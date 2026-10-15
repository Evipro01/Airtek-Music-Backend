const { findSession } = require('../services/sessions.service');
const { isAirtekNetwork } = require('../services/network');
const { SESSION_COOKIE, clearSessionCookie, sessionError } = require('../utils/session');

/**
 * Exige una sesión de abonado válida (ver services/sessions.service.js) y que la petición siga
 * llegando desde la red de Airtek. Deja disponibles:
 *  - req.user:    { id, abonadoId, rol, profile } (id = public.usuarios.id)
 *  - req.session: { id, dispositivoId }
 *
 * Todas las consultas de datos personales filtran por req.user.id: solo el backend accede a
 * Supabase (service_role) y el navegador nunca habla con la base de datos directamente.
 */
async function requireSession(req, res, next) {
  if (!isAirtekNetwork(req.ip)) {
    return sessionError(res, 403, 'OUTSIDE_NETWORK', 'AirtekMusic solo está disponible desde una conexión de Airtek');
  }

  const session = await findSession(req.cookies?.[SESSION_COOKIE]);
  if (!session) {
    clearSessionCookie(res);
    return sessionError(res, 401, 'NO_SESSION', 'La sesión no existe o caducó');
  }
  if (session.usuario.estado_cuenta !== 'activa') {
    return sessionError(res, 403, 'ACCOUNT_SUSPENDED', 'El acceso de este abonado está suspendido');
  }

  req.user = {
    id: session.usuario.id,
    abonadoId: session.usuario.abonado_id,
    rol: session.usuario.rol,
    profile: session.usuario,
  };
  req.session = { id: session.id, dispositivoId: session.dispositivo_id };
  next();
}

module.exports = requireSession;
