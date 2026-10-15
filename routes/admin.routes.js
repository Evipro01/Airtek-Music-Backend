const express = require('express');
const requireSession = require('../middlewares/requireSession');
const requireAdmin = require('../middlewares/requireAdmin');
const { getStats, listUsers } = require('../controllers/admin.controller');

const router = express.Router();

// Sesión válida y rol "admin" en public.usuarios
router.use(requireSession, requireAdmin);

router.get('/stats', getStats);
router.get('/users', listUsers);

module.exports = router;
