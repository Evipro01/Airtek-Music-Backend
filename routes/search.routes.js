const express = require('express');
const { search } = require('../controllers/search.controller');

const router = express.Router();

// Catálogo público
router.get('/', search);

module.exports = router;
