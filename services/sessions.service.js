const crypto = require('node:crypto');
const supabaseAdmin = require('./supabaseAdmin');
const { PG } = require('../utils/http');

/**
 * Sesiones por conexión, al estilo de Airtek TV:
 *  1. El navegador pide una sesión sin credenciales (POST /api/session).
 *  2. El backend identifica al abonado por la IP (subscriberResolver) y crea la sesión de ese
 *     dispositivo. Cada abonado puede tener como máximo MAX_DEVICES dispositivos activos a la vez.
 *  3. El frontend la renueva cada REFRESH_INTERVAL_SECONDS (POST /api/session/refresh).
 *     Una sesión que deja de renovarse caduca sola a los SESSION_TTL_MINUTES y libera su hueco.
 *
 * En la base de datos solo se guarda el hash SHA-256 del token: si la tabla se filtrara,
 * los tokens no servirían para suplantar a nadie.
 */
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MINUTES || 30) * 60 * 1000;
const REFRESH_INTERVAL_SECONDS = Number(process.env.SESSION_REFRESH_SECONDS || 300);
const MAX_DEVICES = Number(process.env.MAX_DEVICES_PER_SUBSCRIBER || 4);

const USER_FIELDS = 'id, abonado_id, username, alias, rol, estado_cuenta, fecha_creacion';

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');
const expiresFromNow = () => new Date(Date.now() + SESSION_TTL_MS).toISOString();

const DEVICE_ID_REGEX = /^web_[0-9a-f-]{36}$/;
const isValidDeviceId = (value) => typeof value === 'string' && DEVICE_ID_REGEX.test(value);
const newDeviceId = () => `web_${crypto.randomUUID()}`;

// El username cumple el CHECK de public.usuarios (^[a-z0-9_]{4,30}$) sea cual sea el formato del abonado
const usernameFor = (subscriberId) => `ab_${crypto.createHash('sha256').update(subscriberId).digest('hex').slice(0, 12)}`;
const aliasFor = (subscriberId) => `Abonado ${subscriberId}`.slice(0, 50);

// Perfil del abonado en public.usuarios; se crea la primera vez que se conecta
async function ensureSubscriberUser(subscriberId) {
  const lookup = () =>
    supabaseAdmin.from('usuarios').select(USER_FIELDS).eq('abonado_id', subscriberId).maybeSingle();

  const { data: existing, error } = await lookup();
  if (error) throw error;
  if (existing) return existing;

  const { data: created, error: insertError } = await supabaseAdmin
    .from('usuarios')
    .insert({ abonado_id: subscriberId, username: usernameFor(subscriberId), alias: aliasFor(subscriberId) })
    .select(USER_FIELDS)
    .single();

  // Dos dispositivos del mismo abonado conectándose a la vez: el segundo reutiliza el perfil del primero
  if (insertError?.code === PG.UNIQUE_VIOLATION) {
    const { data, error: retryError } = await lookup();
    if (retryError) throw retryError;
    return data;
  }
  if (insertError) throw insertError;
  return created;
}

/**
 * Crea (o reemplaza) la sesión de un dispositivo.
 * Devuelve { token, user } o { limitReached: true, devices } si el abonado ya usa MAX_DEVICES.
 */
async function createSession({ subscriberId, deviceId, ip, userAgent }) {
  const user = await ensureSubscriberUser(subscriberId);
  if (user.estado_cuenta !== 'activa') return { suspended: true };

  const now = new Date().toISOString();

  // Limpieza: las sesiones caducadas de este abonado ya no cuentan ni hace falta guardarlas
  const { error: cleanupError } = await supabaseAdmin.from('sesiones').delete().eq('usuario_id', user.id).lte('expira', now);
  if (cleanupError) throw cleanupError;

  const { data: active, error: activeError } = await supabaseAdmin
    .from('sesiones')
    .select('dispositivo_id, user_agent, ultimo_uso')
    .eq('usuario_id', user.id)
    .gt('expira', now);
  if (activeError) throw activeError;

  const otherDevices = active.filter((session) => session.dispositivo_id !== deviceId);
  if (otherDevices.length >= MAX_DEVICES) {
    return {
      limitReached: true,
      devices: otherDevices.map(({ user_agent, ultimo_uso }) => ({ dispositivo: user_agent, ultimo_uso })),
    };
  }

  const token = newToken();
  const { error } = await supabaseAdmin.from('sesiones').upsert(
    {
      usuario_id: user.id,
      dispositivo_id: deviceId,
      token_hash: hashToken(token),
      ip,
      user_agent: userAgent?.slice(0, 300) ?? null,
      ultimo_uso: now,
      expira: expiresFromNow(),
    },
    { onConflict: 'usuario_id,dispositivo_id' },
  );
  if (error) throw error;

  return { token, user };
}

// Sesión vigente para un token, con el perfil del abonado; null si no existe o caducó
async function findSession(token) {
  if (typeof token !== 'string' || !token) return null;

  const { data, error } = await supabaseAdmin
    .from('sesiones')
    .select(`id, dispositivo_id, expira, usuario:usuarios(${USER_FIELDS})`)
    .eq('token_hash', hashToken(token))
    .maybeSingle();
  if (error) throw error;
  if (!data?.usuario || new Date(data.expira) <= new Date()) return null;
  return data;
}

// Renueva la sesión: token nuevo (el anterior deja de valer) y caducidad desde ahora
async function refreshSession(sessionId) {
  const token = newToken();
  const { error } = await supabaseAdmin
    .from('sesiones')
    .update({ token_hash: hashToken(token), ultimo_uso: new Date().toISOString(), expira: expiresFromNow() })
    .eq('id', sessionId);
  if (error) throw error;
  return token;
}

module.exports = {
  createSession,
  findSession,
  refreshSession,
  isValidDeviceId,
  newDeviceId,
  SESSION_TTL_MS,
  REFRESH_INTERVAL_SECONDS,
};
