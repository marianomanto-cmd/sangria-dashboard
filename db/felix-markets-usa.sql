-- ════════════════════════════════════════════════════════════════════════════
-- Catálogo de mercados de FÉLIX — 13 estados de EE.UU.
-- ════════════════════════════════════════════════════════════════════════════
--
-- CONTEXTO:
--   Félix opera por estado, no por país. Su catálogo de `markets` (per-cliente,
--   unique en (client_id, slug)) arranca vacío de estados, así que sus
--   placements no se pueden clasificar por mercado. Esto carga los 13 estados
--   pedidos por el cliente.
--
--   OJO con el nombre del cliente: se llama **Félix** (con tilde) en
--   `clients.name`, pero la query keyea por `clients.slug`, que es 'felix' sin
--   tilde — el mismo slug de la URL del portal (`/felix`). Para confirmarlo:
--     select id, name, slug from public.clients order by name;
--
--   Los nombres van COMPLETOS (Arizona, no AZ): son los que salen impresos en
--   el PDF del plan y en el portal. El slug es la forma normalizada del nombre,
--   igual que lo genera `slugify` en app/actions/markets.ts.
--
-- QUÉ HACE:
--   Inserta los 13 mercados para el cliente `felix`, habilitados, con
--   sort_order continuando el máximo actual del cliente (no pisa lo que ya
--   tenga cargado). Es idempotente: `on conflict` sobre (client_id, slug) sólo
--   se asegura de que el mercado quede `enabled` — NO toca el `name`, así que
--   un mercado ya renombrado a mano se respeta.
--
-- CÓMO APLICAR:
--   Pegar el bloque de migración en el SQL Editor de Supabase y ejecutarlo.
--   Después correr el bloque de VERIFICACIÓN: tienen que aparecer los 13
--   estados con enabled = t.
--
-- NO REQUIERE DEPLOY: el editor del plan y /configuracion/clientes/felix leen
--   `markets` directo (sin unstable_cache), así que los mercados aparecen en el
--   dropdown apenas se refresca la página.
--
-- COMPAÑERO EN CÓDIGO (opcional, no bloqueante): el mapa de /analisis geocodea
--   por nombre desde `lib/market-geo.ts`. Los centroides de estos 13 estados se
--   agregaron en el mismo PR; sin ese cambio los estados caen en "Sin ubicación
--   en el mapa" (el resto de la app funciona igual).
-- ════════════════════════════════════════════════════════════════════════════

insert into public.markets (client_id, slug, name, enabled, sort_order)
select c.id,
       v.slug,
       v.name,
       true,
       coalesce((select max(m.sort_order) from public.markets m
                  where m.client_id = c.id), -1) + v.ord
  from public.clients c
 cross join (values
     ('california',     'California',     1),
     ('new-york',       'New York',       2),
     ('new-jersey',     'New Jersey',     3),
     ('texas',          'Texas',          4),
     ('florida',        'Florida',        5),
     ('arizona',        'Arizona',        6),
     ('illinois',       'Illinois',       7),
     ('colorado',       'Colorado',       8),
     ('north-carolina', 'North Carolina', 9),
     ('georgia',        'Georgia',       10),
     ('washington',     'Washington',    11),
     ('pennsylvania',   'Pennsylvania',  12),
     ('new-mexico',     'New Mexico',    13)
   ) as v(slug, name, ord)
 where c.slug = 'felix'
 on conflict on constraint markets_client_slug_uq
 do update set enabled = true;

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN (correr aparte — el SQL Editor muestra sólo el último statement)
-- Esperado: los 13 estados, enabled = t, más lo que Félix ya tuviera cargado.
-- ════════════════════════════════════════════════════════════════════════════

-- select m.slug, m.name, m.enabled, m.sort_order
--   from public.markets m
--   join public.clients c on c.id = m.client_id
--  where c.slug = 'felix'
--  order by m.sort_order, m.name;

-- ════════════════════════════════════════════════════════════════════════════
-- LECTURA: cómo está cargado el plan de Félix (para asignarle mercado a cada
-- placement). Devuelve una fila por placement con su bloque de publisher, su
-- mercado actual (">>> SIN MERCADO" si está en null) y su `placement_id`, que
-- es lo que usa el UPDATE posterior.
-- ════════════════════════════════════════════════════════════════════════════

-- select
--   pr.code                                       as proyecto,
--   mp.name                                       as plan,
--   mp.status::text || ' v' || mp.current_version as estado,
--   pub.name                                      as publisher,
--   mpp.sort_order                                as bloque,
--   pl.sort_order                                 as linea,
--   pl.placement_name                             as placement,
--   coalesce(mk.name, '>>> SIN MERCADO')          as mercado,
--   pl.amount_usd                                 as monto_usd,
--   pl.cost_method                                as costo,
--   pl.start_date,
--   pl.end_date,
--   pl.audience                                   as audiencia,
--   pl.notes_md                                   as notas,
--   pl.metrics_json                               as metricas,
--   pl.id                                         as placement_id
-- from public.clients c
-- join public.projects pr               on pr.client_id = c.id
-- join public.media_plans mp            on mp.project_id = pr.id and mp.deleted_at is null
-- join public.media_plan_publishers mpp on mpp.media_plan_id = mp.id
-- join public.publishers pub            on pub.id = mpp.publisher_id
-- join public.media_plan_placements pl  on pl.media_plan_publisher_id = mpp.id
-- left join public.markets mk           on mk.id = pl.market_id
-- where c.slug = 'felix'
-- order by pr.code, mp.name, mpp.sort_order, pl.sort_order;
