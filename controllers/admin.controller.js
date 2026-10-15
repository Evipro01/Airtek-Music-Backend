const supabaseAdmin = require('../services/supabaseAdmin');
const { HttpError, PG } = require('../utils/http');

const TOP_FAVORITES = 5;
const MAX_FAVORITES_SCANNED = 10000;
const MAX_USERS = 200;

// Las consultas de administración leen datos de todos los usuarios con la service_role.
// Si falta el GRANT de lectura (sql/002_permisos_admin.sql) se avisa con un mensaje claro.
function assertQuery({ error, status }) {
  if (!error) return;
  // Los conteos (HEAD) no traen cuerpo: un permiso denegado solo se ve como HTTP 403
  if (status === 403 || error.code === PG.INSUFFICIENT_PRIVILEGE || /permission denied/i.test(error.message ?? '')) {
    throw new HttpError(500, 'La clave de servicio no tiene permiso de lectura: ejecuta sql/002_permisos_admin.sql en Supabase');
  }
  throw error;
}

async function countRows(table) {
  const result = await supabaseAdmin.from(table).select('*', { count: 'exact', head: true });
  assertQuery(result);
  return result.count ?? 0;
}

// Las pistas con más "Me gusta" de la plataforma
async function topFavorites() {
  const favorites = await supabaseAdmin.from('favoritos').select('pista_id').limit(MAX_FAVORITES_SCANNED);
  assertQuery(favorites);

  const counts = new Map();
  for (const { pista_id } of favorites.data) counts.set(pista_id, (counts.get(pista_id) ?? 0) + 1);
  const ranking = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_FAVORITES);
  if (ranking.length === 0) return [];

  const tracks = await supabaseAdmin
    .from('pistas')
    .select('id_externo, titulo, artista, portada_url')
    .in('id_externo', ranking.map(([id]) => id));
  assertQuery(tracks);

  const byId = new Map(tracks.data.map((track) => [track.id_externo, track]));
  return ranking.filter(([id]) => byId.has(id)).map(([id, guardados]) => ({ pista: byId.get(id), guardados }));
}

// GET /api/admin/stats → { success, pistas, playlists, favoritos, top: [{ pista, guardados }] }
async function getStats(req, res) {
  const [pistas, playlists, favoritos, top] = await Promise.all([
    countRows('pistas'),
    countRows('playlists'),
    countRows('favoritos'),
    topFavorites(),
  ]);

  res.status(200).json({ success: true, pistas, playlists, favoritos, top });
}

// GET /api/admin/users → { success, total, usuarios } (los más recientes primero)
async function listUsers(req, res) {
  const result = await supabaseAdmin
    .from('usuarios')
    .select('id, abonado_id, username, alias, rol, estado_cuenta, fecha_creacion', { count: 'exact' })
    .order('fecha_creacion', { ascending: false })
    .limit(MAX_USERS);
  assertQuery(result);

  res.status(200).json({ success: true, total: result.count ?? result.data.length, usuarios: result.data });
}

module.exports = { getStats, listUsers };
