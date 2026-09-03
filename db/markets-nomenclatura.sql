-- ════════════════════════════════════════════════════════════════════════════
-- Nomenclatura única de MERCADOS — normalizar el catálogo de todos los
-- clientes y fusionar los duplicados sin perder una sola línea de plan.
--
--   ⚠️  ARCHIVO GENERADO. No editar a mano: sale de
--       lib/market-nomenclature.ts vía `npm run gen:markets-sql`.
--
-- EL PROBLEMA:
--   `markets` es per-cliente y el nombre se tipeaba libre, así que el mismo
--   lugar entró varias veces con distinta escritura ("Panama" / "Panamá" /
--   "Panama City" / "Ciudad de Panamá" son cuatro mercados distintos, cada uno
--   con sus líneas). El Análisis los cuenta separados, el dropdown del editor
--   muestra repetidos y los benchmarks del simulador quedan partidos.
--
-- LA REGLA (la misma para TODOS los clientes — ver lib/market-nomenclature.ts):
--   el país entero      → "<País> (País)"       ej. Argentina (País)
--   una plaza           → "<País> - <Plaza>"    ej. México - Ciudad de México
--   varias plazas       → "<País> - Varios"     ej. Argentina - Varios
--     (con etiqueta, si hay más de un grupo en el mismo país:
--      "Estados Unidos - Varios (T1)" — los tiers de Félix)
--   una región          → "<Región>"            ej. Centroamérica · LATAM
--
-- QUÉ HACE, en orden:
--   1. Calcula el nombre canónico de cada mercado con los mismos diccionarios
--      que usa la app.
--   2. Donde dos o más mercados del MISMO cliente canonizan al mismo slug,
--      elige un ganador y repunta al ganador TODO lo que apunta a los otros:
--        · media_plan_placements.market_id      (FK)
--        · campaign_actual_snapshots.market_id  (FK)
--        · media_plan_snapshots.snapshot_json → placements[].marketId  (JSONB)
--        · simulator_scenarios.rows_json → rows[].marketId             (JSONB)
--      y recién ahí borra a los perdedores.
--   3. Renombra y re-sluggea a los ganadores.
--
--   Es IDEMPOTENTE: en la segunda corrida no hay grupos con más de uno y los
--   renames son no-ops.
--
--   Las decisiones que el diccionario NO puede tomar (dos formas válidas de la
--   taxonomía que en la práctica se usaban para lo mismo) van en la tabla
--   `market_override` del bloque 1/2, con su porqué en
--   scripts/gen-markets-sql.ts. Salen marcadas "decisión manual" en el dry-run.
--
--   Lo que NO puede mapear con certeza NO SE TOCA y sale listado en el bloque
--   1 como "SIN MAPEAR" (ej. "Santiago" a secas: puede ser Chile o República
--   Dominicana; lo desambigua una persona desde el form).
--
-- CÓMO APLICAR:
--   Bloque 0 → mirás el catálogo actual.
--   Bloque 1 → mirás el plan de cambios ANTES de tocar nada. Es read-only.
--   Bloque 2 → aplica. Un solo statement (`do $$ … $$`), todo o nada.
--   Bloque 3 → verificación.
--
-- OJO:
--   • Correr por SQL NO deja rastro en `audit_log` (lo escriben las server
--     actions, no la base).
--   • Los snapshots de versiones aprobadas resuelven el nombre del mercado
--     contra el catálogo de HOY: un PDF de una versión vieja que se regenere
--     va a decir el nombre nuevo. Es el comportamiento que ya existía con
--     cualquier rename desde la UI.
--   • `media_plan_placements.market_id` y `campaign_actual_snapshots.market_id`
--     NO tienen índice: el bloque 2 hace seq scan. Con los volúmenes actuales
--     es instantáneo, pero conviene correrlo fuera de hora pico (ver el
--     incidente de db/fk-indexes.sql).
--
-- COMPAÑERO EN CÓDIGO (mismo PR, deploy y SQL son independientes):
--   · lib/market-nomenclature.ts — la taxonomía y los diccionarios.
--   · components/market-picker.tsx — el alta/edición ya no es texto libre.
--   · lib/market-geo.ts — geocoding de las formas nuevas.
--   Si se deploya el código SIN correr este SQL: la app anda igual, sigue
--   mostrando los duplicados viejos y el form ya no deja crear nuevos.
--   Si se corre el SQL SIN deployar: el catálogo queda limpio, pero
--   "Argentina (País)" cae en el mapa como ciudad (bordó) hasta el deploy.
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 0 — DIAGNÓSTICO (read-only). Qué hay hoy y cuánto pesa cada mercado.
-- ════════════════════════════════════════════════════════════════════════════

select c.slug                                                as cliente,
       m.name                                                as mercado,
       m.slug,
       m.enabled,
       m.sort_order,
       (select count(*) from public.media_plan_placements pl
         where pl.market_id = m.id)                          as lineas,
       (select coalesce(sum(pl.amount_usd), 0) from public.media_plan_placements pl
         where pl.market_id = m.id)                          as monto_usd,
       (select count(*) from public.campaign_actual_snapshots s
         where s.market_id = m.id)                           as cierres
  from public.markets m
  join public.clients c on c.id = m.client_id
 order by c.slug, m.sort_order, m.name;

-- ────────────────────────────────────────────────────────────────────────────
-- norm(): la MISMA normalización que `slugify` en app/actions/markets.ts y
-- `norm` en lib/market-nomenclature.ts — minúsculas, sin tildes, todo lo no
-- alfanumérico a "-". Es lo que hace que "Panamá" y "panama" tengan la misma
-- clave. Se crea como función para no repetirla en cada bloque; es inmutable y
-- no toca datos, así que se puede dejar creada.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.norm(v text) returns text
  language sql immutable strict parallel safe
