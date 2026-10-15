const net = require('node:net');

/**
 * ¿La petición llega desde la red de Airtek?
 *
 * Igual que Airtek TV, AirtekMusic solo funciona desde una conexión de Airtek. Los rangos se
 * configuran en AIRTEK_IP_RANGES (CIDR separados por comas), p. ej.:
 *   AIRTEK_IP_RANGES=190.120.0.0/16,200.44.32.0/19
 *
 * Si la variable no está definida y no estamos en producción, se aceptan las direcciones locales y
 * privadas (localhost, 10/8, 172.16/12, 192.168/16) para poder desarrollar sin estar en la red real.
 * En producción sin rangos configurados no se acepta ninguna: es más seguro fallar cerrado.
 */
const DEV_RANGES = ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '::1/128', 'fc00::/7'];
const isProduction = process.env.NODE_ENV === 'production';

function parseRanges(value) {
  return value
    .split(',')
    .map((range) => range.trim())
    .filter(Boolean);
}

function buildBlockList(ranges) {
  const list = new net.BlockList();
  for (const range of ranges) {
    const [address, prefix] = range.split('/');
    const type = net.isIPv6(address) ? 'ipv6' : 'ipv4';
    if (!net.isIP(address) || prefix === undefined) {
      throw new Error(`AIRTEK_IP_RANGES contiene un rango no válido: "${range}" (usa formato CIDR, p. ej. 190.120.0.0/16)`);
    }
    list.addSubnet(address, Number(prefix), type);
  }
  return list;
}

const configuredRanges = process.env.AIRTEK_IP_RANGES ? parseRanges(process.env.AIRTEK_IP_RANGES) : null;
const ranges = configuredRanges ?? (isProduction ? [] : DEV_RANGES);
const allowedNetworks = buildBlockList(ranges);

if (!configuredRanges) {
  console.warn(
    isProduction
      ? '[network] AIRTEK_IP_RANGES no está definido: el servicio rechazará todas las conexiones.'
      : '[network] AIRTEK_IP_RANGES no está definido: en desarrollo se aceptan solo direcciones locales y privadas.',
  );
}

// Express entrega las IPv4 como "::ffff:1.2.3.4" cuando escucha en IPv6
function normalizeIp(ip = '') {
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

function isAirtekNetwork(rawIp) {
  const ip = normalizeIp(rawIp);
  if (!net.isIP(ip)) return false;
  return allowedNetworks.check(ip, net.isIPv6(ip) ? 'ipv6' : 'ipv4');
}

module.exports = { isAirtekNetwork };
