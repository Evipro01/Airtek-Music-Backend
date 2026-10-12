const express = require('express');
const requireAuth = require('../middlewares/requireAuth');
const requireAdmin = require('../middlewares/requireAdmin');
const { getStats, listUsers } = require('../controllers/admin.controller');

const router = express.Router();

// Sesión válida y rol "admin" en public.usuarios
router.use(requireAuth, requireAdmin);

router.get('/stats', getStats);
router.get('/users', listUsers);

module.exports = router;
