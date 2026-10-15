const { HttpError } = require('../utils/http');

// Formato de la PK: "<proveedor>:<tipo>:<id>", p. ej. "deezer:track:3135556"
const TRACK_ID_REGEX = /^[a-z0-9_-]+:[a-z0-9_-]+:[^\s/]+$/i;

function assertTrackId(idExterno) {
  if (typeof idExterno !== 'string' || idExterno.length > 200 || !TRACK_ID_REGEX.test(idExterno)) {
    throw new HttpError(400, 'id_externo debe tener el formato "<proveedor>:<tipo>:<id>"');
  }
}

module.exports = { assertTrackId };
