const supabaseAdmin = require('./supabaseAdmin');
const { HttpError } = require('../utils/http');

// Formato de la PK: "<proveedor>:<tipo>:<id>", p. ej. "deezer:track:3135556"
const TRACK_ID_REGEX = /^[a-z0-9_-]+:[a-z0-9_-]+:[^\s/]+$/i;

function assertTrackId(idExterno) {
  if (typeof idExterno !== 'string' || idExterno.length > 200 || !TRACK_ID_REGEX.test(idExterno)) {
    throw new HttpError(400, 'id_externo debe tener el formato "<proveedor>:<tipo>:<id>"');
  }
}

function requiredText(value, field, max) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new HttpError(400, `${field} es obligatorio (máximo ${max} caracteres)`);
  }
  return value.trim();
}

function optionalUrl(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 2048 || !/^https:\/\/\S+$/i.test(value)) {
    throw new HttpError(400, 'portada_url debe ser una URL https válida');
  }
  return value;
}

// Valida y normaliza los datos de una pista recibidos en el body
function parseTrack(body = {}) {
  assertTrackId(body.id_externo);

  return {
    id_externo: body.id_externo,
    titulo: requiredText(body.titulo, 'titulo', 300),
    artista: requiredText(body.artista, 'artista', 300),
    portada_url: optionalUrl(body.portada_url),
  };
}

// Inserta la pista o refresca sus datos si ya existe (la tabla actúa como caché de la API externa).
// `pistas` es un catálogo compartido: solo el backend escribe en él, con la service_role.
async function upsertTrack(track) {
  const { data, error } = await supabaseAdmin
    .from('pistas')
    .upsert({ ...track, fecha_actualizacion: new Date().toISOString() }, { onConflict: 'id_externo' })
    .select()
    .single();

  if (error) throw error;
  return data;
}

module.exports = { parseTrack, upsertTrack, assertTrackId };
