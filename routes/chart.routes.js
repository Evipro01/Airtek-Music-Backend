const express = require('express');
const { getLatinChart } = require('../controllers/chart.controller');

const router = express.Router();

// Catálogo público
router.get('/', getLatinChart);

module.exports = router;
