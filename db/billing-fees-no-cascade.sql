-- ════════════════════════════════════════════════════════════════════════════
-- Migración one-time: lo facturado deja de borrarse cuando cambia el plan
-- ════════════════════════════════════════════════════════════════════════════
--
-- CONTEXTO (el bug que la motiva):
--   `plan_billing_fees.media_plan_fee_id` tenía FK ON DELETE **CASCADE** hacia
--   `media_plan_fees`. Como "Descartar borrador" (revertPlanToApprovedSnapshot)
--   borraba y reinsertaba TODOS los fees del plan, cada revert se llevaba en
--   silencio la imputación de fees de TODOS los meses del plan — incluidos los
--   ya facturados. La pantalla de billing entonces mostraba "Imputado antes"
--   en 0 y la analista volvía a cargar fees ya cobrados (riesgo de facturar dos
--   veces el mismo Set Up / Reporting).
--
--   Caso real detectado: plan COPA.m1172.TarifasViajaPanama
--   (0ae7d4a1-0991-44b7-956f-11c1694e45c6). Los billings 2026-03 a 2026-07
--   conservaron `total_fee_usd` pero se quedaron SIN ninguna fila en
--   plan_billing_fees.
--
-- QUÉ HACE:
--   PARTE 1 — cambia la FK a NO ACTION (nunca más un borrado en cascada).
--   PARTE 2 — reconstruye las imputaciones borradas de ese plan.
--
-- CÓMO APLICAR:
--   Pegá este archivo en el SQL Editor de Supabase y ejecutalo. Está todo en
--   una transacción: o entra todo o no entra nada. Al final hay un bloque de
--   VERIFICACIÓN.
--
--   La PARTE 1 va junto con el deploy del código nuevo (el código nuevo asume
--   `no action`: limpia a mano las filas en 0 antes de borrar un fee).
--   La PARTE 2 es data-fix puntual de un plan: se puede correr sola.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ── PARTE 1 · FK sin cascade ────────────────────────────────────────────────
-- `no action` y no `restrict` a propósito: el chequeo queda diferido al final
-- de la sentencia, así el hard delete de un plan sigue andando (plan_billings
-- cascadea a plan_billing_fees antes de que se evalúe esta FK).
alter table plan_billing_fees
  drop constraint if exists plan_billing_fees_media_plan_fee_id_media_plan_fees_id_fk;

alter table plan_billing_fees
  add constraint plan_billing_fees_media_plan_fee_id_media_plan_fees_id_fk
  foreign key (media_plan_fee_id) references media_plan_fees(id);

-- ── PARTE 2 · Reconstrucción de las imputaciones borradas del m1172 ─────────
-- Los montos salen de `plan_billings.total_fee_usd` (que sobrevivió) abierto en
-- management (13% prorrateado por consumo del mes) + set up + reporting. Cierra
-- al centavo contra el total guardado de cada mes:
--
--   mes       mgmt 13%   set up   reporting   total_fee_usd guardado
--   2026-03   1843.56    500.00      500.00   2843.56
--   2026-04   2660.31      0.00      500.00   3160.31
--   2026-05   2762.35      0.00      500.00   3262.35
--   2026-06   2635.17      0.00        0.00   2635.17
--   2026-07   2809.76      0.00        0.00   2809.76  ← ver nota
--
-- NOTA sobre 2026-07 (único mes en draft): tenía guardado 4809.76 porque, al
-- ver "Imputado antes" en 0, se recargaron Set Up (500) y Reporting (1500) que
-- YA se habían imputado por completo entre marzo y mayo. Se restaura solo el
-- management fee y se corrige el total del mes (-2000).
insert into plan_billing_fees (plan_billing_id, media_plan_fee_id, amount_imputed_usd)
select b.id, f.id, v.amount
from (values
  ('2026-03', 'management', 1843.56),
  ('2026-03', 'setup',       500.00),
  ('2026-03', 'reporting',   500.00),
  ('2026-04', 'management', 2660.31),
  ('2026-04', 'reporting',   500.00),
  ('2026-05', 'management', 2762.35),
  ('2026-05', 'reporting',   500.00),
  ('2026-06', 'management', 2635.17),
  ('2026-07', 'management', 2809.76)
) as v(month, fee_type, amount)
join plan_billings b
  on b.media_plan_id = '0ae7d4a1-0991-44b7-956f-11c1694e45c6'
 and b.month = v.month