as $fn$
  select regexp_replace(
          regexp_replace(
            lower(translate(v, 'ÁÀÂÄÃÅáàâäãåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÖÕóòôöõÚÙÛÜúùûüÝýÑñÇç', 'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuYyNnCc')),
            '[^a-z0-9]+', '-', 'g'),
          '^-+|-+$', '', 'g')
$fn$;

-- ────────────────────────────────────────────────────────────────────────────
-- market_canonical_name(): el nombre canónico de un mercado, o NULL si no se
-- puede mapear con certeza. Es la MISMA lógica que `canonicalMarketName` en
-- lib/market-nomenclature.ts, con los mismos diccionarios — este archivo se
-- genera desde ahí justamente para que no puedan divergir.
--
-- Diferencia deliberada: cuando el país se reconoce pero la plaza no está en el
-- diccionario, el TS igual arma "País - Plaza"; acá devuelve NULL. Una
-- migración no inventa nombres: los deja quietos y los lista.
--
-- Es `immutable` y no toca datos. Se puede dejar creada, o borrarla al final:
--   drop function public.market_canonical_name(text);
--   drop function public.norm(text);
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.market_canonical_name(v text)
  returns text language sql immutable parallel safe
as $fn$
with
  k(key) as (select public.norm(v)),
  country_alias(alias, country) as (values
    ('abw', 'Aruba'),
    ('ar', 'Argentina'),
    ('arg', 'Argentina'),
    ('argentina', 'Argentina'),
    ('aruba', 'Aruba'),
    ('aw', 'Aruba'),
    ('bahamas', 'Bahamas'),
    ('barbados', 'Barbados'),
    ('bb', 'Barbados'),
    ('belice', 'Belice'),
    ('belize', 'Belice'),
    ('bhs', 'Bahamas'),
    ('blz', 'Belice'),
    ('bo', 'Bolivia'),
    ('bol', 'Bolivia'),
    ('bolivia', 'Bolivia'),
    ('br', 'Brasil'),
    ('bra', 'Brasil'),
    ('brasil', 'Brasil'),
    ('brazil', 'Brasil'),
    ('brb', 'Barbados'),
    ('bs', 'Bahamas'),
    ('bz', 'Belice'),
    ('ca', 'Canadá'),
    ('can', 'Canadá'),
    ('canada', 'Canadá'),
    ('chile', 'Chile'),
    ('chl', 'Chile'),
    ('cl', 'Chile'),
    ('co', 'Colombia'),
    ('col', 'Colombia'),
    ('colombia', 'Colombia'),
    ('costa-rica', 'Costa Rica'),
    ('cr', 'Costa Rica'),
    ('cri', 'Costa Rica'),
    ('cu', 'Cuba'),
    ('cub', 'Cuba'),
    ('cuba', 'Cuba'),
    ('curacao', 'Curazao'),
    ('curazao', 'Curazao'),
    ('cuw', 'Curazao'),
    ('cw', 'Curazao'),
    ('do', 'República Dominicana'),
    ('dom', 'República Dominicana'),
    ('dominican-republic', 'República Dominicana'),
    ('dominicana', 'República Dominicana'),
    ('ec', 'Ecuador'),
    ('ecu', 'Ecuador'),
    ('ecuador', 'Ecuador'),
    ('ee-uu', 'Estados Unidos'),
    ('eeuu', 'Estados Unidos'),
    ('el-salvador', 'El Salvador'),
    ('estados-unidos', 'Estados Unidos'),
    ('estados-unidos-de-america', 'Estados Unidos'),
    ('gt', 'Guatemala'),
    ('gtm', 'Guatemala'),
    ('guatemala', 'Guatemala'),
    ('guy', 'Guyana'),
    ('guyana', 'Guyana'),
    ('gy', 'Guyana'),
    ('haiti', 'Haití'),
    ('hn', 'Honduras'),
    ('hnd', 'Honduras'),
    ('honduras', 'Honduras'),
    ('ht', 'Haití'),
    ('hti', 'Haití'),
    ('jam', 'Jamaica'),
    ('jamaica', 'Jamaica'),
    ('jm', 'Jamaica'),
    ('mejico', 'México'),
    ('mex', 'México'),
    ('mexico', 'México'),
    ('mx', 'México'),
    ('ni', 'Nicaragua'),
    ('nic', 'Nicaragua'),
    ('nicaragua', 'Nicaragua'),
    ('norteamerica-usa', 'Estados Unidos'),
    ('pa', 'Panamá'),
    ('pan', 'Panamá'),
    ('panama', 'Panamá'),
    ('paraguay', 'Paraguay'),
    ('pe', 'Perú'),
    ('per', 'Perú'),
    ('peru', 'Perú'),
    ('pr', 'Puerto Rico'),
    ('pri', 'Puerto Rico'),
    ('pry', 'Paraguay'),
    ('puerto-rico', 'Puerto Rico'),
    ('py', 'Paraguay'),
    ('rd', 'República Dominicana'),
    ('rep-dominicana', 'República Dominicana'),
    ('republica-dominicana', 'República Dominicana'),
    ('salvador', 'El Salvador'),
    ('slv', 'El Salvador'),
    ('sr', 'Surinam'),
    ('sur', 'Surinam'),
    ('surinam', 'Surinam'),
    ('suriname', 'Surinam'),
    ('sv', 'El Salvador'),
    ('the-bahamas', 'Bahamas'),
    ('trinidad', 'Trinidad y Tobago'),
    ('trinidad-and-tobago', 'Trinidad y Tobago'),
    ('trinidad-tobago', 'Trinidad y Tobago'),
    ('trinidad-y-tobago', 'Trinidad y Tobago'),
    ('tt', 'Trinidad y Tobago'),
    ('tto', 'Trinidad y Tobago'),
    ('u-s', 'Estados Unidos'),
    ('u-s-a', 'Estados Unidos'),
    ('united-states', 'Estados Unidos'),
    ('united-states-of-america', 'Estados Unidos'),
    ('uruguay', 'Uruguay'),
    ('ury', 'Uruguay'),
    ('us', 'Estados Unidos'),
    ('usa', 'Estados Unidos'),
    ('uy', 'Uruguay'),
    ('ve', 'Venezuela'),
    ('ven', 'Venezuela'),
    ('venezuela', 'Venezuela')
  ),
  place_alias(alias, place, country, ambiguous) as (values
    ('aep', 'Buenos Aires', 'Argentina', false),
    ('alabama', 'Alabama', 'Estados Unidos', false),
    ('alaska', 'Alaska', 'Estados Unidos', false),
    ('arizona', 'Arizona', 'Estados Unidos', false),
    ('arkansas', 'Arkansas', 'Estados Unidos', false),
    ('armenia', 'Armenia', 'Colombia', true),
    ('asu', 'Asunción', 'Paraguay', false),
    ('asuncion', 'Asunción', 'Paraguay', false),
    ('atl', 'Atlanta', 'Estados Unidos', false),
    ('atlanta', 'Atlanta', 'Estados Unidos', false),
    ('aua', 'Oranjestad', 'Aruba', false),
    ('aus', 'Austin', 'Estados Unidos', false),
    ('austin', 'Austin', 'Estados Unidos', false),
    ('axm', 'Armenia', 'Colombia', true),
    ('baltimore', 'Baltimore', 'Estados Unidos', false),
    ('baq', 'Barranquilla', 'Colombia', false),
    ('barranquilla', 'Barranquilla', 'Colombia', false),
    ('belize-city', 'Ciudad de Belice', 'Belice', false),
    ('belo-horizonte', 'Belo Horizonte', 'Brasil', false),
    ('bga', 'Bucaramanga', 'Colombia', false),
    ('bgi', 'Bridgetown', 'Barbados', false),
    ('boc', 'Bocas del Toro', 'Panamá', false),
    ('bocas-del-toro', 'Bocas del Toro', 'Panamá', false),
    ('bog', 'Bogotá', 'Colombia', false),
    ('bogota', 'Bogotá', 'Colombia', false),
    ('bos', 'Boston', 'Estados Unidos', false),
    ('boston', 'Boston', 'Estados Unidos', false),
    ('brasilia', 'Brasilia', 'Brasil', false),
    ('bridgetown', 'Bridgetown', 'Barbados', false),
    ('bs-as', 'Buenos Aires', 'Argentina', false),
    ('bsas', 'Buenos Aires', 'Argentina', false),
    ('bsb', 'Brasilia', 'Brasil', false),
    ('bucaramanga', 'Bucaramanga', 'Colombia', false),
    ('buenos-aires', 'Buenos Aires', 'Argentina', false),
    ('bwi', 'Baltimore', 'Estados Unidos', false),
    ('bze', 'Ciudad de Belice', 'Belice', false),
    ('caba', 'Buenos Aires', 'Argentina', false),
    ('cabo-san-lucas', 'Los Cabos', 'México', false),
    ('cali', 'Cali', 'Colombia', false),
    ('california', 'California', 'Estados Unidos', false),
    ('cancun', 'Cancún', 'México', false),
    ('capital-federal', 'Buenos Aires', 'Argentina', false),
    ('caracas', 'Caracas', 'Venezuela', false),
    ('carolina-del-norte', 'North Carolina', 'Estados Unidos', false),
    ('carolina-del-sur', 'South Carolina', 'Estados Unidos', false),
    ('cartagena', 'Cartagena', 'Colombia', false),
    ('cbb', 'Cochabamba', 'Bolivia', false),
    ('ccs', 'Caracas', 'Venezuela', false),
    ('cd-de-panama', 'Ciudad de Panamá', 'Panamá', false),
    ('cdad-de-panama', 'Ciudad de Panamá', 'Panamá', false),
    ('cdmx', 'Ciudad de México', 'México', false),
    ('chicago', 'Chicago', 'Estados Unidos', false),
    ('ciudad-de-belice', 'Ciudad de Belice', 'Belice', false),
    ('ciudad-de-guatemala', 'Ciudad de Guatemala', 'Guatemala', false),
    ('ciudad-de-mexico', 'Ciudad de México', 'México', false),
    ('ciudad-de-panama', 'Ciudad de Panamá', 'Panamá', false),
    ('clo', 'Cali', 'Colombia', false),
    ('cnf', 'Belo Horizonte', 'Brasil', false),
    ('cochabamba', 'Cochabamba', 'Bolivia', false),
    ('colon', 'Colón', 'Panamá', true),
    ('colorado', 'Colorado', 'Estados Unidos', false),
    ('connecticut', 'Connecticut', 'Estados Unidos', false),
    ('cor', 'Córdoba', 'Argentina', true),
    ('cordoba', 'Córdoba', 'Argentina', true),
    ('coronado', 'Coronado', 'Estados Unidos', false),
    ('ctg', 'Cartagena', 'Colombia', false),
    ('cuc', 'Cúcuta', 'Colombia', false),
    ('cucuta', 'Cúcuta', 'Colombia', false),
    ('cun', 'Cancún', 'México', false),
    ('cur', 'Willemstad', 'Curazao', false),
    ('curitiba', 'Curitiba', 'Brasil', false),
    ('cusco', 'Cusco', 'Perú', false),
    ('cuz', 'Cusco', 'Perú', false),
    ('cuzco', 'Cusco', 'Perú', false),
    ('cwb', 'Curitiba', 'Brasil', false),
    ('dakota-del-norte', 'North Dakota', 'Estados Unidos', false),
    ('dakota-del-sur', 'South Dakota', 'Estados Unidos', false),
    ('dallas', 'Dallas', 'Estados Unidos', false),
    ('david', 'David', 'Panamá', true),
    ('dca', 'Washington D.C.', 'Estados Unidos', false),
    ('del-mar', 'Del Mar', 'Estados Unidos', false),
    ('delaware', 'Delaware', 'Estados Unidos', false),
    ('den', 'Denver', 'Estados Unidos', false),
    ('denver', 'Denver', 'Estados Unidos', false),
    ('detroit', 'Detroit', 'Estados Unidos', false),
    ('df', 'Ciudad de México', 'México', false),
    ('dfw', 'Dallas', 'Estados Unidos', false),
    ('distrito-federal', 'Ciudad de México', 'México', false),
    ('dtw', 'Detroit', 'Estados Unidos', false),
    ('encinitas', 'Encinitas', 'Estados Unidos', false),
    ('eze', 'Buenos Aires', 'Argentina', false),
    ('filadelfia', 'Filadelfia', 'Estados Unidos', false),
    ('fll', 'Fort Lauderdale', 'Estados Unidos', false),
    ('florida', 'Florida', 'Estados Unidos', false),
    ('for', 'Fortaleza', 'Brasil', false),
    ('fort-lauderdale', 'Fort Lauderdale', 'Estados Unidos', false),
    ('fortaleza', 'Fortaleza', 'Brasil', false),
    ('gdl', 'Guadalajara', 'México', false),
    ('geo', 'Georgetown', 'Guyana', true),
    ('georgetown', 'Georgetown', 'Guyana', true),
    ('georgia', 'Georgia', 'Estados Unidos', false),
    ('gig', 'Río de Janeiro', 'Brasil', false),
    ('gru', 'São Paulo', 'Brasil', false),
    ('gua', 'Ciudad de Guatemala', 'Guatemala', false),
    ('guadalajara', 'Guadalajara', 'México', false),
    ('guate', 'Ciudad de Guatemala', 'Guatemala', false),
    ('guatemala-city', 'Ciudad de Guatemala', 'Guatemala', false),
    ('guayaquil', 'Guayaquil', 'Ecuador', false),
    ('gye', 'Guayaquil', 'Ecuador', false),
    ('habana', 'La Habana', 'Cuba', false),
    ('hav', 'La Habana', 'Cuba', false),
    ('havana', 'La Habana', 'Cuba', false),
    ('hawai', 'Hawaii', 'Estados Unidos', false),
    ('hawaii', 'Hawaii', 'Estados Unidos', false),
    ('houston', 'Houston', 'Estados Unidos', false),
    ('huatulco', 'Huatulco', 'México', false),
    ('hux', 'Huatulco', 'México', false),
    ('iad', 'Washington D.C.', 'Estados Unidos', false),
    ('iah', 'Houston', 'Estados Unidos', false),
    ('idaho', 'Idaho', 'Estados Unidos', false),
    ('illinois', 'Illinois', 'Estados Unidos', false),
    ('indiana', 'Indiana', 'Estados Unidos', false),
    ('iowa', 'Iowa', 'Estados Unidos', false),
    ('kansas', 'Kansas', 'Estados Unidos', false),
    ('kansas-city', 'Kansas City', 'Estados Unidos', false),
    ('kentucky', 'Kentucky', 'Estados Unidos', false),
    ('kin', 'Kingston', 'Jamaica', false),
    ('kingston', 'Kingston', 'Jamaica', false),
    ('la-habana', 'La Habana', 'Cuba', false),
    ('la-jolla', 'La Jolla', 'Estados Unidos', false),
    ('la-joya', 'La Jolla', 'Estados Unidos', false),
    ('la-paz', 'La Paz', 'Bolivia', false),
    ('las', 'Las Vegas', 'Estados Unidos', false),
    ('las-vegas', 'Las Vegas', 'Estados Unidos', false),
    ('lax', 'Los Angeles', 'Estados Unidos', false),
    ('liberia', 'Liberia', 'Costa Rica', true),
    ('lim', 'Lima', 'Perú', false),
    ('lima', 'Lima', 'Perú', false),
    ('lir', 'Liberia', 'Costa Rica', true),
    ('los-angeles', 'Los Angeles', 'Estados Unidos', false),
    ('los-cabos', 'Los Cabos', 'México', false),
    ('louisiana', 'Louisiana', 'Estados Unidos', false),
    ('lpb', 'La Paz', 'Bolivia', false),
    ('luisiana', 'Louisiana', 'Estados Unidos', false),
    ('maine', 'Maine', 'Estados Unidos', false),
    ('managua', 'Managua', 'Nicaragua', false),
    ('manaos', 'Manaos', 'Brasil', false),
    ('manaus', 'Manaos', 'Brasil', false),
    ('mao', 'Manaos', 'Brasil', false),
    ('mar', 'Maracaibo', 'Venezuela', false),
    ('maracaibo', 'Maracaibo', 'Venezuela', false),
    ('maryland', 'Maryland', 'Estados Unidos', false),
    ('massachusetts', 'Massachusetts', 'Estados Unidos', false),
    ('mbj', 'Montego Bay', 'Jamaica', false),
    ('mci', 'Kansas City', 'Estados Unidos', false),
    ('mco', 'Orlando', 'Estados Unidos', false),
    ('mde', 'Medellín', 'Colombia', false),
    ('mdz', 'Mendoza', 'Argentina', false),
    ('medellin', 'Medellín', 'Colombia', false),
    ('mendoza', 'Mendoza', 'Argentina', false),
    ('merida', 'Mérida', 'México', false),
    ('mex-city', 'Ciudad de México', 'México', false),
    ('mexico-city', 'Ciudad de México', 'México', false),
    ('mexico-df', 'Ciudad de México', 'México', false),
    ('mga', 'Managua', 'Nicaragua', false),
    ('mia', 'Miami', 'Estados Unidos', false),
    ('miami', 'Miami', 'Estados Unidos', false),
    ('michigan', 'Michigan', 'Estados Unidos', false),
    ('mid', 'Mérida', 'México', false),
    ('minnesota', 'Minnesota', 'Estados Unidos', false),
    ('mississippi', 'Mississippi', 'Estados Unidos', false),
    ('missouri', 'Missouri', 'Estados Unidos', false),
    ('montana', 'Montana', 'Estados Unidos', false),
    ('montego-bay', 'Montego Bay', 'Jamaica', false),
    ('monteria', 'Montería', 'Colombia', false),
    ('monterrey', 'Monterrey', 'México', false),
    ('montevideo', 'Montevideo', 'Uruguay', false),
    ('montreal', 'Montreal', 'Canadá', false),
    ('msy', 'Nueva Orleans', 'Estados Unidos', false),
    ('mtr', 'Montería', 'Colombia', false),
    ('mty', 'Monterrey', 'México', false),
    ('mvd', 'Montevideo', 'Uruguay', false),
    ('nas', 'Nassau', 'Bahamas', false),
    ('nassau', 'Nassau', 'Bahamas', false),
    ('nebraska', 'Nebraska', 'Estados Unidos', false),
    ('nevada', 'Nevada', 'Estados Unidos', false),
    ('new-hampshire', 'New Hampshire', 'Estados Unidos', false),
    ('new-jersey', 'New Jersey', 'Estados Unidos', false),
    ('new-mexico', 'New Mexico', 'Estados Unidos', false),
    ('new-orleans', 'Nueva Orleans', 'Estados Unidos', false),
    ('new-york', 'New York', 'Estados Unidos', false),
    ('north-carolina', 'North Carolina', 'Estados Unidos', false),
    ('north-dakota', 'North Dakota', 'Estados Unidos', false),
    ('nueva-jersey', 'New Jersey', 'Estados Unidos', false),
    ('nueva-orleans', 'Nueva Orleans', 'Estados Unidos', false),
    ('nueva-york', 'New York', 'Estados Unidos', false),
    ('nuevo-hampshire', 'New Hampshire', 'Estados Unidos', false),
    ('nuevo-mexico', 'New Mexico', 'Estados Unidos', false),
    ('ohio', 'Ohio', 'Estados Unidos', false),
    ('oklahoma', 'Oklahoma', 'Estados Unidos', false),
    ('oranjestad', 'Oranjestad', 'Aruba', false),
    ('ord', 'Chicago', 'Estados Unidos', false),
    ('oregon', 'Oregon', 'Estados Unidos', false),
    ('orlando', 'Orlando', 'Estados Unidos', false),
    ('panama-city', 'Ciudad de Panamá', 'Panamá', false),
    ('pap', 'Puerto Príncipe', 'Haití', false),
    ('paramaribo', 'Paramaribo', 'Surinam', false),
    ('pbm', 'Paramaribo', 'Surinam', false),
    ('pei', 'Pereira', 'Colombia', false),
    ('pennsylvania', 'Pennsylvania', 'Estados Unidos', false),
    ('pensilvania', 'Pennsylvania', 'Estados Unidos', false),
    ('pereira', 'Pereira', 'Colombia', false),
    ('philadelphia', 'Filadelfia', 'Estados Unidos', false),
    ('phl', 'Filadelfia', 'Estados Unidos', false),
    ('phoenix', 'Phoenix', 'Estados Unidos', false),
    ('phx', 'Phoenix', 'Estados Unidos', false),
    ('poa', 'Porto Alegre', 'Brasil', false),
    ('port-au-prince', 'Puerto Príncipe', 'Haití', false),
    ('port-of-spain', 'Puerto España', 'Trinidad y Tobago', false),
    ('porto-alegre', 'Porto Alegre', 'Brasil', false),
    ('pos', 'Puerto España', 'Trinidad y Tobago', false),
    ('pty', 'Ciudad de Panamá', 'Panamá', false),
    ('puebla', 'Puebla', 'México', false),
    ('puerto-espana', 'Puerto España', 'Trinidad y Tobago', false),
    ('puerto-principe', 'Puerto Príncipe', 'Haití', false),
    ('puerto-vallarta', 'Puerto Vallarta', 'México', false),
    ('puj', 'Punta Cana', 'República Dominicana', false),
    ('punta-cana', 'Punta Cana', 'República Dominicana', false),
    ('pvr', 'Puerto Vallarta', 'México', false),
    ('qro', 'Querétaro', 'México', false),
    ('queretaro', 'Querétaro', 'México', false),
    ('quito', 'Quito', 'Ecuador', false),
    ('raleigh', 'Raleigh', 'Estados Unidos', false),
    ('raleigh-durham', 'Raleigh', 'Estados Unidos', false),
    ('rdu', 'Raleigh', 'Estados Unidos', false),
    ('rec', 'Recife', 'Brasil', false),
    ('recife', 'Recife', 'Brasil', false),
    ('rhode-island', 'Rhode Island', 'Estados Unidos', false),
    ('rio', 'Río de Janeiro', 'Brasil', false),
    ('rio-de-janeiro', 'Río de Janeiro', 'Brasil', false),
    ('roatan', 'Roatán', 'Honduras', false),
    ('ros', 'Rosario', 'Argentina', false),
    ('rosario', 'Rosario', 'Argentina', false),
    ('rtb', 'Roatán', 'Honduras', false),
    ('sal', 'San Salvador', 'El Salvador', false),
    ('salta', 'Salta', 'Argentina', false),
    ('salvador-bahia', 'Salvador de Bahía', 'Brasil', false),
    ('salvador-de-bahia', 'Salvador de Bahía', 'Brasil', false),
    ('san', 'San Diego', 'Estados Unidos', false),
    ('san-diego', 'San Diego', 'Estados Unidos', false),
    ('san-francisco', 'San Francisco', 'Estados Unidos', false),
    ('san-jose', 'San José', 'Costa Rica', true),
    ('san-jose-del-cabo', 'Los Cabos', 'México', false),
    ('san-juan', 'San Juan', 'Puerto Rico', true),
    ('san-miguel-de-tucuman', 'Tucumán', 'Argentina', false),
    ('san-pablo', 'São Paulo', 'Brasil', false),
    ('san-pedro-sula', 'San Pedro Sula', 'Honduras', false),
    ('san-salvador', 'San Salvador', 'El Salvador', false),
    ('santa-cruz', 'Santa Cruz de la Sierra', 'Bolivia', false),
    ('santa-cruz-de-la-sierra', 'Santa Cruz de la Sierra', 'Bolivia', false),
    ('santa-marta', 'Santa Marta', 'Colombia', false),
    ('santiago', 'Santiago', 'Chile', true),
    ('santiago-de-chile', 'Santiago', 'Chile', true),
    ('santiago-de-los-caballeros', 'Santiago de los Caballeros', 'República Dominicana', false),
    ('santo-domingo', 'Santo Domingo', 'República Dominicana', false),
    ('sao-paulo', 'São Paulo', 'Brasil', false),
    ('sap', 'San Pedro Sula', 'Honduras', false),
    ('scl', 'Santiago', 'Chile', true),
    ('sdq', 'Santo Domingo', 'República Dominicana', false),
    ('sfo', 'San Francisco', 'Estados Unidos', false),
    ('sjd', 'Los Cabos', 'México', false),
    ('sjo', 'San José', 'Costa Rica', true),
    ('sju', 'San Juan', 'Puerto Rico', true),
    ('sla', 'Salta', 'Argentina', false),
    ('smr', 'Santa Marta', 'Colombia', false),
    ('south-carolina', 'South Carolina', 'Estados Unidos', false),
    ('south-dakota', 'South Dakota', 'Estados Unidos', false),
    ('ssa', 'Salvador de Bahía', 'Brasil', false),
    ('sti', 'Santiago de los Caballeros', 'República Dominicana', false),
    ('tampa', 'Tampa', 'Estados Unidos', false),
    ('tegucigalpa', 'Tegucigalpa', 'Honduras', false),
    ('tennessee', 'Tennessee', 'Estados Unidos', false),
    ('texas', 'Texas', 'Estados Unidos', false),
    ('tgu', 'Tegucigalpa', 'Honduras', false),
    ('tij', 'Tijuana', 'México', false),
    ('tijuana', 'Tijuana', 'México', false),
    ('toronto', 'Toronto', 'Canadá', false),
    ('tpa', 'Tampa', 'Estados Unidos', false),
    ('tuc', 'Tucumán', 'Argentina', false),
    ('tucuman', 'Tucumán', 'Argentina', false),
    ('uio', 'Quito', 'Ecuador', false),
    ('utah', 'Utah', 'Estados Unidos', false),
    ('valencia', 'Valencia', 'Venezuela', true),
    ('vermont', 'Vermont', 'Estados Unidos', false),
    ('virginia', 'Virginia', 'Estados Unidos', false),
    ('virginia-occidental', 'West Virginia', 'Estados Unidos', false),
    ('vln', 'Valencia', 'Venezuela', true),
    ('vvi', 'Santa Cruz de la Sierra', 'Bolivia', false),
    ('washington', 'Washington', 'Estados Unidos', false),
    ('washington-d-c', 'Washington D.C.', 'Estados Unidos', false),
    ('washington-dc', 'Washington D.C.', 'Estados Unidos', false),
    ('west-virginia', 'West Virginia', 'Estados Unidos', false),
    ('willemstad', 'Willemstad', 'Curazao', false),
    ('wisconsin', 'Wisconsin', 'Estados Unidos', false),
    ('wyoming', 'Wyoming', 'Estados Unidos', false),
    ('yul', 'Montreal', 'Canadá', false),
    ('yyz', 'Toronto', 'Canadá', false)
  ),
  region_alias(alias, region) as (values
    ('america-del-norte', 'Norteamérica'),
    ('america-del-sur', 'Sudamérica'),
    ('america-latina', 'LATAM'),
    ('andina', 'Región Andina'),
    ('cam', 'Centroamérica'),
    ('caribbean', 'Caribe'),
    ('caribe', 'Caribe'),
    ('central-america', 'Centroamérica'),
    ('centro-america', 'Centroamérica'),
    ('centroamerica', 'Centroamérica'),
    ('cono-sur', 'Cono Sur'),
    ('el-caribe', 'Caribe'),
    ('latam', 'LATAM'),
    ('latin-america', 'LATAM'),
    ('latino-america', 'LATAM'),
    ('latinoamerica', 'LATAM'),
    ('norte-america', 'Norteamérica'),
    ('norteamerica', 'Norteamérica'),
    ('north-america', 'Norteamérica'),
    ('paises-andinos', 'Región Andina'),
    ('region-andina', 'Región Andina'),
    ('south-america', 'Sudamérica'),
    ('sud-america', 'Sudamérica'),
    ('sudamerica', 'Sudamérica')
  ),
  country_marker(marker) as (values
    ('all'),
    ('country'),
    ('general'),
    ('nacional'),
    ('national'),
    ('pais'),
    ('todo'),
    ('todo-el-pais'),
    ('total')
  ),
  multi_marker(marker) as (values
    ('mix'),
    ('multi'),
    ('multiple'),
    ('multiples'),
    ('otras'),
    ('otros'),
    ('resto'),
    ('several'),
    ('varias'),
    ('varias-ciudades'),
    ('varias-plazas'),
    ('varios'),
    ('varios-mercados')
  ),
  -- El país más largo que prefija la clave. El "-" del patrón evita que "usa"
  -- se coma "usa-miami" mal partido, y el orden por longitud evita que un alias
  -- corto le gane a uno largo.
  pref as (
    select ca.country, substring(k.key from length(ca.alias) + 2) as rest
      from k join country_alias ca on k.key like ca.alias || '-%'
     order by length(ca.alias) desc
     limit 1
  )
