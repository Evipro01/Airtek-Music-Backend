const express = require('express');
const requireAuth = require('../middlewares/requireAuth');
const { search } = require('../controllers/search.controller');

const router = express.Router();

router.use(requireAuth);

router.get('/', search);

module.exports = router;
