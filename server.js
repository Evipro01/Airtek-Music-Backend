require('dotenv').config({ quiet: true });
// Antes que cualquier fetch: conexiones keep-alive largas hacia Deezer, Audius y Supabase
require('./services/httpAgent');

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { rateLimit } = require('express-rate-limit');
const { HttpError } = require('./utils/http');

const tracksRoutes = require('./routes/tracks.routes');
const streamRoutes = require('./routes/stream.routes');
const searchRoutes = require('./routes/search.routes');
const radioRoutes = require('./routes/radio.routes');
const chartRoutes = require('./routes/chart.routes');
const artistRoutes = require('./routes/artist.routes');
const albumRoutes = require('./routes/album.routes');
const adminRoutes = require('./routes/admin.routes');
const homeRoutes = require('./routes/home.routes');


const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;

// Orígenes del frontend autorizados (CORS con credenciales: nunca "*").
// FRONTEND_URL admite varias URLs separadas por comas (p. ej. producción y previews).
// CORS_ORIGIN se mantiene como alias por compatibilidad con los .env existentes.
const ALLOWED_ORIGINS = (process.env.FRONTEND_URL || process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);

// Railway/Render ponen un balanceador delante: sin `trust proxy` el límite de peticiones ve a todos con la
// IP del proxy. Si además el frontend reenvía /api desde Vercel, hay dos saltos: TRUST_PROXY=2.
// Solo en producción: en local no hay proxy y confiar en X-Forwarded-For permitiría falsear la IP.
if (isProduction || process.env.TRUST_PROXY) {
  app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);
}

// Seguridad
app.use(helmet());
app.use(
  cors({
    origin: ALLOWED_ORIGINS,
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

// Rutas
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'AirtekMusic API',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/tracks', tracksRoutes);
app.use('/api/stream', streamRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/radio', radioRoutes);
app.use('/api/chart', chartRoutes);
app.use('/api/artists', artistRoutes);
app.use('/api/albums', albumRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/home', homeRoutes);

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