select coalesce(
  -- 1) región supranacional
  (select rg.region from region_alias rg, k where rg.alias = k.key limit 1),
  -- 2) el país entero
  (select cn.country || ' (País)' from country_alias cn, k where cn.alias = k.key limit 1),
  -- 3) una plaza inequívoca, sin país delante ("California", "Panama City")
  (select pl.country || ' - ' || pl.place
     from place_alias pl, k where pl.alias = k.key and pl.ambiguous = false limit 1),
  -- 4) "<País> - <resto>"
  (select case
     -- 4a) "<País> - País/Total/Nacional" → el país entero
     when p.rest = '' or p.rest in (select marker from country_marker)
       then p.country || ' (País)'
     -- 4b) "<País> - Varios"
     when p.rest in (select marker from multi_marker)
       then p.country || ' - Varios'
     -- 4c) "<País> - T1" / "<País> - Tier 2" / "<País> - Varios (T1)" → grupo etiquetado
     when p.rest ~ '^(varios-|varias-)?(t|tier)-?[0-9]{1,2}$'
       then p.country || ' - Varios' || ' (T'
            || substring(p.rest from '([0-9]{1,2})$') || ')'
     -- 4d) "<País> - <Plaza>" del diccionario
     else (select p.country || ' - ' || pa.place
             from place_alias pa where pa.alias = p.rest limit 1)
   end
   from pref p)
)
$fn$;

