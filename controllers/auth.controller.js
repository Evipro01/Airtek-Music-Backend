const { createSupabaseClient, baseCookieOptions } = require('../services/supabaseClient');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 6;
// Contraseñas nuevas (registro). El login sigue aceptando las de cuentas creadas con la regla anterior.
const MIN_NEW_PASSWORD_LENGTH = 8;
const NEW_PASSWORD_ERROR = 'La contraseña debe tener al menos 8 caracteres y un número';
const DUPLICATE_EMAIL_ERROR = 'Este correo ya está registrado en Airtek Music';
// Mismas reglas que los CHECK de public.usuarios (supabase/migrations/..._esquema_inicial.sql)
const USERNAME_REGEX = /^[a-z0-9_]{4,30}$/;
const MAX_ALIAS_LENGTH = 50;

function validateCredentials(body = {}) {
  const { email, password } = body;

  if (typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
    return 'Debes enviar un email válido';
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`;
  }
  return null;
}

function validateNewPassword(password) {
  if (password.length < MIN_NEW_PASSWORD_LENGTH || !/\d/.test(password)) return NEW_PASSWORD_ERROR;
  return null;
}

// Supabase Auth señala el correo repetido de dos formas según la configuración del proyecto:
//  - Sin confirmación de email: error "User already registered" (code user_already_exists, HTTP 422).
//  - Con confirmación (nuestro caso): no hay error, pero el usuario devuelto no tiene identidades.
function isDuplicateEmailError(error) {
  return error.code === 'user_already_exists' || error.code === 'email_exists' || /already registered/i.test(error.message);
}

const isExistingUserResponse = (user) => Array.isArray(user?.identities) && user.identities.length === 0;

// El trigger de auth.users exige username en la metadata; si no llega alias, usa el username
function validateProfile(body = {}) {
  const { username, alias } = body;

  if (typeof username !== 'string' || !USERNAME_REGEX.test(username.trim())) {
    return 'El username debe tener entre 4 y 30 caracteres: minúsculas, números o _';
  }
  if (alias !== undefined && alias !== null && alias !== '') {
    if (typeof alias !== 'string' || !alias.trim() || alias.trim().length > MAX_ALIAS_LENGTH) {
      return `El alias debe tener entre 1 y ${MAX_ALIAS_LENGTH} caracteres`;
    }
  }
  return null;
}

// Supabase devuelve errores con `status`; los 5xx (o sin status) son fallos del servicio
function isServerError(error) {
  return !error.status || error.status >= 500;
}

function sendServerError(res, error) {
  console.error('[auth]', error);
  return res.status(500).json({ success: false, error: 'Error interno del servidor' });
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    username: user.user_metadata?.username ?? null,
    alias: user.user_metadata?.alias ?? null,
  };
}

async function register(req, res) {
  const validationError =
    validateCredentials(req.body) || validateNewPassword(req.body.password) || validateProfile(req.body);
  if (validationError) {
    return res.status(400).json({ success: false, error: validationError });
  }

  const { email, password, username, alias } = req.body;

  try {
    const supabase = createSupabaseClient(req, res);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { username: username.trim(), alias: alias?.trim() || username.trim() } },
    });

    if (error && isDuplicateEmailError(error)) {
      return res.status(409).json({ success: false, error: DUPLICATE_EMAIL_ERROR });
    }

    if (error) {
      // Si el trigger rechaza la fila (p. ej. username repetido) Supabase solo devuelve este mensaje genérico
      if (/database error saving new user/i.test(error.message)) {
        return res.status(400).json({
          success: false,
          error: 'No se pudo crear el usuario: el username podría estar en uso',
        });
      }
      if (isServerError(error)) return sendServerError(res, error);
      return res.status(400).json({ success: false, error: error.message });
    }

    if (isExistingUserResponse(data.user)) {
      return res.status(409).json({ success: false, error: DUPLICATE_EMAIL_ERROR });
    }

    // Si Supabase exige confirmación de email, no hay sesión todavía
    const requiresConfirmation = !data.session;

    return res.status(201).json({
      success: true,
      message: requiresConfirmation
        ? 'Usuario registrado. Revisa tu email para confirmar la cuenta.'
        : 'Usuario registrado e identificado correctamente.',
      user: publicUser(data.user),
      requiresConfirmation,
    });
  } catch (error) {
    return sendServerError(res, error);
  }
}

async function login(req, res) {
  const validationError = validateCredentials(req.body);
  if (validationError) {
    return res.status(400).json({ success: false, error: validationError });
  }

  const { email, password } = req.body;

  try {
    const supabase = createSupabaseClient(req, res);
    // La sesión se guarda vía setAll() como cookie HttpOnly; los tokens nunca van en el body
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      if (isServerError(error)) return sendServerError(res, error);
      return res.status(401).json({
        success: false,
        error:
          error.code === 'email_not_confirmed'
            ? 'Debes confirmar tu email antes de iniciar sesión'
            : 'Credenciales inválidas',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Sesión iniciada correctamente',
      user: publicUser(data.user),
    });
  } catch (error) {
    return sendServerError(res, error);
  }
}

async function logout(req, res) {
  try {
    const supabase = createSupabaseClient(req, res);
    const { error } = await supabase.auth.signOut();

    // Limpieza defensiva: borra cualquier cookie de sesión de Supabase (incluidos chunks .0, .1...)
    Object.keys(req.cookies || {})
      .filter((name) => name.startsWith('sb-'))
      .forEach((name) => res.clearCookie(name, baseCookieOptions));

    if (error && isServerError(error)) return sendServerError(res, error);

    return res.status(200).json({ success: true, message: 'Sesión cerrada correctamente' });
  } catch (error) {
    return sendServerError(res, error);
  }
}

// Requiere requireAuth: devuelve el perfil de public.usuarios del usuario autenticado
async function me(req, res) {
  const { data, error } = await req.supabase
    .from('usuarios')
    .select('id, email, username, alias, rol, estado_cuenta, fecha_creacion')
    .eq('id', req.user.id)
    .maybeSingle();

  if (error) return sendServerError(res, error);
  if (!data) {
    return res.status(404).json({ success: false, error: 'Perfil de usuario no encontrado' });
  }

  return res.status(200).json({ success: true, user: data });
}

module.exports = { register, login, logout, me };
