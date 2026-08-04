-- ════════════════════════════════════════════════════════════════════════════
-- Copa · CORRECCIÓN: sacar Google de lo facturable y desinflar los totales
-- ════════════════════════════════════════════════════════════════════════════
--
-- CONTEXTO / DECISIÓN:
--   La auditoría (`db/copa-google-facturable-check.sql`) encontró media de
--   Google marcada como facturable en los billings de 2026-03, 04 y 05 de Copa,
--   inflando `plan_billings.total_net_usd` (y por lo tanto `total_usd`).
--   A Copa NO se le factura la media de Google: la paga directo.
--
--   **Las facturas emitidas y sus números están bien** — lo que se le cobró al
--   cliente es correcto. El error está en la DB, que quedó registrando como
--   facturable algo que nunca se facturó. Por eso acá SÍ se corrigen meses en
--   `invoiced`/`paid`: no se está reescribiendo lo facturado, se está haciendo
--   que la base coincida con lo que realmente se facturó. (Es la excepción a
--   "lo facturado ya está facturado" — la regla protege contra perder historia
--   real, no contra corregir data que nunca fue real.)
--
-- QUÉ TOCA:
--   1. `plan_billing_publishers.is_billable` → false en las líneas de Google
--      de esos meses.
--   2. `plan_billings.total_net_usd` y `total_usd` → recalculados con la misma
--      fórmula que `recalcBillingTotals` (app/actions/plan-billing.ts).
--   3. Una fila en `audit_log` por billing corregido, para que quede rastro
--      (el SQL crudo no pasa por `recordAudit`).
--
-- 🔒 VENTANA CERRADA: solo 2026-03, 2026-04 y 2026-05. **Junio y julio no se
--    tocan** — ni sus totales, ni sus líneas, ni nada que cambie cómo se ven.
--    Por eso el arreglo de la causa raíz (`publishers.agency_pays`) va
--    COMENTADO en el PASO 3: es lo único que se escaparía de la ventana.
--
-- QUÉ **NO** TOCA:
--   · `invoice_number`, `status`, `sent_at`, `paid_at` — las facturas no se
--     tocan.
--   · `total_fee_usd` ni `plan_billing_fees` — **el management fee sobre la
--     media de Google SÍ se cobra** y no se toca. Por la decisión de negocio
--     #182 el fee va sobre TODA la media gestionada, aunque el cliente le pague
--     al publisher directo.
--   · `amount_real_usd` — el consumo real de Google se sigue registrando tal
--     cual. Solo deja de ser facturable.
--
--   ✔️ POR QUÉ EL FEE NO SE CAE SOLO DESPUÉS DE ESTO: `autoRecomputeMgmtFees`
--      (app/actions/plan-billing.ts) calcula el prorrateo del mes sumando
--      `amount_real_usd` de TODAS las líneas del billing, **sin filtrar por
--      `is_billable`** — está explícito en el código y comentado ahí mismo. O
--      sea que destildar Google NO achica la base del fee, ni ahora ni cuando
--      alguien vuelva a tocar el mes desde la UI. La VERIFICACIÓN A de abajo lo
--      muestra en la columna `base_del_fee`.
--
-- ✅ ALCANCE CONFIRMADO (04/ago): no facturable = **familia Google completa**
--    (Google, Google DemandGen, YouTube, DV360, PMax, Search, GDN, Discovery,
--    Ad Manager). YouTube entra — quedó confirmado explícitamente, y de eso
--    dependía `COPA.m1177.VideoViews`. El patrón ILIKE de abajo ya está así:
--    **no hace falta editar nada**. Igual corré el PASO 0 primero y mirá la
--    columna `lineas_a_destildar` antes de seguir.
-- ════════════════════════════════════════════════════════════════════════════


