// ════════════════════════════════════════════════════════════════════════════
// Genera db/markets-nomenclatura.sql desde lib/market-nomenclature.ts.
// Uso: `npm run gen:markets-sql`
//
// El SQL de la migración NO se escribe a mano: los diccionarios de países,
// plazas y regiones viven en el módulo de TypeScript (que es lo que usa la app
// para armar el nombre en el form), y acá se vuelcan a tablas `values` para
// que la base normalice EXACTAMENTE igual que la app. Si mañana se agrega una
// plaza, se corre esto de nuevo y el SQL queda al día solo.
//
// Diferencia deliberada con el TS: cuando el país se reconoce pero la plaza no
// está en el diccionario, el TS igual arma "País - Plaza" (title-case de lo
// que haya); el SQL NO — lo deja sin tocar y lo reporta como SIN MAPEAR. Una
// migración no inventa nombres: los lista para que los mire una persona.
// ════════════════════════════════════════════════════════════════════════════
import { writeFileSync } from "node:fs";
import {
  CITY_BY_KEY,
  COUNTRY_BY_KEY,
  COUNTRY_MARKERS,
  COUNTRY_SUFFIX,
  MULTI_MARKERS,
  MULTI_SUFFIX,
  REGION_BY_KEY,
  SEPARATOR,
} from "../lib/market-nomenclature";

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** `values (...)` de una lista de tuplas, indentado y en varias líneas. */
function values(rows: string[][], indent = "    "): string {
  return rows.map((r) => `${indent}(${r.join(", ")})`).join(",\n");
}

// ── translate() para sacar tildes ───────────────────────────────────────────
// Se arma acá y no a mano: las dos cadenas de translate() tienen que tener la
// misma cantidad de caracteres, y a mano eso se rompe solo.
const ACCENTED = "ÁÀÂÄÃÅáàâäãåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÖÕóòôöõÚÙÛÜúùûüÝýÑñÇç";
const FOLDED = [...ACCENTED]
  .map((c) => c.normalize("NFD").replace(/[̀-ͯ]/g, ""))
  .join("");
if (FOLDED.length !== ACCENTED.length) throw new Error("translate() desbalanceado");

const NORM_SQL = `regexp_replace(
        regexp_replace(
          lower(translate(v, ${q(ACCENTED)}, ${q(FOLDED)})),
          '[^a-z0-9]+', '-', 'g'),
        '^-+|-+$', '', 'g')`;

// ── Tablas de alias ─────────────────────────────────────────────────────────
const countryRows = [...COUNTRY_BY_KEY.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([alias, name]) => [q(alias), q(name)]);

const placeRows = [...CITY_BY_KEY.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([alias, p]) => [q(alias), q(p.name), q(p.country), p.ambiguous ? "true" : "false"]);

const regionRows = [...REGION_BY_KEY.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([alias, name]) => [q(alias), q(name)]);

const countryMarkerRows = [...COUNTRY_MARKERS].sort().map((m) => [q(m)]);
const multiMarkerRows = [...MULTI_MARKERS].sort().map((m) => [q(m)]);

