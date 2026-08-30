-- ════════════════════════════════════════════════════════════════════════════
-- TRÁFICO del plan — brief de armado de adsets (tablas + enum + RLS)
-- ════════════════════════════════════════════════════════════════════════════
--
-- ⚠️ SUPERADO POR `db/plan-traffic-adsets.sql`. Este archivo es el primer paso
-- (crea las tablas base); el otro suma los adsets, el catálogo de tipos de ad
-- y migra los ads. Si arrancás de cero, corré los dos EN ORDEN.
--
-- QUÉ HACE:
--   1. Crea el enum `traffic_ad_format` (single_image, carousel, video,
--      dgen_set, other).
--   2. Crea `media_plan_traffic_briefs` (1 por placement: cantidad de adsets +
--      link a la carpeta de tráfico) y `media_plan_traffic_ads` (N por brief:
--      tipo de anuncio, copy, título, subtítulo, CTA, landing y el registro de
--      "cargado" del trafficker), con sus índices y RLS.
--
-- CÓMO APLICAR (Dashboard → SQL Editor):
--   Pegá el archivo entero y ejecutalo. Es idempotente: re-correrlo no rompe
--   nada. Alternativa equivalente: `npm run db:push` (el schema de Drizzle en
--   db/schema.ts ya tiene las dos tablas).
--
-- LO QUE PASA DESPUÉS EN LA APP:
--   Cada plan suma la ventana "Tráfico"
--   (/proyectos/[code]/planes/[planId]/trafico), con un botón en el header del
--   plan. El planner completa ahí, por placement, lo que el trafficker necesita
--   para armar los adsets; el trafficker marca cada anuncio como "cargado".
--
--   ⚠️ CAMBIO DE COMPORTAMIENTO: a partir de esto, marcar un plan como `live`
--   exige que TODOS sus placements tengan el brief completo y TODOS sus
--   anuncios marcados como cargados (además del QA, que ya era obligatorio).
--   Los planes que YA están `live` no se tocan — la regla corre sobre la
--   transición, no retroactivamente.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. Enum del tipo de anuncio ─────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'traffic_ad_format') then
    create type traffic_ad_format as enum (
      'single_image', 'carousel', 'video', 'dgen_set', 'other'
    );
  end if;
end $$;

-- ── 2. Brief por placement ──────────────────────────────────────────────────
create table if not exists public.media_plan_traffic_briefs (
  id                  uuid primary key default gen_random_uuid(),
  placement_id        uuid not null
                        references public.media_plan_placements(id)
                        on delete cascade,
  adsets_count        integer not null default 0,
  traffic_folder_url  text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint uq_mptb_placement unique (placement_id)
);

-- ── 3. Anuncios del brief ───────────────────────────────────────────────────
create table if not exists public.media_plan_traffic_ads (
  id                uuid primary key default gen_random_uuid(),
  brief_id          uuid not null
                      references public.media_plan_traffic_briefs(id)
                      on delete cascade,
  ad_format         traffic_ad_format,
  ad_format_other   text,
  copy              text,
  headline          text,
  subheadline       text,
  cta               text,
  landing_url       text,
  loaded_at         timestamptz,
  loaded_by_user_id uuid,
  loaded_by_email   text,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_mpta_brief
  on public.media_plan_traffic_ads (brief_id, sort_order);

-- ── 4. RLS (ver db/rls.sql: toda tabla nueva necesita su ENABLE) ────────────
alter table public.media_plan_traffic_briefs enable row level security;
alter table public.media_plan_traffic_ads    enable row level security;

commit;

-- ── Verificación ────────────────────────────────────────────────────────────
-- Tiene que devolver 2 filas, ambas con rowsecurity = true:
--
-- select tablename, rowsecurity
--   from pg_tables
--  where schemaname = 'public'
--    and tablename in ('media_plan_traffic_briefs', 'media_plan_traffic_ads');
