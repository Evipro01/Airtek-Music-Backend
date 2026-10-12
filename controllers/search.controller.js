const { HttpError } = require('../utils/http');
const { deezerGet, isPlayableTrack, mapTrack, mapArtist, mapAlbum } = require('../services/deezer.service');
const audius = require('../services/audius.service');
const { prewarmAudioSources } = require('../services/audioProviders');

// Pistas de Audius cuya URL de audio se pre-resuelve al buscar (solo Audius: Deezer limita
// a ~50 peticiones cada 5 s por IP y su resolución ya es rápida)
const AUDIUS_PREWARM_COUNT = 5;

const RESULTS_PER_PROVIDER = 10;
const ARTISTS_LIMIT = 6;
const ALBUMS_LIMIT = 8;
const PROVIDER_TIMEOUT_MS = 8000;
const MAX_QUERY_LENGTH = 100;

// Deezer limita por IP (~50 peticiones cada 5 s): sus tres consultas salen escalonadas, no en el mismo milisegundo
const DEEZER_STAGGER_MS = 200;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Caché corta por texto de búsqueda: el desplegable del buscador y la página /search suelen pedir
// lo mismo seguido. Solo se guardan respuestas completas (sin categorías perdidas por la cuota).
const CACHE_TTL_MS = 2 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;
const cache = new Map();

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.payload;
}

function setCached(key, payload) {
  // Map conserva el orden de inserción: se descarta la entrada más antigua
  if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(key, { payload, expiresAt: Date.now() + CACHE_TTL_MS });
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

// Solo pistas con audio reproducible: si no, /api/stream devolvería 404 al darle play
async function searchDeezer(q) {
  const params = new URLSearchParams({ q, limit: String(RESULTS_PER_PROVIDER) });
  const body = await deezerGet(`/search?${params}`);

  return (body.data || []).filter((track) => track.readable && isPlayableTrack(track)).map((track) => mapTrack(track));
}

async function searchDeezerArtists(q) {
  const params = new URLSearchParams({ q, limit: String(ARTISTS_LIMIT) });
  const body = await deezerGet(`/search/artist?${params}`);
  return (body.data || []).map(mapArtist);
}

async function searchDeezerAlbums(q) {
  const params = new URLSearchParams({ q, limit: String(ALBUMS_LIMIT) });
  const body = await deezerGet(`/search/album?${params}`);
  return (body.data || []).map(mapAlbum);
}

async function searchJamendo(q, clientId) {
  const url = new URL('https://api.jamendo.com/v3.0/tracks/');
  url.search = new URLSearchParams({
    client_id: clientId,
    search: q,
    limit: String(RESULTS_PER_PROVIDER),
    format: 'json',
    imagesize: '300',
  });

  const body = await fetchJson(url);
  if (body.headers?.status !== 'success') {
    throw new Error(`Jamendo: ${body.headers?.error_message || 'respuesta inválida'}`);
  }

  return (body.results || [])
    .filter((track) => track.audio)
    .map((track) => ({
      id_externo: `jamendo:track:${track.id}`,
      titulo: track.name,
      artista: track.artist_name || 'Desconocido',
      portada_url: track.album_image || track.image || null,
      // Las páginas de artista y álbum solo existen para Deezer: sin id no se enlazan
      artista_id: null,
      album_id: null,
      album: track.album_name || null,
      duracion: Number.isFinite(Number(track.duration)) ? Number(track.duration) : null,
      explicita: false,
    }));
}

// Alterna resultados de cada proveedor para que ninguno acapare los primeros puestos
function interleave(lists) {
  const merged = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let i = 0; i < longest; i++) {
    for (const list of lists) {
      if (i < list.length) merged.push(list[i]);
    }
  }
  return merged;
}

async function search(req, res) {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!q || q.length > MAX_QUERY_LENGTH) {
    throw new HttpError(400, `El parámetro q es obligatorio (máximo ${MAX_QUERY_LENGTH} caracteres)`);
  }

  const cacheKey = q.toLowerCase();
  const cached = getCached(cacheKey);
  if (cached) return res.status(200).json(cached);

  // Canciones de Deezer (previews de 30 s), Audius (completas) y Jamendo si hay client_id, más
  // artistas y álbumes de Deezer. Las de Deezer salen escalonadas (0, 200 y 400 ms) por su límite por IP.
  // allSettled, no all: si una falla (p. ej. 429 de Deezer) o tarda más de 8 s, su categoría queda
  // vacía y se responde con las demás.
  const jamendoClientId = process.env.JAMENDO_CLIENT_ID;
  const queries = [
    { name: 'deezer', category: 'pistas', run: () => searchDeezer(q) },
    { name: 'audius', category: 'pistas', run: () => audius.searchTracks(q, RESULTS_PER_PROVIDER) },
    { name: 'deezer_artistas', category: 'artistas', run: () => wait(DEEZER_STAGGER_MS).then(() => searchDeezerArtists(q)) },
    { name: 'deezer_albumes', category: 'albumes', run: () => wait(2 * DEEZER_STAGGER_MS).then(() => searchDeezerAlbums(q)) },
  ];
  if (jamendoClientId) queries.push({ name: 'jamendo', category: 'pistas', run: () => searchJamendo(q, jamendoClientId) });

  const settled = await Promise.allSettled(queries.map((query) => query.run()));

  const proveedores = { jamendo: jamendoClientId ? undefined : 'omitido' };
  const results = { pistas: [], artistas: [], albumes: [] };
  let hitQuota = false;
  settled.forEach((result, i) => {
    const { name, category } = queries[i];
    if (result.status === 'fulfilled') {
      proveedores[name] = 'ok';
      results[category].push(result.value);
    } else {
      const isQuota = result.reason?.status === 429;
      hitQuota ||= isQuota;
      proveedores[name] = isQuota ? 'limite' : 'error';
      console.error(`[search] ${name}:`, result.reason?.message || result.reason);
    }
  });

  // Solo es un fallo si no respondió ninguna consulta (nunca un 429 hacia el frontend)
  if (settled.every((result) => result.status === 'rejected')) {
    throw new HttpError(
      502,
      hitQuota
        ? 'Hay muchas búsquedas en este momento, intenta de nuevo en unos segundos'
        : 'Los proveedores de música no están disponibles, intenta de nuevo más tarde',
    );
  }

  const data = {
    pistas: interleave(results.pistas),
    artistas: results.artistas.flat(),
    albumes: results.albumes.flat(),
  };
  const total = { pistas: data.pistas.length, artistas: data.artistas.length, albumes: data.albumes.length };
  const payload = { success: true, data, meta: { q, total, proveedores } };
  if (settled.every((result) => result.status === 'fulfilled')) setCached(cacheKey, payload);
  res.status(200).json(payload);

  // Tras responder: mientras el usuario elige, se resuelven las URLs de audio de Audius
  prewarmAudioSources(
    data.pistas
      .filter((track) => track.id_externo.startsWith('audius:'))
      .slice(0, AUDIUS_PREWARM_COUNT)
      .map((track) => track.id_externo),
  );
}

module.exports = { search };
