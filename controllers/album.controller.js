const {
  createCache,
  deezerGet,
  isPlayableTrack,
  mapTrack,
  parseDeezerId,
  prefixedId,
  recordTypeLabel,
} = require('../services/deezer.service');

const MAX_TRACKS = 500;
const cached = createCache({ ttlMs: 30 * 60 * 1000 });

async function loadAlbum(id) {
  const album = await deezerGet(`/album/${id}`);

  // /album/:id incluye las pistas; si el álbum es muy largo vienen recortadas y se piden aparte
  let tracks = album.tracks?.data || [];
  if (tracks.length < (album.nb_tracks ?? 0)) {
    tracks = (await deezerGet(`/album/${id}/tracks?limit=${MAX_TRACKS}`)).data || tracks;
  }

  return {
    id: prefixedId('album', album.id),
    titulo: album.title,
    portada_url: album.cover_xl || album.cover_big || album.cover_medium || null,
    fecha_lanzamiento: album.release_date || null,
    tipo: recordTypeLabel(album.record_type),
    artista: album.artist?.name ?? 'Desconocido',
    artista_id: prefixedId('artist', album.artist?.id),
    // Solo las pistas con audio de prueba, que son las que /api/stream puede reproducir
    pistas: tracks.filter(isPlayableTrack).map((track) => mapTrack(track, album)),
  };
}

// GET /api/albums/:id → { success, album }
async function getAlbum(req, res) {
  const id = parseDeezerId(req.params.id, 'album');
  const album = await cached(id, () => loadAlbum(id));
  res.status(200).json({ success: true, album });
}

module.exports = { getAlbum };
