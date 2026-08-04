-- ════════════════════════════════════════════════════════════════════════════
-- Copa · auditoría de billing: ¿se coló Google como FACTURABLE?
-- ════════════════════════════════════════════════════════════════════════════
--
-- Regla de negocio: a Copa NO se le factura la media de Google (Google, Google
-- DemandGen, YouTube, DV360, PMax, Search…). El cliente la paga directo. Su
-- consumo igual se carga en el billing —alimenta el cálculo del management
-- fee, que Copa sí paga— pero NO debe entrar en la media que se factura.
--
-- CÓMO SE DECIDE QUÉ SE FACTURA (dos flags distintos, y por eso hay dos
-- formas de que esto salga mal):
--
--   · `agency_pays` — la verdad ESTRUCTURAL. Sale del catálogo per-cliente
--     (`publishers.agency_pays`), y un bloque del plan lo puede pisar
--     (`media_plan_publishers.agency_pays_override`). Si el publisher tiene N
--     bloques, basta que UNO diga "agencia paga" para que valga true (misma
--     regla `anyAgencyPays` que usan el editor de billing y el PDF).
--   · `is_billable` — el flag EDITABLE del mes, en `plan_billing_publishers`.
--     Nace copiado de `agency_pays` (override ?? default del catálogo) cuando
--     se crea el mes, y después la analista lo puede tocar a mano.
--
--   → El PDF de finanzas incluye la línea si `agency_pays AND is_billable AND
--     monto > 0`  (app/api/billings/[id]/report.pdf/route.ts).
--   → PERO el total del mes (`plan_billings.total_net_usd`, el número que va a
--     la factura) se calcula con `sum(amount_real_usd) FILTER (is_billable)`
--     y NO mira `agency_pays` (`recalcBillingTotals` en
--     app/actions/plan-billing.ts).
--
--   Es decir: un Google con `is_billable = true` y `agency_pays = false`
--   **no sale en el PDF pero igual infla el total facturado** — la factura
--   queda por un monto que el PDF no explica. El bloque 2 separa los dos casos.
--
-- Es una auditoría READ-ONLY: no modifica nada. Los UPDATE de corrección
-- están comentados al final.
--
-- Meses auditados: 2026-03, 2026-04 y 2026-05. Para mirar otra ventana,
-- cambiá el ARRAY del CTE `ventana` (aparece una sola vez, en el bloque 2).
-- ════════════════════════════════════════════════════════════════════════════


-- ────────────────────────────────────────────────────────────────────────────
-- BLOQUE 1 — El catálogo de Copa: ¿cómo está configurada la regla?
-- ────────────────────────────────────────────────────────────────────────────
-- Esto es la causa raíz. Si acá Google figura como "AGENCIA PAGA (se factura)",
-- entonces CADA mes nuevo que se cree va a nacer con Google tildado como
-- facturable, y el problema se repite solo. Se arregla en
-- /configuracion/clientes/copa (o con el UPDATE (a) del final).
SELECT
  pub.name                                                   AS publisher,
  pub.slug,
  CASE WHEN pub.agency_pays THEN 'AGENCIA PAGA (se factura)'
       ELSE 'cliente paga directo (no se factura)' END       AS regla_actual,
  pub.enabled                                                AS habilitado,
  CASE
    WHEN pub.agency_pays AND (pub.name ILIKE '%google%' OR pub.slug ILIKE '%google%'
      OR pub.name ILIKE '%demand%gen%' OR pub.slug ILIKE '%demand%gen%'
      OR pub.name ILIKE '%youtube%'    OR pub.slug ILIKE '%youtube%'
      OR pub.name ILIKE '%dv360%'      OR pub.slug ILIKE '%dv360%'
      OR pub.name ILIKE '%display % video%'
      OR pub.name ILIKE '%p%max%'      OR pub.name ILIKE '%performance max%'
      OR pub.name ILIKE '%gdn%'        OR pub.name ILIKE '%discovery%'
      OR pub.name ILIKE '%ad manager%' OR pub.name ILIKE '%adx%')
      THEN '🚩 REVISAR — es Google y está marcado como facturable'
    ELSE ''
  END                                                        AS alerta
FROM publishers pub
JOIN clients c ON c.id = pub.client_id
WHERE c.slug = 'copa'
ORDER BY alerta DESC, pub.agency_pays DESC, pub.name;


