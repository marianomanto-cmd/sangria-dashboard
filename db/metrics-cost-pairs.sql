-- ════════════════════════════════════════════════════════════════════════════
-- Métricas de costo que le faltaban al catálogo de Copa (03/sep/2026)
-- ════════════════════════════════════════════════════════════════════════════
--
-- POR QUÉ: en el editor del plan, la tarifa de una métrica direct sólo se
-- PERSISTE si el catálogo del cliente tiene una métrica `calculated` con
-- fórmula `amount / <slug>` (regla 2 de `buildMetricRatePairs`,
-- lib/cost-methods.ts). Sin esa calculada el par nace con `rate: null`: la
-- tarifa que carga el planner se descarta y la pantalla la re-deriva como
-- `amount / delivery`.
--
-- Seis direct de Copa no tenían la suya, así que su tarifa se perdía en cada
-- carga: cc_los_cabos, cc_canada, cc_costa_rica, cc_tickets_argentina,
-- cc_origen_san_diego y tickets_rep_dom. Caso reportado: CPA $450 en
-- "CC Los Cabos" sobre un placement de $4.101 volvía como $455,67
-- (4101/450 = 9,11 → el delivery se guardaba 9 → 4101/9 = 455,67).
--
-- Los slugs van en snake_case, sin dígitos y fuera de los 10 canónicos
-- (`cpm cpc cpv cpa cpr cpe cpf cpl cpi cpvis`) a propósito: los dígitos
-- rompen el regex de `evalFormula` (lib/plan-metrics.ts) y un slug canónico
-- le robaría el par a su delivery canónica. `unit = '$'` es lo que hace que
-- el Campaign Tracker las trate como "menos es mejor".
--
-- Idempotente (`on conflict do nothing`). Sólo agrega filas al catálogo: NO
-- toca ningún plan ni ningún metrics_json. Los planes ya cargados siguen
-- mostrando la tarifa re-derivada hasta que alguien la re-cargue a mano —
-- decisión explícita del dueño: no se backfillea nada.
--
-- Probado contra un Postgres 16 local con el catálogo real de Copa: corrido
-- dos veces, la segunda no inserta nada. Deja 1 sola direct sin par
-- (`revenue`, que es plata y no una conversión).
-- ════════════════════════════════════════════════════════════════════════════

insert into metrics_catalog (client_id, slug, name, kind, unit, formula, enabled, sort_order)
select c.id, v.slug, v.name, 'calculated'::metric_kind, '$', v.formula, true, v.sort_order
from clients c
cross join (values
  ('cpa_cc_los_cabos',         'CPA CC Los Cabos',         'amount / cc_los_cabos',         61),
  ('cpa_cc_canada',            'CPA CC Canada',            'amount / cc_canada',            62),
  ('cpa_cc_costa_rica',        'CPA CC Costa Rica',        'amount / cc_costa_rica',        63),
  ('cpa_cc_tickets_argentina', 'CPA CC Tickets Argentina', 'amount / cc_tickets_argentina', 64),
  ('cpa_cc_origen_san_diego',  'CPA CC Origen San Diego',  'amount / cc_origen_san_diego',  65),
  ('cpt_rep_dom',              'CPT Rep Dom',              'amount / tickets_rep_dom',      66)
) as v(slug, name, formula, sort_order)
where c.slug = 'copa'
on conflict (client_id, slug) do nothing;

-- ── VERIFICACIÓN (correr aparte: el SQL Editor sólo muestra el último) ──────
-- Éxito = UNA sola fila, `revenue`. Cualquier otra `cc_*` o `tickets*` que
-- aparezca es una direct a la que todavía le falta su métrica de costo.
--
-- El doble regexp_replace replica `parseCostFormula` (lib/cost-methods.ts):
-- primero saca los espacios y DESPUÉS el `×N`, en ese orden. Al revés, un
-- `amount / impressions × 1000` no matchea y `impressions` sale como falso
-- positivo.
--
-- select d.slug as delivery, d.name, r.slug as clave_tarifa
-- from metrics_catalog d
-- join clients c on c.id = d.client_id
-- left join metrics_catalog r
--   on  r.client_id = d.client_id and r.kind = 'calculated' and r.enabled
--   and regexp_replace(regexp_replace(lower(r.formula),'[[:space:]]','','g'),'×[0-9]+','','g')
--       = 'amount/' || lower(d.slug)
-- where c.slug = 'copa' and d.kind = 'direct' and d.enabled and r.slug is null
-- order by d.sort_order;
