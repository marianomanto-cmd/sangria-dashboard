-- ═══════════════════════════════════════════════════════════════════════════
-- Copa Airlines · alta del proyecto "Tarifas Viaja Panama V2" (budget Online)
-- + el media plan COPA.m1213.TarifasViajaPanamaV2 adentro.
--
-- Fuente: COPA.m1213.TarifasViajaPanamaV2-V1.xlsx (export del plan homónimo
-- que hoy vive en el proyecto `tarifas-viaja-panama-2026`, budget origin PR).
--
-- Todo se resuelve por nombre/slug contra los catálogos per-cliente de Copa
-- (budget_origins, markets, publishers): no hay UUIDs hardcodeados. Si falta
-- alguna pieza, el bloque aborta con un mensaje explícito y no deja nada a
-- medias.
--
-- Idempotente: si el proyecto `tarifas-viaja-panama-v2` ya existe, corta. Todo
-- va en UNA transacción: o entra el proyecto completo (plan + publishers +
-- placements + fees + tab auxiliar) o no entra nada.
--
-- ⚠️ OJO CON UNA FECHA (viene así del Excel, se replica tal cual):
--   El placement de Meta tiene inicio Y fin el 31/07/2026 — un solo día —
--   mientras que el de Google corre 31/07 → 31/12. Por eso el "Budget por
--   mercado" carga los 20.000 de Meta enteros en julio (julio = 20.194,81).
--   Si era un error de carga en el plan original, ver "OPCIONALES" al final.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $do$
DECLARE
  v_client     uuid;
  v_origin     uuid;
  v_market     uuid;
  v_pub_google uuid;
  v_pub_meta   uuid;
  v_project    uuid;
  v_plan       uuid;
  v_mpp_google uuid;
  v_mpp_meta   uuid;
