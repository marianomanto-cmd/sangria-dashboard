-- ════════════════════════════════════════════════════════════════════════════
-- Corrección de datos: meses de Copa que ya se facturaron y se cobraron
-- ════════════════════════════════════════════════════════════════════════════
--
-- CONTEXTO:
--   El panel "Billing pendiente" del dashboard listaba 8 meses cerrados como
--   "sin facturar". El dueño confirmó que esos meses YA están facturados y
--   cobrados: nunca se cargaron en la app, nada más. Este script los lleva a
--   `status = 'paid'` para que dejen de figurar como pendientes.
--
--   El panel sale de `db/queries/dashboard-v2.ts` (query 5): un mes aparece
--   como pendiente cuando el plan está vivo y aprobado, el mes ya cerró, y
--   NO hay fila en `plan_billings` o la que hay está en 'draft'. O sea que
--   acá hay dos casos y por eso es un upsert y no un update:
--     · sin fila  → INSERT de la fila del mes, ya en 'paid'
--     · en draft  → UPDATE del status a 'paid'
--
-- MESES (proyecto · plan · mes), tal como los mostraba el panel:
--   chile-sale        COPA.m1223.ChileSale                      2026-08
--   boosting-cirium   COPA.m1157 BoostingCirium - CopaLove      2026-02
--   stopover-2025     COPA.m1024.StopoverPerformance.ASC        2026-02
--   boosting-cirium   COPA.m1157 BoostingCirium - CopaLove      2026-01
--   vuelo-inaugural   COPA.m1159 Vuelo Inaugural                2026-01
--   boosting-enero    COPA.m1156 Boosting Enero                 2026-01
--   demand-gen-...    COPA.m1099|DemandGen|TarifasPanama|...    2025-09
--
--   Son 7. El panel contaba 8: la octava quedó tapada entre las dos capturas.
--   Por eso el PASO 0 lista el set completo — si la que falta también va,
--   se agrega su par (código de proyecto, mes) a la lista del PASO 1.
--
-- ⚠️ LO QUE HAY QUE SABER ANTES DE CORRERLO — los montos quedan en CERO.
--   La app NO deriva la plata del mes de `plan_billings.total_*` a mano: los
--   recalcula `recalcBillingTotals()` (app/actions/plan-billing.ts) a partir
--   de `plan_billing_publishers` (consumo por publisher) y `plan_billing_fees`
--   (fees imputados). Los meses que ni siquiera tienen fila no tienen esas
--   sublíneas, así que van a quedar como meses **pagados de US$ 0**.
--
--   Este script calcula los totales desde las sublíneas que existan, con lo
--   cual un mes que estaba en 'draft' con el consumo ya cargado conserva su
--   monto real; los que no tienen nada cargado quedan en 0 y se van a ver
--   así en /billing, en el Billing Tracker, en el "facturado real" del
--   dashboard y en la estimación del portal del cliente.
--
--   Si esos meses tuvieron consumo real y ese número importa, hay que cargar
--   el consumo por publisher ANTES de marcarlos pagados (o después, desde la
--   pantalla del billing del plan: al guardar cada línea la app recalcula los
--   totales sola). Marcar pagado no es reversible desde la app más que a
--   'invoiced'.
--
-- OTRAS CONSECUENCIAS, a propósito:
--   · `invoice_number` queda NULL. La columna es nullable y nada se rompe,
--     pero estos meses no van a mostrar número de factura. Si los números
--     existen, cargarlos después desde la pantalla del billing.
--   · `sent_at` queda NULL: nunca hubo handoff a finanzas desde la app y no
--     tiene sentido inventar la fecha.
--   · `paid_at` queda en `now()` (es lo que hace el botón "Marcar pagado").
--     Si se conoce la fecha real de cobro, cambiar `now()` por esa fecha.
--   · No se escribe `audit_log`: el SQL directo saltea `recordAudit()`. En el
--     historial del billing no va a figurar quién lo marcó pagado.
--
-- IDEMPOTENTE: el filtro del CTE sólo toma meses sin fila o en 'draft', así
--   que una segunda corrida afecta 0 filas. Probado contra Postgres 16 local.
-- ════════════════════════════════════════════════════════════════════════════

-- ── PASO 0 — DIAGNÓSTICO: el set completo de meses pendientes ───────────────
-- Es la misma lógica del panel. Correr ANTES para ver las 8 filas y confirmar
-- cuál es la que no entró en la captura.

select pr.code as proyecto, mp.name as plan, to_char(m,'YYYY-MM') as mes,
       coalesce(pb.status::text, '(sin fila)') as estado_actual
