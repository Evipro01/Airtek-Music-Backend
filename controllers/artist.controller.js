const {
  createCache,
  deezerGet,
  isPlayableTrack,
  mapTrack,
  parseDeezerId,
  prefixedId,
  recordTypeLabel,
} = require('../services/deezer.service');

const TOP_LIMIT = 10;
const ALBUMS_LIMIT = 50;
const cached = createCache({ ttlMs: 30 * 60 * 1000 });

async function loadArtist(id) {
  // Las tres consultas a Deezer van en paralelo; si el artista no existe, /artist/:id responde 404
  const [artist, top, albums] = await Promise.all([
    deezerGet(`/artist/${id}`),
    deezerGet(`/artist/${id}/top?limit=${TOP_LIMIT}`),
    deezerGet(`/artist/${id}/albums?limit=${ALBUMS_LIMIT}`),
  ]);

  return {
    artista: {
      id: prefixedId('artist', artist.id),
      nombre: artist.name,
      imagen_url: artist.picture_xl || artist.picture_big || null,
      fans: Number.isFinite(artist.nb_fan) ? artist.nb_fan : null,
    },
    top: (top.data || []).filter(isPlayableTrack).map((track) => mapTrack(track)),
    // Discografía de la más reciente a la más antigua
    albumes: (albums.data || [])
      .map((album) => ({
        id: prefixedId('album', album.id),
        titulo: album.title,
        portada_url: album.cover_medium || null,
        fecha_lanzamiento: album.release_date || null,
        tipo: recordTypeLabel(album.record_type),
      }))
      .sort((a, b) => (b.fecha_lanzamiento ?? '').localeCompare(a.fecha_lanzamiento ?? '')),
  };
}

// GET /api/artists/:id → { success, artista, top, albumes }
async function getArtist(req, res) {
  const id = parseDeezerId(req.params.id, 'artist');
  const artist = await cached(id, () => loadArtist(id));
  res.status(200).json({ success: true, ...artist });
}

module.exports = { getArtist };
