-- ════════════════════════════════════════════════════════════════════════════
-- PASO B — normalizar el catálogo de mercados a la nomenclatura única.
--
--   ⚠️  ARCHIVO GENERADO. No editar a mano: sale de cruzar
--       db/markets-catalogo-2026-09-03.csv (la foto de prod) con
--       lib/market-nomenclature.ts (la taxonomía), vía
--       `npm run gen:markets-sql`.
--
--   Va DESPUÉS de db/copa-varios-desarmar.sql (paso A), que desarma el mercado
--   "Varios" de Copa. Si se corre antes, "Varios" queda sin tocar y reportado.
--
-- LA REGLA (la misma para todos los clientes):
--   el país entero      → "<País> (País)"       ej. Argentina (País)
--   una plaza           → "<País> - <Plaza>"    ej. México - Ciudad de México
--   varias plazas       → "<País> - Varios"     ej. Argentina - Varios
--     (con etiqueta si hay más de un grupo: "Estados Unidos - Varios (T1)")
--   una región          → "<Región>"            ej. Centroamérica · LATAM · Global
--
-- EL PLAN, en números: 64 mercados en la foto · 49 se renombran · 2 fusiones · 0 sin mapear.
--
-- LAS FUSIONES (lo único que borra una fila del catálogo):
--   · "Estados Unidos" + "Estados Unidos - Varios" → "Estados Unidos (País)" (32 líneas, USD 1.165.345,00); desaparece "Estados Unidos - Varios"
--   · "Colombia - Bogota" + "CO - Bogota" → "Colombia - Bogotá" (4 líneas, USD 32.658,00); desaparece "CO - Bogota"
--
-- SIN MAPEAR (no se tocan; salen listados en el bloque 1):
--   · ninguno
--
-- QUÉ REPUNTA UNA FUSIÓN, antes de borrar al perdedor:
--   · media_plan_placements.market_id      (FK, ON DELETE SET NULL)
--   · campaign_actual_snapshots.market_id  (FK — el histórico de cierres)
--   · media_plan_snapshots.snapshot_json → placements[].marketId   (JSONB, SIN FK)
--   · simulator_scenarios.rows_json → rows[].marketId              (JSONB, SIN FK)
--   El del snapshot es el que se olvida: si queda un id muerto, "descartar
--   borrador" lo sanea a NULL y BORRA el mercado de las líneas vivas.
--
-- IDEMPOTENTE: en la segunda corrida no hay grupos con más de uno y los
--   renames son no-ops.
--
-- CÓMO APLICAR:
--   Bloque 1 → el plan de cambios, read-only. Mirarlo ANTES de tocar nada.
--   Bloque 2 → aplica. Un solo statement, todo o nada.
--   Bloque 3 → verificación (aparte: el SQL Editor muestra sólo el último).
--
-- OJO:
--   · Cada bloque es UN solo statement y se banca solo: el slug destino viene
--     ya calculado en el plan, así que no hay que crear ninguna función antes.
--   · Correr por SQL NO deja rastro en `audit_log`.
--   · Los snapshots de versiones resuelven el nombre contra el catálogo de HOY:
--     un PDF de una versión firmada, regenerado, va a decir el nombre nuevo.
--     Es lo que ya pasaba con cualquier renombre desde la UI.
--   · Ninguna de las dos columnas market_id tiene índice: el bloque 2 hace seq
--     scan. Con estos volúmenes es instantáneo (ver db/fk-indexes.sql).
--
-- COMPAÑERO EN CÓDIGO (deploy y SQL son independientes y van en cualquier
--   orden): lib/market-nomenclature.ts (taxonomía), components/market-picker.tsx
--   (el alta ya no es texto libre) y lib/market-geo.ts (geocoding de las formas
--   nuevas). Sin el deploy, "Argentina (País)" cae en el mapa como ciudad.
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 1 — DRY RUN (read-only). El plan de cambios, ANTES de tocar nada.
--
-- `accion`:  sin cambio · renombrar · FUSIONAR EN … · SIN MAPEAR ·
--            NO ESTABA EN EL PLAN (cargado después de la foto: no se toca)
-- ════════════════════════════════════════════════════════════════════════════