-- ────────────────────────────────────────────────────────────────────────────
-- BLOQUE 2 — La revisión de marzo / abril / mayo, línea por línea
-- ────────────────────────────────────────────────────────────────────────────
-- Trae TODAS las líneas de publisher de esos meses (no solo las de Google) con
-- su veredicto, para que nada quede escondido. Ordena los problemas arriba.
WITH ventana AS (
  -- ⇩ la única lista de meses a editar
  SELECT unnest(ARRAY['2026-03', '2026-04', '2026-05']) AS month
),
-- agency_pays EFECTIVO por (plan, publisher): override del bloque ?? default
-- del catálogo, y si hay N bloques basta que uno diga "agencia paga".
efectivo AS (
  SELECT
    mpp.media_plan_id,
    mpp.publisher_id,
    bool_or(COALESCE(mpp.agency_pays_override, pub.agency_pays)) AS agency_pays
  FROM media_plan_publishers mpp
  JOIN publishers pub ON pub.id = mpp.publisher_id
  GROUP BY mpp.media_plan_id, mpp.publisher_id
),
lineas AS (
  SELECT
    pb.month,
    prj.code                                        AS proyecto,
    mp.name                                         AS plan,
    pb.status::text                                 AS estado_mes,
    pb.invoice_number                               AS factura,
    pub.name                                        AS publisher,
    COALESCE(ef.agency_pays, pub.agency_pays)       AS agency_pays,
    pbp.is_billable,
    pbp.amount_real_usd                             AS monto,
    pb.total_net_usd                                AS total_media_del_mes,
    pbp.notes,
    -- ¿Es familia Google? Ampliá/recortá la lista si hace falta.
    (pub.name ILIKE '%google%' OR pub.slug ILIKE '%google%'
     OR pub.name ILIKE '%demand%gen%' OR pub.slug ILIKE '%demand%gen%'
     OR pub.name ILIKE '%youtube%'    OR pub.slug ILIKE '%youtube%'
     OR pub.name ILIKE '%dv360%'      OR pub.slug ILIKE '%dv360%'
     OR pub.name ILIKE '%display % video%'
     OR pub.name ILIKE '%p%max%'      OR pub.name ILIKE '%performance max%'
     OR pub.name ILIKE '%gdn%'        OR pub.name ILIKE '%discovery%'
     OR pub.name ILIKE '%ad manager%' OR pub.name ILIKE '%adx%') AS es_google
  FROM plan_billings pb
  JOIN media_plans mp            ON mp.id  = pb.media_plan_id
  JOIN projects prj              ON prj.id = mp.project_id
  JOIN clients c                 ON c.id   = prj.client_id
  JOIN plan_billing_publishers pbp ON pbp.plan_billing_id = pb.id
  JOIN publishers pub            ON pub.id = pbp.publisher_id
  LEFT JOIN efectivo ef          ON ef.media_plan_id = mp.id
                                AND ef.publisher_id  = pbp.publisher_id
  WHERE c.slug = 'copa'
    AND pb.month IN (SELECT month FROM ventana)
)
SELECT
  month, proyecto, plan, estado_mes, factura, publisher,
  agency_pays, is_billable, monto, total_media_del_mes, notes,
  CASE
    WHEN es_google AND is_billable AND agency_pays AND monto > 0
      THEN '🚩 GRAVE — Google facturado: entra en el total DEL MES y sale como línea en el PDF de finanzas'
    WHEN es_google AND is_billable AND NOT agency_pays AND monto > 0
      THEN '🚩 GRAVE — Google infla el total del mes (is_billable) aunque NO sale en el PDF: la factura no cierra con el PDF'
    WHEN es_google AND is_billable AND monto = 0
      THEN '⚠️ Google tildado como facturable, pero con monto 0 — no afecta plata todavía, destildar igual'
    WHEN es_google
      THEN '✅ Google, correctamente NO facturable'
    WHEN is_billable <> agency_pays
      THEN '⚠️ Incoherencia: is_billable del mes ≠ regla del catálogo/plan (revisar si fue a propósito)'
    ELSE '·'
  END AS veredicto,
  -- Cuánto habría que sacarle al total del mes si esta línea no debía facturarse
  CASE WHEN es_google AND is_billable THEN monto ELSE 0 END AS a_descontar
FROM lineas
ORDER BY
  (es_google AND is_billable AND monto > 0) DESC,
  (is_billable <> agency_pays) DESC,
  month, publisher;


