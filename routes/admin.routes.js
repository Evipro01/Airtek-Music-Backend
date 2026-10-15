const express = require('express');
const { rateLimit } = require('express-rate-limit');
const requireAdmin = require('../middlewares/requireAdmin');
const { getStats, listUsers } = require('../controllers/admin.controller');

const router = express.Router();

// Contra la fuerza bruta: solo cuentan los intentos fallidos (clave incorrecta)
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, error: 'Demasiados intentos con una clave incorrecta. Espera 15 minutos.' },
});

// Clave de administración en la cabecera X-Admin-Key (ver middlewares/requireAdmin.js)
router.use(adminLimiter, requireAdmin);

router.get('/stats', getStats);
router.get('/users', listUsers);

module.exports = router;
