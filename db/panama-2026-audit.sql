-- ════════════════════════════════════════════════════════════════════════════
-- AUDITORÍA (read-only): ¿qué planes de 2026 usan un mercado "Panamá"?
--
-- Contexto: el catálogo de `markets` es per-cliente y hoy conviven al menos dos
-- entradas de Panamá (ver /configuracion/markets):
--   • slug `panama`         → "Panama Country"        (el país entero)
--   • slug `panama-panama`  → "Panamá - Panamá City"  (la plaza / ciudad)
-- Estas queries listan qué planes de 2026 caen en cada una para poder decidir
-- plan por plan cuál corresponde a ciudad y cuál a país.
--
-- Definición de "plan de 2026" — la misma que usa la UI (`lib/year-filter.ts`):
-- el período del plan NO se almacena, se DERIVA de sus placements
-- (period_start = min(start_date), period_end = max(end_date)) y el plan
-- pertenece a 2026 si ese período INTERSECTA el año (no hace falta que empiece
-- ni termine en 2026). Un plan sin fechas cuenta como año actual, igual que en
-- la UI.
--
-- Todas filtran `media_plans.deleted_at IS NULL` (planes vivos, sin papelera).
-- Nada de esto escribe: son SELECTs, se pueden correr en el SQL Editor de
-- Supabase sin riesgo.
-- ════════════════════════════════════════════════════════════════════════════


-- ── 1) Catálogo: qué mercados "Panamá" existen y cuánto se usan ─────────────
-- Una fila por mercado (per-cliente). `placements` / `planes` cuentan uso en
-- planes vivos de cualquier año — sirve para ver si hay duplicados por cliente
-- o entradas viejas sin uso. Para ver el catálogo completo de un cliente y
-- detectar otras grafías, sacá el WHERE.
select
  c.name    as cliente,
  m.slug,
  m.name    as mercado,
  m.enabled,
  count(pl.id) filter (where mp.id is not null) as placements,
  count(distinct mp.id)                          as planes,
  m.id      as market_id
from markets m
join clients c                       on c.id  = m.client_id
left join media_plan_placements pl   on pl.market_id = m.id
left join media_plan_publishers mpp  on mpp.id = pl.media_plan_publisher_id
left join media_plans mp             on mp.id  = mpp.media_plan_id
                                    and mp.deleted_at is null
where m.slug ilike '%panam%' or m.name ilike '%panam%'
group by c.name, m.id, m.slug, m.name, m.enabled
order by c.name, m.slug;


-- ── 2) LA QUERY: planes de 2026 con Panamá, una fila por plan × mercado ─────
-- Si un plan usa las dos entradas de Panamá aparece en dos filas, así se ve al
-- toque si el plan mezcla ciudad y país.
with panama_markets as (
  select m.id, m.slug, m.name
  from markets m
  where m.slug ilike '%panam%' or m.name ilike '%panam%'
),
plan_period as (
  -- período derivado del plan: min/max sobre TODOS sus placements
  select
    mpp.media_plan_id      as plan_id,
    min(pl.start_date)     as period_start,
    max(pl.end_date)       as period_end
  from media_plan_placements pl
  join media_plan_publishers mpp on mpp.id = pl.media_plan_publisher_id
  group by mpp.media_plan_id
)
select
  c.name   as cliente,
  p.code   as proyecto,
  mp.name  as plan,
  mp.status as estado,
  pm.name  as mercado,
  pm.slug  as slug,
  count(*)             as placements,
  sum(pl.amount_usd)   as usd,
  min(pl.start_date)   as desde,          -- del tramo Panamá
  max(pl.end_date)     as hasta,          -- del tramo Panamá
  pp.period_start      as plan_desde,     -- período completo del plan
  pp.period_end        as plan_hasta,
  string_agg(distinct pub.name, ', ')            as publishers,
  string_agg(distinct pl.placement_name, ' | ')  as detalle,
  mp.id    as plan_id,
  pm.id    as market_id
from media_plan_placements pl
join panama_markets pm         on pm.id  = pl.market_id
join media_plan_publishers mpp on mpp.id = pl.media_plan_publisher_id
join publishers pub            on pub.id = mpp.publisher_id
join media_plans mp            on mp.id  = mpp.media_plan_id
join plan_period pp            on pp.plan_id = mp.id
join projects p                on p.id   = mp.project_id
join clients c                 on c.id   = p.client_id
where mp.deleted_at is null
  and (
    -- el período del plan intersecta 2026…
    (coalesce(pp.period_start, pp.period_end) <= date '2026-12-31'
     and coalesce(pp.period_end, pp.period_start) >= date '2026-01-01')
    -- …o el plan no tiene fechas todavía (en la UI cuenta como año actual)
    or (pp.period_start is null and pp.period_end is null)
  )
group by c.name, p.code, mp.name, mp.status, mp.id,
         pm.name, pm.slug, pm.id, pp.period_start, pp.period_end
order by c.name, p.code, mp.name, pm.slug;


-- ── 3) Detalle línea por línea (para desempatar ciudad vs país) ─────────────
-- Mismo universo que (2) pero sin agrupar: nombre del placement, audiencia y
-- notas suelen decir si la compra era Ciudad de Panamá / PTY o todo el país.
with panama_markets as (
  select m.id, m.slug, m.name
  from markets m
  where m.slug ilike '%panam%' or m.name ilike '%panam%'
),
plan_period as (
  select mpp.media_plan_id as plan_id,
         min(pl.start_date) as period_start,
         max(pl.end_date)   as period_end
  from media_plan_placements pl
  join media_plan_publishers mpp on mpp.id = pl.media_plan_publisher_id
  group by mpp.media_plan_id
)
select
  c.name  as cliente,
  p.code  as proyecto,
  mp.name as plan,
  pm.slug as mercado,
  pub.name as publisher,
  pl.placement_name,
  pl.audience,
  pl.amount_usd,
  pl.start_date,
  pl.end_date,
  pl.notes_md,
  pl.id   as placement_id
from media_plan_placements pl
join panama_markets pm         on pm.id  = pl.market_id
join media_plan_publishers mpp on mpp.id = pl.media_plan_publisher_id
join publishers pub            on pub.id = mpp.publisher_id
join media_plans mp            on mp.id  = mpp.media_plan_id
join plan_period pp            on pp.plan_id = mp.id
join projects p                on p.id   = mp.project_id
join clients c                 on c.id   = p.client_id
where mp.deleted_at is null
  and ((coalesce(pp.period_start, pp.period_end) <= date '2026-12-31'
        and coalesce(pp.period_end, pp.period_start) >= date '2026-01-01')
       or (pp.period_start is null and pp.period_end is null))
order by c.name, p.code, mp.name, pm.slug, pl.start_date nulls last;
