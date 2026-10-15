const { HttpError } = require('../utils/http');

/**
 * Asistente "Buscar con IA": reenvía el texto del oyente al flujo de n8n (Gemini + Deezer) y devuelve su
 * respuesta validada. El navegador nunca habla con n8n: la URL y la clave del webhook solo viven aquí.
 *
 *   N8N_IA_URL     URL de producción del webhook (…/webhook/airtekmusic-ia)
 *   N8N_IA_HEADER  nombre de la cabecera de la credencial "Header Auth" del webhook
 *   N8N_IA_KEY     valor de esa cabecera
 */
const MAX_PROMPT_LENGTH = 300;
const N8N_TIMEOUT_MS = 45 * 1000;
const MAX_TRACKS = 15;

const INTENTS = new Set(['playlist', 'biografia', 'general']);
const TRACK_ID = /^deezer:track:\d{1,20}$/;
const ARTIST_ID = /^deezer:artist:\d{1,20}$/;
const ALBUM_ID = /^deezer:album:\d{1,20}$/;

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const matching = (value, pattern) => (typeof value === 'string' && pattern.test(value) ? value : null);
const httpsUrl = (value) => (typeof value === 'string' && value.length <= 2048 && /^https:\/\/\S+$/i.test(value) ? value : null);

// Solo los campos que usa el frontend, con el mismo formato que /api/search
function toTrack(raw) {
  if (!raw || typeof raw !== 'object' || !TRACK_ID.test(raw.id_externo ?? '')) return null;
  const titulo = text(raw.titulo, 300);
  const artista = text(raw.artista, 300);
  if (!titulo || !artista) return null;

  return {
    id_externo: raw.id_externo,
    titulo,
    artista,
    artista_id: matching(raw.artista_id, ARTIST_ID),
    album: text(raw.album, 300) || null,
    album_id: matching(raw.album_id, ALBUM_ID),
    portada_url: httpsUrl(raw.portada_url),
    duracion: Number.isInteger(raw.duracion) && raw.duracion > 0 && raw.duracion < 86400 ? raw.duracion : null,
    explicita: raw.explicita === true,
  };
}

// La respuesta de n8n se trata como datos no confiables: se valida y se queda solo lo esperado
function normalizeAnswer(body) {
  if (!body || typeof body !== 'object' || !INTENTS.has(body.intencion)) {
    throw new HttpError(502, 'El asistente devolvió una respuesta inesperada. Inténtalo de nuevo.');
  }

  const ids = new Set();
  const canciones = [];
  for (const raw of Array.isArray(body.canciones) ? body.canciones : []) {
    const track = toTrack(raw);
    if (!track || ids.has(track.id_externo)) continue;
    ids.add(track.id_externo);
    canciones.push(track);
    if (canciones.length === MAX_TRACKS) break;
  }

  return {
    intencion: body.intencion,
    titulo: text(body.titulo, 150) || null,
    texto: text(body.texto, 3000) || null,
    respuesta: text(body.respuesta, 1000) || null,
    canciones,
    error: text(body.error, 300) || null,
  };
}

// POST /api/ia { prompt } → { success, data: { intencion, titulo, texto, respuesta, canciones, error } }
async function askAssistant(req, res) {
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  if (!prompt || prompt.length > MAX_PROMPT_LENGTH) {
    throw new HttpError(400, `Escribe qué quieres escuchar (máximo ${MAX_PROMPT_LENGTH} caracteres)`);
  }

  const url = process.env.N8N_IA_URL;
  const header = process.env.N8N_IA_HEADER;
  const key = process.env.N8N_IA_KEY;
  if (!url || !header || !key) {
    throw new HttpError(503, 'El asistente de IA no está configurado en el servidor');
  }

  // Si el oyente cancela o cierra la página, se corta también la llamada a n8n
  const disconnected = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) disconnected.abort();
  });

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [header]: key },
      body: JSON.stringify({ prompt }),
      signal: AbortSignal.any([disconnected.signal, AbortSignal.timeout(N8N_TIMEOUT_MS)]),
    });
  } catch (error) {
    if (disconnected.signal.aborted) return;
    if (error.name === 'TimeoutError') {
      throw new HttpError(504, 'El asistente tardó demasiado en responder. Inténtalo de nuevo.');
    }
    console.error('[ia] No se pudo conectar con n8n:', error.message);
    throw new HttpError(502, 'No se pudo conectar con el asistente de IA');
  }

  if (!response.ok) {
    console.error(`[ia] n8n respondió HTTP ${response.status}`);
    throw new HttpError(502, 'El asistente de IA no está disponible ahora mismo');
  }

  const body = await response.json().catch(() => null);
  res.set('Cache-Control', 'no-store');
  res.status(200).json({ success: true, data: normalizeAnswer(body) });
}

module.exports = { askAssistant };
