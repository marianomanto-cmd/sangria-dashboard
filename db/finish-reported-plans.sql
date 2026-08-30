-- ════════════════════════════════════════════════════════════════════════════
-- Estado `finished` de un plan + cierre de los planes que quedaron `live`
-- dentro de proyectos ya `reportado`
-- ════════════════════════════════════════════════════════════════════════════
--
-- EL PROBLEMA:
--   Un proyecto pasa a `reportado` cuando se marca su reporte final como
--   entregado (/reportes/calendario). Ese cierre NO bajaba a sus planes: los
--   planes quedaban en `live` para siempre. Resultado: campañas de 2024 y 2025
--   figurando como "al aire" en /planes, en el detalle del proyecto y en el
--   campaign tracker.
--
-- POR QUÉ `finished` Y NO `archived`:
--   `archived` significa "reemplazado por otra versión o cancelado" y está
--   FUERA de PLAN_SIGNED_STATUSES (lib/plan-status.ts). Archivar estos planes
--   los habría borrado del portal del cliente, de analysis, del dashboard, del
--   billing y del histórico del campaign tracker — o sea, habría borrado 2024 y
--   2025 de todas esas vistas. `finished` es el cierre NORMAL: el plan deja de
--   estar al aire pero sigue contando como plan firmado en todo lo histórico.
--
-- QUÉ HACE:
--   1. Suma `finished` al enum `plan_status`, entre `live` y `archived`.
--   2. Diagnóstico (solo lectura): qué planes están abiertos dentro de un
--      proyecto reportado, y qué planes firmados terminaron hace rato.
--   3. Backfill: esos planes pasan a `finished`.
--   4. Verificación.
--
-- CÓMO APLICAR (Dashboard → SQL Editor):
--   ⚠️ CORRÉ CADA PASO POR SEPARADO, EN ORDEN. El PASO 1 tiene que estar
--   COMMITEADO antes de que el PASO 3 pueda usar el valor nuevo del enum:
--   Postgres no deja usar un valor de enum en la misma transacción en la que se
--   agregó ("unsafe use of new value of enum type").
--
--   El PASO 2 se puede correr ANTES que todo — no depende del enum nuevo.
--   Todos los pasos son idempotentes: re-correrlos no rompe nada.
--
-- LO QUE PASA DESPUÉS EN LA APP:
--   `markReportDelivered` (app/actions/reports.ts) cierra en cascada: al marcar
--   el reporte final como entregado, el proyecto pasa a `reportado` y todos sus
--   planes firmados pasan a `finished`, con su fila de auditoría. Este drift no
--   se vuelve a acumular. En el editor del plan quedan los botones "Marcar
--   terminado" (desde live) y "Reabrir plan" (finished → live) para los casos
--   que haya que corregir a mano.
-- ════════════════════════════════════════════════════════════════════════════


-- ────────────────────────────────────────────────────────────────────────────
-- PASO 1 — Valor nuevo del enum.  ⚠️ CORRER SOLO ESTE BLOQUE Y ESPERAR.
-- ────────────────────────────────────────────────────────────────────────────

alter type plan_status add value if not exists 'finished' after 'live';

-- Verificación del paso 1 — tiene que listar los 7 estados en orden:
-- draft, ready_to_send, approved, qa_done, live, finished, archived
--
--   select enumlabel, enumsortorder
--   from pg_enum
--   where enumtypid = 'plan_status'::regtype
--   order by enumsortorder;


-- ────────────────────────────────────────────────────────────────────────────
-- PASO 2 — Diagnóstico. NO modifica nada. Se puede correr antes del paso 1.
-- ────────────────────────────────────────────────────────────────────────────

-- 2a. EL PEDIDO: planes abiertos (approved / qa_done / live) que viven en un
--     proyecto ya `reportado`. Estos son los que el paso 3 va a cerrar.
--     `anio` sale del período real del plan (fechas de sus placements).
select
  c.name                                     as cliente,
  bo.name                                    as budget_origin,
  p.code                                     as proyecto,
  p.status                                   as status_proyecto,
  mp.name                                    as plan,
  mp.status                                  as status_plan,
  mp.current_version                         as version,
  min(pl.start_date)                         as desde,
  max(pl.end_date)                           as hasta,
  extract(year from min(pl.start_date))::int as anio,
  current_date - max(pl.end_date)            as dias_desde_que_termino,
  count(pl.id)                               as lineas
from media_plans mp
join projects p                     on p.id  = mp.project_id
join clients  c                     on c.id  = p.client_id
join budget_origins bo              on bo.id = p.budget_origin_id
left join media_plan_publishers mpp on mpp.media_plan_id = mp.id
left join media_plan_placements pl  on pl.media_plan_publisher_id = mpp.id
where p.status = 'reportado'
  and mp.status in ('approved', 'qa_done', 'live')
  and mp.deleted_at is null
group by c.name, bo.name, p.code, p.status, mp.name, mp.status, mp.current_version
order by anio nulls last, c.name, p.code, mp.name;

-- 2b. Resumen del mismo set, por año y estado — para ver de un vistazo cuántos
--     planes de 2024 / 2025 están en esta situación.
select
  extract(year from sub.desde)::int as anio,
  sub.status_plan,
  count(*)                          as planes
from (
  select mp.id, mp.status as status_plan, min(pl.start_date) as desde
  from media_plans mp
  join projects p                     on p.id = mp.project_id
  left join media_plan_publishers mpp on mpp.media_plan_id = mp.id
  left join media_plan_placements pl  on pl.media_plan_publisher_id = mpp.id
  where p.status = 'reportado'
    and mp.status in ('approved', 'qa_done', 'live')
    and mp.deleted_at is null
  group by mp.id, mp.status
) sub
group by anio, sub.status_plan
order by anio nulls last, sub.status_plan;