// ── La función que canoniza un nombre ───────────────────────────────────────
// Se define UNA vez y los tres bloques la llaman. Antes el diccionario se
// repetía inline en cada uno y el archivo daba 2.100 líneas.
//
// Orden de resolución, el mismo que `canonicalMarketName`:
//   1. el nombre entero es una región           → se canoniza la ortografía
//   2. el nombre entero es un país              → "<País> (País)"
//   3. el nombre entero es una plaza NO ambigua → "<País> - <Plaza>"
//   4. el nombre arranca con un país            → se mira el resto
//   5. nada de lo anterior                      → null (SIN MAPEAR, no se toca)
const CANON_FN = `create or replace function public.market_canonical_name(v text)
  returns text language sql immutable parallel safe
as $fn$
with
  k(key) as (select public.norm(v)),
  country_alias(alias, country) as (values
${values(countryRows)}
  ),
  place_alias(alias, place, country, ambiguous) as (values
${values(placeRows)}
  ),
  region_alias(alias, region) as (values
${values(regionRows)}
  ),
  country_marker(marker) as (values
${values(countryMarkerRows)}
  ),
  multi_marker(marker) as (values
${values(multiMarkerRows)}
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
  (select cn.country || ${q(" " + COUNTRY_SUFFIX)} from country_alias cn, k where cn.alias = k.key limit 1),
  -- 3) una plaza inequívoca, sin país delante ("California", "Panama City")
  (select pl.country || ${q(SEPARATOR)} || pl.place
     from place_alias pl, k where pl.alias = k.key and pl.ambiguous = false limit 1),
  -- 4) "<País> - <resto>"
  (select case
     -- 4a) "<País> - País/Total/Nacional" → el país entero
     when p.rest = '' or p.rest in (select marker from country_marker)
       then p.country || ${q(" " + COUNTRY_SUFFIX)}
     -- 4b) "<País> - Varios"
     when p.rest in (select marker from multi_marker)
       then p.country || ${q(SEPARATOR + MULTI_SUFFIX)}
     -- 4c) "<País> - T1" / "<País> - Tier 2" / "<País> - Varios (T1)" → grupo etiquetado
     when p.rest ~ '^(varios-|varias-)?(t|tier)-?[0-9]{1,2}$'
       then p.country || ${q(SEPARATOR + MULTI_SUFFIX)} || ' (T'
            || substring(p.rest from '([0-9]{1,2})$') || ')'
     -- 4d) "<País> - <Plaza>" del diccionario
     else (select p.country || ${q(SEPARATOR)} || pa.place
             from place_alias pa where pa.alias = p.rest limit 1)
   end
   from pref p)
)
$fn$;`;

// ── Overrides: las decisiones que el diccionario NO puede tomar ────────────
// Hay pares de mercados que son dos formas VÁLIDAS y distintas de la taxonomía
// —"Estados Unidos (País)" y "Estados Unidos - Varios" no son lo mismo— pero
// que en el catálogo real se usaron para lo mismo. Eso no lo decide un
// diccionario: lo decide quien conoce los planes.
//
// Valen UNA vez, en la migración. Después el form puede volver a crear
// cualquiera de esas formas si de verdad hacen falta.
//
// `slug` es el slug ACTUAL de la fila en `markets` (el que sale del bloque 0).
const OVERRIDES: { client: string; slug: string; target: string; why: string }[] = [
  {
    client: "copa",
    slug: "estados-unidos-varios",
    target: "Estados Unidos (País)",
    why:
      "Confirmado con el dueño del catálogo: 'Estados Unidos' (23 líneas) y " +
      "'Estados Unidos - Varios' (9 líneas) se usaban para lo mismo. Se funden " +
      "en el país entero: 32 líneas, USD 1.165.345.",
  },
];

const overrideRows = OVERRIDES.map((o) => [q(o.client), q(o.slug), q(o.target)]);
// Una fila imposible mantiene la tabla bien tipada cuando no hay overrides.
const OVERRIDE_CTE = `market_override(client_slug, market_slug, target_name) as (values
${values(overrideRows.length ? overrideRows : [["''", "''", "''"]])}
  )`;

// ── El plan de cambios. Corto, porque el diccionario vive en la función ─────
// Ganador de cada grupo (client_id, slug destino): el que más líneas tiene; a
// igualdad, el que ya está bien escrito, y después el de menor sort_order.
const PLAN_CTE = `${OVERRIDE_CTE},
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
  )`;

const header = `-- ════════════════════════════════════════════════════════════════════════════
-- Nomenclatura única de MERCADOS — normalizar el catálogo de todos los
-- clientes y fusionar los duplicados sin perder una sola línea de plan.
--
--   ⚠️  ARCHIVO GENERADO. No editar a mano: sale de
--       lib/market-nomenclature.ts vía \`npm run gen:markets-sql\`.
--
-- EL PROBLEMA:
--   \`markets\` es per-cliente y el nombre se tipeaba libre, así que el mismo
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
--   \`market_override\` del bloque 1/2, con su porqué en
--   scripts/gen-markets-sql.ts. Salen marcadas "decisión manual" en el dry-run.
--
--   Lo que NO puede mapear con certeza NO SE TOCA y sale listado en el bloque
--   1 como "SIN MAPEAR" (ej. "Santiago" a secas: puede ser Chile o República
--   Dominicana; lo desambigua una persona desde el form).
--
-- CÓMO APLICAR:
--   Bloque 0 → mirás el catálogo actual.
--   Bloque 1 → mirás el plan de cambios ANTES de tocar nada. Es read-only.
--   Bloque 2 → aplica. Un solo statement (\`do $$ … $$\`), todo o nada.
--   Bloque 3 → verificación.
--
-- OJO:
--   • Correr por SQL NO deja rastro en \`audit_log\` (lo escriben las server
--     actions, no la base).
--   • Los snapshots de versiones aprobadas resuelven el nombre del mercado
--     contra el catálogo de HOY: un PDF de una versión vieja que se regenere
--     va a decir el nombre nuevo. Es el comportamiento que ya existía con
--     cualquier rename desde la UI.
--   • \`media_plan_placements.market_id\` y \`campaign_actual_snapshots.market_id\`
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
`;

