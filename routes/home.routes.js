const express = require('express');
const requireAuth = require('../middlewares/requireAuth');
const { getHome } = require('../controllers/home.controller');

const router = express.Router();

// Inicio personalizado: necesita saber quién es el usuario para leer sus favoritos
router.use(requireAuth);

router.get('/', getHome);

module.exports = router;
