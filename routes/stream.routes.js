const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { streamTrack } = require('../controllers/stream.controller');

const router = express.Router();

// Cada seek del reproductor es una petición nueva con Range: límite propio, más amplio que el global
const streamLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, error: 'Demasiadas peticiones de audio, intenta de nuevo más tarde.' },
});

// Público, como el catálogo: el proxy solo acepta las fuentes y dominios de services/audioProviders.js
router.use(streamLimiter);

// <audio src> carga desde otro origen (localhost:5173 → :3000): helmet lo bloquearía con same-origin
router.use((req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  next();
});

router.get('/:track_id', streamTrack);

module.exports = router;
