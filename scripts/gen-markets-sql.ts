// ════════════════════════════════════════════════════════════════════════════
// Genera db/markets-nomenclatura.sql — el PASO B de la normalización de
// mercados: renombrar el catálogo a la nomenclatura canónica y fusionar los
// duplicados.  Uso: `npm run gen:markets-sql`
//
// El SQL NO se escribe a mano. Sale de cruzar dos cosas:
//   · db/markets-catalogo-2026-09-03.csv — la foto de prod (salida del bloque
//     0), que es exactamente lo que hay que normalizar.
//   · lib/market-nomenclature.ts — la taxonomía, que es lo mismo que usa el
//     form del catálogo para armar un nombre.
//
// El resultado es un PLAN EXPLÍCITO: una fila por mercado, con su nombre
// destino ya resuelto. Se puede leer entero y ver cada renombre. La
// alternativa —mandar los diccionarios a la base y que resuelva ella— daba un
// archivo de 900 líneas donde no se veía qué iba a pasar con cada mercado.
//
// Un mercado que esté en la base y NO en el plan (cargado después de la foto)
// no se toca y sale reportado. Preferimos que sobre a que se renombre a ciegas.
// ════════════════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync } from "node:fs";
import { canonicalMarketName } from "../lib/market-nomenclature";

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

// ── Overrides: las decisiones que el diccionario NO puede tomar ─────────────
// Hay pares que son dos formas VÁLIDAS y distintas de la taxonomía
// —"Estados Unidos (País)" y "Estados Unidos - Varios" no son lo mismo— pero
// que en el catálogo real se usaron para lo mismo. Eso no lo decide un
// diccionario: lo decide quien conoce los planes. Valen una vez; después el
// form puede volver a crear cualquiera de esas formas.
const OVERRIDES: Record<string, { target: string; why: string }> = {
  "copa|estados-unidos-varios": {
    target: "Estados Unidos (País)",
    why:
      "Copa usaba 'Estados Unidos' (23 líneas, USD 755.800) y " +
      "'Estados Unidos - Varios' (9 líneas, USD 409.545) para lo mismo. " +
      "Confirmado con el dueño del catálogo: se funden en el país entero.",
  },
};

// ── La foto del catálogo ────────────────────────────────────────────────────
type Row = { client: string; name: string; slug: string; sortOrder: number; lineas: number; monto: number };

function readCatalog(): Row[] {
  const raw = readFileSync(new URL("../db/markets-catalogo-2026-09-03.csv", import.meta.url), "utf8");
  const [, ...lines] = raw.trim().split("\n");
  return lines.map((line) => {
    // El CSV puede traer el nombre entre comillas si tiene coma.
    const cells: string[] = [];
    let cur = "";
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === "," && !quoted) { cells.push(cur); cur = ""; }
      else cur += ch;
    }
    cells.push(cur);
    const [client, name, slug, , sortOrder, lineas, monto] = cells;
    return {
      client, name, slug,
      sortOrder: Number(sortOrder), lineas: Number(lineas), monto: Number(monto),
    };
  });
}

const catalog = readCatalog();

// ── El plan: una fila por mercado, con su destino ya resuelto ───────────────
type Planned = Row & { target: string | null; forced: boolean };

const planned: Planned[] = catalog.map((r) => {
  const ov = OVERRIDES[`${r.client}|${r.slug}`];
  if (ov) return { ...r, target: ov.target, forced: true };
  const c = canonicalMarketName(r.name);
  return { ...r, target: c.shape === "unknown" ? null : c.name, forced: false };
});

const mapped = planned.filter((p) => p.target);
const unmapped = planned.filter((p) => !p.target);

// Slug destino, con la misma normalización que usa la app.
const slugOf = (name: string) => canonicalMarketName(name).slug;

// Grupos con más de un mercado apuntando al mismo destino: son las fusiones.
const groups = new Map<string, Planned[]>();
for (const p of mapped) {
  const k = `${p.client}|${slugOf(p.target!)}`;
  groups.set(k, [...(groups.get(k) ?? []), p]);
}
const merges = [...groups.values()].filter((g) => g.length > 1);
const renames = mapped.filter((p) => p.name !== p.target);

// Caso peligroso: un mercado A cuyo slug ACTUAL es el slug DESTINO de otra
// fila B que apunta a otro lado. Después del rename, el ganador de B pasaría a
// tener el slug de A y emparejaría con la fila de A, que quiere otro destino.
// Que A y B compartan destino (una fusión) NO es problema: es el mismo grupo.
{
  for (const a of mapped) {
    const aTarget = slugOf(a.target!);
    if (aTarget === a.slug) continue; // A no cambia de slug: no hay riesgo
    const b = mapped.find(
      (x) => x !== a && x.client === a.client && slugOf(x.target!) === a.slug,
    );
    if (b) {
      throw new Error(
        `El slug "${a.slug}" (${a.client}, "${a.name}" → "${a.target}") es también el ` +
          `destino de "${b.name}". Después del rename el join quedaría ambiguo.`,
      );
    }
  }
}

