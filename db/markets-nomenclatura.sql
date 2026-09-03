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
-- EL PLAN, en números: 64 mercados en la foto · 47 se renombran · 2 fusiones · 0 sin mapear.
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
--   Bloque 0 → la foto del antes. Anotar los seis números.
--   Bloque 1 → el plan de cambios, read-only. Mirarlo ANTES de tocar nada.
--                Conviene re-correrlo justo antes del bloque 2: si alguien
--                cargó un mercado en el medio, aparece como "NO ESTABA EN EL
--                PLAN" (no se toca) y se ve antes de aplicar.
--   Bloque 2 → aplica. Un solo statement, todo o nada. Tiene que imprimir en
--                Messages: fusionados 2 · líneas repuntadas 11 · cierres 194 ·
--                borrados 2 · renombrados 47. Otro número: frenar y avisar.
--   Bloque 3 → el control (en su propio Run: el SQL Editor muestra sólo el
--                resultado del último statement).
--
--   Cada bloque va en un Run SEPARADO. Pegar el archivo entero de una aplica
--   el bloque 2 sin que llegues a mirar el dry-run.
--
-- OJO:
--   · Cada bloque es UN solo statement y se banca solo: el slug destino viene
--     ya calculado en el plan, así que no hay que crear ninguna función antes.
--   · NO hay pre-imagen: la fusión es irreversible y el audit_log no sirve
--     para restaurarla (lo escriben las server actions, no la base). Si querés
--     red, sacá una copia ANTES — en un schema aparte, NO en `public`, que
--     Supabase expone entero por PostgREST (ver db/rls.sql):
--       create schema if not exists bkp;
--       create table bkp.markets_20260903            as select * from public.markets;
--       create table bkp.placements_20260903         as select id, market_id from public.media_plan_placements;
--       create table bkp.cierres_20260903            as select id, market_id from public.campaign_actual_snapshots;
--       create table bkp.plan_snapshots_20260903     as select id, snapshot_json from public.media_plan_snapshots;
--       create table bkp.escenarios_20260903         as select id, rows_json from public.simulator_scenarios;
--   · Los benchmarks del simulador SE MUEVEN: al fusionar, "Estados Unidos
--     (País)" pasa de 95 a 289 cierres, así que un escenario guardado va a
--     cotizar distinto. Es la consecuencia buscada de la fusión, no un bug.
--   · Los links guardados con `?mkt=<uuid>` de los dos mercados que
--     desaparecen dejan de filtrar (la vista sale vacía).
--   · Correr por SQL NO deja rastro en `audit_log`.
--   · Los snapshots de versiones resuelven el nombre contra el catálogo de HOY:
--     un PDF de una versión firmada, regenerado, va a decir el nombre nuevo.
--     Es lo que ya pasaba con cualquier renombre desde la UI.
--   · Ninguna de las dos columnas market_id tiene índice: el bloque 2 hace seq
--     scan. Con estos volúmenes es instantáneo (ver db/fk-indexes.sql).
--
-- COMPAÑERO EN CÓDIGO — DEPLOYAR PRIMERO, no es indistinto:
--   lib/market-nomenclature.ts (taxonomía), components/market-picker.tsx (el
--   alta ya no es texto libre) y lib/market-geo.ts (geocoding de las formas
--   nuevas). Si el SQL corre ANTES del deploy, el geocoding viejo no reconoce
--   los slugs nuevos y los dos tiers de Félix —"Estados Unidos - Varios (T1)"
--   y "(T2)", USD 1,4M— colapsan en la MISMA burbuja sobre el centroide de
--   EE.UU., y los mercados "<País> (País)" de Copa pierden el nivel país (azul
--   → bordó). Nada se rompe ni se pierde, pero el mapa que ve el cliente en su
--   portal queda mal hasta el deploy.
--   Al revés no hay problema: deployar sin correr el SQL deja la app andando
--   con los nombres viejos, y el form ya no deja crear duplicados nuevos.
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 0 — FOTO ANTES (read-only). Correlo ANTES del bloque 2 y anotá los
-- seis números: son contra lo que compara el control del bloque 3.
--
-- Los cinco de líneas y cierres TIENEN que quedar idénticos después — la
-- migración reapunta, nunca crea ni borra una línea, y nunca deja una
-- huérfana. "mercados" es el único que baja, por las fusiones.
-- ════════════════════════════════════════════════════════════════════════════

select 'mercados'              as control, count(*)::text                    as valor
  from public.markets m join public.clients c on c.id = m.client_id
 where c.slug in ('copa', 'felix')