with
  market_plan(client_slug, market_slug, target_name, target_slug) as (values
    ('copa', 'costa-rica', 'Costa Rica (País)', 'costa-rica-pais'),
    ('copa', 'panama', 'Panamá (País)', 'panama-pais'),
    ('copa', 'guatemala', 'Guatemala (País)', 'guatemala-pais'),
    ('copa', 'honduras', 'Honduras (País)', 'honduras-pais'),
    ('copa', 'el-salvador', 'El Salvador (País)', 'el-salvador-pais'),
    ('copa', 'nicaragua', 'Nicaragua (País)', 'nicaragua-pais'),
    ('copa', 'mexico', 'México (País)', 'mexico-pais'),
    ('copa', 'argentina', 'Argentina (País)', 'argentina-pais'),
    ('copa', 'brasil', 'Brasil (País)', 'brasil-pais'),
    ('copa', 'chile', 'Chile (País)', 'chile-pais'),
    ('copa', 'colombia', 'Colombia (País)', 'colombia-pais'),
    ('copa', 'peru', 'Perú (País)', 'peru-pais'),
    ('copa', 'centroamerica', 'Centroamérica', 'centroamerica'),
    ('copa', 'latam', 'LATAM', 'latam'),
    ('copa', 'canada-toronto', 'Canadá - Toronto', 'canada-toronto'),
    ('copa', 'panama-panama', 'Panamá - Ciudad de Panamá', 'panama-ciudad-de-panama'),
    ('copa', 'estados-unidos', 'Estados Unidos (País)', 'estados-unidos-pais'),
    ('copa', 'colombia-bogota', 'Colombia - Bogotá', 'colombia-bogota'),
    ('copa', 'peru-lima', 'Perú - Lima', 'peru-lima'),
    ('copa', 'brasil-sao-paulo', 'Brasil - São Paulo', 'brasil-sao-paulo'),
    ('copa', 'estados-unidos-varios', 'Estados Unidos (País)', 'estados-unidos-pais'),
    ('copa', 'colombia-varios', 'Colombia - Varios', 'colombia-varios'),
    ('copa', 'argentina-varios', 'Argentina - Varios', 'argentina-varios'),
    ('copa', 'mexico-guadalajara', 'México - Guadalajara', 'mexico-guadalajara'),
    ('copa', 'mexico-df', 'México - Ciudad de México', 'mexico-ciudad-de-mexico'),
    ('copa', 'mexico-monterrey', 'México - Monterrey', 'mexico-monterrey'),
    ('copa', 'mexico-los-cabos', 'México - Los Cabos', 'mexico-los-cabos'),
    ('copa', 'ecuador-quito', 'Ecuador - Quito', 'ecuador-quito'),
    ('copa', 'argentina-salta', 'Argentina - Salta', 'argentina-salta'),
    ('copa', 'argentina-cordoba', 'Argentina - Córdoba', 'argentina-cordoba'),
    ('copa', 'argentina-mendoza', 'Argentina - Mendoza', 'argentina-mendoza'),
    ('copa', 'argentina-buenos-aires', 'Argentina - Buenos Aires', 'argentina-buenos-aires'),
    ('copa', 'argentina-rosario', 'Argentina - Rosario', 'argentina-rosario'),
    ('copa', 'venezuela', 'Venezuela (País)', 'venezuela-pais'),
    ('copa', 'us-la-joya', 'Estados Unidos - La Jolla', 'estados-unidos-la-jolla'),
    ('copa', 'us-coronado', 'Estados Unidos - Coronado', 'estados-unidos-coronado'),
    ('copa', 'us-encinitas', 'Estados Unidos - Encinitas', 'estados-unidos-encinitas'),
    ('copa', 'us-del-mar', 'Estados Unidos - Del Mar', 'estados-unidos-del-mar'),
    ('copa', 'us-san-diego', 'Estados Unidos - San Diego', 'estados-unidos-san-diego'),
    ('copa', 'co-bogota', 'Colombia - Bogotá', 'colombia-bogota'),
    ('copa', 'co-medellin', 'Colombia - Medellín', 'colombia-medellin'),
    ('copa', 'costa-rica-san-jose', 'Costa Rica - San José', 'costa-rica-san-jose'),
    ('copa', 'guatemala-guatemala-city', 'Guatemala - Ciudad de Guatemala', 'guatemala-ciudad-de-guatemala'),
    ('copa', 'global', 'Global', 'global'),
    ('copa', 'puerto-rico-pais', 'Puerto Rico (País)', 'puerto-rico-pais'),
    ('copa', 'paraguay-pais', 'Paraguay (País)', 'paraguay-pais'),
    ('copa', 'trinidad-y-tobago-pais', 'Trinidad y Tobago (País)', 'trinidad-y-tobago-pais'),
    ('copa', 'uruguay-pais', 'Uruguay (País)', 'uruguay-pais'),
    ('copa', 'republica-dominicana-pais', 'República Dominicana (País)', 'republica-dominicana-pais'),
    ('felix', 'california', 'Estados Unidos - California', 'estados-unidos-california'),
    ('felix', 'new-york', 'Estados Unidos - New York', 'estados-unidos-new-york'),
    ('felix', 'new-jersey', 'Estados Unidos - New Jersey', 'estados-unidos-new-jersey'),
    ('felix', 'texas', 'Estados Unidos - Texas', 'estados-unidos-texas'),
    ('felix', 'florida', 'Estados Unidos - Florida', 'estados-unidos-florida'),
    ('felix', 'arizona', 'Estados Unidos - Arizona', 'estados-unidos-arizona'),
    ('felix', 'illinois', 'Estados Unidos - Illinois', 'estados-unidos-illinois'),
    ('felix', 'colorado', 'Estados Unidos - Colorado', 'estados-unidos-colorado'),
    ('felix', 'north-carolina', 'Estados Unidos - North Carolina', 'estados-unidos-north-carolina'),
    ('felix', 'georgia', 'Estados Unidos - Georgia', 'estados-unidos-georgia'),
    ('felix', 'washington', 'Estados Unidos - Washington', 'estados-unidos-washington'),
    ('felix', 'pennsylvania', 'Estados Unidos - Pennsylvania', 'estados-unidos-pennsylvania'),
    ('felix', 'new-mexico', 'Estados Unidos - New Mexico', 'estados-unidos-new-mexico'),
    ('felix', 'estados-unidos-t1', 'Estados Unidos - Varios (T1)', 'estados-unidos-varios-t1'),
    ('felix', 'estados-unidos-t2', 'Estados Unidos - Varios (T2)', 'estados-unidos-varios-t2')
  ),
  plan as (
    select m.id, m.client_id, m.name, m.slug, m.sort_order,
           c.slug as client_slug,
           mp.target_name,
           mp.target_slug,
           (select count(*) from public.media_plan_placements pl where pl.market_id = m.id) as placements
      from public.markets m
      join public.clients c on c.id = m.client_id
      -- Empareja por el slug ACTUAL o por el slug DESTINO: así el plan sigue
      -- reconociendo al mercado después de renombrarlo. Sin esto, la segunda
      -- corrida y la verificación no encontraban nada y reportaban todo como
      -- "no estaba en el plan". Gana siempre el match por slug actual.
      left join lateral (
        select mp.target_name, mp.target_slug
          from market_plan mp
         where mp.client_slug = c.slug
           and (mp.market_slug = m.slug or mp.target_slug = m.slug)
         order by (mp.market_slug = m.slug) desc
         limit 1
      ) mp on true
     where c.slug in ('copa', 'felix')
  ),
  -- Ganador de cada grupo: el que más líneas tiene; a igualdad, el que ya está
  -- bien escrito, y después el de menor sort_order.
  winner as (
    select p.*,
           first_value(p.id) over (
             partition by p.client_id, p.target_slug
             order by p.placements desc,
                      (case when p.name = p.target_name then 0 else 1 end),
                      p.sort_order, p.id
           ) as winner_id
      from plan p
     where p.target_name is not null
  )
