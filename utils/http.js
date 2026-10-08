// Error con código HTTP que el manejador global de server.js devuelve tal cual al cliente
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.expose = true;
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value, label = 'id') {
  if (typeof value !== 'string' || !UUID_REGEX.test(value)) {
    throw new HttpError(400, `El ${label} no es un UUID válido`);
  }
}

// Códigos de PostgreSQL que devuelve PostgREST
const PG = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  INSUFFICIENT_PRIVILEGE: '42501',
};

module.exports = { HttpError, assertUuid, PG };