BEGIN
  -- ─── 1. Catálogos del cliente ────────────────────────────────────────────
  SELECT id INTO v_client FROM clients WHERE slug = 'copa';
  IF v_client IS NULL THEN
    RAISE EXCEPTION 'No existe el cliente con slug "copa".';
  END IF;

  SELECT id INTO v_origin
    FROM budget_origins
   WHERE client_id = v_client AND name = 'Online'
   LIMIT 1;
  IF v_origin IS NULL THEN
    RAISE EXCEPTION 'Copa no tiene budget origin "Online". Creálo primero en /configuracion/clientes/copa.';
  END IF;

  SELECT id INTO v_market
    FROM markets
   WHERE client_id = v_client AND (slug = 'panama' OR name = 'Panama')
   ORDER BY (slug = 'panama') DESC
   LIMIT 1;
  IF v_market IS NULL THEN
    RAISE EXCEPTION 'Copa no tiene el mercado "Panama" en su catálogo.';
  END IF;

  SELECT id INTO v_pub_google
    FROM publishers
   WHERE client_id = v_client AND (slug = 'google' OR name = 'Google')
   ORDER BY (slug = 'google') DESC
   LIMIT 1;
  IF v_pub_google IS NULL THEN
    RAISE EXCEPTION 'Copa no tiene el publisher "Google" en su catálogo.';
  END IF;

  SELECT id INTO v_pub_meta
    FROM publishers
   WHERE client_id = v_client AND (slug = 'meta' OR name = 'Meta')
   ORDER BY (slug = 'meta') DESC
   LIMIT 1;
  IF v_pub_meta IS NULL THEN
    RAISE EXCEPTION 'Copa no tiene el publisher "Meta" en su catálogo.';
  END IF;

  IF EXISTS (SELECT 1 FROM projects WHERE code = 'tarifas-viaja-panama-v2') THEN
    RAISE EXCEPTION 'El proyecto "tarifas-viaja-panama-v2" ya existe. Nada que hacer.';
  END IF;

  -- ─── 2. Proyecto ─────────────────────────────────────────────────────────
  -- `code` = slugify(name), igual que uniqueProjectCode() en
  -- app/actions/projects.ts. Budget = grand total del plan (media + fees),
  -- que es contra lo que el editor calcula la cobertura.
  INSERT INTO projects (
    client_id, budget_origin_id, code, name, status,
    start_date, total_gross_budget_usd
  ) VALUES (
    v_client, v_origin,
    'tarifas-viaja-panama-v2',
    'Tarifas Viaja Panama V2',
    'active',
    DATE '2026-07-31',
    60471.26
  )
  RETURNING id INTO v_project;

  -- ─── 3. Media plan ───────────────────────────────────────────────────────
  -- Nace en `draft` / version 0: editable en la UI y sin snapshot fantasma.
  -- (Aprobarlo desde /proyectos/.../planes para que se cree el snapshot v1.)
  INSERT INTO media_plans (project_id, name, status, current_version)
  VALUES (v_project, 'COPA.m1213.TarifasViajaPanamaV2', 'draft', 0)
  RETURNING id INTO v_plan;

  -- ─── 4. Bloques de publisher ─────────────────────────────────────────────
  INSERT INTO media_plan_publishers (media_plan_id, publisher_id, total_planned_usd, sort_order)
  VALUES (v_plan, v_pub_google, 30000.00, 0)
  RETURNING id INTO v_mpp_google;

  INSERT INTO media_plan_publishers (media_plan_id, publisher_id, total_planned_usd, sort_order)
  VALUES (v_plan, v_pub_meta, 20000.00, 1)
  RETURNING id INTO v_mpp_meta;

  -- ─── 5. Placements ───────────────────────────────────────────────────────
  -- metrics_json guarda solo las métricas direct + las tarifas declaradas del
  -- dCPC/dCPM (cpc, cpm). CTR se deriva en runtime con la fórmula del catálogo.
  INSERT INTO media_plan_placements (
    media_plan_publisher_id, placement_name, market_id, audience,
    amount_usd, cost_method, start_date, end_date, metrics_json, sort_order
  ) VALUES (
    v_mpp_google,
    'DemandGen|TarifasPanama|Consideration',
    v_market,
    $aud$Ad Set 1: Open Target (non-travelers)
Users in Panama
Exclusion to minimize overlap: 
- Site Visitors (pixel based - 120 days)
- Convertors  (pixel based - 120 days)

Ad Set 2: Travelers                                                                                                                                                                                                  Affinity Audiences: interest in traveling to LATAM and similar destinations from Panama
In-market Audiences: travel intent to LATAM and similar destinations from Panama (Prospecting + Retargeting non-convertors last 30 days)                                                                                                                                                                                                                                                                                                                                                (1%) LAL off convertors PA 
(1%) LAL off site visitors PA                                                                                                                                        URL$aud$,
    30000.00, 'dCPC', DATE '2026-07-31', DATE '2026-12-31',
    '{"impressions": 75000000, "clicks": 2419355, "cpc": 0.0124, "cpm": 0.4}'::jsonb,
    0
  );

  INSERT INTO media_plan_placements (
    media_plan_publisher_id, placement_name, market_id, audience,
    amount_usd, cost_method, start_date, end_date, metrics_json, sort_order
  ) VALUES (
    v_mpp_meta,
    'Meta|TarifasPanama|Consideration',
    v_market,
    $aud$Ad Set 1: Open Target (non-travelers)
Users in Panama
Exclusion to minimize overlap: 
- Site Visitors (pixel based - 120 days)
- Convertors  (pixel based - 120 days)

Ad Set 2: Travelers                                                                                                                                                                                                  Affinity Audiences: interest in traveling to LATAM and similar destinations from Panama
In-market Audiences: travel intent to LATAM and similar destinations from Panama (Prospecting + Retargeting non-convertors last 30 days)                                                                                                                                                                                                                                                                                                                                                (1%) LAL off convertors PA 
(1%) LAL off site visitors PA                                                                                                                                       $aud$,
    20000.00, 'dCPC', DATE '2026-07-31', DATE '2026-07-31',
    '{"impressions": 28571429, "clicks": 442478, "cpc": 0.0452, "cpm": 0.7}'::jsonb,
    0
  );

  -- ─── 6. Fees ─────────────────────────────────────────────────────────────
  -- Management: 13% sobre gross → 50.000 × 13/(100−13) = 7.471,26.
  INSERT INTO media_plan_fees (media_plan_id, fee_type, name, rate_pct, amount_usd, sort_order)
  VALUES
    (v_plan, 'management', 'Management Fee', 13.00, 7471.26, 0),
    (v_plan, 'setup',      'Set Up Fee',     NULL,   500.00, 1),
    (v_plan, 'reporting',  'Reporting Fee',  NULL,  2500.00, 2);

  -- ─── 7. Tab auxiliar "Auxiliar" (COMBINED PROJECTIONS) ───────────────────
  INSERT INTO media_plan_aux_sheets (media_plan_id, name, grid_json, merges_json, sort_order)
  VALUES (
    v_plan, 'Auxiliar',
    $grid$[["COMBINED PROJECTIONS", "", "", "", "", "", "", "", ""], ["PUBLISHER / PLACEMENT", "MERCADO", "INICIO", "FIN", "MÉTODO", "INVERSIÓN", "IMPRESSIONS", "CLICKS", "CTR"], ["DemandGen|TarifasPanama|Consideration", "Panama", "2 de mar de 2026", "31 de dic de 2026", "dCPC", "81000", "178581641", "5532888", "3.09%"], ["Meta|TarifasPanama|Consideration", "Panama", "2 de mar de 2026", "31 de dic de 2026", "dCPC", "54260", "90367966", "1091342", "1.20%"], ["TOTAL MEDIA", "", "", "", "", "135260", "269153070", "6623230", "2.46%"]]$grid$::jsonb,
    '[]'::jsonb,
    0
  );

  RAISE NOTICE 'OK — proyecto % / plan %', v_project, v_plan;
