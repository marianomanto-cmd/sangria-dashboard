-- ════════════════════════════════════════════════════════════════════════════
-- RLS en creative_billings (02/sep/2026)
--
-- db/creative-billings.sql creó la tabla sin habilitar Row-Level Security, y
-- rls.sql es anterior a la tabla. Sin RLS, la REST pública de Supabase la deja
-- legible con la anon key (que viaja al navegador). La app no la lee por la
-- REST: entra por DATABASE_URL como `postgres` (drizzle), que bypasea RLS, así
-- que habilitarla no cambia nada del lado de la app — sólo cierra la puerta.
--
-- Mismo criterio que rls.sql: se habilita RLS sin policies (nadie que no sea
-- el rol de servicio tiene acceso). Idempotente.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.creative_billings enable row level security;
