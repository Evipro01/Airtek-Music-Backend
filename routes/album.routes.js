const express = require('express');
const requireAuth = require('../middlewares/requireAuth');
const { getAlbum } = require('../controllers/album.controller');

const router = express.Router();

// Como /search y /chart: consulta Deezer, solo para usuarios con sesión
router.use(requireAuth);

router.get('/:id', getAlbum);

module.exports = router;
