const { HttpError } = require('../utils/http');

const DEEZER_API_URL = 'https://api.deezer.com';
const TIMEOUT_MS = 8000;
const DEEZER_NO_DATA = 800; // Código de Deezer para "el recurso no existe"
const DEEZER_QUOTA_EXCEEDED = 4; // "Quota limit exceeded": ~50 peticiones cada 5 s por IP

/**
 * GET a la API pública de Deezer. Deezer devuelve sus errores con HTTP 200 y un objeto `error`:
 * "no data" se traduce a 404, el límite de cuota (código 4 o HTTP 429) a 429 y el resto a 502.
 */
async function deezerGet(path) {
  let response;
  try {
    response = await fetch(DEEZER_API_URL + path, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new HttpError(502, 'No se pudo conectar con Deezer');
  }
  if (response.status === 429) throw new HttpError(429, 'Deezer: límite de peticiones alcanzado');
  if (!response.ok) throw new HttpError(502, 'Deezer no respondió correctamente');

  const body = await response.json();
  if (body.error?.code === DEEZER_NO_DATA) throw new HttpError(404, 'No se encontró en Deezer');
  if (body.error?.code === DEEZER_QUOTA_EXCEEDED) throw new HttpError(429, 'Deezer: límite de peticiones alcanzado');
  if (body.error) throw new HttpError(502, `Deezer rechazó la petición: ${body.error.message}`);
  return body;
}

// Solo pistas con audio: /api/stream necesita el preview para reproducirlas
const isPlayableTrack = (track) => track?.type === 'track' && Boolean(track.preview);

const prefixedId = (type, id) => (id ? `deezer:${type}:${id}` : null);

/**
 * Pista de Deezer → formato de la tabla `pistas` + datos para enlazar artista y álbum.
 * `album` permite pasar el álbum padre cuando la pista viene dentro de /album/:id.
 */
function mapTrack(track, album = track.album) {
  return {
    id_externo: prefixedId('track', track.id),
    titulo: track.title,
    artista: track.artist?.name ?? 'Desconocido',
    portada_url: album?.cover_medium || null,
    artista_id: prefixedId('artist', track.artist?.id),
    album_id: prefixedId('album', album?.id),
    album: album?.title ?? null,
    duracion: Number.isFinite(track.duration) ? track.duration : null,
    explicita: Boolean(track.explicit_lyrics),
  };
}

const RECORD_TYPES = { album: 'Álbum', single: 'Sencillo', ep: 'EP', compile: 'Recopilatorio' };
const recordTypeLabel = (recordType) => RECORD_TYPES[recordType] ?? 'Álbum';

// Resultado de /search/artist → tarjeta de artista (enlaza a /artist/:id)
function mapArtist(artist) {
  return {
    id: prefixedId('artist', artist.id),
    nombre: artist.name,
    imagen_url: artist.picture_medium || artist.picture_big || null,
    fans: Number.isFinite(artist.nb_fan) ? artist.nb_fan : null,
    num_albumes: Number.isFinite(artist.nb_album) ? artist.nb_album : null,
  };
}

// Resultado de /search/album → tarjeta de álbum (enlaza a /album/:id)
function mapAlbum(album) {
  return {
    id: prefixedId('album', album.id),
    titulo: album.title,
    portada_url: album.cover_medium || album.cover_big || null,
    artista: album.artist?.name ?? 'Desconocido',
    artista_id: prefixedId('artist', album.artist?.id),
    tipo: recordTypeLabel(album.record_type),
    num_pistas: Number.isFinite(album.nb_tracks) ? album.nb_tracks : null,
    explicita: Boolean(album.explicit_lyrics),
  };
}

/**
 * Acepta el id con prefijo que usa el frontend ("deezer:artist:27") o solo el número ("27").
 */
function parseDeezerId(raw, type) {
  const match = new RegExp(`^(?:deezer:${type}:)?(\\d{1,20})$`).exec(String(raw));
  if (!match) throw new HttpError(400, `Id de ${type === 'artist' ? 'artista' : 'álbum'} no válido`);
  return match[1];
}

// Caché en memoria con caducidad y tamaño acotado (los datos de catálogo cambian poco)
function createCache({ ttlMs, maxEntries = 500 }) {
  const entries = new Map();
  return async function cached(key, load) {
    const hit = entries.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    const value = await load();
    if (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
    entries.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  };
}

module.exports = {
  deezerGet,
  isPlayableTrack,
  mapTrack,
  mapArtist,
  mapAlbum,
  prefixedId,
  recordTypeLabel,
  parseDeezerId,
  createCache,
};