-- ────────────────────────────────────────────────────────────────────────────
-- PASO 0 — PREVIEW (read-only). Correr SOLO esto primero y revisar.
-- ────────────────────────────────────────────────────────────────────────────
-- Muestra exactamente qué líneas se van a destildar y cómo queda cada mes.
-- Si esto no es lo que esperás, NO sigas: ajustá el patrón de publishers.
WITH ventana AS (
  SELECT unnest(ARRAY['2026-03', '2026-04', '2026-05']) AS month
),
objetivo AS (
  SELECT
    pbp.id                 AS pbp_id,
    pb.id                  AS billing_id,
    pb.month,
    prj.code               AS proyecto,
    mp.name                AS plan,
    pb.status::text        AS estado_mes,
    pb.invoice_number      AS factura,
    pub.name               AS publisher,
    pbp.amount_real_usd    AS monto,
    pb.total_net_usd,
    pb.total_fee_usd
  FROM plan_billings pb
  JOIN media_plans mp              ON mp.id  = pb.media_plan_id
  JOIN projects prj                ON prj.id = mp.project_id
  JOIN clients c                   ON c.id   = prj.client_id
  JOIN plan_billing_publishers pbp ON pbp.plan_billing_id = pb.id
  JOIN publishers pub              ON pub.id = pbp.publisher_id
  WHERE c.slug = 'copa'
    AND pb.month IN (SELECT month FROM ventana)
    AND pbp.is_billable
    -- ⇩⇩⇩ LA LISTA DE PUBLISHERS A DESTILDAR — editá acá y en los PASOS 1 y 3
    AND (pub.name ILIKE '%google%'    OR pub.slug ILIKE '%google%'
      OR pub.name ILIKE '%demand%gen%' OR pub.slug ILIKE '%demand%gen%'
      OR pub.name ILIKE '%youtube%'    OR pub.slug ILIKE '%youtube%'
      OR pub.name ILIKE '%dv360%'      OR pub.slug ILIKE '%dv360%'
      OR pub.name ILIKE '%display % video%'
      OR pub.name ILIKE '%p%max%'      OR pub.name ILIKE '%performance max%'
      OR pub.name ILIKE '%gdn%'        OR pub.name ILIKE '%discovery%'
      OR pub.name ILIKE '%ad manager%' OR pub.name ILIKE '%adx%')
)
SELECT
  month, proyecto, plan, estado_mes, factura,
  string_agg(publisher || ' (' || monto || ')', ' + ' ORDER BY publisher) AS lineas_a_destildar,
  total_net_usd                        AS media_antes,
  SUM(monto)                           AS se_descuenta,
  total_net_usd - SUM(monto)           AS media_despues,
  total_fee_usd                        AS fees_sin_cambio,
  total_net_usd + total_fee_usd        AS total_antes,
  total_net_usd - SUM(monto) + total_fee_usd AS total_despues
FROM objetivo
GROUP BY billing_id, month, proyecto, plan, estado_mes, factura, total_net_usd, total_fee_usd
ORDER BY month, proyecto;


-- ────────────────────────────────────────────────────────────────────────────
-- PASOS 1-4 — LA CORRECCIÓN. Todo en una transacción.
-- ────────────────────────────────────────────────────────────────────────────
BEGIN;

-- ─── PASO 1: destildar Google en los meses de la ventana ────────────────────
UPDATE plan_billing_publishers pbp
   SET is_billable = false
  FROM plan_billings pb
  JOIN media_plans mp ON mp.id  = pb.media_plan_id
  JOIN projects prj   ON prj.id = mp.project_id
  JOIN clients c      ON c.id   = prj.client_id,
       publishers pub
 WHERE pbp.plan_billing_id = pb.id
   AND pub.id = pbp.publisher_id
   AND c.slug = 'copa'
   AND pb.month IN ('2026-03', '2026-04', '2026-05')
   AND pbp.is_billable
   AND (pub.name ILIKE '%google%'    OR pub.slug ILIKE '%google%'
     OR pub.name ILIKE '%demand%gen%' OR pub.slug ILIKE '%demand%gen%'
     OR pub.name ILIKE '%youtube%'    OR pub.slug ILIKE '%youtube%'
     OR pub.name ILIKE '%dv360%'      OR pub.slug ILIKE '%dv360%'
     OR pub.name ILIKE '%display % video%'
     OR pub.name ILIKE '%p%max%'      OR pub.name ILIKE '%performance max%'
     OR pub.name ILIKE '%gdn%'        OR pub.name ILIKE '%discovery%'
     OR pub.name ILIKE '%ad manager%' OR pub.name ILIKE '%adx%');

