const { isAirtekNetwork } = require('../services/network');

// Igual que Airtek TV: AirtekMusic solo responde a conexiones de la red de Airtek (ver services/network.js).
// El frontend reconoce el código OUTSIDE_NETWORK y muestra la pantalla "Conéctate a tu internet de Airtek".
function requireAirtekNetwork(req, res, next) {
  if (!isAirtekNetwork(req.ip)) {
    return res.status(403).json({
      success: false,
      code: 'OUTSIDE_NETWORK',
      error: 'AirtekMusic solo está disponible desde una conexión de Airtek',
    });
  }
  next();
}

module.exports = requireAirtekNetwork;
