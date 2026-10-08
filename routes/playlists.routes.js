const express = require('express');
const requireAuth = require('../middlewares/requireAuth');
const {
  createPlaylist,
  listPlaylists,
  getPlaylist,
  addTrackToPlaylist,
  removeTrackFromPlaylist,
  deletePlaylist,
} = require('../controllers/playlists.controller');

const router = express.Router();

router.use(requireAuth);

router.get('/', listPlaylists);
router.post('/', createPlaylist);
router.get('/:id', getPlaylist);
router.delete('/:id', deletePlaylist);
router.post('/:id/tracks', addTrackToPlaylist);
router.delete('/:id/tracks/:pista_id', removeTrackFromPlaylist);

module.exports = router;
