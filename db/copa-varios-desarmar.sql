-- ════════════════════════════════════════════════════════════════════════════
-- Copa · desarmar el mercado "Varios" (17 líneas, USD 820.275,98)
--
-- PASO A de la normalización de mercados. Va ANTES de
-- db/markets-nomenclatura.sql: cuando termina, "Varios" ya no existe y el
-- catálogo entero entra en la taxonomía.
--
-- QUÉ ERA "Varios": tres cosas distintas en la misma bolsa. Se leyó línea por
-- línea (proyecto, plan, publisher, audiencia) y se resolvió con el dueño del
-- catálogo:
--
--   a) 5 líneas que son de UN país y nunca se les asignó — USD 4.000.
--      Van a su país. Los cinco países hay que CREARLOS: ninguno estaba en el
--      catálogo de Copa.
--   b) 10 líneas multi-país (feeders) — USD 601.809,55. Cada una corre sobre
--      varios países a la vez con budget compartido ("Single placement que
--      comparte budget entre 3 mercados", "AR-UY", "Brasil/Argentina/México/
--      Chile", "EZE, COR, CLO, GDL, GUA, MEX, MTY, PTY, SAL, GRU, SSA"). No se
--      pueden expresar como país-ciudad: `market_id` es UNA sola FK. Van al
--      LATAM que ya existe. El detalle de ciudades sigue en `audience`.
--   c) 2 líneas always-on globales — USD 214.466,43. BoostingIGGlobal
--      ("Geo-targeted by post") y Tiktok2026: no tienen mercado por diseño.
--      Van a un mercado nuevo "Global".
--
--   4.000 + 601.809,55 + 214.466,43 = 820.275,98 ✔
--
-- POR QUÉ POR NOMBRE DE LÍNEA: la reasignación es por PLACEMENT, no por
-- mercado, así que las 17 van enumeradas una por una. Los 17 nombres son
-- distintos entre sí. Una línea que no esté en la lista NO se toca y queda en
-- "Varios" — con lo cual el `delete` final no corre y el bloque de
-- verificación lo muestra. Es a propósito: preferimos que sobre "Varios" a que
-- una línea se vaya a un mercado que no le corresponde.
--
-- LOS CIERRES: "Varios" tiene 528 filas en `campaign_actual_snapshots` (el
-- histórico que alimenta los benchmarks del simulador). Son una copia
-- desnormalizada que NO se re-sincroniza sola. Se repuntan por `placement_id`
-- al mercado que la línea tenga después de la reasignación, así el histórico
-- sigue al día sin inventar nada.
--
-- IDEMPOTENTE: la segunda corrida no encuentra líneas en "Varios" y no hace
-- nada. Correr por SQL NO deja rastro en `audit_log`.
--
-- CÓMO APLICAR: pegar el bloque de abajo y ejecutarlo. Después, el bloque de
-- VERIFICACIÓN (va aparte: el SQL Editor muestra sólo el último statement).
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare
  v_client uuid; v_varios uuid;
  n_new int; n_pl int; n_cas int; n_snap int; n_sim int; n_left int;
