const { HttpError } = require('../utils/http');
const { deezerGet, isPlayableTrack, mapTrack } = require('../services/deezer.service');
const audius = require('../services/audius.service');
const { prewarmAudioSources } = require('../services/audioProviders');

// Pistas de Audius cuya URL de audio se pre-resuelve al buscar (solo Audius: Deezer limita
// a ~50 peticiones cada 5 s por IP y su resolución ya es rápida)
const AUDIUS_PREWARM_COUNT = 5;

const RESULTS_PER_PROVIDER = 10;
const PROVIDER_TIMEOUT_MS = 8000;
const MAX_QUERY_LENGTH = 100;

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

  // Deezer (previews de 30 s) y Audius (canciones completas) siempre; Jamendo si hay client_id.
  // allSettled, no all: si un proveedor falla o tarda más de 8 s, se responde con los demás.
  const jamendoClientId = process.env.JAMENDO_CLIENT_ID;
  const providers = [
    { name: 'deezer', run: () => searchDeezer(q) },
    { name: 'audius', run: () => audius.searchTracks(q, RESULTS_PER_PROVIDER) },
  ];
  if (jamendoClientId) providers.push({ name: 'jamendo', run: () => searchJamendo(q, jamendoClientId) });

  const settled = await Promise.allSettled(providers.map((provider) => provider.run()));

  const proveedores = { jamendo: jamendoClientId ? undefined : 'omitido' };
  const lists = [];
  settled.forEach((result, i) => {
    const { name } = providers[i];
    if (result.status === 'fulfilled') {
      proveedores[name] = 'ok';
      lists.push(result.value);
    } else {
      proveedores[name] = 'error';
      console.error(`[search] ${name}:`, result.reason?.message || result.reason);
    }
  });

  // Solo es un fallo si no respondió ningún proveedor consultado
  if (!lists.length) {
    throw new HttpError(502, 'Los proveedores de música no están disponibles, intenta de nuevo más tarde');
  }

  const data = interleave(lists);
  res.status(200).json({ success: true, data, meta: { q, total: data.length, proveedores } });

  // Tras responder: mientras el usuario elige, se resuelven las URLs de audio de Audius
  prewarmAudioSources(
    data
      .filter((track) => track.id_externo.startsWith('audius:'))
      .slice(0, AUDIUS_PREWARM_COUNT)
      .map((track) => track.id_externo),
  );
}

module.exports = { search };
