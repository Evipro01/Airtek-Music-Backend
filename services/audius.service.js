const { HttpError } = require('../utils/http');

// API pública y oficial de Audius: canciones completas subidas por sus artistas, sin clave.
// Audius pide identificar la app en cada petición con `app_name`.
const AUDIUS_API_URL = 'https://api.audius.co/v1';
const AUDIUS_APP_NAME = 'airtek_music';
const TIMEOUT_MS = 8000;

async function audiusGet(path, params = {}) {
  const query = new URLSearchParams({ ...params, app_name: AUDIUS_APP_NAME });
  let response;
  try {
    response = await fetch(`${AUDIUS_API_URL}${path}?${query}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new HttpError(502, 'No se pudo conectar con Audius');
  }
  // Audius responde 400 "invalid trackId" o 404 cuando la pista no existe
  if (response.status === 400 || response.status === 404) throw new HttpError(404, 'La pista no existe en Audius');
  if (!response.ok) throw new HttpError(502, 'Audius no respondió correctamente');
  return response.json();
}

// Solo pistas que se pueden escuchar completas: se descartan las de pago (gated), borradas u ocultas
const isStreamableTrack = (track) =>
  track.is_streamable !== false &&
  !track.is_stream_gated &&
  !track.stream_conditions &&
  !track.is_delete &&
  track.is_available !== false &&
  track.access?.stream !== false;

// La tabla `pistas` solo acepta portadas https
const httpsOrNull = (url) => (typeof url === 'string' && url.startsWith('https://') ? url : null);

// Pista de Audius → formato estándar de búsqueda. Audius no tiene páginas de artista/álbum en Airtek.
function mapTrack(track) {
  return {
    id_externo: `audius:track:${track.id}`,
    titulo: track.title,
    artista: track.user?.name || 'Desconocido',
    portada_url: httpsOrNull(track.artwork?.['480x480'] || track.artwork?.['150x150']),
    artista_id: null,
    album_id: null,
    album: null,
    duracion: Number.isFinite(track.duration) ? track.duration : null,
    explicita: false,
  };
}

async function searchTracks(query, limit) {
  const body = await audiusGet('/tracks/search', { query, limit: String(limit) });
  return (body.data || []).filter(isStreamableTrack).map(mapTrack);
}

// ─── Elección del nodo de contenido ─────────────────────────────────────────
// Cada pista está en varios nodos (stream.url + stream.mirrors) y se comportan muy distinto: unos
// responden 206 al instante (o redirigen a almacenamiento en la nube) y otros ignoran Range, devuelven
// el archivo entero con 200 y tardan segundos. Sin 206 el navegador no puede hacer seek.
const PROBE_TIMEOUT_MS = 4000;
const HOST_HEALTH_TTL_MS = 60 * 60 * 1000; // lo que se aprende de cada nodo vale 1 hora
const hostHealth = new Map(); // hostname → { supportsRange, ms, expiresAt }

const hostOf = (url) => new URL(url).hostname;

function healthOf(url) {
  const health = hostHealth.get(hostOf(url));
  return health && health.expiresAt > Date.now() ? health : null;
}

// Los mirrors son otros nodos con la misma ruta firmada: se cambia solo el origen
function candidateUrls(stream) {
  const primary = new URL(stream.url);
  const mirrors = (stream.mirrors || []).flatMap((origin) => {
    try {
      const url = new URL(primary);
      const mirror = new URL(origin);
      url.protocol = mirror.protocol;
      url.host = mirror.host;
      return [url.toString()];
    } catch {
      return [];
    }
  });
  return [...new Set([primary.toString(), ...mirrors])];
}

// Pide 1 byte: si el nodo responde 206 soporta seek; el tiempo de respuesta mide su velocidad
async function probe(url) {
  const startedAt = Date.now();
  const response = await fetch(url, { headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
  response.body?.cancel().catch(() => {});

  const supportsRange = response.status === 206;
  hostHealth.set(hostOf(url), { supportsRange, ms: Date.now() - startedAt, expiresAt: Date.now() + HOST_HEALTH_TTL_MS });
  if (!supportsRange) throw new Error(`HTTP ${response.status}`);
  return url;
}

/**
 * URL firmada del audio en el mejor nodo disponible:
 *  1. Si algún nodo de la pista ya se sabe rápido y con Range (última hora), se usa sin probar nada.
 *  2. Si no, se prueban todos en paralelo y gana el primero que responde 206.
 *  3. Si ninguno lo soporta, se usa el principal (el proxy emula el Range para que el seek funcione).
 */
async function resolveStreamUrl(id) {
  const body = await audiusGet(`/tracks/${encodeURIComponent(id)}`);
  const stream = body.data?.stream;
  if (!stream?.url) throw new HttpError(404, 'La pista no tiene audio disponible en Audius');

  const candidates = candidateUrls(stream);

  const known = candidates
    .map((url) => ({ url, health: healthOf(url) }))
    .filter(({ health }) => health?.supportsRange)
    .sort((a, b) => a.health.ms - b.health.ms);
  if (known.length) return known[0].url;

  // Los nodos ya conocidos como lentos/sin Range no se vuelven a probar durante la hora
  const unknown = candidates.filter((url) => !healthOf(url));
  try {
    return await Promise.any(unknown.map(probe));
  } catch {
    return candidates[0];
  }
}

module.exports = { searchTracks, resolveStreamUrl };