begin
  select id into v_client from public.clients where slug = 'copa';
  if v_client is null then raise exception 'no existe el cliente copa'; end if;

  select id into v_varios from public.markets
   where client_id = v_client and slug = 'varios';
  if v_varios is null then
    raise notice 'no hay mercado "Varios" en Copa: nada que hacer';
    return;
  end if;

  -- 1) Los mercados destino que faltan. `on conflict` los deja como están si
  --    ya existen (no pisa un nombre editado a mano).
  with nuevos(slug, name, ord) as (values
      ('puerto-rico-pais',        'Puerto Rico (País)',          1),
      ('paraguay-pais',           'Paraguay (País)',             2),
      ('trinidad-y-tobago-pais',  'Trinidad y Tobago (País)',    3),
      ('uruguay-pais',            'Uruguay (País)',              4),
      ('republica-dominicana-pais','República Dominicana (País)', 5),
      ('global',                  'Global',                      6)
  )
  insert into public.markets (client_id, slug, name, enabled, sort_order)
  select v_client, n.slug, n.name, true,
         coalesce((select max(m.sort_order) from public.markets m
                    where m.client_id = v_client), -1) + n.ord
    from nuevos n
  on conflict on constraint markets_client_slug_uq do nothing;
  get diagnostics n_new = row_count;

  -- 2) Las 17 líneas, una por una, al mercado que le corresponde.
  create temporary table _varios_map on commit drop as
  select v.placement_name, m.id as market_id
    from (values
      -- a) de un solo país
      ('BuyMiles Baseline Puerto Rico',                'puerto-rico-pais'),
      ('Buy Miles Paraguay',                           'paraguay-pais'),
      ('BuyMiles Trinidad y Tobago',                   'trinidad-y-tobago-pais'),
      ('Buy Miles Uruguay',                            'uruguay-pais'),
      ('Meta - DO',                                    'republica-dominicana-pais'),
      -- b) multi-país (feeders) → LATAM
      ('COPA.m1202_AR-UY',                             'latam'),
      ('Meta | CostaRica | Consideration',             'latam'),
      ('DemandGen | CostaRica | Consideration',        'latam'),
      ('Meta | CostaRicaASC | Performance',            'latam'),
      ('COPA.m1211|Meta|MidYearSales|Performance',     'latam'),
      ('COPA.m1185|Meta|RepDom|Consideration',         'latam'),
      ('COPA.m1185|DemandGen|RepDom|Consideration',    'latam'),
      ('COPA.m1186|Meta|RepDom|Performance',           'latam'),
      ('COPA.m1186|Lotame|RepDom|Performance',         'latam'),
      ('COPA.m1194|Meta|LosCabosTarifas|Performance|Tickets', 'latam'),
      -- c) always-on sin mercado definido
      ('Meta|BoostingIGGlobal|Engagement',             'global'),
      ('TikTok|BoostingTikTok2026|Engagement',         'global')
    ) as v(placement_name, target_slug)
    join public.markets m
      on m.client_id = v_client and m.slug = v.target_slug;

  update public.media_plan_placements pl
     set market_id = mp.market_id
    from _varios_map mp
   where pl.market_id = v_varios
     and pl.placement_name = mp.placement_name;
  get diagnostics n_pl = row_count;

  -- 3) El histórico de cierres sigue a su línea (por placement_id, no por
  --    mercado: es lo único exacto después de una reasignación por línea).
  update public.campaign_actual_snapshots s
     set market_id = pl.market_id
    from public.media_plan_placements pl
   where pl.id = s.placement_id
     and s.market_id = v_varios;
  get diagnostics n_cas = row_count;

  -- 4) El marketId congelado en los snapshots de versiones aprobadas. Sin FK:
  --    si queda apuntando a "Varios" y "Varios" se borra, "descartar borrador"
  --    lo sanea a NULL y BORRA el mercado de las líneas vivas. Se resuelve por
  --    el `id` del placement, que el snapshot guarda al lado del marketId.
  update public.media_plan_snapshots s
     set snapshot_json = jsonb_set(
           s.snapshot_json, '{placements}',
           coalesce((
             select jsonb_agg(
                      case when e.p->>'marketId' = v_varios::text
                                and pl.market_id is not null
                           then jsonb_set(e.p, '{marketId}', to_jsonb(pl.market_id::text))
                           else e.p end
                      order by e.ord)
               from jsonb_array_elements(s.snapshot_json->'placements') with ordinality as e(p, ord)
               left join public.media_plan_placements pl on pl.id::text = e.p->>'id'
           ), '[]'::jsonb))
   where jsonb_typeof(s.snapshot_json->'placements') = 'array'
     and exists (select 1 from jsonb_array_elements(s.snapshot_json->'placements') e2
                  where e2->>'marketId' = v_varios::text);
  get diagnostics n_snap = row_count;

  -- 5) Los escenarios del simulador: no tienen placement al que seguir, así
  --    que las filas que apuntaban a "Varios" van a LATAM, que es donde cae la
  --    mayoría de esas líneas.
  update public.simulator_scenarios sc
     set rows_json = jsonb_set(
           sc.rows_json, '{rows}',
           coalesce((
             select jsonb_agg(
                      case when e.r->>'marketId' = v_varios::text
                           then jsonb_set(e.r, '{marketId}',
                                  to_jsonb((select m.id::text from public.markets m
                                             where m.client_id = v_client and m.slug = 'latam')))
                           else e.r end
                      order by e.ord)
               from jsonb_array_elements(sc.rows_json->'rows') with ordinality as e(r, ord)
           ), '[]'::jsonb))
   where sc.client_id = v_client
     and jsonb_typeof(sc.rows_json->'rows') = 'array'
     and exists (select 1 from jsonb_array_elements(sc.rows_json->'rows') e2
                  where e2->>'marketId' = v_varios::text);
  get diagnostics n_sim = row_count;

  -- 6) "Varios" se borra SÓLO si quedó vacío. Si sobró alguna línea que no
  --    estaba en la lista, se queda y la verificación la muestra.
  select count(*) into n_left from public.media_plan_placements
   where market_id = v_varios;
  if n_left = 0 then
    delete from public.markets where id = v_varios;
    raise notice 'mercados creados: %  ·  líneas reasignadas: %  ·  cierres: %  ·  snapshots de versión: %  ·  escenarios: %  ·  "Varios" BORRADO',
      n_new, n_pl, n_cas, n_snap, n_sim;
  else
    raise notice 'mercados creados: %  ·  líneas reasignadas: %  ·  cierres: %  ·  snapshots de versión: %  ·  escenarios: %  ·  "Varios" NO se borró: le quedan % líneas sin mapear',
      n_new, n_pl, n_cas, n_snap, n_sim, n_left;
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN (correr aparte)
--
-- ESPERADO, exacto:
--   Global                        2 líneas    214.466,43
--   LATAM                        27 líneas    869.210,75   (17 que ya tenía + 10)
--   Paraguay (País)               1 línea         500,00
--   Puerto Rico (País)            1 línea         500,00
--   República Dominicana (País)   1 línea       2.000,00
--   Trinidad y Tobago (País)      1 línea         200,00
--   Uruguay (País)                1 línea         800,00
--   …y NINGUNA fila que diga "Varios".
-- ════════════════════════════════════════════════════════════════════════════

-- select m.name                                   as mercado,
--        count(pl.id)                             as lineas,
--        coalesce(sum(pl.amount_usd), 0)          as monto_usd
--   from public.markets m
--   join public.clients c on c.id = m.client_id
--   left join public.media_plan_placements pl on pl.market_id = m.id
--  where c.slug = 'copa'
--    and m.slug in ('varios','latam','global','puerto-rico-pais','paraguay-pais',
--                   'trinidad-y-tobago-pais','uruguay-pais','republica-dominicana-pais')
--  group by m.name
--  order by m.name;

-- ── Que no haya quedado ningún marketId muerto apuntando a "Varios". 0 filas: ──
-- select s.id from public.media_plan_snapshots s,
--        lateral jsonb_array_elements(s.snapshot_json->'placements') e
--  where jsonb_typeof(s.snapshot_json->'placements') = 'array'
--    and e->>'marketId' is not null
--    and not exists (select 1 from public.markets m where m.id::text = e->>'marketId');
