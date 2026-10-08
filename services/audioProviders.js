const { HttpError } = require('../utils/http');

/**
 * Resuelve un `id_externo` ("<proveedor>:track:<id>") a la URL de audio del proveedor.
 * Solo se cachean URLs en memoria (nunca audio): el streaming sigue siendo zero-disk.
 */

const CACHE_MAX_ENTRIES = 1000;
const cache = new Map();

const providers = {
  // Pistas completas con licencia Creative Commons
  jamendo: {
    allowedHosts: /(^|\.)jamendo\.com$/,
    ttlMs: 6 * 60 * 60 * 1000,
    preview: false,
    async resolve(id) {
      const clientId = process.env.JAMENDO_CLIENT_ID;

      // Sin client_id se usa el endpoint de almacenamiento al que apunta el campo `audio` de su API
      if (!clientId) return `https://prod-1.storage.jamendo.com/?trackid=${id}&format=mp31`;

      const url = new URL('https://api.jamendo.com/v3.0/tracks/');
      url.search = new URLSearchParams({ client_id: clientId, id, format: 'json', audioformat: 'mp32' });

      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new HttpError(502, 'Jamendo no respondió correctamente');

      const body = await response.json();
      if (body.headers?.status !== 'success') throw new HttpError(502, 'Jamendo rechazó la petición');

      const audio = body.results?.[0]?.audio;
      if (!audio) throw new HttpError(404, 'La pista no existe en Jamendo');
      return audio;
    },
  },

  // La API pública de Deezer solo expone previews de 30 s (URLs firmadas que caducan)
  deezer: {
    allowedHosts: /(^|\.)dzcdn\.net$/,
    ttlMs: 10 * 60 * 1000,
    preview: true,
    async resolve(id) {
      const response = await fetch(`https://api.deezer.com/track/${id}`, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new HttpError(502, 'Deezer no respondió correctamente');

      const body = await response.json();
      if (body.error) throw new HttpError(404, 'La pista no existe en Deezer');
      if (!body.preview) throw new HttpError(404, 'La pista no tiene audio disponible en Deezer');
      return body.preview;
    },
  },
};

function parseTrackId(trackId) {
  const [provider, type, id] = trackId.split(':');

  if (!providers[provider]) {
    throw new HttpError(400, `Proveedor de audio no soportado. Usa: ${Object.keys(providers).join(', ')}`);
  }
  if (type !== 'track' || !/^\d{1,20}$/.test(id)) {
    throw new HttpError(400, `Formato esperado: "${provider}:track:<id numérico>"`);
  }
  return { provider, id };
}

// Defensa SSRF: nunca se hace fetch a una URL que no pertenezca al proveedor
function assertAllowedUrl(rawUrl, provider) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new HttpError(502, 'El proveedor devolvió una URL de audio inválida');
  }
  if (url.protocol !== 'https:' || !providers[provider].allowedHosts.test(url.hostname)) {
    throw new HttpError(502, 'El proveedor devolvió una URL de audio no permitida');
  }
}

async function resolveAudioSource(trackId) {
  const cached = cache.get(trackId);
  if (cached && cached.expiresAt > Date.now()) return cached;

  const { provider, id } = parseTrackId(trackId);
  const url = await providers[provider].resolve(id);
  assertAllowedUrl(url, provider);

  const source = {
    url,
    provider,
    preview: providers[provider].preview,
    expiresAt: Date.now() + providers[provider].ttlMs,
  };

  // Map conserva el orden de inserción: se descarta la entrada más antigua
  if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(trackId, source);
  return source;
}

function invalidateAudioSource(trackId) {
  cache.delete(trackId);
}

module.exports = { resolveAudioSource, invalidateAudioSource, assertAllowedUrl };
