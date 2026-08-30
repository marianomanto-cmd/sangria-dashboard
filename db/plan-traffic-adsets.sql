-- ════════════════════════════════════════════════════════════════════════════
-- TRÁFICO v2 — adsets del planner + ads del AM/PM + catálogo de tipos de ad
-- ════════════════════════════════════════════════════════════════════════════
--
-- QUÉ HACE:
--   1. Crea `ad_types` (catálogo de tipos de ad per-cliente, como
--      metrics_catalog) y siembra los estándar para TODOS los clientes:
--      Carrusel, Single image, Video, DGEN set, PMAX set, YT Video y Otro.
--   2. Crea `media_plan_traffic_adsets` — el nivel intermedio que faltaba:
--      placement → adsets (audiencia, budget, pilar creativo, fechas) → ads.
--   3. Migra `media_plan_traffic_ads` de colgar del BRIEF a colgar del ADSET,
--      y le suma las columnas nuevas (ad_type_id, ad_type_other, creative_url,
--      click_url). Los ads que ya existían se conservan: a cada brief con ads
--      se le crea un adset "Adset 1" y los ads se le reasignan, mapeando el
--      viejo enum `traffic_ad_format` al tipo del catálogo del cliente.
--   4. Saca `adsets_count` del brief: ahora la cantidad de adsets se DERIVA de
--      cuántos hay, no se carga a mano.
--   5. RLS de las tablas nuevas.
--
-- CÓMO APLICAR (Dashboard → SQL Editor):
--   Pegá el archivo entero y ejecutalo. Es idempotente: re-correrlo no rompe
--   nada. Si nunca corriste `db/plan-traffic.sql`, corré ESE PRIMERO.
--
-- LO QUE PASA DESPUÉS EN LA APP — dos gates nuevos:
--
--   ⚠️ `ready_to_send` / `approved` exigen que TODOS los placements tengan al
--   menos un adset, con audiencia, budget, pilar creativo y fechas. Los planes
--   que ya están firmados no se tocan (la regla corre sobre la transición),
--   pero cualquier plan en borrador queda frenado hasta cargar sus adsets.
--
--   ⚠️ Cerrar el QA exige que TODOS los ads estén completos (tipo, creativo,
--   copy, título, subtítulo, URL y landing) y que cada adset tenga al menos
--   uno. Marcar Live sigue exigiendo, además, que estén todos cargados.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. Catálogo de tipos de ad ──────────────────────────────────────────────
create table if not exists public.ad_types (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.clients(id) on delete cascade,
  slug            text not null,
  name            text not null,
  requires_detail boolean not null default false,
  enabled         boolean not null default true,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  constraint ad_types_client_slug_uq unique (client_id, slug)
);

create index if not exists idx_ad_types_client_enabled
  on public.ad_types (client_id, enabled, sort_order);

-- Semilla para todos los clientes existentes. `on conflict do nothing` la hace
-- idempotente y respeta lo que cada cliente ya haya editado.
insert into public.ad_types (client_id, slug, name, requires_detail, sort_order)
select c.id, t.slug, t.name, t.requires_detail, t.sort_order
  from public.clients c
  cross join (values
    ('carousel',     'Carrusel',     false, 0),
    ('single_image', 'Single image', false, 1),
    ('video',        'Video',        false, 2),
    ('dgen_set',     'DGEN set',     false, 3),
    ('pmax_set',     'PMAX set',     false, 4),
    ('yt_video',     'YT Video',     false, 5),
    ('other',        'Otro',         true,  6)
  ) as t(slug, name, requires_detail, sort_order)
on conflict (client_id, slug) do nothing;

