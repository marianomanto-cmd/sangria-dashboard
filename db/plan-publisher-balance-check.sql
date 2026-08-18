-- ════════════════════════════════════════════════════════════════════════════
-- Diagnóstico: publishers descuadrados en planes ya congelados
-- ════════════════════════════════════════════════════════════════════════════
--
-- QUÉ BUSCA:
--   Bloques de publisher donde `total_planned_usd` NO coincide con la suma de
--   los montos de sus placements, en planes que ya pasaron de draft
--   (ready_to_send / approved / qa_done / live).
--
-- POR QUÉ IMPORTA:
--   Los dos números alimentan cosas distintas y nunca se cruzaban:
--     • el TOTAL del plan (y con él la base del management fee, los KPIs, la
--       estimación y la cobertura vs budget del proyecto) sale de
--       `sum(media_plan_publishers.total_planned_usd)`;
--     • el prorrateo mensual (`getBillingEstimate`), el pacing, el campaign
--       tracker y las líneas del Excel salen de los PLACEMENTS.
--   La diferencia es plata que figura en el total pero no se prorratea a
--   ningún mes (o, al revés, meses que facturan más que el total del plan).
--
-- DESDE CUÁNDO NO PASA MÁS:
--   `lib/plan-readiness.ts` ahora bloquea el pase a Listo/Aprobado si algún
--   publisher no cuadra (barrera real en `transitionPlanStatus`). Esta query
--   sirve para los planes que se congelaron ANTES de esa regla.
--
-- QUÉ HACER CON EL RESULTADO:
--   ⚠️ NO hay query de reparación a propósito. Cuál de los dos números está
--   bien es una decisión de negocio por plan: puede faltar cargar un placement
--   (y entonces el total está bien) o puede haber quedado un total viejo de una
--   negociación anterior (y entonces mandan los placements). Además, mover el
--   total cambia la base del management fee. Lo correcto es abrirlos en el
--   editor, usar el botón "Balancear" o cargar la línea faltante, y re-aprobar.
-- ════════════════════════════════════════════════════════════════════════════

select
  c.name                                as cliente,
  p.code                                as proyecto,
  mp.name                               as plan,
  mp.status,
  mp.current_version                    as version,
  pub.name                              as publisher,
  mpp.total_planned_usd                 as total_publisher,
  coalesce(sum(pl.amount_usd), 0)       as suma_placements,
  mpp.total_planned_usd
    - coalesce(sum(pl.amount_usd), 0)   as diferencia,   -- > 0 = falta plata en placements
  count(pl.id)                          as lineas
from media_plan_publishers mpp
join media_plans mp on mp.id = mpp.media_plan_id
join projects    p  on p.id  = mp.project_id
join clients     c  on c.id  = p.client_id
join publishers  pub on pub.id = mpp.publisher_id
left join media_plan_placements pl on pl.media_plan_publisher_id = mpp.id
where mp.deleted_at is null
  and mp.status in ('ready_to_send', 'approved', 'qa_done', 'live')
group by c.name, p.code, mp.name, mp.status, mp.current_version,
         pub.name, mpp.id, mpp.total_planned_usd
having abs(mpp.total_planned_usd - coalesce(sum(pl.amount_usd), 0)) >= 0.01
order by abs(mpp.total_planned_usd - coalesce(sum(pl.amount_usd), 0)) desc;


-- ────────────────────────────────────────────────────────────────────────────
-- Resumen: cuánta plata hay descuadrada en total, por estado de plan.
-- ────────────────────────────────────────────────────────────────────────────

select
  t.status,
  count(*)                        as bloques_descuadrados,
  count(distinct t.media_plan_id) as planes_afectados,
  sum(t.diferencia)               as diferencia_neta,
  sum(abs(t.diferencia))          as diferencia_absoluta
from (
  select
    mp.id as media_plan_id,
    mp.status,
    mpp.total_planned_usd - coalesce(sum(pl.amount_usd), 0) as diferencia
  from media_plan_publishers mpp
  join media_plans mp on mp.id = mpp.media_plan_id
  left join media_plan_placements pl on pl.media_plan_publisher_id = mpp.id
  where mp.deleted_at is null
    and mp.status in ('ready_to_send', 'approved', 'qa_done', 'live')
  group by mp.id, mp.status, mpp.id, mpp.total_planned_usd
  having abs(mpp.total_planned_usd - coalesce(sum(pl.amount_usd), 0)) >= 0.01
) t
group by t.status
order by t.status;
