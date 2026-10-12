const { createCache, deezerGet, isPlayableTrack, mapTrack } = require('./deezer.service');

// Éxitos en español: chart Latino de Deezer (género 197). Alimenta /api/chart y /api/home.
const LATIN_CHART_TRACKS_PATH = '/chart/197/tracks?limit=50';
const LATIN_CHART_ARTISTS_PATH = '/chart/197/artists?limit=50';

// Los charts cambian como mucho una vez al día: los lotes se cachean; la mezcla es por petición
const cached = createCache({ ttlMs: 10 * 60 * 1000, maxEntries: 10 });

// Fisher-Yates sobre una copia: mezcla uniforme sin alterar el lote cacheado
// (sort(() => 0.5 - Math.random()) produce un orden sesgado).
function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Mismo formato que /api/search; solo pistas con audio, para que /api/stream pueda reproducirlas
const getLatinChartTracks = () =>
  cached('tracks', async () => {
    const body = await deezerGet(LATIN_CHART_TRACKS_PATH);
    return (body.data || []).filter(isPlayableTrack).map((track) => mapTrack(track));
  });

const getLatinChartArtists = () =>
  cached('artists', async () => {
    const body = await deezerGet(LATIN_CHART_ARTISTS_PATH);
    return body.data || [];
  });

module.exports = { shuffle, getLatinChartTracks, getLatinChartArtists };
