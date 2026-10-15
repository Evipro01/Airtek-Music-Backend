/**
 * Prueba de humo de la API pública de Airtek Music contra el servidor en marcha.
 *
 *   npm run test:smoke                       (servidor en http://localhost:$PORT)
 *   SMOKE_BASE_URL=https://... npm run test:smoke
 */
require('dotenv').config({ quiet: true });

const BASE_URL = (process.env.SMOKE_BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '') + '/api';
const ORIGIN = (process.env.FRONTEND_URL || process.env.CORS_ORIGIN || 'http://localhost:5173').split(',')[0].trim();

const results = [];

async function api(method, path, { body, headers = {}, raw = false } = {}) {
  const response = await fetch(BASE_URL + path, {
    method,
    headers: {
      Origin: ORIGIN,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) {
    const bytes = (await response.arrayBuffer()).byteLength;
    return { status: response.status, headers: response.headers, bytes };
  }
  return { status: response.status, headers: response.headers, body: await response.json().catch(() => null) };
}

// Ejecuta una comprobación: `fn` devuelve un texto de detalle o lanza un error con el motivo del fallo
async function check(group, name, fn) {
  try {
    const detail = await fn();
    results.push({ group, name, ok: true, detail });
  } catch (error) {
    results.push({ group, name, ok: false, detail: error.message });
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

const expectStatus = (response, status) =>
  expect(response.status === status, `HTTP ${response.status} (esperado ${status}): ${JSON.stringify(response.body)?.slice(0, 120)}`);

const TRACK_KEYS = ['id_externo', 'titulo', 'artista', 'portada_url'];
const hasTrackShape = (track) => TRACK_KEYS.every((key) => key in track);

async function run() {
  let firstTrack = null;
  let chartTrack = null;

  {
    // ── Servidor ────────────────────────────────────────────────────────────
    await check('Servidor', 'GET /health', async () => {
      const r = await api('GET', '/health');
      expectStatus(r, 200);
      return `status ${r.body.status}`;
    });
    await check('Servidor', 'Ruta inexistente → 404 JSON', async () => {
      const r = await api('GET', '/no-existe');
      expectStatus(r, 404);
      expect(r.body?.success === false, 'sin { success: false }');
      return r.body.error;
    });

    // ── Catálogo ────────────────────────────────────────────────────────────
    await check('Catálogo', 'GET /search (pistas, artistas y álbumes)', async () => {
      const r = await api('GET', '/search?q=daft%20punk');
      expectStatus(r, 200);
      const { pistas, artistas, albumes } = r.body.data;
      expect(pistas.length > 0 && pistas.every(hasTrackShape), 'pistas vacías o con formato incorrecto');
      expect(artistas.length > 0 && artistas.every((a) => a.id?.startsWith('deezer:artist:') && a.nombre), 'artistas vacíos o incorrectos');
      expect(albumes.length > 0 && albumes.every((a) => a.id?.startsWith('deezer:album:') && a.titulo), 'álbumes vacíos o incorrectos');
      firstTrack = pistas.find((t) => t.id_externo.startsWith('deezer:')) ?? pistas[0];
      return `${pistas.length} pistas, ${artistas.length} artistas, ${albumes.length} álbumes (${JSON.stringify(r.body.meta.proveedores)})`;
    });
    await check('Catálogo', 'GET /search sin q → 400', async () => {
      const r = await api('GET', '/search');
      expectStatus(r, 400);
      return r.body.error;
    });
    await check('Catálogo', 'GET /chart (caché + mezcla)', async () => {
      const first = await api('GET', '/chart');
      expectStatus(first, 200);
      const startedAt = Date.now();
      const second = await api('GET', '/chart');
      const cachedMs = Date.now() - startedAt;
      expect(first.body.data.length > 0 && first.body.data.every(hasTrackShape), 'chart vacío o con formato incorrecto');
      const sameOrder = first.body.data.map((t) => t.id_externo).join() === second.body.data.map((t) => t.id_externo).join();
      expect(!sameOrder, 'dos peticiones devolvieron el mismo orden (¿sin mezcla?)');
      chartTrack = first.body.data[0];
      return `${first.body.data.length} canciones, orden distinto en cada petición, 2ª respuesta en ${cachedMs} ms`;
    });
    await check('Catálogo', 'GET /radio (HLS)', async () => {
      const r = await api('GET', '/radio');
      expectStatus(r, 200);
      const station = r.body.data[0];
      const playlist = await fetch(station.stream_url, { headers: { Origin: ORIGIN } });
      expect(playlist.ok, `la emisora ${station.titulo} respondió HTTP ${playlist.status}`);
      expect((await playlist.text()).startsWith('#EXTM3U'), 'la emisora no devolvió una lista .m3u8');
      return `${r.body.data.length} emisoras; "${station.titulo}" emite (CORS: ${playlist.headers.get('access-control-allow-origin')})`;
    });

    // ── Streaming ───────────────────────────────────────────────────────────
    await check('Streaming', 'GET /stream/:id con Range → 206', async () => {
      const track = chartTrack || firstTrack;
      const r = await api('GET', `/stream/${encodeURIComponent(track.id_externo)}`, { headers: { Range: 'bytes=0-1023' }, raw: true });
      expectStatus(r, 206);
      expect(r.headers.get('content-type')?.startsWith('audio/'), 'no es audio');
      return `${r.bytes} bytes, ${r.headers.get('content-range')}`;
    });
    await check('Streaming', 'Audius: búsqueda mixta y canción completa con seek', async () => {
      const search = await api('GET', '/search?q=reggaeton');
      expectStatus(search, 200);
      expect(search.body.meta.proveedores.audius === 'ok', `Audius: ${search.body.meta.proveedores.audius}`);
      const track = search.body.data.pistas.find((t) => t.id_externo.startsWith('audius:track:'));
      expect(track, 'la búsqueda no devolvió pistas de Audius');
      expect(search.body.data.pistas.some((t) => t.id_externo.startsWith('deezer:track:')), 'faltan pistas de Deezer');

      const path = `/stream/${encodeURIComponent(track.id_externo)}`;
      // Rango acotado: un `bytes=0-` descargaría la canción entera (las mezclas de Audius pesan >100 MB)
      const start = await api('GET', path, { headers: { Range: 'bytes=0-1023' }, raw: true });
      expectStatus(start, 206);
      expect(start.headers.get('x-audio-preview') === 'false', 'marcada como preview');
      const seek = await api('GET', path, { headers: { Range: 'bytes=100000-100999' }, raw: true });
      expectStatus(seek, 206);
      const size = Number(start.headers.get('content-range')?.split('/')[1]);
      return `"${track.titulo}" (${track.duracion} s): ${(size / 1e6).toFixed(1)} MB completos, seek → ${seek.headers.get('content-range')}`;
    });

    // ── Inicio ──────────────────────────────────────────────────────────────
    await check('Inicio', 'GET /home: populares sin favoritos y artistas de ?favoritos=', async () => {
      const fresh = await api('GET', '/home');
      expectStatus(fresh, 200);
      expect(fresh.body.meta.artistas_origen === 'populares', `sin favoritos con origen "${fresh.body.meta.artistas_origen}"`);
      expect(fresh.body.data.artistas.length > 0, 'sin artistas sugeridos');

      const favorite = [chartTrack, firstTrack].find((track) => track?.id_externo.startsWith('deezer:track:') && track.artista_id);
      expect(favorite, 'no hay una pista de Deezer con artista para probar');
      const personal = await api('GET', `/home?favoritos=${encodeURIComponent(favorite.id_externo)}`);
      expectStatus(personal, 200);
      const { artistas, albumes, pistas } = personal.body.data;
      expect(personal.body.meta.artistas_origen !== 'populares', 'no usó los favoritos');
      expect(artistas[0]?.id === favorite.artista_id, `el primer artista no es el de tu favorito (${favorite.artista})`);
      expect(albumes.length > 0 && albumes.every((a) => a.id?.startsWith('deezer:album:')), 'álbumes vacíos o incorrectos');
      expect(pistas.length > 0 && pistas.every(hasTrackShape), 'pistas vacías o incorrectas');

      const again = await api('GET', '/home');
      const sameAlbums = albumes.map((a) => a.id).join() === again.body.data.albumes.map((a) => a.id).join();
      expect(!sameAlbums, 'los álbumes no cambian entre recargas');
      return `sin favoritos → ${fresh.body.data.artistas.length} populares; con favorito → "${artistas[0].nombre}" primero (${personal.body.meta.artistas_origen}), ${albumes.length} álbumes que cambian, ${pistas.length} pistas`;
    });
    await check('Inicio', 'GET /home ignora ids con formato inválido', async () => {
      const r = await api('GET', `/home?favoritos=${encodeURIComponent('jamendo:track:1,deezer:track:abc,<script>')}`);
      expectStatus(r, 200);
      expect(r.body.meta.artistas_origen === 'populares', `origen "${r.body.meta.artistas_origen}"`);
      return 'solo artistas populares';
    });

    // ── Páginas de artista y álbum (si el servidor ya las tiene) ─────────────
    await check('Catálogo', 'Campos extra en /search (artista_id, album_id, album, duracion, explicita)', async () => {
      for (const key of ['artista_id', 'album_id', 'album', 'duracion', 'explicita']) {
        expect(key in firstTrack, `falta "${key}"`);
      }
      return `${firstTrack.titulo}: ${firstTrack.album} (${firstTrack.duracion} s)`;
    });
    await check('Catálogo', 'GET /artists/:id', async () => {
      const id = firstTrack.artista_id;
      expect(id, 'la búsqueda no devolvió artista_id');
      const r = await api('GET', `/artists/${encodeURIComponent(id)}`);
      expectStatus(r, 200);
      expect(r.body.artista?.nombre && r.body.top.length > 0 && r.body.top.every(hasTrackShape), 'respuesta incompleta');
      return `${r.body.artista.nombre}: top ${r.body.top.length}, ${r.body.albumes.length} álbumes`;
    });
    await check('Catálogo', 'GET /artists/:id inexistente → 404', async () => {
      const r = await api('GET', '/artists/deezer%3Aartist%3A999999999999');
      expectStatus(r, 404);
      return r.body.error;
    });
    await check('Catálogo', 'GET /albums/:id', async () => {
      const id = firstTrack.album_id;
      expect(id, 'la búsqueda no devolvió album_id');
      const r = await api('GET', `/albums/${encodeURIComponent(id)}`);
      expectStatus(r, 200);
      expect(r.body.album?.titulo && r.body.album.pistas.every(hasTrackShape), 'respuesta incompleta');
      return `${r.body.album.titulo}: ${r.body.album.pistas.length} pistas con audio`;
    });

    // ── Asistente IA (sin llamar a n8n: cada pregunta real gasta Gemini) ──
    await check('IA', 'POST /ia sin texto → 400', async () => {
      const r = await api('POST', '/ia', { body: { prompt: '   ' } });
      expectStatus(r, 400);
      return r.body.error;
    });
    await check('IA', 'POST /ia con más de 300 caracteres → 400', async () => {
      const r = await api('POST', '/ia', { body: { prompt: 'a'.repeat(301) } });
      expectStatus(r, 400);
      return r.body.error;
    });
    if (!process.env.N8N_IA_URL || !process.env.N8N_IA_HEADER || !process.env.N8N_IA_KEY) {
      await check('IA', 'Sin variables de n8n → 503', async () => {
        const r = await api('POST', '/ia', { body: { prompt: 'música para estudiar' } });
        expectStatus(r, 503);
        return r.body.error;
      });
    }

    // ── Administración ──────────────────────────────────────────────────────
    const adminKey = process.env.ADMIN_API_KEY ?? '';
    if (adminKey.length >= 16) {
      await check('Admin', 'GET /admin/stats sin clave → 401', async () => {
        const r = await api('GET', '/admin/stats');
        expectStatus(r, 401);
        return r.body.error;
      });
      await check('Admin', 'GET /admin/stats con clave incorrecta → 401', async () => {
        const r = await api('GET', '/admin/stats', { headers: { 'X-Admin-Key': `${adminKey}x` } });
        expectStatus(r, 401);
        return r.body.error;
      });
      await check('Admin', 'GET /admin/stats con la clave → 200', async () => {
        const r = await api('GET', '/admin/stats', { headers: { 'X-Admin-Key': adminKey } });
        expectStatus(r, 200);
        return `${r.body.pistas} pistas, ${r.body.favoritos} favoritos`;
      });
    } else {
      await check('Admin', 'Sin ADMIN_API_KEY el panel está desactivado → 503', async () => {
        const r = await api('GET', '/admin/stats');
        expectStatus(r, 503);
        return r.body.error;
      });
    }
    await check('Admin', 'POST /tracks ya no existe → 404', async () => {
      const r = await api('POST', '/tracks', { body: {} });
      expectStatus(r, 404);
      return r.body.error;
    });
  }
}

run()
  .catch((error) => results.push({ group: 'Script', name: 'Ejecución', ok: false, detail: error.message }))
  .finally(() => {
    let group = null;
    for (const result of results) {
      if (result.group !== group) {
        group = result.group;
        console.log(`\n${group}`);
      }
      console.log(`  ${result.ok ? '✅' : '❌'} ${result.name}${result.detail ? ` — ${result.detail}` : ''}`);
    }
    const failed = results.filter((result) => !result.ok).length;
    console.log(`\n${results.length - failed}/${results.length} comprobaciones correctas`);
    process.exitCode = failed ? 1 : 0;
  });
