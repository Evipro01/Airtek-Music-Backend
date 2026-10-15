const { createClient } = require('@supabase/supabase-js');

/**
 * Único cliente de Supabase del backend (service_role, se salta RLS). El navegador nunca habla con la
 * base de datos: la biblioteca de cada oyente vive en su navegador y aquí solo se leen el catálogo
 * de pistas y las cifras del panel de administración.
 */
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

module.exports = supabaseAdmin;
