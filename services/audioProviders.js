const { HttpError } = require('../utils/http');
const audius = require('./audius.service');

/**
 * Resuelve un `id_externo` ("<proveedor>:track:<id>") a la URL de audio del proveedor.
 * Solo se cachean URLs en memoria (nunca audio): el streaming sigue siendo zero-disk.
 */

const CACHE_MAX_ENTRIES = 1000;
const cache = new Map();

const NUMERIC_ID = /^\d{1,20}$/;
const hostMatches = (pattern) => (hostname) => pattern.test(hostname);

// Nombre de dominio público: ni IPs literales, ni localhost, ni nombres de red interna
function isPublicHostname(hostname) {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':') || hostname.startsWith('[')) return false;
  if (!hostname.includes('.')) return false;
  return !/(^|\.)(localhost|local|internal|intranet|home\.arpa)$/i.test(hostname);
}

const providers = {
  // Pistas completas con licencia Creative Commons
  jamendo: {
    idPattern: NUMERIC_ID,
    isAllowedHost: hostMatches(/(^|\.)jamendo\.com$/),
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
    idPattern: NUMERIC_ID,
    isAllowedHost: hostMatches(/(^|\.)dzcdn\.net$/),
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

  // Canciones completas de la API oficial de Audius. El audio lo sirven nodos de contenido de distintos
  // operadores (creatornode.audius.co, *.figment.io…), así que no hay lista fija de dominios: se exige
  // https y un dominio público. La URL siempre la entrega la API de Audius, nunca el cliente.
  audius: {
    idPattern: /^[A-Za-z0-9]{1,32}$/,
    isAllowedHost: isPublicHostname,
    // URL firmada: si caduca antes, el proxy la renueva y reintenta (stream.controller)
    ttlMs: 30 * 60 * 1000,
    preview: false,
    resolve: (id) => audius.resolveStreamUrl(id),
  },
};

function parseTrackId(trackId) {
  const [provider, type, id] = trackId.split(':');

  if (!providers[provider]) {
    throw new HttpError(400, `Proveedor de audio no soportado. Usa: ${Object.keys(providers).join(', ')}`);
  }
  if (type !== 'track' || !providers[provider].idPattern.test(id ?? '')) {
    throw new HttpError(400, `Formato esperado: "${provider}:track:<id>"`);
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
  if (url.protocol !== 'https:' || !providers[provider].isAllowedHost(url.hostname)) {
    throw new HttpError(502, 'El proveedor devolvió una URL de audio no permitida');
  }
}

// Resoluciones en curso: si llega un play mientras se pre-resuelve esa pista, espera a la misma petición
const inFlight = new Map();

async function loadAudioSource(trackId) {
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

async function resolveAudioSource(trackId) {
  const cached = cache.get(trackId);
  if (cached && cached.expiresAt > Date.now()) return cached;

  if (!inFlight.has(trackId)) {
    inFlight.set(trackId, loadAudioSource(trackId).finally(() => inFlight.delete(trackId)));
  }
  return inFlight.get(trackId);
}

/**
 * Resuelve en segundo plano las URLs de audio de pistas que probablemente se van a reproducir
 * (p. ej. los primeros resultados de una búsqueda): el primer play ya no espera a la API del proveedor.
 * Nunca lanza: si falla, el play la resolverá normalmente.
 */
function prewarmAudioSources(trackIds) {
  for (const trackId of trackIds) {
    resolveAudioSource(trackId).catch(() => {});
  }
}

function invalidateAudioSource(trackId) {
  cache.delete(trackId);
}

module.exports = { resolveAudioSource, prewarmAudioSources, invalidateAudioSource, assertAllowedUrl };
