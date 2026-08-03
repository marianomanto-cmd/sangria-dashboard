-- ════════════════════════════════════════════════════════════════════════════
-- Reparación de datos: imputaciones de fees borradas por la cascada (2 planes)
-- ════════════════════════════════════════════════════════════════════════════
--
-- CONTEXTO:
--   Segunda tanda del mismo daño que arregló `db/billing-fees-no-cascade.sql`
--   (FK ON DELETE CASCADE + "Descartar borrador" borrando y recreando los fees
--   del plan). El barrido global de ese archivo encontró estos dos planes:
--
--     COPA.m1164.BoostingIGGlobal   → 2026-02, 03, 04, 05  (todos invoiced)
--     COPA.m1190.BoostingImposible  → 2026-05, 06          (ambos invoiced)
--
--   Los meses conservaron `total_fee_usd` pero se quedaron sin líneas.
--
-- DE DÓNDE SALEN LOS MONTOS (no son estimados):
--   · Set Up / Reporting → del **audit_log**. `setFeeImputation` audita cada
--     escritura (`entity_type = 'plan_billing_fee'`, monto en el after_json),
--     así que el valor exacto que cargó la analista está registrado.
--   · Management fee → por **diferencia** contra el `total_fee_usd` que
--     sobrevivió (el autoprorrateo no deja audit). Verificado además contra la
--     fórmula `(consumo del mes / media total) × total del fee`: los 6 meses
--     dan exacto al centavo por los dos caminos.
--
--     plan    mes       mgmt      set up   reporting   total_fee_usd
--     m1164   2026-02   2103.60   500.00      500.00   3103.60
--     m1164   2026-03   2760.59        —           —   2760.59
--     m1164   2026-04   3164.73        —     1000.00   4164.73
--     m1164   2026-05   2220.77        —      500.00   2720.77
--     m1190   2026-05    311.66   500.00      500.00   1311.66
--     m1190   2026-06   3216.91   500.00      500.00   4216.91
--
-- ⚠️ CRITERIO: son meses YA FACTURADOS (todos con número de factura), así que
--   se restaura EXACTAMENTE lo que se facturó — no se "corrige" nada. Eso
--   incluye el mes 2026-06 de m1190, donde Set Up y Reporting se cargaron de
--   nuevo (la pantalla mostraba "Imputado antes" en 0 por este mismo bug)
--   aunque ya estaban 100% imputados en 2026-05: **el plan queda con 1000
--   imputado sobre un total de 500 en cada uno de esos dos fees, y así se
--   facturó en la factura 1430 — hay $1.000 cobrados de más que resolver
--   comercialmente** (nota de crédito o descuento en un mes futuro). La app lo
--   va a mostrar como "Restante" en negativo, que es la señal correcta.
--   Es distinto del caso de m1172 2026-07, que estaba en draft (todavía no
--   facturado) y por eso ahí sí se dejó afuera el duplicado.
--
-- CÓMO APLICAR:
--   Pegar en el SQL Editor de Supabase. Requiere que `billing-fees-no-cascade.sql`
--   ya esté corrido (la FK sin cascade). Idempotente: se puede correr dos veces.
-- ════════════════════════════════════════════════════════════════════════════

begin;

