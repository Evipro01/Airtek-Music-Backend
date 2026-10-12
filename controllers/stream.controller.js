const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { assertTrackId } = require('../services/tracks.service');
const { resolveAudioSource, invalidateAudioSource, assertAllowedUrl } = require('../services/audioProviders');
const { HttpError } = require('../utils/http');

// Cabeceras del proveedor que el reproductor necesita para saber duración y posición
const FORWARDED_HEADERS = ['content-type', 'content-length', 'content-range', 'last-modified', 'etag'];
const RANGE_REGEX = /^bytes=(\d+-\d*|-\d+)$/;
// Respuestas típicas de una URL firmada que ya no es válida
const EXPIRED_URL_STATUSES = new Set([401, 403, 410]);

/**
 * Algunos nodos (p. ej. ciertos nodos de Audius) ignoran Range y devuelven el archivo entero con 200.
 * Sin un 206 el navegador no puede hacer seek, así que el proxy emula el rango a partir de
 * Content-Length. Devuelve { start, end, total } o null si no hace falta (o no es posible) emularlo.
 */
function rangeToEmulate(range, upstream) {
  if (!range || upstream.status !== 200) return null;
  const total = Number(upstream.headers.get('content-length'));
  const match = /^bytes=(\d+)-(\d*)$/.exec(range);
  if (!match || !Number.isSafeInteger(total) || total <= 0) return null;

  const start = Number(match[1]);
  const end = match[2] === '' ? total - 1 : Math.min(Number(match[2]), total - 1);
  return { start, end, total };
}

const waitForDrainOrClose = (res) =>
  new Promise((resolve) => {
    const done = () => {
      res.off('drain', done);
      res.off('close', done);
      resolve();
    };
    res.on('drain', done);
    res.on('close', done);
  });

// Reenvía solo los bytes [start, end] del archivo completo: descarta lo anterior al vuelo, sin guardarlo
async function pipeByteRange(body, res, { start, end }) {
  const reader = body.getReader();
  let toSkip = start;
  let remaining = end - start + 1;
  try {
    while (remaining > 0 && !res.destroyed) {
      const { done, value } = await reader.read();
      if (done) break;

      let chunk = value;
      if (toSkip > 0) {
        if (chunk.length <= toSkip) {
          toSkip -= chunk.length;
          continue;
        }
        chunk = chunk.subarray(toSkip);
        toSkip = 0;
      }
      if (chunk.length > remaining) chunk = chunk.subarray(0, remaining);
      remaining -= chunk.length;

      if (!res.write(chunk)) await waitForDrainOrClose(res);
    }
    if (!res.destroyed) res.end();
  } finally {
    reader.cancel().catch(() => {});
  }
}

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

  // Si el cliente se va (cambia de canción, hace seek, cierra la pestaña) se corta la descarga del proveedor
  const upstreamAbort = new AbortController();
  res.on('close', () => upstreamAbort.abort());

  const fetchUpstream = async (url) => {
    try {
      return await fetch(url, { headers: range ? { Range: range } : {}, signal: upstreamAbort.signal });
    } catch (error) {
      if (upstreamAbort.signal.aborted) return null;
      throw new HttpError(502, 'No se pudo conectar con la fuente de audio');
    }
  };

  let source = await resolveAudioSource(track_id);
  let upstream = await fetchUpstream(source.url);
  if (!upstream) return;

  // URL firmada caducada (previews de Deezer, nodos de Audius): se resuelve una nueva y se reintenta una vez
  if (EXPIRED_URL_STATUSES.has(upstream.status)) {
    upstream.body?.cancel();
    invalidateAudioSource(track_id);
    source = await resolveAudioSource(track_id);
    upstream = await fetchUpstream(source.url);
    if (!upstream) return;
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

  const emulated = rangeToEmulate(range, upstream);
  if (emulated && emulated.start >= emulated.total) {
    upstream.body.cancel().catch(() => {});
    res.setHeader('Content-Range', `bytes */${emulated.total}`);
    throw new HttpError(416, 'Rango fuera del tamaño del archivo');
  }

  // 200 completo o 206 Partial Content (del proveedor o emulado por el proxy)
  res.status(emulated ? 206 : upstream.status);
  for (const name of FORWARDED_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) res.setHeader(name, value);
  }
  if (emulated) {
    res.setHeader('Content-Range', `bytes ${emulated.start}-${emulated.end}/${emulated.total}`);
    res.setHeader('Content-Length', String(emulated.end - emulated.start + 1));
  }
  if (!res.getHeader('content-type')?.startsWith('audio/')) res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Audio-Preview', String(source.preview));
  // Cabeceras (206, Content-Length, Content-Range) al navegador ya, sin esperar al primer trozo de audio
  res.flushHeaders();

  // Zero-disk y sin acumular: cada trozo que llega del proveedor se reenvía al cliente en cuanto llega,
  // y pipeline aplica contrapresión (si el cliente va lento, se deja de leer del proveedor)
  try {
    if (emulated) await pipeByteRange(upstream.body, res, emulated);
    else await pipeline(Readable.fromWeb(upstream.body), res);
  } catch (error) {
    // Cortes del cliente (seek, salto de canción) son normales y no se registran
    if (upstreamAbort.signal.aborted || error.code === 'ERR_STREAM_PREMATURE_CLOSE') return;
    console.error('[stream]', track_id, error);
  }
}

module.exports = { streamTrack };
