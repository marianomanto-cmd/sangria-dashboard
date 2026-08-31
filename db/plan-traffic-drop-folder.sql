-- ════════════════════════════════════════════════════════════════════════════
-- TRÁFICO — la carpeta de archivos sale del placement
-- ════════════════════════════════════════════════════════════════════════════
--
-- QUÉ HACE: borra `traffic_folder_url` de `media_plan_traffic_briefs`.
--
-- POR QUÉ: la carpeta estaba a nivel PLACEMENT (una sola para todo el
-- placement, arriba de los adsets). No es donde va: el trafficker la necesita
-- por AD, y un mismo placement puede tener creatividades distintas en carpetas
-- distintas. El campo del ad `creative_url` ("Link del creativo") ya cumple esa
-- función, así que no hay campo nuevo — sólo se saca el que sobraba.
--
-- `media_plan_traffic_briefs` queda como el contenedor 1:1 del que cuelgan los
-- adsets, sin campos propios. NO se borra la tabla: es el eslabón
-- placement → adsets, y borrarla se llevaría puestos todos los adsets.
--
-- ⚠️ ESTO BORRA DATOS. Si algún placement ya tenía cargada su carpeta, el link
-- se pierde. Para verlos antes de correrlo:
--
--   select p.name as plan, pl.placement_name, b.traffic_folder_url
--     from public.media_plan_traffic_briefs b
--     join public.media_plan_placements     pl on pl.id = b.placement_id
--     join public.media_plan_publishers     mp on mp.id = pl.media_plan_publisher_id
--     join public.media_plans               p  on p.id  = mp.media_plan_id
--    where b.traffic_folder_url is not null;
--
-- CÓMO APLICAR: pegarlo en el SQL Editor. Es idempotente.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.media_plan_traffic_briefs
  drop column if exists traffic_folder_url;

-- ── Verificación: no debe devolver ninguna fila ─────────────────────────────
-- select column_name from information_schema.columns
--  where table_schema = 'public'
--    and table_name   = 'media_plan_traffic_briefs'
--    and column_name  = 'traffic_folder_url';
