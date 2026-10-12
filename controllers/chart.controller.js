const { getLatinChartTracks, shuffle } = require('../services/chart.service');

// En cada petición se entrega una selección aleatoria distinta del chart Latino
const TRACKS_PER_RESPONSE = 20;

async function getLatinChart(req, res) {
  try {
    const tracks = await getLatinChartTracks();
    // Respuesta distinta en cada visita: que el navegador no la reutilice
    res.set('Cache-Control', 'no-store');
    res.status(200).json({ success: true, data: shuffle(tracks).slice(0, TRACKS_PER_RESPONSE) });
  } catch (error) {
    console.error('[chart]', error.message);
    res.status(500).json({ success: false, error: 'Error al obtener las recomendaciones' });
  }
}

module.exports = { getLatinChart };
