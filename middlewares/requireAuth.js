const { createSupabaseClient } = require('../services/supabaseClient');

/**
 * Valida la sesión de la cookie HttpOnly y deja disponibles:
 *  - req.user: { id, email }
 *  - req.supabase: cliente con la sesión del usuario (las políticas RLS aplican)
 * Si el access token expiró, Supabase lo refresca y reescribe la cookie vía setAll().
 */
async function requireAuth(req, res, next) {
  const supabase = createSupabaseClient(req, res);
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (error || !claims?.sub) {
    return res.status(401).json({ success: false, error: 'No autenticado' });
  }

  req.supabase = supabase;
  req.user = { id: claims.sub, email: claims.email };
  next();
}

module.exports = requireAuth;
