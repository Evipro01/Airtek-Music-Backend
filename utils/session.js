const { cookieOptions, ONE_YEAR_MS } = require('./cookies');
const { SESSION_TTL_MS } = require('../services/sessions.service');

// Nombres de las cookies propias (HttpOnly: JavaScript del navegador no puede leerlas)
const SESSION_COOKIE = 'airtek_session';
const DEVICE_COOKIE = 'airtek_device';

const setSessionCookie = (res, token) => res.cookie(SESSION_COOKIE, token, cookieOptions({ maxAge: SESSION_TTL_MS }));
const setDeviceCookie = (res, deviceId) => res.cookie(DEVICE_COOKIE, deviceId, cookieOptions({ maxAge: ONE_YEAR_MS }));
const clearSessionCookie = (res) => res.clearCookie(SESSION_COOKIE, cookieOptions({ maxAge: 0 }));

// Errores de sesión con un `code` que el frontend usa para elegir qué pantalla mostrar
const sessionError = (res, status, code, error, extra = {}) =>
  res.status(status).json({ success: false, code, error, ...extra });

// Lo que el frontend necesita del perfil (sin datos internos como el abonado_id)
const publicProfile = ({ id, username, alias, rol, estado_cuenta, fecha_creacion }) => ({
  id,
  username,
  alias,
  rol,
  estado_cuenta,
  fecha_creacion,
});

module.exports = {
  SESSION_COOKIE,
  DEVICE_COOKIE,
  setSessionCookie,
  setDeviceCookie,
  clearSessionCookie,
  sessionError,
  publicProfile,
};