-- Un solo fee por tipo en este plan (management / setup / reporting). El
-- lateral con limit 1 evita duplicar la línea si algún día hubiera dos.
join lateral (
  select f.id
  from media_plan_fees f
  where f.media_plan_id = '0ae7d4a1-0991-44b7-956f-11c1694e45c6'
    and f.fee_type::text = v.fee_type
  order by f.sort_order
  limit 1
) f on true
on conflict (plan_billing_id, media_plan_fee_id) do update
  set amount_imputed_usd = excluded.amount_imputed_usd;

-- Recalcular los totales de esos meses desde sus líneas (misma fórmula que
-- recalcBillingTotals en app/actions/plan-billing.ts: media facturable + fees).
update plan_billings b
set total_net_usd = t.net,
    total_fee_usd = t.fee,
    total_usd     = t.net + t.fee
from (
  select b.id,
         coalesce((select sum(p.amount_real_usd)
                   from plan_billing_publishers p
                   where p.plan_billing_id = b.id and p.is_billable), 0) as net,
         coalesce((select sum(x.amount_imputed_usd)
                   from plan_billing_fees x
                   where x.plan_billing_id = b.id), 0) as fee
  from plan_billings b
  where b.media_plan_id = '0ae7d4a1-0991-44b7-956f-11c1694e45c6'
) t
where b.id = t.id;

commit;

-- ── VERIFICACIÓN (correr después del commit) ────────────────────────────────
-- 1) La FK ya no cascadea: confirm_delete_rule debe decir 'a' (NO ACTION).
--    ('c' = cascade, 'r' = restrict)
select conname, confdeltype as confirm_delete_rule
from pg_constraint
where conrelid = 'plan_billing_fees'::regclass
  and confrelid = 'media_plan_fees'::regclass;

-- 2) El plan quedó con sus imputaciones y los totales cierran.
--    Esperado: 2026-03 2843.56 · 2026-04 3160.31 · 2026-05 3262.35
--              2026-06 2635.17 · 2026-07 2809.76 (era 4809.76)
select b.month,
       b.status,
       b.total_fee_usd,
       sum(pbf.amount_imputed_usd) as suma_lineas,
       count(*)                    as lineas
from plan_billings b
join plan_billing_fees pbf on pbf.plan_billing_id = b.id
where b.media_plan_id = '0ae7d4a1-0991-44b7-956f-11c1694e45c6'
group by b.month, b.status, b.total_fee_usd
order by b.month;

-- 3) Ningún fee quedó sobre-imputado (la suma no puede pasar el total del fee).
--    Management es por % (13% sobre media total 85.260 → 12.740).
select f.name,
       f.fee_type,
       case when f.rate_pct is not null
            then round((select coalesce(sum(mpp.total_planned_usd), 0)
                        from media_plan_publishers mpp
                        where mpp.media_plan_id = f.media_plan_id)
                       * f.rate_pct / (100 - f.rate_pct), 2)
            else f.amount_usd end as total_fee,
       sum(pbf.amount_imputed_usd) as imputado
from media_plan_fees f
left join plan_billing_fees pbf on pbf.media_plan_fee_id = f.id
where f.media_plan_id = '0ae7d4a1-0991-44b7-956f-11c1694e45c6'
group by f.id, f.name, f.fee_type, f.rate_pct, f.amount_usd, f.media_plan_id;

-- 4) Barrido global: ¿algún otro plan quedó con meses que tienen fee cobrado
--    pero sin líneas? (mismo daño en otros planes, si lo hubo)
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