select w.client_slug                                       as cliente,
       w.name                                              as mercado_actual,
       w.target_name                                       as mercado_nuevo,
       case
         when w.id <> w.winner_id
           then 'FUSIONAR EN → ' || (select w2.target_name from winner w2 where w2.id = w.winner_id limit 1)
         when w.name = w.target_name and w.slug = w.target_slug then 'sin cambio'
         else 'renombrar'
       end                                                 as accion,
       w.placements                                        as lineas,
       (select count(*) from public.campaign_actual_snapshots s where s.market_id = w.id) as cierres,
       (select count(*) from public.media_plan_snapshots s
         where jsonb_typeof(s.snapshot_json->'placements') = 'array'
           and exists (select 1 from jsonb_array_elements(s.snapshot_json->'placements') e
                        where e->>'marketId' = w.id::text))                               as snapshots,
       (select count(*) from public.simulator_scenarios sc
         where jsonb_typeof(sc.rows_json->'rows') = 'array'
           and exists (select 1 from jsonb_array_elements(sc.rows_json->'rows') e
                        where e->>'marketId' = w.id::text))                               as simulador
  from winner w
union all
select p.client_slug, p.name, null, 'NO ESTABA EN EL PLAN', p.placements, 0, 0, 0
  from plan p where p.target_name is null
 order by 1, 4, 2;

-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 2 — APLICAR. Un solo statement: o entra todo o no entra nada.
-- Al terminar imprime en "Messages" cuántas filas tocó cada cosa.
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare
  n_merge int; n_pl int; n_cas int; n_snap int; n_sim int; n_del int; n_ren int;
