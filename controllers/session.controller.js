const { resolveSubscriber } = require('../services/subscriberResolver');
const { isAirtekNetwork, normalizeIp } = require('../services/network');
const {
  createSession,
  refreshSession,
  isValidDeviceId,
  newDeviceId,
  REFRESH_INTERVAL_SECONDS,
} = require('../services/sessions.service');
const {
  DEVICE_COOKIE,
  setSessionCookie,
  setDeviceCookie,
  sessionError,
  publicProfile,
} = require('../utils/session');

/**
 * POST /api/session → { success, user, refreshIntervalSeconds }
 * Sin credenciales: el abonado se deduce de la conexión. Errores con `code`:
 *  403 OUTSIDE_NETWORK   la petición no viene de la red de Airtek
 *  403 NOT_SUBSCRIBER    la IP no corresponde a ningún abonado
 *  403 ACCOUNT_SUSPENDED el administrador suspendió el acceso de este abonado
 *  409 DEVICE_LIMIT      ya hay demasiados dispositivos conectados (incluye `devices`)
 */
async function startSession(req, res) {
  const ip = normalizeIp(req.ip);
  if (!isAirtekNetwork(ip)) {
    return sessionError(res, 403, 'OUTSIDE_NETWORK', 'AirtekMusic solo está disponible desde una conexión de Airtek');
  }

  const subscriber = await resolveSubscriber(ip);
  if (!subscriber) {
    return sessionError(res, 403, 'NOT_SUBSCRIBER', 'Esta conexión no corresponde a ningún abonado de Airtek');
  }

  // El identificador del dispositivo vive en su propia cookie: se mantiene entre sesiones
  const cookieDeviceId = req.cookies?.[DEVICE_COOKIE];
  const deviceId = isValidDeviceId(cookieDeviceId) ? cookieDeviceId : newDeviceId();
  setDeviceCookie(res, deviceId);

  const result = await createSession({
    subscriberId: subscriber.id,
    deviceId,
    ip,
    userAgent: req.get('user-agent'),
  });

  if (result.suspended) {
    return sessionError(res, 403, 'ACCOUNT_SUSPENDED', 'El acceso de este abonado está suspendido');
  }
  if (result.limitReached) {
    return sessionError(res, 409, 'DEVICE_LIMIT', 'Alcanzaste el máximo de dispositivos conectados a la vez', {
      devices: result.devices,
    });
  }

  setSessionCookie(res, result.token);
  res.set('Cache-Control', 'no-store');
  res.status(201).json({
    success: true,
    user: publicProfile(result.user),
    refreshIntervalSeconds: REFRESH_INTERVAL_SECONDS,
  });
}

/**
 * POST /api/session/refresh (requiere requireSession) → { success, user, refreshIntervalSeconds }
 * Rota el token y, como Airtek TV, vuelve a comprobar la conexión: si ahora la IP es de otro
 * abonado, la sesión deja de valer y el frontend pide una nueva.
 */
async function refresh(req, res) {
  const ip = normalizeIp(req.ip);
  const subscriber = await resolveSubscriber(ip);
  if (!subscriber || subscriber.id !== req.user.abonadoId) {
    return sessionError(res, 401, 'NO_SESSION', 'La conexión cambió: hace falta una sesión nueva');
  }

  const token = await refreshSession(req.session.id);
  setSessionCookie(res, token);
  res.set('Cache-Control', 'no-store');
  res.status(200).json({
    success: true,
    user: publicProfile(req.user.profile),
    refreshIntervalSeconds: REFRESH_INTERVAL_SECONDS,
  });
}

module.exports = { startSession, refresh };