-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 1 — DRY RUN (read-only). El plan de cambios, ANTES de tocar nada.
--
-- `accion` dice qué va a pasar con cada fila:
--   sin cambio       — ya está en la forma canónica
--   renombrar        — cambia el nombre (y el slug); sigue siendo la misma fila
--   FUSIONAR EN …    — esta fila desaparece; sus líneas pasan al mercado que
--                      nombra la columna `destino`
--   SIN MAPEAR       — no se toca (ver la última columna: por qué)
--
-- Mirá sobre todo las filas "FUSIONAR EN": son las únicas que borran una fila
-- del catálogo. `lineas` / `cierres` / `snapshots` / `simulador` son lo que se
-- repunta al destino.
-- ════════════════════════════════════════════════════════════════════════════

with
  market_override(client_slug, market_slug, target_name) as (values
    ('copa', 'estados-unidos-varios', 'Estados Unidos (País)')
  ),
  plan as (
    select m.id, m.client_id, m.name, m.slug, m.sort_order,
           c.slug as client_slug,
           -- El override gana sobre el diccionario: es la única forma de fundir
           -- dos formas que la taxonomía considera distintas.
           coalesce(ov.target_name, public.market_canonical_name(m.name)) as target_name,
           (ov.target_name is not null) as forzado,
           (select count(*) from public.media_plan_placements pl where pl.market_id = m.id) as placements
      from public.markets m
      join public.clients c on c.id = m.client_id
      left join market_override ov
        on ov.client_slug = c.slug and ov.market_slug = m.slug
  ),
  winner as (
    select p.*,
           public.norm(p.target_name) as target_slug,
           first_value(p.id) over (
             partition by p.client_id, public.norm(p.target_name)
             order by p.placements desc,
                      (case when p.name = p.target_name then 0 else 1 end),
                      p.sort_order, p.id
           ) as winner_id
      from plan p
     where p.target_name is not null
  )
