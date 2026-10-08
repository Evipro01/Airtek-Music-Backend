const express = require('express');
const requireAuth = require('../middlewares/requireAuth');
const { upsertTrack, getTrack } = require('../controllers/tracks.controller');

const router = express.Router();

router.use(requireAuth);

router.post('/', upsertTrack);
router.get('/:id_externo', getTrack);

module.exports = router;