END
$do$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  p.code,
  p.name                                   AS proyecto,
  bo.name                                  AS budget_origin,
  mp.name                                  AS plan,
  mp.status,
  SUM(pl.amount_usd)                       AS total_media,
  (SELECT SUM(amount_usd) FROM media_plan_fees WHERE media_plan_id = mp.id) AS total_fees,
  SUM(pl.amount_usd)
    + (SELECT SUM(amount_usd) FROM media_plan_fees WHERE media_plan_id = mp.id) AS grand_total,
  p.total_gross_budget_usd                 AS budget_proyecto,
  MIN(pl.start_date)                       AS periodo_desde,
  MAX(pl.end_date)                         AS periodo_hasta,
  COUNT(*)                                 AS placements
FROM projects p
JOIN budget_origins bo            ON bo.id = p.budget_origin_id
JOIN media_plans mp               ON mp.project_id = p.id AND mp.deleted_at IS NULL
JOIN media_plan_publishers mpp    ON mpp.media_plan_id = mp.id
JOIN media_plan_placements pl     ON pl.media_plan_publisher_id = mpp.id
WHERE p.code = 'tarifas-viaja-panama-v2'
GROUP BY p.code, p.name, bo.name, mp.id, mp.name, mp.status, p.total_gross_budget_usd;

-- ═══════════════════════════════════════════════════════════════════════════
-- OPCIONALES (correr solo si aplica)
-- ═══════════════════════════════════════════════════════════════════════════

-- (a) El plan queda en `draft` (editable). Para dejarlo como estaba el
--     original, en "listo para enviar":
--
--   UPDATE media_plans SET status = 'ready_to_send'
--    WHERE name = 'COPA.m1213.TarifasViajaPanamaV2'
--      AND project_id = (SELECT id FROM projects WHERE code = 'tarifas-viaja-panama-v2');
--
--     Para APROBARLO no uses SQL: hacelo desde la UI del plan, así se crea el
--     snapshot inmutable (media_plan_snapshots) y el audit_log de la versión.

-- (b) Si el placement de Meta tenía que correr hasta fin de año como el de
--     Google (ver el aviso del encabezado):
--
--   UPDATE media_plan_placements SET end_date = DATE '2026-12-31'
--    WHERE placement_name = 'Meta|TarifasPanama|Consideration'
--      AND media_plan_publisher_id IN (
--        SELECT mpp.id FROM media_plan_publishers mpp
--          JOIN media_plans mp ON mp.id = mpp.media_plan_id
--          JOIN projects p     ON p.id = mp.project_id
--         WHERE p.code = 'tarifas-viaja-panama-v2'
--      );

-- (c) Este script COPIA el MP: el plan original sigue vivo en el proyecto
--     `tarifas-viaja-panama-2026` (budget origin PR). Si en vez de copiarlo
--     querés MOVERLO al proyecto nuevo, no corras el bloque de arriba —
--     alcanza con reapuntar el plan y borrar después el proyecto viejo si
--     queda vacío:
--
--   UPDATE media_plans
--      SET project_id = (SELECT id FROM projects WHERE code = 'tarifas-viaja-panama-v2')
--    WHERE name = 'COPA.m1213.TarifasViajaPanamaV2';
--
--     ⚠️ Mover el plan se lleva TAMBIÉN su billing (plan_billings cuelga del
--     plan, no del proyecto). Si el plan ya facturó meses bajo PR, moverlo
--     reimputa esa facturación al budget origin Online. Copiar es lo seguro.
