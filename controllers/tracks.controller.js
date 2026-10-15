const supabaseAdmin = require('../services/supabaseAdmin');
const tracksService = require('../services/tracks.service');
const { HttpError } = require('../utils/http');

async function upsertTrack(req, res) {
  const track = tracksService.parseTrack(req.body);
  const saved = await tracksService.upsertTrack(track);

  res.status(200).json({ success: true, track: saved });
}

async function getTrack(req, res) {
  const { id_externo } = req.params;
  tracksService.assertTrackId(id_externo);

  const { data, error } = await supabaseAdmin
    .from('pistas')
    .select('*')
    .eq('id_externo', id_externo)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new HttpError(404, 'Pista no encontrada');

  res.status(200).json({ success: true, track: data });
}

module.exports = { upsertTrack, getTrack };