select w.client_slug                                       as cliente,
       w.name                                              as mercado_actual,
       w.slug                                              as slug_actual,
       w.target_name                                       as mercado_nuevo,
       case
         when w.id <> w.winner_id
           then 'FUSIONAR EN → ' || (select w2.target_name from winner w2 where w2.id = w.winner_id limit 1)
         when w.name = w.target_name and w.slug = w.target_slug then 'sin cambio'
         else 'renombrar'
       end                                                 as accion,
       case when w.forzado then 'decisión manual' else '' end as origen,
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
select p.client_slug, p.name, p.slug, null, 'SIN MAPEAR', '', p.placements, 0, 0, 0
  from plan p where p.target_name is null
 order by 1, 5 desc, 2;

-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 2 — APLICAR. Un solo statement: o entra todo o no entra nada.
-- Al terminar imprime en "Messages" cuántas filas tocó cada cosa.
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare
  n_merge int; n_pl int; n_cas int; n_snap int; n_sim int; n_del int; n_ren int;
begin
  -- Plan de trabajo, materializado para no recalcularlo en cada update.
  create temporary table _mkt_plan on commit drop as
  with
    market_override(client_slug, market_slug, target_name) as (values
      ('copa', 'estados-unidos-varios', 'Estados Unidos (País)')
    ),
    plan as (
      select m.id, m.client_id, m.name, m.slug, m.sort_order,
             c.slug as client_slug,
             -- El override gana sobre el diccionario: es la única forma de fundir
             -- dos formas que la taxonomía considera distintas.
             coalesce(ov.target_name, public.market_canonical_name(m.name)) as target_name,
             (ov.target_name is not null) as forzado,
             (select count(*) from public.media_plan_placements pl where pl.market_id = m.id) as placements
        from public.markets m
        join public.clients c on c.id = m.client_id
        left join market_override ov
          on ov.client_slug = c.slug and ov.market_slug = m.slug
    ),
    winner as (
      select p.*,
             public.norm(p.target_name) as target_slug,
             first_value(p.id) over (
               partition by p.client_id, public.norm(p.target_name)
               order by p.placements desc,
                        (case when p.name = p.target_name then 0 else 1 end),
                        p.sort_order, p.id
             ) as winner_id
        from plan p
       where p.target_name is not null
    )
  select w.id, w.client_id, w.winner_id, w.target_name, w.target_slug, w.name, w.slug
    from winner w;

  -- Perdedores: filas que se fusionan en otra.
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

  -- 3) marketId embebido en los snapshots de versiones del plan. Sin FK: si no
  --    se reescribe, "descartar borrador" sanea el id muerto a NULL y BORRA el
  --    mercado de las líneas vivas (app/actions/plans.ts, revertPlanToApprovedSnapshot).
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
     and exists (
           select 1 from jsonb_array_elements(s.snapshot_json->'placements') e2
            join _mkt_merge mm2 on mm2.loser_id::text = e2->>'marketId');
  get diagnostics n_snap = row_count;

  -- 4) marketId embebido en los escenarios del simulador. Sin FK: un id muerto
  --    revienta "promover a plan" con violación de FK.
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
     and exists (
           select 1 from jsonb_array_elements(sc.rows_json->'rows') e2
            join _mkt_merge mm2 on mm2.loser_id::text = e2->>'marketId');
  get diagnostics n_sim = row_count;

  -- 5) Recién ahora se borran los perdedores: ya no queda nada apuntándoles.
  --    Va ANTES del rename porque un perdedor puede estar ocupando el slug que
  --    el ganador necesita (markets_client_slug_uq).
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

  raise notice 'mercados fusionados: %  ·  líneas repuntadas: %  ·  cierres: %  ·  snapshots de versión: %  ·  escenarios: %  ·  mercados borrados: %  ·  renombrados: %',
    n_merge, n_pl, n_cas, n_snap, n_sim, n_del, n_ren;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 3 — VERIFICACIÓN (correr aparte; el SQL Editor muestra sólo el
-- resultado del último statement).
--
-- 3.a — El catálogo después. ESPERADO: ningún nombre repetido por cliente, y
--       todo lo que diga "queda" en `estado` es SIN MAPEAR a propósito (ver el
--       bloque 1). Si una fila dice "REVISAR", el rename no entró.
-- ════════════════════════════════════════════════════════════════════════════

