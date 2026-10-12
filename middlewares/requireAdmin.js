/**
 * Debe ir después de requireAuth. Comprueba en public.usuarios que el usuario tenga rol "admin"
 * y la cuenta activa. Se consulta con el cliente del propio usuario: cada uno puede leer su perfil (RLS).
 */
async function requireAdmin(req, res, next) {
  const { data: profile, error } = await req.supabase
    .from('usuarios')
    .select('rol, estado_cuenta')
    .eq('id', req.user.id)
    .maybeSingle();

  if (error) throw error;
  if (profile?.rol !== 'admin' || profile.estado_cuenta !== 'activa') {
    return res.status(403).json({ success: false, error: 'Necesitas permisos de administrador' });
  }

  next();
}

module.exports = requireAdmin;
