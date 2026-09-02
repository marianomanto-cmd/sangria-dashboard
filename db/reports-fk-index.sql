-- ════════════════════════════════════════════════════════════════════════════
-- Índice faltante en la FK de project_reports.
--
-- db/fk-indexes.sql (02/sep/2026) cubrió 12 foreign keys pero se salteó
-- project_reports.project_id. Es la FK que usan las DOS queries del calendario
-- de reportes (getReportingCalendar y getSentReports) para joinear contra
-- projects. Postgres NO crea índices de FK solos.
--
-- Idempotente: se puede correr las veces que haga falta.
-- No bloquea escrituras de forma apreciable (la tabla es chica).
-- ════════════════════════════════════════════════════════════════════════════

create index if not exists idx_project_reports_project
  on project_reports (project_id);
