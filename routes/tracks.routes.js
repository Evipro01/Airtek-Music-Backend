const express = require('express');
const requireSession = require('../middlewares/requireSession');
const { upsertTrack, getTrack } = require('../controllers/tracks.controller');

const router = express.Router();

// Leer el catálogo es público; escribir en la tabla `pistas` sigue necesitando sesión
router.post('/', requireSession, upsertTrack);
router.get('/:id_externo', getTrack);

module.exports = router;
