// Control de la nomenclatura de mercados (lib/market-nomenclature.ts).
// Uso: `npm run check:markets`
//
// Chequea tres cosas:
//   1. IDEMPOTENCIA — canonizar dos veces da lo mismo que canonizar una. Es lo
//      que permite correr la migración de nuevo sin que el catálogo se mueva.
//   2. ROUND-TRIP   — lo que arma el form (`buildMarketName`) ya es canónico, y
//      `parseMarketName` lo devuelve a los mismos campos del form.
//   3. CASOS REALES — el corpus de escrituras sucias que había en el catálogo.
import { resolveMarketGeo } from "../lib/market-geo";
import {
  CITY_BY_KEY,
  COUNTRY_BY_KEY,
  COUNTRY_MARKERS,
  MULTI_MARKERS,
  REGION_BY_KEY,
  COUNTRIES,
  CITIES,
  REGIONS,
  COUNTRY_NAMES,
  buildMarketName,
  canonicalMarketName,
  parseMarketName,
  placesForCountry,
  type MarketFormValue,
} from "../lib/market-nomenclature";

let fail = 0;
const bad = (msg: string) => {
  fail++;
  console.error(`  ✗ ${msg}`);
};

// ── 1. Idempotencia ─────────────────────────────────────────────────────────
const CORPUS: string[] = [
  ...COUNTRIES.flatMap((c) => [c.name, ...c.aliases]),
  ...CITIES.flatMap((c) => [c.name, ...c.aliases]),
  ...REGIONS.flatMap((r) => [r.name, ...r.aliases]),
  "Panama", "PANAMA", "  panamá  ", "Panama City", "Ciudad de Panamá",
  "Ciudad de Panama - Panama", "Panamá | Ciudad de Panamá", "Panamá/Ciudad de Panamá",
  "Mexico", "México", "mexico df", "MEXICO DF", "CDMX", "Ciudad de Mexico",
  "México - CDMX", "Mexico - Ciudad de Mexico", "Mexico City",
  "Argentina", "Argentina (Pais)", "Argentina (País)", "Argentina - Varios",
  "argentina - varios", "Argentina — varios", "Argentina - Buenos Aires",
  "Estados Unidos - Varios", "Estados Unidos - T1", "Estados Unidos - T2",
  "EE.UU. - Miami", "USA - Miami", "usa", "Estados Unidos",
  "California", "New York", "Washington", "Georgia", "North Carolina",
  "Costa Rica", "costa rica", "Centroamérica", "centroamerica", "LATAM",
  "Latinoamérica", "Caribe", "Perú", "peru", "Brasil", "Brazil", "brasil - sao paulo",
  "República Dominicana", "Republica Dominicana - Punta Cana",
  "Santiago", "San José", "Chile - Santiago", "Costa Rica - San José",
  "Estados Unidos - T1", "Estados Unidos - Varios (T1)", "Estados Unidos - Varios T1",
  "Tier 1", "Estados Unidos - Tier 2",
  "Un Mercado Que No Existe", "Q3 Boosting", "",
];
console.log(`Idempotencia sobre ${CORPUS.length} entradas…`);
for (const raw of CORPUS) {
  const once = canonicalMarketName(raw).name;
  const twice = canonicalMarketName(once).name;
  if (once !== twice) bad(`no idempotente: "${raw}" → "${once}" → "${twice}"`);
}

