/**
 * Debe ir después de requireSession, que ya cargó el perfil del abonado (rol y estado de la cuenta).
 * Para dar acceso al panel: update public.usuarios set rol = 'admin' where abonado_id = '<abonado>';
 */
function requireAdmin(req, res, next) {
  if (req.user?.rol !== 'admin') {
    return res.status(403).json({ success: false, error: 'Necesitas permisos de administrador' });
  }
  next();
}

module.exports = requireAdmin;
