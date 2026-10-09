require('dotenv').config({ quiet: true });

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { rateLimit } = require('express-rate-limit');
const { HttpError } = require('./utils/http');

const authRoutes = require('./routes/auth.routes');
const tracksRoutes = require('./routes/tracks.routes');
const favoritesRoutes = require('./routes/favorites.routes');
const playlistsRoutes = require('./routes/playlists.routes');
const streamRoutes = require('./routes/stream.routes');
const searchRoutes = require('./routes/search.routes');
const radioRoutes = require('./routes/radio.routes');

const app = express();
const PORT = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

// Seguridad
app.use(helmet());
app.use(
  cors({
    origin: CORS_ORIGIN,
    credentials: true,
  })
);
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Demasiadas peticiones, intenta de nuevo más tarde.' },
    // El streaming tiene su propio limitador en routes/stream.routes.js
    skip: (req) => req.path.startsWith('/api/stream/'),
  })
);

// Parsers
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// Rutas
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'AirtekMusic API',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/tracks', tracksRoutes);
app.use('/api/favorites', favoritesRoutes);
app.use('/api/playlists', playlistsRoutes);
app.use('/api/stream', streamRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/radio', radioRoutes);

// 404 - Ruta no encontrada
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Ruta no encontrada' });
});

// Manejador global de errores (no expone el stack trace).
// Express 5 envía aquí los errores lanzados en controladores async (HttpError o errores de Supabase).
app.use((err, req, res, next) => {
  // Si ya se empezó a enviar la respuesta (p. ej. un stream de audio) Express cierra la conexión
  if (res.headersSent) return next(err);

  const status = Number.isInteger(err.status) ? err.status : 500;

  // HttpError con mensaje pensado para el cliente (incluye 502 de proveedores externos)
  if (err instanceof HttpError) {
    return res.status(status).json({ success: false, error: err.message });
  }

  if (status >= 500) {
    console.error(err);
    return res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }

  // Errores de cliente conocidos (HttpError, JSON malformado, payload demasiado grande, etc.)
  res.status(status).json({ success: false, error: err.expose ? err.message : 'Petición inválida' });
});

app.listen(PORT, () => {
  console.log(`AirtekMusic API escuchando en http://localhost:${PORT}`);
});
