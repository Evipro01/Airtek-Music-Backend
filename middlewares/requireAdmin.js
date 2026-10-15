const crypto = require('node:crypto');

/**
 * Protege /api/admin con una clave compartida por el equipo (ADMIN_API_KEY en el .env).
 * El panel la envía en la cabecera X-Admin-Key. Se comparan los hashes SHA-256 con timingSafeEqual,
 * así la comparación tarda lo mismo acierte o no y no da pistas sobre la clave.
 *
 * Sin ADMIN_API_KEY (o con menos de 16 caracteres) el panel queda desactivado: falla cerrado.
 */
const MIN_KEY_LENGTH = 16;

const digest = (value) => crypto.createHash('sha256').update(value).digest();

const configuredKey = process.env.ADMIN_API_KEY ?? '';
const expectedDigest = configuredKey.length >= MIN_KEY_LENGTH ? digest(configuredKey) : null;

if (!expectedDigest) {
  console.warn(`[admin] ADMIN_API_KEY no está definida o tiene menos de ${MIN_KEY_LENGTH} caracteres: el panel de administración queda desactivado.`);
}

function requireAdmin(req, res, next) {
  if (!expectedDigest) {
    return res.status(503).json({ success: false, error: 'El panel de administración no está configurado en el servidor' });
  }

  const providedKey = req.get('x-admin-key');
  if (!providedKey || !crypto.timingSafeEqual(digest(providedKey), expectedDigest)) {
    return res.status(401).json({ success: false, error: 'Clave de administración incorrecta' });
  }
  next();
}

module.exports = requireAdmin;