begin
  create temporary table _mkt_plan on commit drop as
  with
    market_plan(client_slug, market_slug, target_name, target_slug) as (values
      ('copa', 'costa-rica', 'Costa Rica (País)', 'costa-rica-pais'),
      ('copa', 'panama', 'Panamá (País)', 'panama-pais'),
      ('copa', 'guatemala', 'Guatemala (País)', 'guatemala-pais'),
      ('copa', 'honduras', 'Honduras (País)', 'honduras-pais'),
      ('copa', 'el-salvador', 'El Salvador (País)', 'el-salvador-pais'),
      ('copa', 'nicaragua', 'Nicaragua (País)', 'nicaragua-pais'),
      ('copa', 'mexico', 'México (País)', 'mexico-pais'),
      ('copa', 'argentina', 'Argentina (País)', 'argentina-pais'),
      ('copa', 'brasil', 'Brasil (País)', 'brasil-pais'),
      ('copa', 'chile', 'Chile (País)', 'chile-pais'),
      ('copa', 'colombia', 'Colombia (País)', 'colombia-pais'),
      ('copa', 'peru', 'Perú (País)', 'peru-pais'),
      ('copa', 'centroamerica', 'Centroamérica', 'centroamerica'),
      ('copa', 'latam', 'LATAM', 'latam'),
      ('copa', 'canada-toronto', 'Canadá - Toronto', 'canada-toronto'),
      ('copa', 'panama-panama', 'Panamá - Ciudad de Panamá', 'panama-ciudad-de-panama'),
      ('copa', 'estados-unidos', 'Estados Unidos (País)', 'estados-unidos-pais'),
      ('copa', 'colombia-bogota', 'Colombia - Bogotá', 'colombia-bogota'),
      ('copa', 'peru-lima', 'Perú - Lima', 'peru-lima'),
      ('copa', 'brasil-sao-paulo', 'Brasil - São Paulo', 'brasil-sao-paulo'),
      ('copa', 'estados-unidos-varios', 'Estados Unidos (País)', 'estados-unidos-pais'),
      ('copa', 'colombia-varios', 'Colombia - Varios', 'colombia-varios'),
      ('copa', 'argentina-varios', 'Argentina - Varios', 'argentina-varios'),
      ('copa', 'mexico-guadalajara', 'México - Guadalajara', 'mexico-guadalajara'),
      ('copa', 'mexico-df', 'México - Ciudad de México', 'mexico-ciudad-de-mexico'),
      ('copa', 'mexico-monterrey', 'México - Monterrey', 'mexico-monterrey'),
      ('copa', 'mexico-los-cabos', 'México - Los Cabos', 'mexico-los-cabos'),
      ('copa', 'ecuador-quito', 'Ecuador - Quito', 'ecuador-quito'),
      ('copa', 'argentina-salta', 'Argentina - Salta', 'argentina-salta'),
      ('copa', 'argentina-cordoba', 'Argentina - Córdoba', 'argentina-cordoba'),
      ('copa', 'argentina-mendoza', 'Argentina - Mendoza', 'argentina-mendoza'),
      ('copa', 'argentina-buenos-aires', 'Argentina - Buenos Aires', 'argentina-buenos-aires'),
      ('copa', 'argentina-rosario', 'Argentina - Rosario', 'argentina-rosario'),
      ('copa', 'venezuela', 'Venezuela (País)', 'venezuela-pais'),
      ('copa', 'us-la-joya', 'Estados Unidos - La Jolla', 'estados-unidos-la-jolla'),
      ('copa', 'us-coronado', 'Estados Unidos - Coronado', 'estados-unidos-coronado'),
      ('copa', 'us-encinitas', 'Estados Unidos - Encinitas', 'estados-unidos-encinitas'),
      ('copa', 'us-del-mar', 'Estados Unidos - Del Mar', 'estados-unidos-del-mar'),
      ('copa', 'us-san-diego', 'Estados Unidos - San Diego', 'estados-unidos-san-diego'),
      ('copa', 'co-bogota', 'Colombia - Bogotá', 'colombia-bogota'),
      ('copa', 'co-medellin', 'Colombia - Medellín', 'colombia-medellin'),
      ('copa', 'costa-rica-san-jose', 'Costa Rica - San José', 'costa-rica-san-jose'),
      ('copa', 'guatemala-guatemala-city', 'Guatemala - Ciudad de Guatemala', 'guatemala-ciudad-de-guatemala'),
      ('copa', 'global', 'Global', 'global'),
      ('copa', 'puerto-rico-pais', 'Puerto Rico (País)', 'puerto-rico-pais'),
      ('copa', 'paraguay-pais', 'Paraguay (País)', 'paraguay-pais'),
      ('copa', 'trinidad-y-tobago-pais', 'Trinidad y Tobago (País)', 'trinidad-y-tobago-pais'),
      ('copa', 'uruguay-pais', 'Uruguay (País)', 'uruguay-pais'),
      ('copa', 'republica-dominicana-pais', 'República Dominicana (País)', 'republica-dominicana-pais'),
      ('felix', 'california', 'Estados Unidos - California', 'estados-unidos-california'),
      ('felix', 'new-york', 'Estados Unidos - New York', 'estados-unidos-new-york'),
      ('felix', 'new-jersey', 'Estados Unidos - New Jersey', 'estados-unidos-new-jersey'),
      ('felix', 'texas', 'Estados Unidos - Texas', 'estados-unidos-texas'),
      ('felix', 'florida', 'Estados Unidos - Florida', 'estados-unidos-florida'),
      ('felix', 'arizona', 'Estados Unidos - Arizona', 'estados-unidos-arizona'),
      ('felix', 'illinois', 'Estados Unidos - Illinois', 'estados-unidos-illinois'),
      ('felix', 'colorado', 'Estados Unidos - Colorado', 'estados-unidos-colorado'),
      ('felix', 'north-carolina', 'Estados Unidos - North Carolina', 'estados-unidos-north-carolina'),
      ('felix', 'georgia', 'Estados Unidos - Georgia', 'estados-unidos-georgia'),
      ('felix', 'washington', 'Estados Unidos - Washington', 'estados-unidos-washington'),
      ('felix', 'pennsylvania', 'Estados Unidos - Pennsylvania', 'estados-unidos-pennsylvania'),
      ('felix', 'new-mexico', 'Estados Unidos - New Mexico', 'estados-unidos-new-mexico'),
      ('felix', 'estados-unidos-t1', 'Estados Unidos - Varios (T1)', 'estados-unidos-varios-t1'),
      ('felix', 'estados-unidos-t2', 'Estados Unidos - Varios (T2)', 'estados-unidos-varios-t2')
    ),
    plan as (
      select m.id, m.client_id, m.name, m.slug, m.sort_order,
             c.slug as client_slug,
             mp.target_name,
             mp.target_slug,
             (select count(*) from public.media_plan_placements pl where pl.market_id = m.id) as placements
        from public.markets m
        join public.clients c on c.id = m.client_id
        -- Empareja por el slug ACTUAL o por el slug DESTINO: así el plan sigue
        -- reconociendo al mercado después de renombrarlo. Sin esto, la segunda
        -- corrida y la verificación no encontraban nada y reportaban todo como
        -- "no estaba en el plan". Gana siempre el match por slug actual.
        left join lateral (
          select mp.target_name, mp.target_slug
            from market_plan mp
           where mp.client_slug = c.slug
             and (mp.market_slug = m.slug or mp.target_slug = m.slug)
           order by (mp.market_slug = m.slug) desc
           limit 1
        ) mp on true
       where c.slug in ('copa', 'felix')
    ),
    -- Ganador de cada grupo: el que más líneas tiene; a igualdad, el que ya está
    -- bien escrito, y después el de menor sort_order.
    winner as (
      select p.*,
             first_value(p.id) over (
               partition by p.client_id, p.target_slug
               order by p.placements desc,
                        (case when p.name = p.target_name then 0 else 1 end),
                        p.sort_order, p.id
             ) as winner_id
        from plan p
       where p.target_name is not null
    )
  select w.id, w.client_id, w.winner_id, w.target_name, w.target_slug, w.name, w.slug
    from winner w;

  create temporary table _mkt_merge on commit drop as
    select id as loser_id, winner_id from _mkt_plan where id <> winner_id;
  select count(*) into n_merge from _mkt_merge;

  -- 1) FK de las líneas del plan.
  update public.media_plan_placements pl
     set market_id = m.winner_id
    from _mkt_merge m
   where pl.market_id = m.loser_id;
  get diagnostics n_pl = row_count;

  -- 2) FK del histórico de cierres (alimenta los benchmarks del simulador).
  update public.campaign_actual_snapshots s
     set market_id = m.winner_id
    from _mkt_merge m
   where s.market_id = m.loser_id;
  get diagnostics n_cas = row_count;

  -- 3) marketId congelado en los snapshots de versiones. Sin FK.
  update public.media_plan_snapshots s
     set snapshot_json = jsonb_set(
           s.snapshot_json, '{placements}',
           coalesce((
             select jsonb_agg(
                      case when mm.winner_id is not null
                           then jsonb_set(e.p, '{marketId}', to_jsonb(mm.winner_id::text))
                           else e.p end
                      order by e.ord)
               from jsonb_array_elements(s.snapshot_json->'placements') with ordinality as e(p, ord)
               left join _mkt_merge mm on mm.loser_id::text = e.p->>'marketId'
           ), '[]'::jsonb))
   where jsonb_typeof(s.snapshot_json->'placements') = 'array'
     and exists (select 1 from jsonb_array_elements(s.snapshot_json->'placements') e2
                  join _mkt_merge mm2 on mm2.loser_id::text = e2->>'marketId');
  get diagnostics n_snap = row_count;

  -- 4) marketId en los escenarios del simulador. Sin FK: un id muerto revienta
  --    "promover a plan" con violación de FK, y sin transacción alrededor.
  update public.simulator_scenarios sc
     set rows_json = jsonb_set(
           sc.rows_json, '{rows}',
           coalesce((
             select jsonb_agg(
                      case when mm.winner_id is not null
                           then jsonb_set(e.r, '{marketId}', to_jsonb(mm.winner_id::text))
                           else e.r end
                      order by e.ord)
               from jsonb_array_elements(sc.rows_json->'rows') with ordinality as e(r, ord)
               left join _mkt_merge mm on mm.loser_id::text = e.r->>'marketId'
           ), '[]'::jsonb))
   where jsonb_typeof(sc.rows_json->'rows') = 'array'
     and exists (select 1 from jsonb_array_elements(sc.rows_json->'rows') e2
                  join _mkt_merge mm2 on mm2.loser_id::text = e2->>'marketId');
  get diagnostics n_sim = row_count;

  -- 5) Recién ahora se borran los perdedores. Va ANTES del rename porque un
  --    perdedor puede estar ocupando el slug que el ganador necesita.
  delete from public.markets m using _mkt_merge x where m.id = x.loser_id;
  get diagnostics n_del = row_count;

  -- 6) Los ganadores toman su nombre y su slug canónicos.
  update public.markets m
     set name = p.target_name, slug = p.target_slug
    from _mkt_plan p
   where m.id = p.id
     and p.id = p.winner_id
     and (m.name is distinct from p.target_name or m.slug is distinct from p.target_slug);
  get diagnostics n_ren = row_count;

  raise notice 'fusionados: %  ·  líneas repuntadas: %  ·  cierres: %  ·  snapshots de versión: %  ·  escenarios: %  ·  borrados: %  ·  renombrados: %',
    n_merge, n_pl, n_cas, n_snap, n_sim, n_del, n_ren;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 3 — VERIFICACIÓN (correr aparte).
