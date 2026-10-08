const express = require('express');
const requireAuth = require('../middlewares/requireAuth');
const { addFavorite, removeFavorite, listFavorites } = require('../controllers/favorites.controller');

const router = express.Router();

router.use(requireAuth);

router.get('/', listFavorites);
router.post('/', addFavorite);
router.delete('/:pista_id', removeFavorite);

module.exports = router;
