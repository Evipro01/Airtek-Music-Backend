-- AirtekMusic · Permisos de lectura para el panel de administración
--
-- GET /api/admin/stats y GET /api/admin/users leen datos de TODOS los usuarios con la
-- service_role (solo el backend la tiene). La service_role ya se salta RLS, pero la
-- migración inicial le quitó los permisos de tabla: aquí se le devuelve SOLO la lectura.
--
-- Ejecutar en: Supabase → SQL Editor → New query → Run

grant select on table public.usuarios, public.playlists, public.favoritos to service_role;

-- Para probar el panel, da rol de administrador a tu cuenta (cambia el correo):
-- update public.usuarios set rol = 'admin' where email = 'tu-correo@ejemplo.com';
