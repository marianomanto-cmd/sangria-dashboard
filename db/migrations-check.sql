-- ════════════════════════════════════════════════════════════════════════════
-- CONTROL (read-only): qué migraciones de db/ ya están aplicadas en esta base.
--
-- Una fila por objeto que crea cada migración aditiva; `aplicada = true`
-- significa que ese objeto ya existe. No escribe nada. Se corre en el SQL
-- Editor antes de decidir si hace falta correr algo.
--
-- drop-plan-traffic.sql aparece sólo como información: es destructiva, y este
-- control nunca la propone.
--
-- Corrido en prod el 02/sep/2026: las 50 filas en true. Después se sumó
-- reports-fk-index.sql, así que ahora son 51 objetos.
-- ════════════════════════════════════════════════════════════════════════════

with objetos(migracion, objeto, aplicada) as (
  -- fk-indexes.sql (02/sep/2026)
  select 'fk-indexes.sql', i, exists (select 1 from pg_indexes where schemaname = 'public' and indexname = i)
  from unnest(array['idx_mpp_plan','idx_mpp_publisher','idx_media_plans_project','idx_plan_billings_plan',
                    'idx_pbp_billing','idx_pbf_billing','idx_pbf_fee','idx_mpf_plan','idx_projects_client',
                    'idx_projects_origin','idx_audit_before_plan','idx_audit_after_plan']) as i
  union all
  -- reports-fk-index.sql (02/sep/2026)
  select 'reports-fk-index.sql', 'idx_project_reports_project',
         exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'idx_project_reports_project')
  union all
  -- plan-planning-qa.sql
  select 'plan-planning-qa.sql', 'type planning_qa_item_kind', exists (select 1 from pg_type where typname = 'planning_qa_item_kind')
  union all
  select 'plan-planning-qa.sql', 'table ' || t, exists (select 1 from pg_tables where schemaname = 'public' and tablename = t)
  from unnest(array['media_plan_planning_qa_runs','media_plan_planning_qa_checks']) as t
  union all
  -- plan-qa-status.sql
  select 'plan-qa-status.sql', 'table ' || t, exists (select 1 from pg_tables where schemaname = 'public' and tablename = t)
  from unnest(array['media_plan_qa_runs','media_plan_qa_checks']) as t
  union all
  select 'plan-qa-status.sql', 'plan_status tiene ' || v,
         exists (select 1 from pg_enum e join pg_type ty on ty.oid = e.enumtypid where ty.typname = 'plan_status' and e.enumlabel = v)
  from unnest(array['qa_done','live']) as v
  union all
  -- creative-billings.sql
  select 'creative-billings.sql', 'table creative_billings', exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'creative_billings')
  union all
  -- publishers-per-client.sql
  select 'publishers-per-client.sql', 'publishers.client_id NOT NULL',
         exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'publishers' and column_name = 'client_id' and is_nullable = 'NO')
  union all
  select 'publishers-per-client.sql', 'client_publishers borrada', not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'client_publishers')
  union all
  -- billing-fees-no-cascade.sql · PARTE 1 (FK sin cascade)
  select 'billing-fees-no-cascade.sql (parte 1)', 'FK plan_billing_fees.media_plan_fee_id sin cascade',
         exists (select 1 from pg_constraint where conname = 'plan_billing_fees_media_plan_fee_id_media_plan_fees_id_fk' and confdeltype = 'a')
  union all
  -- rls.sql · RLS habilitado en las tablas que existen
  select 'rls.sql', 'RLS en ' || t.tablename, t.rowsecurity
  from pg_tables t
  where t.schemaname = 'public'
    and t.tablename in ('markets','metrics_catalog','publishers','clients','budget_origins','projects','media_plans',
                        'media_plan_publishers','media_plan_placements','media_plan_fees','media_plan_aux_sheets',
                        'media_plan_snapshots','media_plan_qa_runs','media_plan_qa_checks','media_plan_planning_qa_runs',
                        'media_plan_planning_qa_checks','plan_billings','plan_billing_publishers','plan_billing_fees',
                        'project_reports','manual_reports','creative_billings')
  union all
  -- timeouts a nivel rol (README → "Prevención")
  select 'ALTER ROLE postgres (timeouts)', s,
         exists (select 1 from pg_roles r where r.rolname = 'postgres' and exists (select 1 from unnest(r.rolconfig) c where c like s || '=%'))
  from unnest(array['statement_timeout','idle_in_transaction_session_timeout']) as s
  union all
  -- drop-plan-traffic.sql (DESTRUCTIVA: sólo informa, no se entrega)
  select 'drop-plan-traffic.sql (destructiva, sólo info)', 'tabla ' || t || ' borrada', not exists (select 1 from pg_tables where schemaname = 'public' and tablename = t)
  from unnest(array['media_plan_traffic_ads','media_plan_traffic_adsets','media_plan_traffic_briefs','ad_types']) as t
)
select migracion, objeto, aplicada
from objetos
order by migracion, objeto;
