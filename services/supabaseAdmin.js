const { createClient } = require('@supabase/supabase-js');

/**
 * Único cliente de Supabase del backend (service_role, se salta RLS). Sin login no hay sesiones de
 * Supabase Auth: el navegador nunca habla con la base de datos y el backend es quien filtra por
 * abonado. Toda consulta de datos personales debe filtrar por req.user.id (ver requireSession).
 */
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

module.exports = supabaseAdmin;
