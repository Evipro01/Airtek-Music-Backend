const express = require('express');
const requireSession = require('../middlewares/requireSession');
const { startSession, refresh } = require('../controllers/session.controller');

const router = express.Router();

// Sin login: la sesión se crea a partir de la conexión del abonado
router.post('/', startSession);
router.post('/refresh', requireSession, refresh);

module.exports = router;