--
-- 3.a — El catálogo después. ESPERADO: todo "ok". Una fila "REVISAR" significa
--       que el rename no entró.
-- ════════════════════════════════════════════════════════════════════════════

with
  market_plan(client_slug, market_slug, target_name, target_slug) as (values
    ('copa', 'costa-rica', 'Costa Rica (País)', 'costa-rica-pais'),
    ('copa', 'panama', 'Panamá (País)', 'panama-pais'),
    ('copa', 'guatemala', 'Guatemala (País)', 'guatemala-pais'),
    ('copa', 'honduras', 'Honduras (País)', 'honduras-pais'),
    ('copa', 'el-salvador', 'El Salvador (País)', 'el-salvador-pais'),
    ('copa', 'nicaragua', 'Nicaragua (País)', 'nicaragua-pais'),
    ('copa', 'mexico', 'México (País)', 'mexico-pais'),
    ('copa', 'argentina', 'Argentina (País)', 'argentina-pais'),
    ('copa', 'brasil', 'Brasil (País)', 'brasil-pais'),
    ('copa', 'chile', 'Chile (País)', 'chile-pais'),
    ('copa', 'colombia', 'Colombia (País)', 'colombia-pais'),
    ('copa', 'peru', 'Perú (País)', 'peru-pais'),
    ('copa', 'centroamerica', 'Centroamérica', 'centroamerica'),
    ('copa', 'latam', 'LATAM', 'latam'),
    ('copa', 'canada-toronto', 'Canadá - Toronto', 'canada-toronto'),
    ('copa', 'panama-panama', 'Panamá - Ciudad de Panamá', 'panama-ciudad-de-panama'),
    ('copa', 'estados-unidos', 'Estados Unidos (País)', 'estados-unidos-pais'),
    ('copa', 'colombia-bogota', 'Colombia - Bogotá', 'colombia-bogota'),
    ('copa', 'peru-lima', 'Perú - Lima', 'peru-lima'),
    ('copa', 'brasil-sao-paulo', 'Brasil - São Paulo', 'brasil-sao-paulo'),
    ('copa', 'estados-unidos-varios', 'Estados Unidos (País)', 'estados-unidos-pais'),
    ('copa', 'colombia-varios', 'Colombia - Varios', 'colombia-varios'),
    ('copa', 'argentina-varios', 'Argentina - Varios', 'argentina-varios'),
    ('copa', 'mexico-guadalajara', 'México - Guadalajara', 'mexico-guadalajara'),
    ('copa', 'mexico-df', 'México - Ciudad de México', 'mexico-ciudad-de-mexico'),
    ('copa', 'mexico-monterrey', 'México - Monterrey', 'mexico-monterrey'),
    ('copa', 'mexico-los-cabos', 'México - Los Cabos', 'mexico-los-cabos'),
    ('copa', 'ecuador-quito', 'Ecuador - Quito', 'ecuador-quito'),
    ('copa', 'argentina-salta', 'Argentina - Salta', 'argentina-salta'),
    ('copa', 'argentina-cordoba', 'Argentina - Córdoba', 'argentina-cordoba'),
    ('copa', 'argentina-mendoza', 'Argentina - Mendoza', 'argentina-mendoza'),
    ('copa', 'argentina-buenos-aires', 'Argentina - Buenos Aires', 'argentina-buenos-aires'),
    ('copa', 'argentina-rosario', 'Argentina - Rosario', 'argentina-rosario'),
    ('copa', 'venezuela', 'Venezuela (País)', 'venezuela-pais'),
    ('copa', 'us-la-joya', 'Estados Unidos - La Jolla', 'estados-unidos-la-jolla'),
    ('copa', 'us-coronado', 'Estados Unidos - Coronado', 'estados-unidos-coronado'),
    ('copa', 'us-encinitas', 'Estados Unidos - Encinitas', 'estados-unidos-encinitas'),
    ('copa', 'us-del-mar', 'Estados Unidos - Del Mar', 'estados-unidos-del-mar'),
    ('copa', 'us-san-diego', 'Estados Unidos - San Diego', 'estados-unidos-san-diego'),
    ('copa', 'co-bogota', 'Colombia - Bogotá', 'colombia-bogota'),
    ('copa', 'co-medellin', 'Colombia - Medellín', 'colombia-medellin'),
    ('copa', 'costa-rica-san-jose', 'Costa Rica - San José', 'costa-rica-san-jose'),
    ('copa', 'guatemala-guatemala-city', 'Guatemala - Ciudad de Guatemala', 'guatemala-ciudad-de-guatemala'),
    ('copa', 'global', 'Global', 'global'),
    ('copa', 'puerto-rico-pais', 'Puerto Rico (País)', 'puerto-rico-pais'),
    ('copa', 'paraguay-pais', 'Paraguay (País)', 'paraguay-pais'),
    ('copa', 'trinidad-y-tobago-pais', 'Trinidad y Tobago (País)', 'trinidad-y-tobago-pais'),
    ('copa', 'uruguay-pais', 'Uruguay (País)', 'uruguay-pais'),
    ('copa', 'republica-dominicana-pais', 'República Dominicana (País)', 'republica-dominicana-pais'),
    ('felix', 'california', 'Estados Unidos - California', 'estados-unidos-california'),
    ('felix', 'new-york', 'Estados Unidos - New York', 'estados-unidos-new-york'),
    ('felix', 'new-jersey', 'Estados Unidos - New Jersey', 'estados-unidos-new-jersey'),
    ('felix', 'texas', 'Estados Unidos - Texas', 'estados-unidos-texas'),
    ('felix', 'florida', 'Estados Unidos - Florida', 'estados-unidos-florida'),
    ('felix', 'arizona', 'Estados Unidos - Arizona', 'estados-unidos-arizona'),
    ('felix', 'illinois', 'Estados Unidos - Illinois', 'estados-unidos-illinois'),
    ('felix', 'colorado', 'Estados Unidos - Colorado', 'estados-unidos-colorado'),
    ('felix', 'north-carolina', 'Estados Unidos - North Carolina', 'estados-unidos-north-carolina'),
    ('felix', 'georgia', 'Estados Unidos - Georgia', 'estados-unidos-georgia'),
    ('felix', 'washington', 'Estados Unidos - Washington', 'estados-unidos-washington'),
    ('felix', 'pennsylvania', 'Estados Unidos - Pennsylvania', 'estados-unidos-pennsylvania'),
    ('felix', 'new-mexico', 'Estados Unidos - New Mexico', 'estados-unidos-new-mexico'),
    ('felix', 'estados-unidos-t1', 'Estados Unidos - Varios (T1)', 'estados-unidos-varios-t1'),
    ('felix', 'estados-unidos-t2', 'Estados Unidos - Varios (T2)', 'estados-unidos-varios-t2')
  ),
  plan as (
    select m.id, m.client_id, m.name, m.slug, m.sort_order,
           c.slug as client_slug,
           mp.target_name,
           mp.target_slug,
           (select count(*) from public.media_plan_placements pl where pl.market_id = m.id) as placements
      from public.markets m
      join public.clients c on c.id = m.client_id
      -- Empareja por el slug ACTUAL o por el slug DESTINO: así el plan sigue
      -- reconociendo al mercado después de renombrarlo. Sin esto, la segunda
      -- corrida y la verificación no encontraban nada y reportaban todo como
      -- "no estaba en el plan". Gana siempre el match por slug actual.
      left join lateral (
        select mp.target_name, mp.target_slug
          from market_plan mp
         where mp.client_slug = c.slug
           and (mp.market_slug = m.slug or mp.target_slug = m.slug)
         order by (mp.market_slug = m.slug) desc
         limit 1
      ) mp on true
     where c.slug in ('copa', 'felix')
  ),
  -- Ganador de cada grupo: el que más líneas tiene; a igualdad, el que ya está
  -- bien escrito, y después el de menor sort_order.
  winner as (
    select p.*,
           first_value(p.id) over (
             partition by p.client_id, p.target_slug
             order by p.placements desc,
                      (case when p.name = p.target_name then 0 else 1 end),
                      p.sort_order, p.id
           ) as winner_id
      from plan p
     where p.target_name is not null
  )
