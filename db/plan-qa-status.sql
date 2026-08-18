-- ════════════════════════════════════════════════════════════════════════════
-- QA de planes de medios — estados `qa_done` / `live` + tablas del QA + backfill
-- ════════════════════════════════════════════════════════════════════════════
--
-- QUÉ HACE:
--   1. Suma `qa_done` y `live` al enum `plan_status`, después de `approved`.
--   2. Crea `media_plan_qa_runs` (un QA por plan y por versión) y
--      `media_plan_qa_checks` (una fila por línea controlada), con RLS.
--   3. Backfill: los planes que hoy están `approved` (las campañas vigentes)
--      pasan a `live` con su QA dado por hecho, para que ningún plan que ya
--      está al aire quede trabado esperando un control retroactivo.
--
-- CÓMO APLICAR (Dashboard → SQL Editor):
--   ⚠️ CORRÉ CADA PASO POR SEPARADO, EN ORDEN. El PASO 1 tiene que estar
--   COMMITEADO antes de que los pasos 3 y 4 puedan usar los valores nuevos del
--   enum: Postgres no deja usar un valor de enum en la misma transacción en la
--   que se agregó. Si pegás todo junto y lo corrés de una, el PASO 4 falla con
--   "unsafe use of new value of enum type".
--
--   Los pasos son idempotentes: re-correrlos no rompe nada.
--
-- LO QUE PASA DESPUÉS EN LA APP:
--   El lifecycle queda: draft → ready_to_send → approved → qa_done → live.
--   `approved` ahora significa "firmado por el cliente, falta el QA"; para ir a
--   `live` hay que abrir "Realizar QA" y tildar TODAS las líneas del plan. Es
--   obligatorio para el plan nuevo y para cada versión nueva (aprobar la
--   v(N+1) devuelve el plan a `approved` sin QA).
-- ════════════════════════════════════════════════════════════════════════════


-- ────────────────────────────────────────────────────────────────────────────
-- PASO 1 — Valores nuevos del enum.  ⚠️ CORRER SOLO ESTE BLOQUE Y ESPERAR.
-- ────────────────────────────────────────────────────────────────────────────

alter type plan_status add value if not exists 'qa_done' after 'approved';
alter type plan_status add value if not exists 'live'    after 'qa_done';

-- Verificación del paso 1 — tiene que listar los 6 estados en orden:
-- draft, ready_to_send, approved, qa_done, live, archived
--
--   select enumlabel, enumsortorder
--   from pg_enum
--   where enumtypid = 'plan_status'::regtype
--   order by enumsortorder;


-- ────────────────────────────────────────────────────────────────────────────
-- PASO 2 — Tablas del QA + índices + RLS.
-- ────────────────────────────────────────────────────────────────────────────

begin;

-- Un QA por (plan, versión). `completed_at` null = QA en curso.
create table if not exists public.media_plan_qa_runs (
  id                   uuid primary key default gen_random_uuid(),
  media_plan_id        uuid not null references public.media_plans(id) on delete cascade,
  version_number       integer not null,
  completed_at         timestamptz,
  completed_by_user_id uuid,
  completed_by_email   text,
  notes                text,
  created_at           timestamptz not null default now(),
  constraint uq_mpqr_plan_version unique (media_plan_id, version_number)
);

create index if not exists idx_mpqr_plan
  on public.media_plan_qa_runs (media_plan_id, version_number);

-- Una fila por línea controlada, con quién y cuándo.
-- OJO: `placement_id` NO tiene FK a propósito — una versión posterior del plan
-- puede borrar la línea, y el registro del QA de la versión vieja tiene que
-- sobrevivir.
create table if not exists public.media_plan_qa_checks (
  id                 uuid primary key default gen_random_uuid(),
  qa_run_id          uuid not null references public.media_plan_qa_runs(id) on delete cascade,
  placement_id       uuid not null,
  checked_at         timestamptz not null default now(),
  checked_by_user_id uuid,
  checked_by_email   text,
  constraint uq_mpqc_run_placement unique (qa_run_id, placement_id)
);

create index if not exists idx_mpqc_run
  on public.media_plan_qa_checks (qa_run_id);

-- RLS: mismo criterio que db/rls.sql — sin policies, la REST API pública de
-- Supabase queda cerrada para anon/authenticated. La app conecta como dueño
-- (postgres, vía DATABASE_URL) y bypassa RLS, así que no cambia nada para ella.
alter table public.media_plan_qa_runs   enable row level security;
alter table public.media_plan_qa_checks enable row level security;

commit;


-- ────────────────────────────────────────────────────────────────────────────
-- PASO 3 — Preview del backfill (NO modifica nada). Corré esto primero para
-- ver exactamente qué planes van a pasar a `live`.
-- ────────────────────────────────────────────────────────────────────────────

select
  c.name                                   as cliente,
  p.code                                   as proyecto,
  mp.name                                  as plan,
  mp.current_version                       as version,
  count(pl.id)                             as lineas,
  to_char(min(pl.start_date), 'YYYY-MM-DD') as desde,
  to_char(max(pl.end_date),   'YYYY-MM-DD') as hasta