const dict = `with
  ${PLAN_CTE}`;

const normFn = `-- ────────────────────────────────────────────────────────────────────────────
-- norm(): la MISMA normalización que \`slugify\` en app/actions/markets.ts y
-- \`norm\` en lib/market-nomenclature.ts — minúsculas, sin tildes, todo lo no
-- alfanumérico a "-". Es lo que hace que "Panamá" y "panama" tengan la misma
-- clave. Se crea como función para no repetirla en cada bloque; es inmutable y
-- no toca datos, así que se puede dejar creada.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.norm(v text) returns text
  language sql immutable strict parallel safe
as $fn$
  select ${NORM_SQL.replace(/\n/g, "\n  ")}
$fn$;
`;

const dryRun = `-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 1 — DRY RUN (read-only). El plan de cambios, ANTES de tocar nada.
--
-- \`accion\` dice qué va a pasar con cada fila:
--   sin cambio       — ya está en la forma canónica
--   renombrar        — cambia el nombre (y el slug); sigue siendo la misma fila
--   FUSIONAR EN …    — esta fila desaparece; sus líneas pasan al mercado que
--                      nombra la columna \`destino\`
--   SIN MAPEAR       — no se toca (ver la última columna: por qué)
--
-- Mirá sobre todo las filas "FUSIONAR EN": son las únicas que borran una fila
-- del catálogo. \`lineas\` / \`cierres\` / \`snapshots\` / \`simulador\` son lo que se
-- repunta al destino.
-- ════════════════════════════════════════════════════════════════════════════

${dict}
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
`;

const apply = `-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 2 — APLICAR. Un solo statement: o entra todo o no entra nada.
-- Al terminar imprime en "Messages" cuántas filas tocó cada cosa.
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare
  n_merge int; n_pl int; n_cas int; n_snap int; n_sim int; n_del int; n_ren int;
begin
  -- Plan de trabajo, materializado para no recalcularlo en cada update.
  create temporary table _mkt_plan on commit drop as
  ${dict.replace(/\n/g, "\n  ")}
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
`;

const verify = `-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 3 — VERIFICACIÓN (correr aparte; el SQL Editor muestra sólo el
-- resultado del último statement).
--
-- 3.a — El catálogo después. ESPERADO: ningún nombre repetido por cliente, y
--       todo lo que diga "queda" en \`estado\` es SIN MAPEAR a propósito (ver el
--       bloque 1). Si una fila dice "REVISAR", el rename no entró.
-- ════════════════════════════════════════════════════════════════════════════

${dict}
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
`;

const canonFn = `-- ────────────────────────────────────────────────────────────────────────────
-- market_canonical_name(): el nombre canónico de un mercado, o NULL si no se
-- puede mapear con certeza. Es la MISMA lógica que \`canonicalMarketName\` en
-- lib/market-nomenclature.ts, con los mismos diccionarios — este archivo se
-- genera desde ahí justamente para que no puedan divergir.
--
-- Diferencia deliberada: cuando el país se reconoce pero la plaza no está en el
-- diccionario, el TS igual arma "País - Plaza"; acá devuelve NULL. Una
-- migración no inventa nombres: los deja quietos y los lista.
--
-- Es \`immutable\` y no toca datos. Se puede dejar creada, o borrarla al final:
--   drop function public.market_canonical_name(text);
--   drop function public.norm(text);
-- ────────────────────────────────────────────────────────────────────────────

${CANON_FN}
`;

const out = [header, normFn, canonFn, dryRun, apply, verify].join("\n");
writeFileSync(new URL("../db/markets-nomenclatura.sql", import.meta.url), out);
console.log(
  `✓ db/markets-nomenclatura.sql — ${countryRows.length} alias de país, ` +
    `${placeRows.length} de plaza, ${regionRows.length} de región (${out.split("\n").length} líneas)`,
);