-- ────────────────────────────────────────────────────────────────────────────
-- BLOQUE 2b — Desglose por publisher: QUÉ publisher suma y POR QUÉ
-- ────────────────────────────────────────────────────────────────────────────
-- Este es el que decide qué hay que arreglar. Separa los dos modos de falla:
--
--   MODO 1 (`is_billable` + `agency_pays`)      → configuración: el publisher
--     figura como "agencia paga" en el catálogo (o en el override del bloque).
--     Suma al total Y sale como línea en el PDF. Se arregla en el catálogo.
--   MODO 2 (`is_billable` + NO `agency_pays`)   → bug de la app: el publisher
--     está bien configurado como "cliente paga directo", así que NO sale en el
--     PDF, pero `recalcBillingTotals` igual lo suma al `total_net_usd`. La
--     factura no cierra con el PDF y no hay forma de verlo desde la UI.
--
-- Ojo: MODO 1 es lo ESPERADO para Meta, TikTok y cualquier publisher que la
-- agencia sí factura. Solo es un problema cuando la fila es de Google.
WITH ventana AS (
  SELECT unnest(ARRAY['2026-03', '2026-04', '2026-05']) AS month
),
efectivo AS (
  SELECT mpp.media_plan_id, mpp.publisher_id,
         bool_or(COALESCE(mpp.agency_pays_override, pub.agency_pays)) AS agency_pays
  FROM media_plan_publishers mpp
  JOIN publishers pub ON pub.id = mpp.publisher_id
  GROUP BY mpp.media_plan_id, mpp.publisher_id
)
SELECT
  pb.month,
  prj.code                                   AS proyecto,
  mp.name                                    AS plan,
  pb.status::text                            AS estado_mes,
  pb.invoice_number                          AS factura,
  pub.name                                   AS publisher,
  COALESCE(ef.agency_pays, pub.agency_pays)  AS agency_pays,
  pbp.is_billable,
  pbp.amount_real_usd                        AS monto,
  CASE
    WHEN pbp.is_billable AND COALESCE(ef.agency_pays, pub.agency_pays)
      THEN 'MODO 1 — suma al total Y sale en el PDF (correcto salvo que sea Google)'
    WHEN pbp.is_billable AND NOT COALESCE(ef.agency_pays, pub.agency_pays)
      THEN '🚩 MODO 2 — NO sale en el PDF pero SUMA al total: la factura no cierra con el PDF'
    WHEN NOT pbp.is_billable AND COALESCE(ef.agency_pays, pub.agency_pays)
      THEN 'destildado a mano este mes (no suma, no sale)'
    ELSE 'OK — cliente paga directo: no suma ni sale'
  END                                        AS diagnostico
FROM plan_billings pb
JOIN media_plans mp              ON mp.id  = pb.media_plan_id
JOIN projects prj                ON prj.id = mp.project_id
JOIN clients c                   ON c.id   = prj.client_id
JOIN plan_billing_publishers pbp ON pbp.plan_billing_id = pb.id
JOIN publishers pub              ON pub.id = pbp.publisher_id
LEFT JOIN efectivo ef ON ef.media_plan_id = mp.id AND ef.publisher_id = pbp.publisher_id
WHERE c.slug = 'copa'
  AND pb.month IN (SELECT month FROM ventana)
  AND pbp.amount_real_usd > 0
ORDER BY pb.month, prj.code, pub.name;


-- ────────────────────────────────────────────────────────────────────────────
-- BLOQUE 3 — El resumen de plata: cuánto se facturó de más por mes
-- ────────────────────────────────────────────────────────────────────────────
-- `total_media_facturado` es el `total_net_usd` del mes tal como está hoy;
-- `total_media_corregido` es lo que debería decir sacando las líneas de Google
-- marcadas facturables. `estado_mes`/`factura` dicen si ya salió a la calle:
-- si el mes está en invoiced/paid, la corrección es comercial (nota de crédito
-- o descuento futuro), no solo de datos.
WITH ventana AS (
  SELECT unnest(ARRAY['2026-03', '2026-04', '2026-05']) AS month
),
lineas AS (
  SELECT
    pb.id AS billing_id, pb.month, prj.code AS proyecto, mp.name AS plan,
    pb.status::text AS estado_mes, pb.invoice_number AS factura,
    pb.total_net_usd, pb.total_fee_usd, pb.total_usd,
    pbp.is_billable, pbp.amount_real_usd AS monto,
    (pub.name ILIKE '%google%' OR pub.slug ILIKE '%google%'
     OR pub.name ILIKE '%demand%gen%' OR pub.slug ILIKE '%demand%gen%'
     OR pub.name ILIKE '%youtube%'    OR pub.slug ILIKE '%youtube%'
     OR pub.name ILIKE '%dv360%'      OR pub.slug ILIKE '%dv360%'
     OR pub.name ILIKE '%display % video%'
     OR pub.name ILIKE '%p%max%'      OR pub.name ILIKE '%performance max%'
     OR pub.name ILIKE '%gdn%'        OR pub.name ILIKE '%discovery%'
     OR pub.name ILIKE '%ad manager%' OR pub.name ILIKE '%adx%') AS es_google
  FROM plan_billings pb
  JOIN media_plans mp              ON mp.id  = pb.media_plan_id
  JOIN projects prj                ON prj.id = mp.project_id
  JOIN clients c                   ON c.id   = prj.client_id
  JOIN plan_billing_publishers pbp ON pbp.plan_billing_id = pb.id
  JOIN publishers pub              ON pub.id = pbp.publisher_id
  WHERE c.slug = 'copa'
    AND pb.month IN (SELECT month FROM ventana)
)
SELECT
  month, proyecto, plan, estado_mes, factura,
  total_net_usd                                              AS total_media_facturado,
  SUM(monto) FILTER (WHERE es_google AND is_billable)        AS google_facturado_de_mas,
  total_net_usd
    - COALESCE(SUM(monto) FILTER (WHERE es_google AND is_billable), 0) AS total_media_corregido,
  total_fee_usd                                              AS fees_del_mes,
  total_usd                                                  AS total_del_mes_hoy