// ── 2. Round-trip del form ──────────────────────────────────────────────────
const FORM_VALUES: MarketFormValue[] = [
  ...COUNTRY_NAMES.flatMap((country): MarketFormValue[] => [
    { level: "country", country },
    { level: "multi", country },
    { level: "multi", country, label: "T1" },
    { level: "multi", country, label: "Norte" },
    ...placesForCountry(country).map(
      (p): MarketFormValue => ({ level: "city", country, place: p.name }),
    ),
  ]),
  ...REGIONS.map((r): MarketFormValue => ({ level: "region", region: r.name })),
];
console.log(`Round-trip sobre ${FORM_VALUES.length} combinaciones del form…`);
for (const v of FORM_VALUES) {
  const name = buildMarketName(v);
  const canon = canonicalMarketName(name);
  if (canon.name !== name) bad(`el form arma un nombre no canónico: "${name}" → "${canon.name}"`);
  const back = parseMarketName(name);
  if (!back) { bad(`parseMarketName no reconoce "${name}"`); continue; }
  if (back.level !== v.level) bad(`"${name}": nivel ${back.level} ≠ ${v.level}`);
  if (buildMarketName(back) !== name) bad(`"${name}" no vuelve a sí mismo: "${buildMarketName(back)}"`);
}

// Dos mercados distintos nunca pueden compartir slug (es lo que rompía el
// catálogo). Chequeado sobre todas las combinaciones del form.
const bySlug = new Map<string, string>();
for (const v of FORM_VALUES) {
  const name = buildMarketName(v);
  const slug = canonicalMarketName(name).slug;
  const prev = bySlug.get(slug);
  if (prev && prev !== name) bad(`colisión de slug "${slug}": "${prev}" vs "${name}"`);
  bySlug.set(slug, name);
}

// ── 3. Casos reales ─────────────────────────────────────────────────────────
const CASES: [input: string, expected: string][] = [
  ["Panama", "Panamá (País)"],
  ["Panamá", "Panamá (País)"],
  ["panama city", "Panamá - Ciudad de Panamá"],
  ["Panama City", "Panamá - Ciudad de Panamá"],
  ["Ciudad de Panamá", "Panamá - Ciudad de Panamá"],
  ["PTY", "Panamá - Ciudad de Panamá"],
  ["Mexico", "México (País)"],
  ["México", "México (País)"],
  ["ciudad de mexico", "México - Ciudad de México"],
  ["CDMX", "México - Ciudad de México"],
  ["México DF", "México - Ciudad de México"],
  ["Mexico City", "México - Ciudad de México"],
  ["México - Cancun", "México - Cancún"],
  ["Argentina", "Argentina (País)"],
  ["Argentina (Pais)", "Argentina (País)"],
  ["Argentina - varios", "Argentina - Varios"],
  ["argentina — otros", "Argentina - Varios"],
  ["Costa Rica", "Costa Rica (País)"],
  ["Brazil", "Brasil (País)"],
  ["brasil - sao paulo", "Brasil - São Paulo"],
  ["Peru", "Perú (País)"],
  ["EE.UU.", "Estados Unidos (País)"],
  ["USA - Miami", "Estados Unidos - Miami"],
  ["Estados Unidos - Varios", "Estados Unidos - Varios"],
  // Félix: los 13 estados entran como plaza del país; los tiers, como grupo.
  ["California", "Estados Unidos - California"],
  ["New York", "Estados Unidos - New York"],
  ["North Carolina", "Estados Unidos - North Carolina"],
  ["Estados Unidos - T1", "Estados Unidos - Varios (T1)"],
  ["Estados Unidos - T2", "Estados Unidos - Varios (T2)"],
  ["Estados Unidos - Tier 1", "Estados Unidos - Varios (T1)"],
  // Regiones: sólo se unifica la ortografía.
  ["centroamerica", "Centroamérica"],
  ["Latinoamérica", "LATAM"],
  ["LATAM", "LATAM"],
  // Ambiguos y desconocidos: se dejan como están.
  ["Santiago", "Santiago"],
  ["San José", "San José"],
  ["Chile - Santiago", "Chile - Santiago"],
  ["Costa Rica - San Jose", "Costa Rica - San José"],
  ["Q3 Boosting", "Q3 Boosting"],
];
console.log(`Casos reales: ${CASES.length}…`);
for (const [input, expected] of CASES) {
  const got = canonicalMarketName(input).name;
  if (got !== expected) bad(`"${input}" → "${got}" (esperado "${expected}")`);
}

