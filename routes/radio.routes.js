const express = require('express');
const { getRadios } = require('../controllers/radio.controller');

const router = express.Router();

// Pública, como el resto del catálogo: los invitados pueden ver las emisoras;
// el frontend pide iniciar sesión para reproducir.
router.get('/', getRadios);

module.exports = router;
