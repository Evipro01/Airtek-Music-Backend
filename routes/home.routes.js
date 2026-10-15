const express = require('express');
const { getHome } = require('../controllers/home.controller');

const router = express.Router();

// Catálogo público. Los favoritos viven en el navegador del oyente y llegan como ?favoritos=id1,id2
router.get('/', getHome);

module.exports = router;