// Las formas ambiguas y las desconocidas tienen que salir marcadas como
// `unknown`, para que la migración las reporte en vez de tocarlas.
for (const raw of ["Santiago", "San José", "Q3 Boosting", "Arizona Norte"]) {
  const c = canonicalMarketName(raw);
  if (raw === "Arizona Norte" ? c.shape !== "unknown" : c.shape !== "unknown") {
    bad(`"${raw}" debería quedar sin mapear, quedó ${c.shape} → "${c.name}"`);
  }
}

// ── 3.b Ningún alias puede estar en dos diccionarios ────────────────────────
// Un alias compartido significa que el mismo texto resuelve a dos cosas según
// el orden en que se pregunte. Pasó con las siglas de dos letras: "ca" era
// Canadá, California y Centroamérica.
{
  const maps: [string, Iterable<string>][] = [
    ["país", COUNTRY_BY_KEY.keys()],
    ["plaza", CITY_BY_KEY.keys()],
    ["región", REGION_BY_KEY.keys()],
    ["marcador de país", COUNTRY_MARKERS],
    ["marcador de varios", MULTI_MARKERS],
  ];
  const seen = new Map<string, string>();
  for (const [dict, keys] of maps) {
    for (const k of keys) {
      const prev = seen.get(k);
      if (prev) bad(`alias "${k}" está en dos diccionarios: ${prev} y ${dict}`);
      else seen.set(k, dict);
    }
  }
  console.log(`Alias únicos: ${seen.size}…`);
}

// ── 4. Geocoding de las formas nuevas ───────────────────────────────────────
// El mapa de /analisis resuelve por slug Y por nombre (lib/market-geo.ts). Un
// nombre canónico que no matchea deja al mercado fuera del mapa, y un `level`
// equivocado lo pinta del color que no es (país = azul, plaza/región = bordó).
const GEO_CASES: [name: string, level: string | null][] = [
  ["Argentina (País)", "country"],
  ["México (País)", "country"],
  ["Panamá (País)", "country"],
  ["Costa Rica (País)", "country"],
  ["Estados Unidos (País)", "country"],
  ["México - Ciudad de México", "city"],
  ["Panamá - Ciudad de Panamá", "city"],
  ["Colombia - Bogotá", "city"],
  ["Estados Unidos - Miami", "city"],
  ["Estados Unidos - California", "city"],
  ["Estados Unidos - New York", "city"],
  ["Estados Unidos - Washington", "city"],
  ["Brasil - São Paulo", "city"],
  ["Argentina - Varios", "city"],
  ["Estados Unidos - Varios", "city"],
  ["Estados Unidos - Varios (T1)", "region"],
  ["Estados Unidos - Varios (T2)", "region"],
  ["Centroamérica", "region"],
  ["LATAM", "region"],
];
console.log(`Geocoding: ${GEO_CASES.length}…`);
for (const [name, level] of GEO_CASES) {
  const slug = canonicalMarketName(name).slug;
  const geo = resolveMarketGeo(slug, name);
  if (!geo) {
    bad(`"${name}" no geocodifica (queda fuera del mapa)`);
    continue;
  }
  if (geo.level !== level) bad(`"${name}": level ${geo.level} (esperado ${level})`);
}

// Cada plaza tiene que caer en SU centroide, no en el del país: si dos plazas
// del mismo país resuelven al mismo punto, las burbujas se apilan.
{
  const plazas = ["Ciudad de México", "Guadalajara", "Monterrey", "Cancún"];
  const seen = new Map<string, string>();
  for (const p of plazas) {
    const name = `México - ${p}`;
    const geo = resolveMarketGeo(canonicalMarketName(name).slug, name);
    if (!geo) { bad(`"${name}" no geocodifica`); continue; }
    const k = `${geo.lat},${geo.lng}`;
    const prev = seen.get(k);
    if (prev) bad(`"${name}" cae en el mismo punto que "${prev}" (${k})`);
    seen.set(k, name);
  }
}

if (fail) {
  console.error(`\n✗ ${fail} problema(s)`);
  process.exit(1);
}
console.log("\n✓ nomenclatura de mercados OK");
