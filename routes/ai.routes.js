const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { askAssistant } = require('../controllers/ai.controller');

const router = express.Router();

// Cada pregunta gasta dos llamadas a Gemini en n8n: 10 por minuto y por persona
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, error: 'Hiciste muchas preguntas seguidas. Espera un minuto y vuelve a intentarlo.' },
});

router.post('/', aiLimiter, askAssistant);

module.exports = router;
