-- ════════════════════════════════════════════════════════════════════════════
-- Índices faltantes en foreign keys (02/sep/2026)
--
-- Postgres NO crea índices en las FK automáticamente. Sin ellos, cada
-- `where media_plan_id = $1` es un scan secuencial, y el `delete from
-- media_plan_publishers where media_plan_id = $1` del "volver a draft"
-- scanea la tabla entera MIENTRAS mantiene locks dentro de la transacción.
-- Cualquier lectura del mismo plan queda esperando -> 57014 statement timeout
-- -> conexiones tomadas -> el plan no se puede volver a abrir.
--
-- Idempotente: se puede correr las veces que haga falta.
-- ════════════════════════════════════════════════════════════════════════════

-- El del incidente: lo lee la página del plan y lo borra el revert a draft.
create index if not exists idx_mpp_plan on media_plan_publishers (media_plan_id);
create index if not exists idx_mpp_publisher on media_plan_publishers (publisher_id);

-- Listado de planes por proyecto (página de proyecto, dashboard, /planes).
create index if not exists idx_media_plans_project on media_plans (project_id);

-- Billing: se joinea por estas tres en todas las vistas de facturación.
create index if not exists idx_plan_billings_plan on plan_billings (media_plan_id);
create index if not exists idx_pbp_billing on plan_billing_publishers (plan_billing_id);
create index if not exists idx_pbf_billing on plan_billing_fees (plan_billing_id);
create index if not exists idx_pbf_fee on plan_billing_fees (media_plan_fee_id);

-- Fees del plan (los recorre el revert y el detalle del plan).
create index if not exists idx_mpf_plan on media_plan_fees (media_plan_id);

-- Proyectos por cliente / budget origin (filtro global de cliente).
create index if not exists idx_projects_client on projects (client_id);
create index if not exists idx_projects_origin on projects (budget_origin_id);

-- audit_log: getPlanAuditEvents filtra por mediaPlanId DENTRO del jsonb, lo que
-- no puede usar idx_audit_entity. Índices de expresión para esos dos accesos.
create index if not exists idx_audit_before_plan
  on audit_log ((before_json ->> 'mediaPlanId'));
create index if not exists idx_audit_after_plan
  on audit_log ((after_json ->> 'mediaPlanId'));
