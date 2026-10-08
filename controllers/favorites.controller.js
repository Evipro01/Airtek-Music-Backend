const { parseTrack, upsertTrack, assertTrackId } = require('../services/tracks.service');
const { HttpError, PG } = require('../utils/http');

async function addFavorite(req, res) {
  const track = parseTrack(req.body);
  const saved = await upsertTrack(track);

  const { data, error } = await req.supabase
    .from('favoritos')
    .insert({ usuario_id: req.user.id, pista_id: saved.id_externo })
    .select('pista_id, fecha_agregado')
    .single();

  // Idempotente: marcar dos veces como favorito no es un error
  if (error?.code === PG.UNIQUE_VIOLATION) {
    return res.status(200).json({ success: true, message: 'La pista ya estaba en favoritos', track: saved });
  }
  if (error) throw error;

  res.status(201).json({
    success: true,
    message: 'Pista añadida a favoritos',
    favorite: { ...data, pista: saved },
  });
}

async function removeFavorite(req, res) {
  const { pista_id } = req.params;
  assertTrackId(pista_id);

  const { data, error } = await req.supabase
    .from('favoritos')
    .delete()
    .eq('usuario_id', req.user.id)
    .eq('pista_id', pista_id)
    .select('pista_id');

  if (error) throw error;
  if (!data.length) throw new HttpError(404, 'La pista no está en tus favoritos');

  res.status(200).json({ success: true, message: 'Pista eliminada de favoritos' });
}

async function listFavorites(req, res) {
  const { data, error } = await req.supabase
    .from('favoritos')
    .select('fecha_agregado, pista:pistas(*)')
    .eq('usuario_id', req.user.id)
    .order('fecha_agregado', { ascending: false });

  if (error) throw error;

  res.status(200).json({ success: true, total: data.length, favorites: data });
}

module.exports = { addFavorite, removeFavorite, listFavorites };