union all select 'líneas de plan',       count(*)::text                      from public.media_plan_placements
union all select 'líneas SIN mercado',   count(*)::text                      from public.media_plan_placements where market_id is null
union all select 'monto de las líneas',  coalesce(sum(amount_usd), 0)::text  from public.media_plan_placements
union all select 'cierres',              count(*)::text                      from public.campaign_actual_snapshots
union all select 'cierres SIN mercado',  count(*)::text                      from public.campaign_actual_snapshots where market_id is null;

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
  -- Cierra la ventana de carrera: entre el repunte y el delete, una línea que
  -- alguien guarde contra un mercado condenado quedaría con market_id NULL en
  -- silencio (el FK es ON DELETE SET NULL). Con el lock ese insert espera y
  -- después falla con violación de FK — un error visible que se reintenta, en
  -- vez de una línea sin mercado que nadie ve. NO bloquea las lecturas.
  lock table public.markets,
             public.media_plan_placements,
             public.campaign_actual_snapshots,
             public.media_plan_snapshots,
             public.simulator_scenarios
    in share row exclusive mode;

  -- Por si el bloque se pega dos veces en el mismo Run del SQL Editor: sin
  -- esto la segunda copia revienta con 'relation "_mkt_plan" already exists'.
  -- El client_min_messages es para que el "does not exist, skipping" no tape
  -- el resumen que importa, que es el raise notice del final.
  set local client_min_messages = warning;
  drop table if exists _mkt_plan;
  drop table if exists _mkt_merge;
  set local client_min_messages = notice;

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
-- BLOQUE 3 — CONTROL (correr después del bloque 2, en su propio Run).
--
-- Una fila por control. Los cinco primeros se juzgan solos: `ok` está bien,
-- `REVISAR` hay que mirarlo antes de dar la migración por buena. Los cinco
-- siguientes dicen `comparar`: se contrastan a ojo contra los números que
-- anotaste del BLOQUE 0, y tienen que dar IDÉNTICOS.
--
-- Antes esto eran cinco queries comentadas, así que pegar el bloque corría
-- sólo la primera — la única que NO ve ni una línea sin mercado ni un
-- marketId muerto, que es justo lo que esta migración puede romper en
-- silencio.
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
select control, valor, estado from (
  select 1 as ord,
         'mercados que no quedaron canónicos'                as control,
         count(*)::text                                      as valor,
         case when count(*) = 0 then 'ok' else 'REVISAR' end as estado
    from winner w
   where w.name is distinct from w.target_name
      or w.slug is distinct from w.target_slug
  union all
  select 2, 'mercados que no estaban en el plan', count(*)::text,
         case when count(*) = 0 then 'ok' else 'REVISAR' end
    from plan p where p.target_name is null
  union all
  select 3, 'nombres repetidos dentro de un cliente', count(*)::text,
         case when count(*) = 0 then 'ok' else 'REVISAR' end
    from (select 1 from public.markets m
           group by m.client_id, m.name having count(*) > 1) d
  union all
  select 4, 'marketId muertos en snapshots de versión', count(*)::text,
         case when count(*) = 0 then 'ok' else 'REVISAR' end
    from public.media_plan_snapshots s,
         lateral jsonb_array_elements(s.snapshot_json->'placements') e
   where jsonb_typeof(s.snapshot_json->'placements') = 'array'
     and jsonb_typeof(e) = 'object'
     and e->>'marketId' is not null
     and not exists (select 1 from public.markets m where m.id::text = e->>'marketId')
  union all
  select 5, 'marketId muertos en el simulador', count(*)::text,
         case when count(*) = 0 then 'ok' else 'REVISAR' end
    from public.simulator_scenarios sc,
         lateral jsonb_array_elements(sc.rows_json->'rows') e
   where jsonb_typeof(sc.rows_json->'rows') = 'array'
     and jsonb_typeof(e) = 'object'
     and e->>'marketId' is not null
     and not exists (select 1 from public.markets m where m.id::text = e->>'marketId')
  union all
  select 6,  'líneas de plan',      count(*)::text,                     'comparar' from public.media_plan_placements
  union all
  select 7,  'líneas SIN mercado',  count(*)::text,                     'comparar' from public.media_plan_placements where market_id is null
  union all
  select 8,  'monto de las líneas', coalesce(sum(amount_usd), 0)::text, 'comparar' from public.media_plan_placements
  union all
  select 9,  'cierres',             count(*)::text,                     'comparar' from public.campaign_actual_snapshots
  union all
  select 10, 'cierres SIN mercado', count(*)::text,                     'comparar' from public.campaign_actual_snapshots where market_id is null
  union all
  select 11, 'mercados en el catálogo', count(*)::text, 'esperado 62'
    from public.markets m join public.clients c on c.id = m.client_id
   where c.slug in ('copa', 'felix')
) x order by ord;

-- ── Nombres viejos tipeados A MANO en texto libre. Ningún SQL de este archivo
--    los alcanza: se revisan a ojo, reemplazando <nombre viejo>. ─────────────
-- select 'placement' as donde, pl.id::text as id, pl.placement_name as texto
--   from public.media_plan_placements pl
--  where pl.placement_name ilike '%<nombre viejo>%'
--     or pl.audience ilike '%<nombre viejo>%'
--     or pl.notes_md ilike '%<nombre viejo>%'
-- union all
-- select 'hoja auxiliar', a.id::text, a.grid_json::text
--   from public.media_plan_aux_sheets a
--  where a.grid_json::text ilike '%<nombre viejo>%';
