const express = require('express');
const requireAuth = require('../middlewares/requireAuth');
const { getArtist } = require('../controllers/artist.controller');

const router = express.Router();

// Como /search y /chart: consulta Deezer, solo para usuarios con sesión
router.use(requireAuth);

router.get('/:id', getArtist);

module.exports = router;