-- ─── PASO 2: recalcular los totales de esos meses ───────────────────────────
-- Misma fórmula que `recalcBillingTotals`: net = suma de lo facturable,
-- total = net + fees (los fees no se tocan). Va como sentencia SEPARADA a
-- propósito: dentro de un mismo statement los CTE ven el snapshot viejo y el
-- recálculo saldría con los valores de ANTES del PASO 1.
-- Recalcula TODOS los meses de Copa de la ventana, no solo los tocados: es
-- idempotente y de paso corrige cualquier total que ya estuviera desfasado.
UPDATE plan_billings pb
   SET total_net_usd = s.net,
       total_usd     = s.net + pb.total_fee_usd
  FROM (
    SELECT plan_billing_id,
           COALESCE(SUM(amount_real_usd) FILTER (WHERE is_billable), 0) AS net
      FROM plan_billing_publishers
     GROUP BY plan_billing_id
  ) s
 WHERE s.plan_billing_id = pb.id
   AND pb.id IN (
     SELECT pb2.id
       FROM plan_billings pb2
       JOIN media_plans mp2 ON mp2.id  = pb2.media_plan_id
       JOIN projects prj2   ON prj2.id = mp2.project_id
       JOIN clients c2      ON c2.id   = prj2.client_id
      WHERE c2.slug = 'copa'
        AND pb2.month IN ('2026-03', '2026-04', '2026-05')
   );

-- ─── PASO 3: la causa raíz — DESACTIVADO a propósito ────────────────────────
-- ⛔ NO CORRER JUNTO CON LO DE ARRIBA. Va comentado porque es el ÚNICO cambio
--    que se escapa de marzo/abril/mayo: `publishers.agency_pays` lo lee el PDF
--    de finanzas EN VIVO, así que tocarlo cambiaría también cómo se renderizan
--    los PDFs de junio y julio (y de cualquier otro mes). Junio y julio no se
--    tocan.
--
--    El costo de dejarlo apagado: mientras Google siga como "agencia paga" en
--    el catálogo, cada mes NUEVO va a nacer con Google tildado como facturable
--    (`ensureBillingForMonth` copia `is_billable` de este flag). Cuando junio y
--    julio estén resueltos, conviene hacerlo desde
--    /configuracion/clientes/copa (o descomentar esto).
--
-- UPDATE publishers pub
--    SET agency_pays = false
--   FROM clients c
--  WHERE c.id = pub.client_id
--    AND c.slug = 'copa'
--    AND pub.agency_pays
--    AND (pub.name ILIKE '%google%'    OR pub.slug ILIKE '%google%'
--      OR pub.name ILIKE '%demand%gen%' OR pub.slug ILIKE '%demand%gen%'
--      OR pub.name ILIKE '%youtube%'    OR pub.slug ILIKE '%youtube%'
--      OR pub.name ILIKE '%dv360%'      OR pub.slug ILIKE '%dv360%'
--      OR pub.name ILIKE '%display % video%'
--      OR pub.name ILIKE '%p%max%'      OR pub.name ILIKE '%performance max%'
--      OR pub.name ILIKE '%gdn%'        OR pub.name ILIKE '%discovery%'
--      OR pub.name ILIKE '%ad manager%' OR pub.name ILIKE '%adx%');

-- ─── PASO 4: dejar rastro en el audit_log ───────────────────────────────────
-- El SQL crudo no pasa por `recordAudit()`, así que la corrección quedaría
-- invisible en /auditoria y en el historial del billing. Una fila por mes
-- corregido, con los totales nuevos en el after_json.
INSERT INTO audit_log (entity_type, entity_id, action, before_json, after_json, user_id, user_email)
SELECT
  'plan_billing',
  pb.id,
  'update',
  NULL,
  jsonb_build_object(
    'month',        pb.month,
    'totalNetUsd',  pb.total_net_usd,
    'totalFeeUsd',  pb.total_fee_usd,
    'totalUsd',     pb.total_usd,
    'nota',         'Corrección manual (db/copa-google-facturable-fix.sql): la media de Google se marcó no facturable y se recalcularon los totales. Copa no factura Google; las facturas emitidas y sus números NO se modificaron.'
  ),
  NULL,
  NULL