const planRows = mapped
  .map((p) => `    (${q(p.client)}, ${q(p.slug)}, ${q(p.target!)})`)
  .join(",\n");

const clients = [...new Set(catalog.map((c) => c.client))].map(q).join(", ");

// El plan se repite en los tres bloques; es corto, así que se inlinea.
const PLAN_CTE = `market_plan(client_slug, market_slug, target_name) as (values
${planRows}
  ),
  plan as (
    select m.id, m.client_id, m.name, m.slug, m.sort_order,
           c.slug as client_slug,
           mp.target_name,
           (select count(*) from public.media_plan_placements pl where pl.market_id = m.id) as placements
      from public.markets m
      join public.clients c on c.id = m.client_id
      -- Empareja por el slug ACTUAL o por el slug DESTINO: así el plan sigue
      -- reconociendo al mercado después de renombrarlo. Sin esto, la segunda
      -- corrida y la verificación no encontraban nada y reportaban todo como
      -- "no estaba en el plan". Gana siempre el match por slug actual.
      left join lateral (
        select mp.target_name
          from market_plan mp
         where mp.client_slug = c.slug
           and (mp.market_slug = m.slug or public.norm(mp.target_name) = m.slug)
         order by (mp.market_slug = m.slug) desc
         limit 1
      ) mp on true
     where c.slug in (${clients})
  ),
  -- Ganador de cada grupo: el que más líneas tiene; a igualdad, el que ya está
  -- bien escrito, y después el de menor sort_order.
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

const mergeLines = merges
  .map((g) => {
    // Mismo desempate que la ventana `winner` del SQL: más líneas, después el
    // que ya está bien escrito, después menor sort_order.
    const winner = [...g].sort(
      (a, b) =>
        b.lineas - a.lineas ||
        (a.name === a.target ? 0 : 1) - (b.name === b.target ? 0 : 1) ||
        a.sortOrder - b.sortOrder,
    )[0];
    const losers = g.filter((x) => x !== winner);
    return `--   · ${g.map((x) => `"${x.name}"`).join(" + ")} → "${winner.target}" `
      + `(${g.reduce((s, x) => s + x.lineas, 0)} líneas, `
      + `USD ${g.reduce((s, x) => s + x.monto, 0).toLocaleString("es-AR", { minimumFractionDigits: 2 })}); `
      + `desaparece${losers.length > 1 ? "n" : ""} ${losers.map((x) => `"${x.name}"`).join(", ")}`;
  })
  .join("\n");

const out = `-- ════════════════════════════════════════════════════════════════════════════
-- PASO B — normalizar el catálogo de mercados a la nomenclatura única.
--
--   ⚠️  ARCHIVO GENERADO. No editar a mano: sale de cruzar
--       db/markets-catalogo-2026-09-03.csv (la foto de prod) con
--       lib/market-nomenclature.ts (la taxonomía), vía
--       \`npm run gen:markets-sql\`.
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
-- EL PLAN, en números: ${planned.length} mercados en la foto · ${renames.length} se renombran · ${merges.length} fusion${merges.length === 1 ? "es" : "es"} · ${unmapped.length} sin mapear.
--
-- LAS FUSIONES (lo único que borra una fila del catálogo):
${mergeLines || "--   · ninguna"}
--
-- SIN MAPEAR (no se tocan; salen listados en el bloque 1):
${unmapped.length ? unmapped.map((u) => `--   · ${u.client}: "${u.name}" (${u.lineas} líneas)`).join("\n") : "--   · ninguno"}
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
--   · Correr por SQL NO deja rastro en \`audit_log\`.
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

-- ────────────────────────────────────────────────────────────────────────────
-- norm(): la MISMA normalización que \`slugify\` en app/actions/markets.ts y
-- \`norm\` en lib/market-nomenclature.ts. Es inmutable y no toca datos; se puede
-- dejar creada o borrarla al final con \`drop function public.norm(text);\`.
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

-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 1 — DRY RUN (read-only). El plan de cambios, ANTES de tocar nada.
--
-- \`accion\`:  sin cambio · renombrar · FUSIONAR EN … · SIN MAPEAR ·
--            NO ESTABA EN EL PLAN (cargado después de la foto: no se toca)
-- ════════════════════════════════════════════════════════════════════════════

with
  ${PLAN_CTE}
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
    ${PLAN_CTE.replace(/\n/g, "\n  ")}
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
  ${PLAN_CTE}
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
`;

writeFileSync(new URL("../db/markets-nomenclatura.sql", import.meta.url), out);
console.log(
  `✓ db/markets-nomenclatura.sql — ${planned.length} mercados · ${renames.length} renombres · ` +
    `${merges.length} fusiones · ${unmapped.length} sin mapear (${out.split("\n").length} líneas)`,
);
