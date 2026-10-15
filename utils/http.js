// Error con código HTTP que el manejador global de server.js devuelve tal cual al cliente
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.expose = true;
  }
}

// Códigos de PostgreSQL que devuelve PostgREST
const PG = {
  INSUFFICIENT_PRIVILEGE: '42501',
};

module.exports = { HttpError, PG };