-- 2c. INFORMATIVO — el mismo drift pero SIN mirar el proyecto: planes firmados
--     cuyo período terminó hace más de 90 días y siguen abiertos. Incluye los
--     de 2a más los que viven en proyectos que todavía no se reportaron (esos
--     el paso 3 NO los toca: falta cerrar el proyecto primero, desde
--     /reportes/calendario). Sirve para ver el tamaño real del problema.
select
  c.name                          as cliente,
  p.code                          as proyecto,
  p.status                        as status_proyecto,
  mp.name                         as plan,
  mp.status                       as status_plan,
  max(pl.end_date)                as termino,
  current_date - max(pl.end_date) as dias
from media_plans mp
join projects p                     on p.id = mp.project_id
join clients  c                     on c.id = p.client_id
left join media_plan_publishers mpp on mpp.media_plan_id = mp.id
left join media_plan_placements pl  on pl.media_plan_publisher_id = mpp.id
where mp.status in ('approved', 'qa_done', 'live')
  and mp.deleted_at is null
group by c.name, p.code, p.status, mp.name, mp.status
having max(pl.end_date) < current_date - interval '90 days'
order by p.status, termino;


-- ────────────────────────────────────────────────────────────────────────────
-- PASO 3 — Backfill: cerrar los planes de proyectos ya reportados.
--
-- Sólo toca lo que el paso 2a lista. `draft`, `ready_to_send` y `archived`
-- quedan como están: nunca fueron una campaña al aire.
-- ────────────────────────────────────────────────────────────────────────────

begin;

update media_plans mp
set status = 'finished'
from projects p
where p.id = mp.project_id
  and p.status = 'reportado'
  and mp.status in ('approved', 'qa_done', 'live')
  and mp.deleted_at is null;

commit;


-- ────────────────────────────────────────────────────────────────────────────
-- PASO 4 — Verificación.
-- ────────────────────────────────────────────────────────────────────────────

-- 4a. Tiene que devolver 0 filas: ningún plan abierto dentro de un proyecto
--     reportado.
select mp.id, mp.name, mp.status, p.code, p.status as status_proyecto
from media_plans mp
join projects p on p.id = mp.project_id
where p.status = 'reportado'
  and mp.status in ('approved', 'qa_done', 'live')
  and mp.deleted_at is null;

-- 4b. Distribución de estados después del backfill.
select status, count(*) as planes
from media_plans
where deleted_at is null
group by status
order by status;


-- ════════════════════════════════════════════════════════════════════════════
-- ANEXO — higiene de fechas de placements. INFORMATIVO, NO modifica nada.
--
-- Salió del diagnóstico del 30/ago/2026 sobre los 100 planes de este backfill.
-- NO es parte del cierre de planes: son placements con fechas mal cargadas, un
-- problema aparte que el backfill no arregla ni empeora.
-- ════════════════════════════════════════════════════════════════════════════

-- A. Placements con el rango INVERTIDO (fin antes que inicio).
--
--    Cómo entraron: `findPlanReadinessIssues` (lib/plan-readiness.ts) exige que
--    las dos fechas EXISTAN pero no chequea `fin >= inicio` — a diferencia de
--    `bulkUpdatePlacementDates`, que sí lo rechaza. Las dos reglas no están
--    alineadas.
--    Efecto hoy: `computePacePct` corta en `end <= start` y devuelve 0%, así
--    que el plan aparece siempre "adelantado". No rompe nada, pero el pace de
--    esas líneas no significa nada.
select
  c.name        as cliente,
  p.code        as proyecto,
  mp.name       as plan,
  mp.status     as status_plan,
  pub.name      as publisher,
  pl.placement_name,
  pl.start_date as inicio,
  pl.end_date   as fin
from media_plan_placements pl
join media_plan_publishers mpp on mpp.id = pl.media_plan_publisher_id
join publishers pub            on pub.id = mpp.publisher_id
join media_plans mp            on mp.id  = mpp.media_plan_id
join projects p                on p.id   = mp.project_id
join clients  c                on c.id   = p.client_id
where pl.start_date is not null
  and pl.end_date   is not null
  and pl.end_date < pl.start_date
  and mp.deleted_at is null
order by c.name, p.code, mp.name, pl.sort_order;

-- B. Placements de planes FIRMADOS sin fecha de inicio o sin fecha de fin.
--
--    Son anteriores a la regla que exige fechas para aprobar. Ojo: un placement
--    sin fechas NO entra al prorrateo de `getBillingEstimate` — su media, y el
--    management fee sobre esa media, desaparecen del estimado. Además el plan
--    queda fuera del campaign tracker, que exige período completo.
select
  c.name      as cliente,
  p.code      as proyecto,
  mp.name     as plan,
  mp.status   as status_plan,
  pub.name    as publisher,
  pl.placement_name,
  pl.start_date as inicio,
  pl.end_date   as fin,
  pl.amount_usd as monto
from media_plan_placements pl
join media_plan_publishers mpp on mpp.id = pl.media_plan_publisher_id
join publishers pub            on pub.id = mpp.publisher_id
join media_plans mp            on mp.id  = mpp.media_plan_id
join projects p                on p.id   = mp.project_id
join clients  c                on c.id   = p.client_id
where (pl.start_date is null or pl.end_date is null)
  and mp.status in ('approved', 'qa_done', 'live', 'finished')
  and mp.deleted_at is null
order by c.name, p.code, mp.name, pl.sort_order;