FROM lineas
GROUP BY billing_id, month, proyecto, plan, estado_mes, factura,
         total_net_usd, total_fee_usd, total_usd
HAVING SUM(monto) FILTER (WHERE es_google AND is_billable) > 0
ORDER BY month;


-- ════════════════════════════════════════════════════════════════════════════
-- CORRECCIÓN (comentada — leer antes de correr)
-- ════════════════════════════════════════════════════════════════════════════
--
-- ⚠️ Si el mes está en `invoiced` o `paid`, la plata YA se facturó. Regla dura
--    del repo: lo facturado ya está facturado. Ahí NO toques la data para
--    "arreglar" el pasado — la corrección es comercial (nota de crédito o
--    descuento en un mes futuro). Destildar `is_billable` sí es correcto en
--    meses todavía en draft/ready/sent.
--
-- (a) Raíz — sacar Google del "agencia paga" en el catálogo de Copa, para que
--     los meses NUEVOS no nazcan mal (también se hace desde
--     /configuracion/clientes/copa):
--
--   UPDATE publishers pub
--      SET agency_pays = false
--     FROM clients c
--    WHERE c.id = pub.client_id AND c.slug = 'copa'
--      AND (pub.name ILIKE '%google%' OR pub.slug ILIKE '%google%'
--        OR pub.name ILIKE '%demand%gen%' OR pub.slug ILIKE '%demand%gen%');
--
-- (b) Destildar Google en los meses TODAVÍA NO FACTURADOS de la ventana:
--
--   UPDATE plan_billing_publishers pbp
--      SET is_billable = false
--     FROM plan_billings pb
--     JOIN media_plans mp  ON mp.id  = pb.media_plan_id
--     JOIN projects prj    ON prj.id = mp.project_id
--     JOIN clients c       ON c.id   = prj.client_id,
--          publishers pub
--    WHERE pbp.plan_billing_id = pb.id
--      AND pub.id = pbp.publisher_id
--      AND c.slug = 'copa'
--      AND pb.month IN ('2026-03', '2026-04', '2026-05')
--      AND pb.status IN ('draft', 'ready', 'sent')   -- ← nunca invoiced/paid
--      AND (pub.name ILIKE '%google%' OR pub.slug ILIKE '%google%'
--        OR pub.name ILIKE '%demand%gen%' OR pub.slug ILIKE '%demand%gen%')
--      AND pbp.is_billable;
--
-- (c) Después de (b) hay que RECALCULAR los totales de esos meses, con la
--     misma fórmula que `recalcBillingTotals`:
--
--   UPDATE plan_billings pb
--      SET total_net_usd = s.net,
--          total_usd     = s.net + pb.total_fee_usd
--     FROM (SELECT plan_billing_id,
--                  COALESCE(SUM(amount_real_usd) FILTER (WHERE is_billable), 0) AS net
--             FROM plan_billing_publishers GROUP BY plan_billing_id) s
--    WHERE s.plan_billing_id = pb.id
--      AND pb.month IN ('2026-03', '2026-04', '2026-05');
--
--     (Alternativa sin SQL: abrir el mes en la UI y tocar cualquier monto —
--     la action recalcula sola. Más seguro si son pocos meses.)
