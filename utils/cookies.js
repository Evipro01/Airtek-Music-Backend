/**
 * Política única de cookies del backend: la usan la de sesión (`airtek_session`) y la del
 * dispositivo (`airtek_device`), ver utils/session.js.
 *
 * En producción el frontend y el backend viven en dominios distintos: el navegador solo envía la
 * cookie en peticiones entre sitios si es `SameSite=None`, y eso exige `Secure` (HTTPS).
 * En desarrollo (http://localhost) `Secure` no funcionaría, así que se usa `Lax`.
 */
const isProduction = process.env.NODE_ENV === 'production';

const baseCookieOptions = Object.freeze({
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? 'none' : 'lax',
  path: '/',
});

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

// Opciones para res.cookie(): la política común + la duración (en milisegundos)
const cookieOptions = ({ maxAge = ONE_YEAR_MS } = {}) => ({ ...baseCookieOptions, maxAge });

module.exports = { isProduction, cookieOptions, ONE_YEAR_MS };
