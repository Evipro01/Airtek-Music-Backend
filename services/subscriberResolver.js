const { HttpError } = require('../utils/http');

/**
 * Identifica al abonado de Airtek a partir de la conexión (IP de origen), como hace Airtek TV:
 * el navegador no envía usuario ni contraseña; es la red la que dice quién es.
 *
 * Es un módulo aislado a propósito. Hoy funciona en modo "mock"; cuando los ingenieros de Airtek
 * indiquen cómo consultar su sistema de abonados, se cambia SUBSCRIBER_RESOLVER=http y el resto del
 * backend no se toca.
 *
 * Variables de entorno:
 *   SUBSCRIBER_RESOLVER         "mock" (por defecto) | "http"
 *   MOCK_SUBSCRIBERS            Solo mock. Pares ip=abonado separados por comas,
 *                               p. ej. "127.0.0.1=AB-0001,192.168.1.20=AB-0002"
 *   MOCK_DEFAULT_SUBSCRIBER     Solo mock. Abonado para cualquier IP no listada (por defecto "AB-DEMO")
 *   AIRTEK_SUBSCRIBER_API_URL   Solo http. Servicio interno de Airtek: GET <url>?ip=<ip> → { abonadoId }
 *   AIRTEK_SUBSCRIBER_API_KEY   Solo http. Se envía como "Authorization: Bearer <clave>"
 *
 * Devuelve { id } o null si la IP no corresponde a ningún abonado.
 */
const MODE = process.env.SUBSCRIBER_RESOLVER || 'mock';
const LOOKUP_TIMEOUT_MS = 3000;

function parseMockMap(value = '') {
  return new Map(
    value
      .split(',')
      .map((pair) => pair.split('=').map((part) => part.trim()))
      .filter(([ip, id]) => ip && id),
  );
}

const mockMap = parseMockMap(process.env.MOCK_SUBSCRIBERS);
const mockDefault = process.env.MOCK_DEFAULT_SUBSCRIBER || 'AB-DEMO';

async function resolveMock(ip) {
  return { id: mockMap.get(ip) ?? mockDefault };
}

async function resolveHttp(ip) {
  const baseUrl = process.env.AIRTEK_SUBSCRIBER_API_URL;
  if (!baseUrl) throw new HttpError(500, 'Falta AIRTEK_SUBSCRIBER_API_URL para identificar al abonado');

  const url = new URL(baseUrl);
  url.searchParams.set('ip', ip);

  let response;
  try {
    response = await fetch(url, {
      headers: process.env.AIRTEK_SUBSCRIBER_API_KEY
        ? { Authorization: `Bearer ${process.env.AIRTEK_SUBSCRIBER_API_KEY}` }
        : undefined,
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
  } catch {
    throw new HttpError(502, 'No se pudo consultar el sistema de abonados de Airtek');
  }

  if (response.status === 404) return null;
  if (!response.ok) throw new HttpError(502, 'El sistema de abonados de Airtek respondió con un error');

  const data = await response.json().catch(() => null);
  return data?.abonadoId ? { id: String(data.abonadoId) } : null;
}

if (MODE !== 'mock' && MODE !== 'http') {
  throw new Error(`SUBSCRIBER_RESOLVER debe ser "mock" o "http" (recibido: "${MODE}")`);
}
if (MODE === 'mock' && process.env.NODE_ENV === 'production') {
  console.warn('[abonados] Modo mock en producción: todas las conexiones se asignan a abonados de prueba.');
}

const resolveSubscriber = MODE === 'http' ? resolveHttp : resolveMock;

module.exports = { resolveSubscriber };
