-- ════════════════════════════════════════════════════════════════════════════
-- QA DE PLANIFICACIÓN — el control del MEDIA PLANNER antes de mandar a firma.
--
-- Segundo QA de la app, hermano del que ya existe. Se hacen en momentos
-- distintos, los hace gente distinta y controlan cosas distintas:
--
--   PLANIFICACIÓN (esto)  draft → ready_to_send.   Lo hace el MEDIA PLANNER.
--     Antes de congelar el plan, repasa y tilda cada PLACEMENT y cada ADSET.
--
--   ARMADO (ya existía)   approved → qa_done.      Lo hace el AM/PM.
--     Con el plan firmado, controla que la campaña esté montada tal cual.
--
-- Esta migración es PURAMENTE ADITIVA: crea un enum y dos tablas nuevas y no
-- toca `media_plan_qa_runs` / `media_plan_qa_checks`, que siguen funcionando
-- igual. Correrla NO invalida ni bloquea ningún plan existente.
--
-- Efecto en la app después de correrla: a partir de ahí, marcar un plan como
-- "listo para enviar" abre el modal de QA y exige tildar todo. Los planes que
-- YA están en ready_to_send o más adelante no se tocan — la barrera sólo mira
-- el pase draft → ready_to_send, así que se pueden seguir aprobando normal.
--
-- Idempotente: se puede correr más de una vez sin romper nada.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. Qué se tilda: una línea del plan o un adset ──────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'planning_qa_item_kind') then
    create type planning_qa_item_kind as enum ('placement', 'adset');
  end if;
end $$;

-- ── 2. El run: un QA de planificación por (plan, versión) ───────────────────
--
-- `version_number` es la versión que el draft VA A SER al aprobarse
-- (current_version + 1). Así el QA de planificación de la v3 y el QA de armado
-- de la v3 hablan de la misma versión, y editar un plan aprobado —que abre la
-- v(N+1)— pide un QA nuevo en vez de heredar el anterior.
create table if not exists public.media_plan_planning_qa_runs (
  id                   uuid primary key default gen_random_uuid(),
  media_plan_id        uuid not null references public.media_plans(id) on delete cascade,
  version_number       integer not null,
  -- null = QA en curso. Seteado = cerrado → habilitó el pase a ready_to_send.
  -- Volver a draft lo limpia: lo controlado ya no es necesariamente lo que se
  -- va a congelar.
  completed_at         timestamptz,
  completed_by_user_id uuid,
  completed_by_email   text,
  notes                text,
  created_at           timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'uq_mppqr_plan_version') then
    alter table public.media_plan_planning_qa_runs
      add constraint uq_mppqr_plan_version unique (media_plan_id, version_number);
  end if;
end $$;

create index if not exists idx_mppqr_plan
  on public.media_plan_planning_qa_runs (media_plan_id, version_number);

-- ── 3. Los tildes ──────────────────────────────────────────────────────────
--
-- Sin FK a media_plan_placements ni a media_plan_traffic_adsets A PROPÓSITO
-- (mismo criterio que media_plan_qa_checks): la línea o el adset pueden
-- desaparecer en una versión futura y el registro de qué se controló, quién y
-- cuándo tiene que sobrevivir.
create table if not exists public.media_plan_planning_qa_checks (
  id                 uuid primary key default gen_random_uuid(),
  qa_run_id          uuid not null references public.media_plan_planning_qa_runs(id) on delete cascade,
  item_kind          planning_qa_item_kind not null,
  item_id            uuid not null,
  checked_at         timestamptz not null default now(),
  checked_by_user_id uuid,
  checked_by_email   text
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'uq_mppqc_run_item') then
    alter table public.media_plan_planning_qa_checks
      add constraint uq_mppqc_run_item unique (qa_run_id, item_kind, item_id);
  end if;
end $$;

create index if not exists idx_mppqc_run
  on public.media_plan_planning_qa_checks (qa_run_id);

-- ── 4. RLS ─────────────────────────────────────────────────────────────────
-- Igual que el resto: la app entra con service role, así que activar RLS sin
-- políticas cierra la REST API pública de Supabase. Ver db/rls.sql.
alter table public.media_plan_planning_qa_runs   enable row level security;
alter table public.media_plan_planning_qa_checks enable row level security;

commit;

-- ── Verificación ───────────────────────────────────────────────────────────
-- Las dos tablas creadas, con RLS activo y sin políticas (= cerradas).
select
  c.relname                                   as tabla,
  c.relrowsecurity                            as rls_activo,
  (select count(*) from pg_policies p
    where p.schemaname = 'public' and p.tablename = c.relname) as politicas
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'media_plan_planning_qa_runs',
    'media_plan_planning_qa_checks'
  )
order by c.relname;

-- Los valores del enum nuevo.
select enumlabel as item_kind
from pg_enum e
join pg_type t on t.oid = e.enumtypid
where t.typname = 'planning_qa_item_kind'
order by e.enumsortorder;
