const { parseTrack, upsertTrack, assertTrackId } = require('../services/tracks.service');
const { HttpError, assertUuid, PG } = require('../utils/http');

const MAX_NOMBRE = 100;
const MAX_ORDEN_RETRIES = 3;

function parseNombre(body = {}) {
  const { nombre } = body;
  if (typeof nombre !== 'string' || !nombre.trim() || nombre.trim().length > MAX_NOMBRE) {
    throw new HttpError(400, `nombre es obligatorio (máximo ${MAX_NOMBRE} caracteres)`);
  }
  return nombre.trim();
}

// Devuelve la playlist si pertenece al usuario; 404 si no existe o es de otro
async function getOwnedPlaylist(req, playlistId) {
  assertUuid(playlistId, 'id de la playlist');

  const { data, error } = await req.supabase
    .from('playlists')
    .select('id')
    .eq('id', playlistId)
    .eq('usuario_id', req.user.id)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new HttpError(404, 'Playlist no encontrada');
  return data;
}

async function createPlaylist(req, res) {
  const nombre = parseNombre(req.body);

  const { data, error } = await req.supabase
    .from('playlists')
    .insert({ usuario_id: req.user.id, nombre })
    .select()
    .single();

  if (error) throw error;

  res.status(201).json({ success: true, playlist: data });
}

async function listPlaylists(req, res) {
  const { data, error } = await req.supabase
    .from('playlists')
    .select('id, nombre, fecha_creacion, fecha_actualizacion, playlist_pistas(count)')
    .eq('usuario_id', req.user.id)
    .order('fecha_creacion', { ascending: false });

  if (error) throw error;

  const playlists = data.map(({ playlist_pistas, ...playlist }) => ({
    ...playlist,
    total_pistas: playlist_pistas[0]?.count ?? 0,
  }));

  res.status(200).json({ success: true, total: playlists.length, playlists });
}

async function getPlaylist(req, res) {
  const { id } = req.params;
  assertUuid(id, 'id de la playlist');

  const { data, error } = await req.supabase
    .from('playlists')
    .select('id, nombre, fecha_creacion, fecha_actualizacion, pistas:playlist_pistas(orden, fecha_agregado, pista:pistas(*))')
    .eq('id', id)
    .eq('usuario_id', req.user.id)
    .order('orden', { referencedTable: 'playlist_pistas', ascending: true })
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new HttpError(404, 'Playlist no encontrada');

  res.status(200).json({ success: true, playlist: { ...data, total_pistas: data.pistas.length } });
}

async function addTrackToPlaylist(req, res) {
  const { id } = req.params;
  await getOwnedPlaylist(req, id);

  const track = parseTrack(req.body);
  const saved = await upsertTrack(track);

  // La PK (playlist_id, pista_id) y `orden` son únicos: se comprueba el duplicado antes de calcular el orden
  const { data: existing, error: existingError } = await req.supabase
    .from('playlist_pistas')
    .select('orden')
    .eq('playlist_id', id)
    .eq('pista_id', saved.id_externo)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing) throw new HttpError(409, 'La pista ya está en la playlist');

  // Si dos peticiones calculan el mismo `orden` a la vez, la segunda choca con el UNIQUE y reintenta
  for (let attempt = 1; attempt <= MAX_ORDEN_RETRIES; attempt++) {
    const { data: last, error: lastError } = await req.supabase
      .from('playlist_pistas')
      .select('orden')
      .eq('playlist_id', id)
      .order('orden', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastError) throw lastError;

    const orden = last ? last.orden + 1 : 0;
    const { data, error } = await req.supabase
      .from('playlist_pistas')
      .insert({ playlist_id: id, pista_id: saved.id_externo, orden })
      .select('orden, fecha_agregado')
      .single();

    if (error?.code === PG.UNIQUE_VIOLATION && attempt < MAX_ORDEN_RETRIES) continue;
    if (error?.code === PG.UNIQUE_VIOLATION) throw new HttpError(409, 'La pista ya está en la playlist');
    if (error) throw error;

    return res.status(201).json({
      success: true,
      message: 'Pista añadida a la playlist',
      item: { ...data, pista: saved },
    });
  }
}

async function removeTrackFromPlaylist(req, res) {
  const { id, pista_id } = req.params;
  await getOwnedPlaylist(req, id);
  assertTrackId(pista_id);

  const { data, error } = await req.supabase
    .from('playlist_pistas')
    .delete()
    .eq('playlist_id', id)
    .eq('pista_id', pista_id)
    .select('pista_id');

  if (error) throw error;
  if (!data.length) throw new HttpError(404, 'La pista no está en la playlist');

  res.status(200).json({ success: true, message: 'Pista eliminada de la playlist' });
}

async function deletePlaylist(req, res) {
  const { id } = req.params;
  assertUuid(id, 'id de la playlist');

  const { data, error } = await req.supabase
    .from('playlists')
    .delete()
    .eq('id', id)
    .eq('usuario_id', req.user.id)
    .select('id');

  if (error) throw error;
  if (!data.length) throw new HttpError(404, 'Playlist no encontrada');

  res.status(200).json({ success: true, message: 'Playlist eliminada' });
}

module.exports = {
  createPlaylist,
  listPlaylists,
  getPlaylist,
  addTrackToPlaylist,
  removeTrackFromPlaylist,
  deletePlaylist,
};
