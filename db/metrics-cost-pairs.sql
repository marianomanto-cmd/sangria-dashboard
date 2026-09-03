-- ════════════════════════════════════════════════════════════════════════════
-- El catálogo de Copa: las métricas de costo que faltaban (03/sep/2026)
-- ════════════════════════════════════════════════════════════════════════════
--
-- POR QUÉ: en el editor del plan, la tarifa de una métrica direct sólo se
-- PERSISTE si el catálogo del cliente tiene una `calculated` con fórmula
-- `amount / <slug>` (regla 2 de `buildMetricRatePairs`, lib/cost-methods.ts).
-- Sin esa calculada el par nace con `rate: null`: la tarifa que carga el
-- planner se descarta y la pantalla la re-deriva como `amount / delivery`.
--
-- Caso reportado: CPA $450 en "CC Los Cabos" sobre un placement de $4.101
-- volvía como $455,67 (4101/450 = 9,11 → el delivery se guardaba 9 →
-- 4101/9 = 455,67).
--
-- Los slugs de las calculadas van en snake_case, sin dígitos y fuera de los 10
-- canónicos (`cpm cpc cpv cpa cpr cpe cpf cpl cpi cpvis`) a propósito: un slug
-- canónico le robaría el par a su delivery canónica, y los dígitos rompen el
-- regex de `evalFormula` (lib/plan-metrics.ts, `[a-z_]+`). `unit = '$'` es lo
-- que hace que el Campaign Tracker las trate como "menos es mejor".
--
-- Probado contra un Postgres 16 local con el catálogo real de Copa: los tres
-- bloques corridos dos veces, idempotentes. Además se verificó con el código
-- real de la app (`buildMetricRatePairs` + `evalFormula`) que después de esto
-- toda métrica de conversión aparea y toda fórmula evalúa.
-- ════════════════════════════════════════════════════════════════════════════


-- ── BLOQUE 1: las 6 conversiones de destino ────────────────────────────────
-- cc_los_cabos, cc_canada, cc_costa_rica, cc_tickets_argentina,
-- cc_origen_san_diego y tickets_rep_dom no tenían su costo por unidad.
-- Aditivo: NO toca ningún plan ni ningún metrics_json.

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


-- ── BLOQUE 2: el CPCV de completed_video_views ─────────────────────────────

insert into metrics_catalog (client_id, slug, name, kind, unit, formula, enabled, sort_order)
select c.id, 'cpcv', 'CPCV', 'calculated'::metric_kind, '$',
       'amount / completed_video_views', true, 67
from clients c
where c.slug = 'copa'
on conflict (client_id, slug) do nothing;


-- ── BLOQUE 3: el slug roto de "YouTube public views" ───────────────────────
--
-- Este NO se arreglaba agregando la calculada, y conviene entender por qué:
-- el slug tiene ESPACIOS y MAYÚSCULAS, y `parseCostFormula` baja la fórmula a
-- minúsculas y le saca los espacios antes de matchear. Así, una calculada
-- `amount / YouTube public views` aparea contra un slug fantasma
-- `youtubepublicviews` que no le corresponde a ninguna métrica, y la real se
-- queda igual con `rate: null`. Peor: `evalFormula` devuelve null para esa
-- métrica, o sea que ninguna calculada que la referencie podría aparecer nunca
-- en el Excel, el PDF ni el tracker.
--
-- Verificado ejecutando el código real: antes `rate: null` y `evalFormula`
-- null; después del rename, `rate: "cpv_youtube_public"` y la fórmula evalúa.
--
-- El rename es seguro y NO toca planes: el scoping en prod dio 1 fila en
-- metrics_catalog y 0 en las otras cuatro tablas donde un slug de métrica vive
-- como dato (media_plan_placements.metrics_json, campaign_placement_actuals,
-- campaign_actual_snapshots y media_plan_snapshots.snapshot_json). Es una
-- entrada huérfana del catálogo que nunca se usó.
--
-- El `name` no cambia: el planner sigue viendo "YouTube public views".

update metrics_catalog m
set slug = 'youtube_public_views'
from clients c
where c.id = m.client_id
  and c.slug = 'copa'
  and m.slug = 'YouTube public views'
  and not exists (
    select 1 from metrics_catalog x
    where x.client_id = m.client_id and x.slug = 'youtube_public_views'
  );

insert into metrics_catalog (client_id, slug, name, kind, unit, formula, enabled, sort_order)
select c.id, 'cpv_youtube_public', 'CPV YouTube Public', 'calculated'::metric_kind, '$',
       'amount / youtube_public_views', true, 68
from clients c
where c.slug = 'copa'
on conflict (client_id, slug) do nothing;


-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN — correr APARTE (el SQL Editor sólo muestra el último statement)
-- ════════════════════════════════════════════════════════════════════════════
--
-- (A) Conversiones sin costo por unidad. ÉXITO = 0 filas.
--
-- Modela `acceptsRate` (lib/cost-methods.ts): `frequency` y toda direct con
-- unidad %/x/$ son ratios o plata, no admiten costo unitario y la app ni les
-- ofrece columna Tarifa — excluirlas evita falsos positivos.
--
-- El doble regexp_replace replica `parseCostFormula`: primero saca los
-- espacios y DESPUÉS el `×N`, en ese orden. Al revés, un
-- `amount / impressions × 1000` no matchea e `impressions` sale como falso
-- positivo.
--
-- select d.slug as delivery, d.name, d.unit
-- from metrics_catalog d
-- join clients c on c.id = d.client_id
-- left join metrics_catalog r
--   on  r.client_id = d.client_id and r.kind = 'calculated' and r.enabled
--   and regexp_replace(regexp_replace(lower(r.formula),'[[:space:]]','','g'),'×[0-9]+','','g')
--       = 'amount/' || lower(d.slug)
-- where c.slug = 'copa' and d.kind = 'direct' and d.enabled and r.slug is null
--   and d.slug <> 'frequency'
--   and coalesce(btrim(d.unit), '') not in ('%', 'x', '$')
-- order by d.sort_order;
--
--
-- (B) Slugs direct que ninguna fórmula puede referenciar. ÉXITO = 0 filas.
--
-- El charset seguro para una direct es `^[a-z_]+$`: sin espacios, sin
-- mayúsculas y SIN DÍGITOS. Los dígitos son la trampa silenciosa —
-- `parseCostFormula` los acepta (`[a-z0-9_]+`) pero `evalFormula` no
-- (`[a-z_]+`), así que un `views_2` formaría el par y persistiría la tarifa,
-- pero su calculada nunca resolvería en ningún export ni en el tracker.
--
-- Correr esto ANTES de crear cualquier métrica direct nueva.
--
-- select c.slug as cliente, m.slug, m.name, m.enabled
-- from metrics_catalog m
-- join clients c on c.id = m.client_id
-- where m.kind = 'direct' and m.slug !~ '^[a-z_]+$'
-- order by c.slug, m.slug;