from media_plans mp
join projects p                on p.id  = mp.project_id
join clients  c                on c.id  = p.client_id
left join media_plan_publishers mpp on mpp.media_plan_id = mp.id
left join media_plan_placements pl  on pl.media_plan_publisher_id = mpp.id
where mp.status = 'approved'
  and mp.deleted_at is null
  and mp.current_version >= 1
group by c.name, p.code, mp.name, mp.current_version
order by c.name, p.code, mp.name;


-- ────────────────────────────────────────────────────────────────────────────
-- PASO 4 — Backfill: las campañas vigentes pasan a `live` con el QA hecho.
--
-- El orden importa: 4a y 4b filtran por `status = 'approved'`, así que el
-- update de 4c va último.
-- ────────────────────────────────────────────────────────────────────────────

begin;

-- 4a. Un run de QA CERRADO por cada plan aprobado vigente, sobre su versión
--     actual. El actor queda marcado como migración para que en el historial
--     se distinga de un QA hecho a mano por un planner.
insert into media_plan_qa_runs (
  media_plan_id, version_number, completed_at, completed_by_email, notes
)
select
  mp.id,
  mp.current_version,
  now(),
  'backfill (migración QA)',
  'QA dado por hecho en la migración: la campaña ya estaba activa cuando se introdujo el paso de QA.'
from media_plans mp
where mp.status = 'approved'
  and mp.deleted_at is null
  and mp.current_version >= 1
on conflict (media_plan_id, version_number) do nothing;

-- 4b. Un check por cada línea de esos planes, para que el QA quede completo
--     (y no "cerrado con 0 de N líneas") si alguien lo reabre después.
insert into media_plan_qa_checks (qa_run_id, placement_id, checked_at, checked_by_email)
select
  r.id,
  pl.id,
  now(),
  'backfill (migración QA)'
from media_plan_qa_runs r
join media_plans mp             on mp.id  = r.media_plan_id
                               and r.version_number = mp.current_version
join media_plan_publishers mpp  on mpp.media_plan_id = mp.id
join media_plan_placements pl   on pl.media_plan_publisher_id = mpp.id
where mp.status = 'approved'
  and mp.deleted_at is null
on conflict (qa_run_id, placement_id) do nothing;

-- 4c. Y recién ahora, los planes pasan a `live`.
update media_plans
set status = 'live'
where status = 'approved'
  and deleted_at is null
  and current_version >= 1;

commit;

-- VARIANTE (opcional): si NO querés marcar live las campañas que ya
-- terminaron, reemplazá el where de 4a / 4b / 4c agregando la condición de que
-- el plan tenga alguna línea que todavía no venció:
--
--   and exists (
--     select 1
--     from media_plan_publishers mpp2
--     join media_plan_placements pl2 on pl2.media_plan_publisher_id = mpp2.id
--     where mpp2.media_plan_id = mp.id
--       and (pl2.end_date is null or pl2.end_date >= current_date)
--   )
--
-- Los planes viejos quedarían en `approved` (esperando QA). Ojo: en ese estado
-- siguen contando para billing, estimación y portal —el set "firmado" incluye
-- approved/qa_done/live— así que no se pierde nada; solo aparecen en el filtro
-- "Esperando QA" de /planes.


-- ────────────────────────────────────────────────────────────────────────────
-- PASO 5 — Verificación.
-- ────────────────────────────────────────────────────────────────────────────

-- 5a. Distribución de estados. No debería quedar ningún `approved` (salvo que
--     hayas usado la variante opcional de arriba).
select status, count(*) as planes
from media_plans
where deleted_at is null
group by status
order by status;

-- 5b. Coherencia del QA: todo plan en `qa_done` o `live` tiene que tener el
--     run de su versión vigente CERRADO. Esta query debe devolver 0 filas.
select mp.id, mp.name, mp.status, mp.current_version
from media_plans mp
left join media_plan_qa_runs r
       on r.media_plan_id  = mp.id
      and r.version_number = mp.current_version
where mp.deleted_at is null
  and mp.status in ('qa_done', 'live')
  and (r.id is null or r.completed_at is null);

-- 5c. Líneas controladas vs líneas del plan, por plan migrado. `lineas` y
--     `controladas` tienen que coincidir.
select
  mp.name                          as plan,
  mp.status,
  r.version_number                 as version,
  count(distinct pl.id)            as lineas,
  count(distinct ch.placement_id)  as controladas
from media_plans mp
join media_plan_qa_runs r          on r.media_plan_id = mp.id
                                  and r.version_number = mp.current_version
left join media_plan_publishers mpp on mpp.media_plan_id = mp.id
left join media_plan_placements pl  on pl.media_plan_publisher_id = mpp.id
left join media_plan_qa_checks ch   on ch.qa_run_id = r.id
                                   and ch.placement_id = pl.id
where mp.deleted_at is null
group by mp.name, mp.status, r.version_number
order by mp.name;
