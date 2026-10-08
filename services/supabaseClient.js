const { createServerClient } = require('@supabase/ssr');

const baseCookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};

// Supabase entrega maxAge en segundos (formato de la cabecera Set-Cookie),
// pero res.cookie() de Express lo espera en milisegundos.
function toExpressCookieOptions(options = {}) {
  const { maxAge, expires } = options;
  const result = { ...baseCookieOptions };

  if (typeof maxAge === 'number') result.maxAge = maxAge * 1000;
  if (expires) result.expires = expires;

  return result;
}

/**
 * Crea un cliente de Supabase ligado a la petición actual.
 * Debe crearse uno nuevo por cada request: nunca compartirlo entre peticiones.
 */
function createSupabaseClient(req, res) {
  return createServerClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return Object.entries(req.cookies || {}).map(([name, value]) => ({ name, value }));
      },
      setAll(cookiesToSet, headers = {}) {
        if (res.headersSent) return;

        cookiesToSet.forEach(({ name, value, options }) => {
          const cookieOptions = toExpressCookieOptions(options);

          if (!value || cookieOptions.maxAge === 0) {
            res.clearCookie(name, baseCookieOptions);
          } else {
            res.cookie(name, value, cookieOptions);
          }
        });

        // Cabeceras anti-caché para que ningún proxy sirva la sesión de otro usuario
        Object.entries(headers).forEach(([key, value]) => res.setHeader(key, value));
      },
    },
  });
}

module.exports = { createSupabaseClient, baseCookieOptions };