FROM plan_billings pb
JOIN media_plans mp ON mp.id  = pb.media_plan_id
JOIN projects prj   ON prj.id = mp.project_id
JOIN clients c      ON c.id   = prj.client_id
WHERE c.slug = 'copa'
  AND pb.month IN ('2026-03', '2026-04', '2026-05');

COMMIT;


-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN A — cómo quedaron los meses de la ventana
-- ────────────────────────────────────────────────────────────────────────────
SELECT
  pb.month,
  prj.code                AS proyecto,
  mp.name                 AS plan,
  pb.status::text         AS estado_mes,
  pb.invoice_number       AS factura,
  pb.total_net_usd        AS media,
  pb.total_fee_usd        AS fees,
  pb.total_usd            AS total,
  SUM(pbp.amount_real_usd) FILTER (WHERE pbp.is_billable)     AS suma_facturable,
  SUM(pbp.amount_real_usd) FILTER (WHERE NOT pbp.is_billable) AS suma_no_facturable,
  -- La base del management fee = TODO el consumo del mes, facturable o no.
  -- Tiene que ser IGUAL a la de antes de la corrección: el fee sobre la media
  -- de Google sí se cobra (decisión #182 + `autoRecomputeMgmtFees`).
  SUM(pbp.amount_real_usd)                                    AS base_del_fee,
  CASE WHEN pb.total_net_usd
          = COALESCE(SUM(pbp.amount_real_usd) FILTER (WHERE pbp.is_billable), 0)
       AND pb.total_usd = pb.total_net_usd + pb.total_fee_usd
       THEN '✅ cierra' ELSE '🚩 NO cierra' END                AS chequeo
FROM plan_billings pb
JOIN media_plans mp              ON mp.id  = pb.media_plan_id
JOIN projects prj                ON prj.id = mp.project_id
JOIN clients c                   ON c.id   = prj.client_id
LEFT JOIN plan_billing_publishers pbp ON pbp.plan_billing_id = pb.id
WHERE c.slug = 'copa'
  AND pb.month IN ('2026-03', '2026-04', '2026-05')
GROUP BY pb.id, pb.month, prj.code, mp.name, pb.status, pb.invoice_number,
         pb.total_net_usd, pb.total_fee_usd, pb.total_usd
ORDER BY pb.month, prj.code;


-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN B — ¿quedó Google facturable en ALGÚN otro mes?
-- ────────────────────────────────────────────────────────────────────────────
-- Barrido sin filtro de fecha. Si trae filas, hay meses fuera de la ventana con
-- el mismo problema: decidí si ampliar la corrección.
SELECT
  pb.month,
  prj.code            AS proyecto,
  mp.name             AS plan,
  pb.status::text     AS estado_mes,
  pb.invoice_number   AS factura,
  pub.name            AS publisher,
  pbp.amount_real_usd AS monto
FROM plan_billings pb
JOIN media_plans mp              ON mp.id  = pb.media_plan_id
JOIN projects prj                ON prj.id = mp.project_id
JOIN clients c                   ON c.id   = prj.client_id
JOIN plan_billing_publishers pbp ON pbp.plan_billing_id = pb.id
JOIN publishers pub              ON pub.id = pbp.publisher_id
WHERE c.slug = 'copa'
  AND pbp.is_billable
  AND pbp.amount_real_usd > 0
  AND (pub.name ILIKE '%google%'    OR pub.slug ILIKE '%google%'
    OR pub.name ILIKE '%demand%gen%' OR pub.slug ILIKE '%demand%gen%'
    OR pub.name ILIKE '%youtube%'    OR pub.slug ILIKE '%youtube%'
    OR pub.name ILIKE '%dv360%'      OR pub.slug ILIKE '%dv360%'
    OR pub.name ILIKE '%display % video%'
    OR pub.name ILIKE '%p%max%'      OR pub.name ILIKE '%performance max%'
    OR pub.name ILIKE '%gdn%'        OR pub.name ILIKE '%discovery%'
    OR pub.name ILIKE '%ad manager%' OR pub.name ILIKE '%adx%')
ORDER BY pb.month, prj.code, pub.name;
