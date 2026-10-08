const { createClient } = require('@supabase/supabase-js');

/**
 * Cliente con la service_role: se salta RLS. Solo para operaciones que el backend
 * hace en nombre del sistema (p. ej. mantener el catálogo compartido de `pistas`).
 * Nunca usarlo para leer o escribir datos de un usuario: para eso está req.supabase.
 */
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

module.exports = supabaseAdmin;