with
  market_override(client_slug, market_slug, target_name) as (values
    ('copa', 'estados-unidos-varios', 'Estados Unidos (País)')
  ),
  plan as (
    select m.id, m.client_id, m.name, m.slug, m.sort_order,
           c.slug as client_slug,
           -- El override gana sobre el diccionario: es la única forma de fundir
           -- dos formas que la taxonomía considera distintas.
           coalesce(ov.target_name, public.market_canonical_name(m.name)) as target_name,
           (ov.target_name is not null) as forzado,
           (select count(*) from public.media_plan_placements pl where pl.market_id = m.id) as placements
      from public.markets m
      join public.clients c on c.id = m.client_id
      left join market_override ov
        on ov.client_slug = c.slug and ov.market_slug = m.slug
  ),
  winner as (
    select p.*,
           public.norm(p.target_name) as target_slug,
           first_value(p.id) over (
             partition by p.client_id, public.norm(p.target_name)
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
       w.placements as lineas
  from winner w
union all
select p.client_slug, p.name, p.slug, 'queda (sin mapear)', p.placements
  from plan p where p.target_name is null
 order by 1, 2;

-- ── 3.b — Que no haya quedado NINGÚN duplicado. ESPERADO: 0 filas. ──────────
-- select c.slug as cliente, m.name, count(*)
--   from public.markets m join public.clients c on c.id = m.client_id
--  group by 1, 2 having count(*) > 1;

-- ── 3.c — Que no se haya perdido plata. ESPERADO: las mismas dos columnas
--         (líneas y monto) que antes de correr el bloque 2, y "sin mercado"
--         con el MISMO número que tenía antes (la migración no debe crear
--         líneas huérfanas). ──────────────────────────────────────────────────
-- select coalesce(mk.name, '(sin mercado)') as mercado,
--        count(*) as lineas, sum(pl.amount_usd) as monto_usd
--   from public.media_plan_placements pl
--   join public.media_plan_publishers mpp on mpp.id = pl.media_plan_publisher_id
--   join public.media_plans mp on mp.id = mpp.media_plan_id and mp.deleted_at is null
--   join public.projects pr on pr.id = mp.project_id
--   join public.clients c on c.id = pr.client_id
--   left join public.markets mk on mk.id = pl.market_id
--  group by 1 order by 3 desc nulls last;

-- ── 3.d — Que no haya quedado ningún marketId muerto dentro de los JSONB.
--         ESPERADO: 0 filas en las dos. ────────────────────────────────────────
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

-- ── 3.e — Nombres viejos que hayan quedado tipeados a mano en texto libre.
--         Ningún SQL de este archivo los alcanza; se revisan a ojo. ───────────
-- select pl.id, pl.placement_name, pl.audience
--   from public.media_plan_placements pl
--  where pl.placement_name ilike '%<nombre viejo>%'
--     or pl.audience ilike '%<nombre viejo>%';