select w.client_slug as cliente,
       w.name        as mercado,
       w.slug,
       case when w.name = w.target_name and w.slug = w.target_slug
            then 'ok' else 'REVISAR' end as estado,
       w.placements  as lineas
  from winner w
union all
select p.client_slug, p.name, p.slug, 'queda (no estaba en el plan)', p.placements
  from plan p where p.target_name is null
 order by 1, 2;

-- ── 3.b — Ningún duplicado. ESPERADO: 0 filas. ─────────────────────────────
-- select c.slug as cliente, m.name, count(*)
--   from public.markets m join public.clients c on c.id = m.client_id
--  group by 1, 2 having count(*) > 1;

-- ── 3.c — No se perdió plata. ESPERADO: mismo total de líneas y monto que
--         antes, y "(sin mercado)" con el MISMO número que tenía. ───────────
-- select coalesce(mk.name, '(sin mercado)') as mercado,
--        count(*) as lineas, sum(pl.amount_usd) as monto_usd
--   from public.media_plan_placements pl
--   join public.media_plan_publishers mpp on mpp.id = pl.media_plan_publisher_id
--   join public.media_plans mp on mp.id = mpp.media_plan_id and mp.deleted_at is null
--   join public.projects pr on pr.id = mp.project_id
--   join public.clients c on c.id = pr.client_id
--   left join public.markets mk on mk.id = pl.market_id
--  group by 1 order by 3 desc nulls last;

-- ── 3.d — Ningún marketId muerto en los JSONB. ESPERADO: 0 filas en las dos. ──
-- select s.id, e->>'marketId' as market_id_muerto
--   from public.media_plan_snapshots s,
--        lateral jsonb_array_elements(s.snapshot_json->'placements') e
--  where jsonb_typeof(s.snapshot_json->'placements') = 'array'
--    and e->>'marketId' is not null
--    and not exists (select 1 from public.markets m where m.id::text = e->>'marketId');

-- select sc.id, e->>'marketId' as market_id_muerto
--   from public.simulator_scenarios sc,
--        lateral jsonb_array_elements(sc.rows_json->'rows') e
--  where jsonb_typeof(sc.rows_json->'rows') = 'array'
--    and e->>'marketId' is not null
--    and not exists (select 1 from public.markets m where m.id::text = e->>'marketId');

-- ── 3.e — Nombres viejos tipeados a mano en texto libre. Ningún SQL de este
--         archivo los alcanza; se revisan a ojo. ───────────────────────────────
-- select pl.id, pl.placement_name, pl.audience
--   from public.media_plan_placements pl
--  where pl.placement_name ilike '%<nombre viejo>%'
--     or pl.audience ilike '%<nombre viejo>%';
