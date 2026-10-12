/**
 * Prueba de humo de la API de Airtek Music contra el servidor en marcha y el Supabase real.
 *
 *   npm run test:smoke                       (servidor en http://localhost:$PORT)
 *   SMOKE_BASE_URL=https://... npm run test:smoke
 *
 * Crea un usuario temporal ya confirmado (no se envía ningún correo), recorre los flujos
 * principales y lo borra al terminar. Necesita SUPABASE_SERVICE_ROLE_KEY en el .env.
 */
require('dotenv').config({ quiet: true });
const { createClient } = require('@supabase/supabase-js');

const BASE_URL = (process.env.SMOKE_BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '') + '/api';
const ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';
const TEST_PASSWORD = 'Prueba1234';

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const results = [];
let cookie = '';

async function api(method, path, { body, headers = {}, auth = true, raw = false } = {}) {
  const response = await fetch(BASE_URL + path, {
    method,
    headers: {
      Origin: ORIGIN,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(auth && cookie ? { Cookie: cookie } : {}),
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
  const ts = Date.now();
  const email = `smoke.${ts}@example.com`;
  const username = `smoke_${ts % 1_000_000}`;

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
    user_metadata: { username, alias: 'Smoke Test' },
  });
  if (createError) throw new Error(`No se pudo crear el usuario de prueba: ${createError.message}`);

  let firstTrack = null;
  let chartTrack = null;

  try {
    // ── Servidor ────────────────────────────────────────────────────────────
    await check('Servidor', 'GET /health', async () => {
      const r = await api('GET', '/health', { auth: false });
      expectStatus(r, 200);
      return `status ${r.body.status}`;
    });
    await check('Servidor', 'Ruta inexistente → 404 JSON', async () => {
      const r = await api('GET', '/no-existe', { auth: false });
      expectStatus(r, 404);
      expect(r.body?.success === false, 'sin { success: false }');
      return r.body.error;
    });

    // ── Autenticación ───────────────────────────────────────────────────────
    await check('Auth', 'Registro con contraseña débil → 400', async () => {
      const r = await api('POST', '/auth/register', { auth: false, body: { email: `x${ts}@example.com`, password: 'abcdefgh', username: 'prueba_debil' } });
      expectStatus(r, 400);
      return r.body.error;
    });
    await check('Auth', 'Registro con correo duplicado → 409 (sin caída)', async () => {
      const r = await api('POST', '/auth/register', { auth: false, body: { email, password: TEST_PASSWORD, username: `${username}_b` } });
      expectStatus(r, 409);
      return r.body.error;
    });
    await check('Auth', 'Login → cookie HttpOnly', async () => {
      const r = await api('POST', '/auth/login', { auth: false, body: { email, password: TEST_PASSWORD } });
      expectStatus(r, 200);
      const setCookies = r.headers.getSetCookie();
      expect(setCookies.some((c) => /HttpOnly/i.test(c)), 'sin cookie HttpOnly');
      cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
      return 'sesión iniciada';
    });
    await check('Auth', 'Login con contraseña incorrecta → 401', async () => {
      const r = await api('POST', '/auth/login', { auth: false, body: { email, password: 'Incorrecta123' } });
      expectStatus(r, 401);
      return r.body.error;
    });
    await check('Auth', 'GET /auth/me', async () => {
      const r = await api('GET', '/auth/me');
      expectStatus(r, 200);
      expect(r.body.user?.username === username, 'perfil incorrecto');
      return `@${r.body.user.username} (${r.body.user.rol})`;
    });
    await check('Auth', 'Ruta protegida sin cookie → 401', async () => {
      const r = await api('GET', '/playlists', { auth: false });
      expectStatus(r, 401);
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
      const r = await api('GET', '/radio', { auth: false });
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
    await check('Streaming', 'GET /stream sin cookie → 401', async () => {
      const r = await api('GET', `/stream/${encodeURIComponent(firstTrack.id_externo)}`, { auth: false, raw: true });
      expectStatus(r, 401);
      return 'bloqueado';
    });

    // ── Biblioteca ──────────────────────────────────────────────────────────
    const trackBody = { ...(firstTrack ?? {}) };
    await check('Biblioteca', 'Favoritos: añadir, repetir, listar y quitar', async () => {
      const added = await api('POST', '/favorites', { body: trackBody });
      expectStatus(added, 201);
      const repeated = await api('POST', '/favorites', { body: trackBody });
      expectStatus(repeated, 200);
      const list = await api('GET', '/favorites');
      expect(list.body.favorites.some((f) => f.pista?.id_externo === trackBody.id_externo), 'no aparece en la lista');
      const removed = await api('DELETE', `/favorites/${encodeURIComponent(trackBody.id_externo)}`);
      expectStatus(removed, 200);
      return 'añadido (201), repetido sin duplicar (200), listado y quitado';
    });
    await check('Biblioteca', 'Playlists: crear, añadir, duplicado, quitar y borrar', async () => {
      const created = await api('POST', '/playlists', { body: { nombre: 'Smoke test' } });
      expectStatus(created, 201);
      const id = created.body.playlist.id;
      try {
        expectStatus(await api('POST', `/playlists/${id}/tracks`, { body: trackBody }), 201);
        expectStatus(await api('POST', `/playlists/${id}/tracks`, { body: trackBody }), 409);
        const detail = await api('GET', `/playlists/${id}`);
        expect(detail.body.playlist.pistas.length === 1, 'la playlist no tiene la pista');
        expectStatus(await api('DELETE', `/playlists/${id}/tracks/${encodeURIComponent(trackBody.id_externo)}`), 200);
      } finally {
        expectStatus(await api('DELETE', `/playlists/${id}`), 200);
      }
      return 'creada (201), pista añadida (201), duplicado rechazado (409), quitada y borrada';
    });

    await check('Biblioteca', 'GET /home: artistas de tus favoritos, álbumes y pistas', async () => {
      const fresh = await api('GET', '/home');
      expectStatus(fresh, 200);
      expect(fresh.body.meta.artistas_origen === 'populares', `usuario nuevo con origen "${fresh.body.meta.artistas_origen}"`);
      expect(fresh.body.data.artistas.length > 0, 'sin artistas sugeridos');

      const favorite = chartTrack ?? firstTrack;
      expectStatus(await api('POST', '/favorites', { body: favorite }), 201);
      try {
        const personal = await api('GET', '/home');
        expectStatus(personal, 200);
        const { artistas, albumes, pistas } = personal.body.data;
        expect(personal.body.meta.artistas_origen !== 'populares', 'no usó los favoritos');
        expect(artistas[0]?.id === favorite.artista_id, `el primer artista no es el de tu favorito (${favorite.artista})`);
        expect(albumes.length > 0 && albumes.every((a) => a.id?.startsWith('deezer:album:')), 'álbumes vacíos o incorrectos');
        expect(pistas.length > 0 && pistas.every(hasTrackShape), 'pistas vacías o incorrectas');

        const again = await api('GET', '/home');
        const sameAlbums = albumes.map((a) => a.id).join() === again.body.data.albumes.map((a) => a.id).join();
        expect(!sameAlbums, 'los álbumes no cambian entre recargas');
        return `nuevo → ${fresh.body.data.artistas.length} populares; con favorito → "${artistas[0].nombre}" primero (${personal.body.meta.artistas_origen}), ${albumes.length} álbumes que cambian, ${pistas.length} pistas`;
      } finally {
        await api('DELETE', `/favorites/${encodeURIComponent(favorite.id_externo)}`);
      }
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

    // ── Administración ──────────────────────────────────────────────────────
    await check('Admin', 'GET /admin/stats con usuario normal → 403', async () => {
      const r = await api('GET', '/admin/stats');
      expectStatus(r, 403);
      return r.body.error;
    });
  } finally {
    const { error } = await admin.auth.admin.deleteUser(created.user.id);
    if (error) console.warn(`⚠ No se pudo borrar el usuario de prueba ${email}: ${error.message}`);
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
