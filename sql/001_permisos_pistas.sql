-- AirtekMusic · Permisos de escritura sobre el catálogo compartido `pistas`
--
-- Solo el backend (service_role) puede crear o actualizar pistas.
-- Los usuarios (`authenticated`) siguen pudiendo leerlas, pero no modificarlas
-- directamente con la clave pública: así nadie puede alterar el catálogo de todos.
--
-- Ejecutar en: Supabase → SQL Editor → New query → Run

grant select, insert, update on table public.pistas to service_role;
