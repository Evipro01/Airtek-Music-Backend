const express = require('express');
const requireAuth = require('../middlewares/requireAuth');
const { getLatinChart } = require('../controllers/chart.controller');

const router = express.Router();

// El frontend la pide con la cookie de sesión, solo cuando hay usuario autenticado
router.use(requireAuth);

router.get('/', getLatinChart);

module.exports = router;
