// Éxitos en español para el inicio: chart Latino de Deezer (playlist editorial 197).
// Se trae un lote grande y en cada petición se entrega una selección aleatoria distinta.
const DEEZER_LATIN_CHART_URL = 'https://api.deezer.com/chart/197/tracks?limit=50';
const PROVIDER_TIMEOUT_MS = 8000;
const TRACKS_PER_RESPONSE = 20;

// El chart cambia como mucho una vez al día: el lote se cachea en memoria; la mezcla es por petición
const CACHE_TTL_MS = 10 * 60 * 1000;
let cache = { data: null, expiresAt: 0 };

async function fetchLatinChart() {
  const response = await fetch(DEEZER_LATIN_CHART_URL, { signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Deezer respondió HTTP ${response.status}`);

  const body = await response.json();
  // Deezer devuelve sus errores con HTTP 200 y un objeto `error`
  if (body.error) throw new Error(`Deezer: ${body.error.message}`);

  // Mismo formato que /api/search; solo pistas con audio, para que /api/stream pueda reproducirlas
  return (body.data || [])
    .filter((track) => track.type === 'track' && track.preview)
    .map((track) => ({
      id_externo: `deezer:track:${track.id}`,
      titulo: track.title,
      artista: track.artist?.name ?? 'Desconocido',
      portada_url: track.album?.cover_medium || null,
    }));
}

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

async function getLatinChart(req, res) {
  try {
    if (!cache.data || cache.expiresAt <= Date.now()) {
      cache = { data: await fetchLatinChart(), expiresAt: Date.now() + CACHE_TTL_MS };
    }
    // Respuesta distinta en cada visita: que el navegador no la reutilice
    res.set('Cache-Control', 'no-store');
    res.status(200).json({ success: true, data: shuffle(cache.data).slice(0, TRACKS_PER_RESPONSE) });
  } catch (error) {
    console.error('[chart]', error.message);
    res.status(500).json({ success: false, error: 'Error al obtener las recomendaciones' });
  }
}

module.exports = { getLatinChart };
