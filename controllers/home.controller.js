const { createCache, deezerGet, prefixedId } = require('../services/deezer.service');
const { getLatinChartArtists, getLatinChartTracks, shuffle } = require('../services/chart.service');

const TRACKS_LIMIT = 20;
const ALBUMS_LIMIT = 10;
const ARTISTS_MIN = 6; // si hay menos artistas favoritos, se completa con populares
const ARTISTS_MAX = 10;
const FAVORITES_SCANNED = 10; // favoritos más recientes de los que se sacan artistas

// El artista de una pista nunca cambia: se cachea un día para no consultar Deezer en cada visita
const trackArtistCache = createCache({ ttlMs: 24 * 60 * 60 * 1000, maxEntries: 5000 });

const toArtist = (artist) => ({
  id: prefixedId('artist', artist.id),
  nombre: artist.name,
  imagen_url: artist.picture_medium || artist.picture_big || null,
});

/**
 * Artistas de las canciones favoritas del usuario, de la más reciente a la más antigua.
 * La tabla `pistas` no guarda el artista_id, así que se consulta la pista en Deezer (/track/:id).
 * Las pistas de Audius o Jamendo no tienen página de artista y se omiten.
 */
async function favoriteArtists(supabase, userId) {
  const { data, error } = await supabase
    .from('favoritos')
    .select('pista_id')
    .eq('usuario_id', userId)
    .order('fecha_agregado', { ascending: false })
    .limit(FAVORITES_SCANNED);
  if (error) throw error;

  const deezerIds = data
    .map(({ pista_id }) => /^deezer:track:(\d+)$/.exec(pista_id)?.[1])
    .filter(Boolean);

  const lookups = await Promise.allSettled(
    deezerIds.map((id) => trackArtistCache(id, async () => (await deezerGet(`/track/${id}`)).artist)),
  );

  const artists = new Map();
  for (const lookup of lookups) {
    if (lookup.status === 'fulfilled' && lookup.value?.id && !artists.has(lookup.value.id)) {
      artists.set(lookup.value.id, toArtist(lookup.value));
    }
  }
  return [...artists.values()].slice(0, ARTISTS_MAX);
}

async function popularArtists(count, excludeIds) {
  const artists = await getLatinChartArtists();
  return shuffle(artists.map(toArtist).filter((artist) => !excludeIds.has(artist.id))).slice(0, count);
}

// Álbumes de las canciones del chart Latino, sin repetir; mezclados en cada visita
async function recommendedAlbums() {
  const tracks = await getLatinChartTracks();
  const albums = new Map();
  for (const track of tracks) {
    if (track.album_id && !albums.has(track.album_id)) {
      albums.set(track.album_id, {
        id: track.album_id,
        titulo: track.album,
        portada_url: track.portada_url,
        artista: track.artista,
        artista_id: track.artista_id,
      });
    }
  }
  return shuffle([...albums.values()]).slice(0, ALBUMS_LIMIT);
}

/**
 * GET /api/home → { success, data: { artistas, albumes, pistas }, meta: { artistas_origen } }
 * Cada carril se calcula por separado: si uno falla, el resto del inicio se muestra igual.
 */
async function getHome(req, res) {
  const [favorites, albums, tracks] = await Promise.allSettled([
    favoriteArtists(req.supabase, req.user.id),
    recommendedAlbums(),
    getLatinChartTracks().then((list) => shuffle(list).slice(0, TRACKS_LIMIT)),
  ]);

  for (const [name, result] of [['artistas favoritos', favorites], ['álbumes', albums], ['pistas', tracks]]) {
    if (result.status === 'rejected') console.error(`[home] ${name}:`, result.reason?.message || result.reason);
  }

  // Artistas: primero los de tus favoritos; si son pocos (o ninguno), se completan con populares
  const ownArtists = favorites.status === 'fulfilled' ? favorites.value : [];
  let artistas = ownArtists;
  if (ownArtists.length < ARTISTS_MIN) {
    const fill = await popularArtists(ARTISTS_MIN - ownArtists.length, new Set(ownArtists.map((a) => a.id))).catch(
      (error) => {
        console.error('[home] artistas populares:', error.message);
        return [];
      },
    );
    artistas = [...ownArtists, ...fill];
  }
  const artistasOrigen =
    ownArtists.length === 0 ? 'populares' : ownArtists.length === artistas.length ? 'favoritos' : 'mixto';

  // Distinto en cada recarga: que el navegador no reutilice la respuesta
  res.set('Cache-Control', 'no-store');
  res.status(200).json({
    success: true,
    data: {
      artistas,
      albumes: albums.status === 'fulfilled' ? albums.value : [],
      pistas: tracks.status === 'fulfilled' ? tracks.value : [],
    },
    meta: { artistas_origen: artistasOrigen },
  });
}

module.exports = { getHome };
