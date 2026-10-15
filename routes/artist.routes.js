const express = require('express');
const { getArtist } = require('../controllers/artist.controller');

const router = express.Router();

// Catálogo público, como /search y /chart
router.get('/:id', getArtist);

module.exports = router;
