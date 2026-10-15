const express = require('express');
const { getTrack } = require('../controllers/tracks.controller');

const router = express.Router();

// Catálogo público: lectura de la caché de pistas
router.get('/:id_externo', getTrack);

module.exports = router;