from media_plans mp
join projects pr on pr.id = mp.project_id
join clients  c  on c.id  = pr.client_id
cross join lateral (
  select min(pl.start_date) as s, max(pl.end_date) as e
  from media_plan_publishers mpp
  join media_plan_placements pl on pl.media_plan_publisher_id = mpp.id
  where mpp.media_plan_id = mp.id
) per
cross join lateral generate_series(
  date_trunc('month', per.s), date_trunc('month', per.e), interval '1 month'
) m
left join plan_billings pb
  on pb.media_plan_id = mp.id and pb.month = to_char(m,'YYYY-MM')
where mp.deleted_at is null
  and mp.status in ('approved','qa_done','live','finished')
  and per.s is not null
  and to_char(m,'YYYY-MM') < to_char(now(),'YYYY-MM')
  and (pb.id is null or pb.status = 'draft')
order by mes desc, pr.code;


-- ── PASO 1 — EL CAMBIO ─────────────────────────────────────────────────────
-- Upsert: inserta el mes que no existe y actualiza el que está en 'draft'.
-- El par (código de proyecto, mes) es la llave: el índice único parcial
-- uq_media_plan_project_name garantiza un solo plan vivo por nombre dentro
-- del proyecto, y el CTE ya descarta todo lo que no esté pendiente.

with target as (
  select mp.id as media_plan_id, to_char(m,'YYYY-MM') as month, pb.id as billing_id
  from media_plans mp
  join projects pr on pr.id = mp.project_id
  cross join lateral (
    select min(pl.start_date) as s, max(pl.end_date) as e
    from media_plan_publishers mpp
    join media_plan_placements pl on pl.media_plan_publisher_id = mpp.id
    where mpp.media_plan_id = mp.id
  ) per
  cross join lateral generate_series(
    date_trunc('month', per.s), date_trunc('month', per.e), interval '1 month'
  ) m
  left join plan_billings pb
    on pb.media_plan_id = mp.id and pb.month = to_char(m,'YYYY-MM')
  where mp.deleted_at is null
    and mp.status in ('approved','qa_done','live','finished')
    and per.s is not null
    and (pb.id is null or pb.status = 'draft')
    and (pr.code, to_char(m,'YYYY-MM')) in (
      ('chile-sale',                                   '2026-08'),
      ('boosting-cirium',                              '2026-02'),
      ('stopover-2025',                                '2026-02'),
      ('boosting-cirium',                              '2026-01'),
      ('vuelo-inaugural',                              '2026-01'),
      ('boosting-enero',                               '2026-01'),
      ('demand-gen-tarifas-panama-clicks-spa-pa-2025', '2025-09')
    )
),
calc as (
  -- Totales desde las sublíneas, igual que recalcBillingTotals(): la media
  -- filtra is_billable (lo que el cliente paga directo no se factura).
  select t.media_plan_id, t.month,
         coalesce((select sum(x.amount_real_usd) from plan_billing_publishers x
                    where x.plan_billing_id = t.billing_id and x.is_billable), 0) as net,
         coalesce((select sum(f.amount_imputed_usd) from plan_billing_fees f
                    where f.plan_billing_id = t.billing_id), 0) as fee
  from target t
)
insert into plan_billings
  (media_plan_id, month, status, paid_at, total_net_usd, total_fee_usd, total_usd)
select media_plan_id, month, 'paid', now(), net, fee, net + fee
from calc
on conflict on constraint uq_pb_plan_month do update
  set status        = 'paid',
      paid_at       = coalesce(plan_billings.paid_at, now()),
      total_net_usd = excluded.total_net_usd,
      total_fee_usd = excluded.total_fee_usd,
      total_usd     = excluded.total_usd;


-- ── PASO 2 — VERIFICACIÓN ──────────────────────────────────────────────────
-- Tiene que devolver una fila por mes de la lista, todas con status = 'paid'
-- y paid_at de hoy.

select pr.code as proyecto, mp.name as plan, pb.month as mes, pb.status,
       to_char(pb.paid_at, 'YYYY-MM-DD') as paid_at,
       pb.total_net_usd as media, pb.total_fee_usd as fees, pb.total_usd as total,
       pb.invoice_number
from plan_billings pb
join media_plans mp on mp.id = pb.media_plan_id
join projects   pr on pr.id = mp.project_id
where (pr.code, pb.month) in (
  ('chile-sale',                                   '2026-08'),
  ('boosting-cirium',                              '2026-02'),
  ('stopover-2025',                                '2026-02'),
  ('boosting-cirium',                              '2026-01'),
  ('vuelo-inaugural',                              '2026-01'),
  ('boosting-enero',                               '2026-01'),
  ('demand-gen-tarifas-panama-clicks-spa-pa-2025', '2025-09')
)
order by pb.month desc, pr.code;