insert into plan_billing_fees (plan_billing_id, media_plan_fee_id, amount_imputed_usd)
select b.id, f.id, v.amount
from (values
  -- COPA.m1164.BoostingIGGlobal
  ('1d4d3c09-cc7b-4a4b-a772-93868921a0e5'::uuid, 'management', 2103.60),  -- 2026-02
  ('1d4d3c09-cc7b-4a4b-a772-93868921a0e5'::uuid, 'setup',       500.00),
  ('1d4d3c09-cc7b-4a4b-a772-93868921a0e5'::uuid, 'reporting',   500.00),
  ('4230aa1c-dcb2-4d90-9171-5c2b7914f837'::uuid, 'management', 2760.59),  -- 2026-03
  ('1660c858-5aa6-43f7-9f6f-379635d12eae'::uuid, 'management', 3164.73),  -- 2026-04
  ('1660c858-5aa6-43f7-9f6f-379635d12eae'::uuid, 'reporting',  1000.00),
  ('b9a414fe-7266-4e56-8d86-104b67566345'::uuid, 'management', 2220.77),  -- 2026-05
  ('b9a414fe-7266-4e56-8d86-104b67566345'::uuid, 'reporting',   500.00),
  -- COPA.m1190.BoostingImposible
  ('53f737d8-0c0d-4be1-a180-e0e9420108b8'::uuid, 'management',  311.66),  -- 2026-05
  ('53f737d8-0c0d-4be1-a180-e0e9420108b8'::uuid, 'setup',       500.00),
  ('53f737d8-0c0d-4be1-a180-e0e9420108b8'::uuid, 'reporting',   500.00),
  ('7c6391e2-32ab-4ec2-a9f0-d149c3a09ff9'::uuid, 'management', 3216.91),  -- 2026-06
  ('7c6391e2-32ab-4ec2-a9f0-d149c3a09ff9'::uuid, 'setup',       500.00),
  ('7c6391e2-32ab-4ec2-a9f0-d149c3a09ff9'::uuid, 'reporting',   500.00)
) as v(billing_id, fee_type, amount)
join plan_billings b on b.id = v.billing_id
-- El fee se resuelve por (plan del billing, tipo), no por id hardcodeado.
join lateral (
  select f.id
  from media_plan_fees f
  where f.media_plan_id = b.media_plan_id
    and f.fee_type::text = v.fee_type
  order by f.sort_order
  limit 1
) f on true
on conflict (plan_billing_id, media_plan_fee_id) do update
  set amount_imputed_usd = excluded.amount_imputed_usd;

commit;

-- ── VERIFICACIÓN ───────────────────────────────────────────────────────────
-- 1) Las líneas tienen que sumar EXACTO el total_fee_usd de cada mes
--    (diferencia = 0.00 en las 6 filas).
select mp.name as plan, b.month, b.status, b.invoice_number,
       b.total_fee_usd,
       sum(pbf.amount_imputed_usd)                     as suma_lineas,
       b.total_fee_usd - sum(pbf.amount_imputed_usd)   as diferencia
from plan_billings b
join media_plans mp on mp.id = b.media_plan_id
join plan_billing_fees pbf on pbf.plan_billing_id = b.id
where b.id in (
  '1d4d3c09-cc7b-4a4b-a772-93868921a0e5','4230aa1c-dcb2-4d90-9171-5c2b7914f837',
  '1660c858-5aa6-43f7-9f6f-379635d12eae','b9a414fe-7266-4e56-8d86-104b67566345',
  '53f737d8-0c0d-4be1-a180-e0e9420108b8','7c6391e2-32ab-4ec2-a9f0-d149c3a09ff9'
)
group by mp.name, b.month, b.status, b.invoice_number, b.total_fee_usd
order by mp.name, b.month;

-- 2) Fees sobre-imputados (lo imputado supera el total del fee). Esperado:
--    SOLO Set Up y Reporting de m1190, en 1000 sobre 500 → los $1.000 de más
--    ya facturados en la 1430. Cualquier otra fila acá hay que mirarla.
select mp.name as plan, f.name as fee, f.fee_type,
       case when f.rate_pct is not null
            then round((select coalesce(sum(mpp.total_planned_usd), 0)
                        from media_plan_publishers mpp
                        where mpp.media_plan_id = f.media_plan_id)
                       * f.rate_pct / (100 - f.rate_pct), 2)
            else f.amount_usd end        as total_fee,
       sum(pbf.amount_imputed_usd)       as imputado
from media_plan_fees f
join media_plans mp on mp.id = f.media_plan_id
join plan_billing_fees pbf on pbf.media_plan_fee_id = f.id
group by mp.name, f.id, f.name, f.fee_type, f.rate_pct, f.amount_usd, f.media_plan_id
having sum(pbf.amount_imputed_usd) > case when f.rate_pct is not null
            then round((select coalesce(sum(mpp.total_planned_usd), 0)
                        from media_plan_publishers mpp
                        where mpp.media_plan_id = f.media_plan_id)
                       * f.rate_pct / (100 - f.rate_pct), 2)
            else f.amount_usd end + 0.01
order by mp.name, f.sort_order;

-- 3) Barrido global de nuevo: no debería quedar NINGÚN mes con fee cobrado y
--    sin líneas.
select p.code as proyecto, mp.name as plan, b.month, b.status, b.total_fee_usd
from plan_billings b
join media_plans mp on mp.id = b.media_plan_id
join projects p on p.id = mp.project_id
where b.total_fee_usd <> 0
  and not exists (
    select 1 from plan_billing_fees pbf
    where pbf.plan_billing_id = b.id and pbf.amount_imputed_usd <> 0
  )
order by p.code, b.month;
