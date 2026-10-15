const express = require('express');
const { getAlbum } = require('../controllers/album.controller');

const router = express.Router();

// Catálogo público, como /search y /chart
router.get('/:id', getAlbum);

module.exports = router;