-- ── 2. Adsets ───────────────────────────────────────────────────────────────
create table if not exists public.media_plan_traffic_adsets (
  id              uuid primary key default gen_random_uuid(),
  brief_id        uuid not null
                    references public.media_plan_traffic_briefs(id)
                    on delete cascade,
  name            text,
  audience        text,
  budget_usd      numeric(14, 2),
  creative_pillar text,
  start_date      date,
  end_date        date,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_mptas_brief
  on public.media_plan_traffic_adsets (brief_id, sort_order);

-- ── 3. Ads: del brief al adset + columnas nuevas ────────────────────────────
alter table public.media_plan_traffic_ads
  add column if not exists adset_id        uuid references public.media_plan_traffic_adsets(id) on delete cascade,
  add column if not exists ad_type_id      uuid references public.ad_types(id) on delete set null,
  add column if not exists ad_type_other   text,
  add column if not exists creative_url    text,
  add column if not exists click_url       text;

-- Backfill: un adset "Adset 1" por cada brief que tenga ads, y los ads pasan a
-- colgar de él. Sólo corre si todavía existe la columna brief_id.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'media_plan_traffic_ads'
       and column_name  = 'brief_id'
  ) then
    insert into public.media_plan_traffic_adsets (brief_id, name, sort_order)
    select distinct a.brief_id, 'Adset 1', 0
      from public.media_plan_traffic_ads a
     where a.adset_id is null
       and not exists (
         select 1 from public.media_plan_traffic_adsets s
          where s.brief_id = a.brief_id
       );

    update public.media_plan_traffic_ads a
       set adset_id = s.id
      from public.media_plan_traffic_adsets s
     where a.adset_id is null
       and s.brief_id = a.brief_id
       and s.sort_order = 0;

    -- El enum viejo (traffic_ad_format) → el tipo del catálogo del cliente.
    -- 'dgen_set' del enum se llamaba igual, así que el join por slug alcanza.
    if exists (
      select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name   = 'media_plan_traffic_ads'
         and column_name  = 'ad_format'
    ) then
      update public.media_plan_traffic_ads a
         set ad_type_id    = t.id,
             ad_type_other = coalesce(a.ad_type_other, a.ad_format_other)
        from public.media_plan_traffic_adsets s
        join public.media_plan_traffic_briefs b on b.id = s.brief_id
        join public.media_plan_placements     p on p.id = b.placement_id
        join public.media_plan_publishers    mp on mp.id = p.media_plan_publisher_id
        join public.media_plans              pl on pl.id = mp.media_plan_id
        join public.projects                 pr on pr.id = pl.project_id
        join public.ad_types                  t on t.client_id = pr.client_id
                                               and t.slug = a.ad_format::text
       where a.adset_id = s.id
         and a.ad_type_id is null
         and a.ad_format is not null;
    end if;

    -- Un ad sin adset a esta altura es huérfano (su brief no existe): se borra.
    delete from public.media_plan_traffic_ads where adset_id is null;

    alter table public.media_plan_traffic_ads drop column brief_id;
  end if;
end $$;

alter table public.media_plan_traffic_ads
  alter column adset_id set not null;

-- Columnas del modelo viejo que ya no se usan.
alter table public.media_plan_traffic_ads
  drop column if exists ad_format,
  drop column if exists ad_format_other,
  drop column if exists cta;

drop index if exists public.idx_mpta_brief;
create index if not exists idx_mpta_adset
  on public.media_plan_traffic_ads (adset_id, sort_order);

-- ── 4. La cantidad de adsets ahora se deriva ────────────────────────────────
alter table public.media_plan_traffic_briefs
  drop column if exists adsets_count;

-- ── 5. RLS (ver db/rls.sql: toda tabla nueva necesita su ENABLE) ────────────
alter table public.ad_types                    enable row level security;
alter table public.media_plan_traffic_adsets   enable row level security;

commit;

-- El enum viejo queda sin uso. Se borra aparte porque `drop type` falla si
-- alguna columna todavía lo referencia — corré esto DESPUÉS del commit:
-- drop type if exists traffic_ad_format;

-- ── Verificación ────────────────────────────────────────────────────────────
-- (a) Tablas nuevas con RLS — 2 filas, ambas rowsecurity = true:
--
-- select tablename, rowsecurity
--   from pg_tables
--  where schemaname = 'public'
--    and tablename in ('ad_types', 'media_plan_traffic_adsets');
--
-- (b) Tipos de ad por cliente — 7 por cliente:
--
-- select c.name, count(*) from public.ad_types t
--   join public.clients c on c.id = t.client_id
--  group by c.name order by c.name;
--
-- (c) Ningún ad huérfano:
--
-- select count(*) from public.media_plan_traffic_ads where adset_id is null;
