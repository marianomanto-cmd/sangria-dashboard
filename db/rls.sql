-- ════════════════════════════════════════════════════════════════════════════
-- Row-Level Security (RLS) — cierra la REST API pública de Supabase.
-- ════════════════════════════════════════════════════════════════════════════
--
-- POR QUÉ:
--   Supabase expone AUTOMÁTICAMENTE cada tabla del schema `public` vía su REST
--   API (PostgREST), accesible desde internet con la anon key — que es PÚBLICA
--   por diseño (NEXT_PUBLIC_SUPABASE_ANON_KEY viaja en el bundle del browser,
--   ver lib/supabase/client.ts). RLS es lo único que cierra esa puerta.
--   Con RLS activado y SIN policies permisivas, los roles `anon` y
--   `authenticated` quedan denegados → la REST API no devuelve ni modifica nada.
--
-- POR QUÉ NO ROMPE LA APP:
--   La app conecta como `postgres` (dueño de las tablas) vía DATABASE_URL +
--   Drizzle (ver db/index.ts). El DUEÑO bypassa RLS por defecto, así que sigue
--   leyendo/escribiendo igual. NO usamos FORCE ROW LEVEL SECURITY a propósito,
--   justamente para preservar ese bypass del dueño.
--
-- CÓMO APLICAR:
--   Pegá este archivo en el SQL Editor de Supabase (Dashboard → SQL Editor) y
--   ejecutalo. Es idempotente: re-ejecutarlo no causa error.
--   Después corré el bloque de VERIFICACIÓN del final (debe devolver 0 filas).
--
-- NOTA: si en el futuro agregás tablas nuevas al schema, agregalas también acá
--   (o re-ejecutá el bloque dinámico comentado al final).
-- ════════════════════════════════════════════════════════════════════════════

begin;

alter table public.markets                     enable row level security;
alter table public.metrics_catalog             enable row level security;
alter table public.publishers                  enable row level security;
alter table public.clients                     enable row level security;
alter table public.budget_origins              enable row level security;
alter table public.projects                    enable row level security;
alter table public.media_plans                 enable row level security;
alter table public.media_plan_publishers       enable row level security;
alter table public.media_plan_placements       enable row level security;
alter table public.media_plan_fees             enable row level security;
alter table public.media_plan_snapshots        enable row level security;
alter table public.plan_billings               enable row level security;
alter table public.plan_billing_publishers     enable row level security;
alter table public.plan_billing_fees           enable row level security;
alter table public.project_reports             enable row level security;
alter table public.manual_reports               enable row level security;
alter table public.campaign_placement_actuals  enable row level security;
alter table public.campaign_actual_snapshots   enable row level security;
alter table public.simulator_scenarios         enable row level security;
alter table public.audit_log                   enable row level security;

commit;

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN — debe devolver 0 filas. Si lista alguna tabla, esa quedó
-- expuesta (RLS off) y hay que activarla.
-- ────────────────────────────────────────────────────────────────────────────
-- select tablename
-- from pg_tables
-- where schemaname = 'public'
--   and rowsecurity = false
-- order by tablename;

-- ────────────────────────────────────────────────────────────────────────────
-- ALTERNATIVA DINÁMICA — activa RLS en TODAS las tablas de `public` de una,
-- incluso las que se agreguen en el futuro. Útil para no mantener la lista a
-- mano. Descomentá y ejecutá en vez del bloque explícito de arriba.
-- ────────────────────────────────────────────────────────────────────────────
-- do $$
-- declare r record;
-- begin
--   for r in select tablename from pg_tables where schemaname = 'public'
--   loop
--     execute format('alter table public.%I enable row level security;', r.tablename);
--   end loop;
-- end $$;
