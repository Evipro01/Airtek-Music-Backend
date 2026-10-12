const { Agent, setGlobalDispatcher } = require('undici');

/**
 * Agente HTTP global para el fetch nativo de Node (Deezer, Audius, Jamendo y Supabase).
 *
 * El fetch de Node ya reutiliza conexiones, pero cierra las inactivas a los 4 segundos: entre una
 * canción y la siguiente se volvía a negociar TCP + TLS (~0,5 s por host). Mantenerlas abiertas
 * un minuto elimina ese coste en plays, seeks y búsquedas consecutivas.
 */
setGlobalDispatcher(
  new Agent({
    keepAliveTimeout: 60 * 1000, // inactividad máxima de una conexión reutilizable
    keepAliveMaxTimeout: 10 * 60 * 1000, // tope si el servidor anuncia un keep-alive mayor
    connections: 32, // conexiones simultáneas por host (varios streams y seeks a la vez)
  }),
);
