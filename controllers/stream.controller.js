const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { assertTrackId } = require('../services/tracks.service');
const { resolveAudioSource, invalidateAudioSource, assertAllowedUrl } = require('../services/audioProviders');
const { HttpError } = require('../utils/http');

// Cabeceras del proveedor que el reproductor necesita para saber duración y posición
const FORWARDED_HEADERS = ['content-type', 'content-length', 'content-range', 'last-modified', 'etag'];
const RANGE_REGEX = /^bytes=(\d+-\d*|-\d+)$/;

/**
 * GET /api/stream/:track_id
 * Proxy "zero-disk": el audio pasa del proveedor al cliente por streaming, en memoria,
 * sin escribirse nunca en disco. Reenvía `Range` para que el cliente pueda hacer seek.
 */
async function streamTrack(req, res) {
  const { track_id } = req.params;
  assertTrackId(track_id);

  const range = req.headers.range;
  if (range && !RANGE_REGEX.test(range)) {
    throw new HttpError(416, 'Cabecera Range inválida');
  }

  const source = await resolveAudioSource(track_id);

  // Si el cliente se va (cambia de canción, hace seek, cierra la pestaña) se corta la descarga del proveedor
  const upstreamAbort = new AbortController();
  res.on('close', () => upstreamAbort.abort());

  let upstream;
  try {
    upstream = await fetch(source.url, {
      headers: range ? { Range: range } : {},
      signal: upstreamAbort.signal,
    });
  } catch (error) {
    if (upstreamAbort.signal.aborted) return;
    throw new HttpError(502, 'No se pudo conectar con la fuente de audio');
  }

  // Las redirecciones del proveedor también deben quedarse en sus dominios
  assertAllowedUrl(upstream.url, source.provider);

  if (upstream.status === 416) {
    upstream.body?.cancel();
    const contentRange = upstream.headers.get('content-range');
    if (contentRange) res.setHeader('Content-Range', contentRange);
    throw new HttpError(416, 'Rango fuera del tamaño del archivo');
  }

  if (!upstream.ok || !upstream.body) {
    upstream.body?.cancel();
    // La URL cacheada pudo caducar (p. ej. previews firmadas de Deezer): el siguiente intento la resuelve de nuevo
    invalidateAudioSource(track_id);
    if (upstream.status === 404) throw new HttpError(404, 'Audio no disponible para esta pista');
    throw new HttpError(502, 'La fuente de audio no respondió correctamente');
  }

  res.status(upstream.status); // 200 completo o 206 Partial Content
  for (const name of FORWARDED_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) res.setHeader(name, value);
  }
  if (!res.getHeader('content-type')?.startsWith('audio/')) res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Audio-Preview', String(source.preview));

  try {
    await pipeline(Readable.fromWeb(upstream.body), res);
  } catch (error) {
    // Cortes del cliente (seek, salto de canción) son normales y no se registran
    if (upstreamAbort.signal.aborted || error.code === 'ERR_STREAM_PREMATURE_CLOSE') return;
    console.error('[stream]', track_id, error);
  }
}

module.exports = { streamTrack };
