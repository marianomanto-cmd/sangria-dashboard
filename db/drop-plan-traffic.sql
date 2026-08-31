-- ════════════════════════════════════════════════════════════════════════════
-- BAJA de la sección TRÁFICO del plan.
--
-- El tráfico vuelve a manejarse con un documento externo, así que la ventana
-- /trafico, sus dos capas (adsets del planner, ads del AM/PM) y el catálogo de
-- tipos de ad que alimentaba el desplegable salen de la app.
--
-- ⚠️ BORRA DATOS Y NO SE PUEDE DESHACER. Se va todo lo que se haya cargado en
-- la sección: adsets, ads, links de creativos, copies y los registros de
-- "cargado en plataforma". Antes de correrla conviene bajarse lo que haya
-- (queda el bloque de inventario comentado más abajo).
--
-- NO toca los planes, publishers, placements, fees ni billings: el tráfico
-- colgaba del placement, no al revés.
--
-- Orden: hijos → padres. `drop table` con FK cascade lo resolvería igual, pero
-- explícito se lee mejor y falla ruidosamente si algo no está donde se espera.
--
-- Idempotente: se puede correr más de una vez.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Inventario ANTES de borrar (opcional, descomentar para verlo) ───────────
-- select
--   (select count(*) from media_plan_traffic_ads)     as ads,
--   (select count(*) from media_plan_traffic_adsets)  as adsets,
--   (select count(*) from media_plan_traffic_briefs)  as lineas_con_trafico,
--   (select count(*) from ad_types)                   as tipos_de_ad;

begin;

drop table if exists public.media_plan_traffic_ads;
drop table if exists public.media_plan_traffic_adsets;
drop table if exists public.media_plan_traffic_briefs;

-- El catálogo de tipos de ad existía sólo para el desplegable de los ads.
drop table if exists public.ad_types;

commit;

-- ── Verificación ───────────────────────────────────────────────────────────
-- Tiene que devolver 0 filas: ninguna de las cuatro tablas existe ya.
select tablename
from pg_tables
where schemaname = 'public'
  and tablename in (
    'media_plan_traffic_ads',
    'media_plan_traffic_adsets',
    'media_plan_traffic_briefs',
    'ad_types'
  )
order by tablename;

-- Y esto tiene que seguir devolviendo las cuatro tablas del plan, intactas.
select tablename
from pg_tables
where schemaname = 'public'
  and tablename in (
    'media_plans',
    'media_plan_publishers',
    'media_plan_placements',
    'media_plan_fees'
  )
order by tablename;
