// Emisoras en vivo de Airtek TV (HLS, solo audio AAC).
// El navegador reproduce cada stream directamente desde airtek.tv con hls.js:
// el servidor de origen ya envía CORS (Access-Control-Allow-Origin: *), así que no pasa por nuestro proxy.
const STREAM_BASE_URL = 'https://airtek.tv/eventos';

// [archivo .m3u8 en airtek.tv, nombre visible]. Los nombres se deducen del archivo y se pueden ajustar aquí.
const STATIONS = [
  ['Cocktail_lounge', 'Cocktail Lounge'],
  ['Opera_Plus', 'Opera Plus'],
  ['Chill_Lounge', 'Chill Lounge'],
  ['Jazz_Masters', 'Jazz Masters'],
  ['Rock_Alternativ', 'Rock Alternativo'],
  ['Northing_But_90', "Nothing But 90's"],
  ['Hard_Rock', 'Hard Rock'],
  ['Soho_70s', "Soho 70's"],
  ['Everything_80s', "Everything 80's"],
  ['Silk_Love_Song', 'Silk Love Songs'],
  ['Latino_Tropical', 'Latino Tropical'],
  ['Solo_Para_Peque', 'Solo para Peques'],
  ['Total_Hits_Bras', 'Total Hits Brasil'],
  ['Rock_Anthem', 'Rock Anthems'],
  ['Jammin', "Jammin'"],
  ['Hit_List', 'Hit List'],
  ['Dancefloor_Fill', 'Dancefloor Fillers'],
  ['Classic_R_N_B_A', 'Classic R&B'],
  ['Popcom', 'Popcom'],
  ['Jazz_Latino', 'Jazz Latino'],
  ['Eventos', 'Eventos'],
  ['Brazilian_Pop', 'Brazilian Pop'],
  ['Samba_and_Pagod', 'Samba & Pagode'],
  ['Brazil_Rock', 'Brazil Rock'],
  ['New_Age', 'New Age'],
  ['Rock_en_Espanol', 'Rock en Español'],
  ['Regional_Mexica', 'Regional Mexicano'],
];

// Mismo formato que la tabla `pistas` (<proveedor>:<tipo>:<id>) más la URL del stream
const radios = STATIONS.map(([file, titulo]) => ({
  id_externo: `airtek:radio:${file.toLowerCase()}`,
  titulo,
  artista: 'En Vivo',
  portada_url: null, // Sin portada propia: el frontend genera una a partir del nombre
  stream_url: `${STREAM_BASE_URL}/${file}.m3u8`,
}));

function getRadios(req, res) {
  // La lista es estática: el navegador puede reutilizarla unos minutos
  res.set('Cache-Control', 'public, max-age=300');
  res.status(200).json({ success: true, data: radios });
}

module.exports = { getRadios };
