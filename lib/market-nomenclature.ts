// ════════════════════════════════════════════════════════════════════════════
// Nomenclatura canónica de MERCADOS del catálogo (`markets`).
//
// El catálogo venía sin regla: el mismo lugar entraba como "Panama",
// "Panamá", "Ciudad de Panamá", "Panama City" o "PTY" y quedaban cuatro
// mercados distintos para una sola plaza — el Análisis los contaba separados y
// el dropdown del editor mostraba repetidos.
//
// La regla, ahora, es una sola y siempre arranca por el PAÍS:
//
//   ┌──────────────────────┬────────────────────────┬─────────────────────────┐
//   │ Qué es el mercado    │ Forma                  │ Ejemplo                 │
//   ├──────────────────────┼────────────────────────┼─────────────────────────┤
//   │ el país entero       │ <País> (País)          │ Argentina (País)        │
//   │ una plaza            │ <País> - <Plaza>       │ México - Ciudad de Méx. │
//   │ varias plazas de un  │ <País> - Varios        │ Argentina - Varios      │
//   │ mismo país           │                        │                         │
//   │ una región supra-    │ <Región>               │ Centroamérica · LATAM   │
//   │ nacional             │                        │                         │
//   └──────────────────────┴────────────────────────┴─────────────────────────┘
//
// El separador es " - " (espacio, guión, espacio). El slug sale de `norm()`,
// que es la misma normalización que usa `slugify` en app/actions/markets.ts:
// "México - Ciudad de México" → `mexico-ciudad-de-mexico`. Eso es lo que hace
// imposible el duplicado: dos escrituras del mismo lugar canonizan al MISMO
// nombre y, por lo tanto, al mismo slug, y el unique (client_id, slug) las
// funde en una.
//
// Las regiones quedan fuera de la forma "País - …" a propósito: Centroamérica
// no tiene país que la anteceda. Se canoniza sólo su ortografía.
//
// ESTE ARCHIVO ES LA FUENTE DE VERDAD. El SQL que normalizó el catálogo en
// prod (db/markets-nomenclatura.sql) NO se escribe a mano: lo genera
// `npm run gen:markets-sql` a partir de estos diccionarios, para que la base y
// la app no puedan divergir.
// ════════════════════════════════════════════════════════════════════════════

// ── Normalización compartida ────────────────────────────────────────────────
// Misma forma que `slugify` (app/actions/markets.ts) y que `norm`
// (lib/market-geo.ts): minúsculas, sin tildes, todo lo no alfanumérico a "-".
export function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ── Diccionario de países ───────────────────────────────────────────────────
// `name` es la forma canónica (español, con tildes: es el idioma de Copa).
// `aliases` son las escrituras que se vieron o se pueden ver en el catálogo:
// inglés, sin tilde, siglas ISO/IATA. Las siglas de DOS letras son de PAÍS y de
// nadie más — el catálogo real las usa así ("US - La Jolla", "CO - Bogota")—,
// así que los estados de EE.UU. NO llevan las suyas: si no, "ca" sería Canadá y
// California al mismo tiempo, "co" Colombia y Colorado, "pa" Panamá y
// Pennsylvania. Félix escribe el estado completo, así que no se pierde nada.
// `npm run check:markets` falla si un alias se repite entre diccionarios.
type CountryDef = { name: string; aliases: string[] };

export const COUNTRIES: CountryDef[] = [
  { name: "Argentina", aliases: ["arg", "ar"] },
  { name: "Aruba", aliases: ["abw", "aw"] },
  { name: "Bahamas", aliases: ["the bahamas", "bhs", "bs"] },
  { name: "Barbados", aliases: ["brb", "bb"] },
  { name: "Belice", aliases: ["belize", "blz", "bz"] },
  { name: "Bolivia", aliases: ["bol", "bo"] },
  { name: "Brasil", aliases: ["brazil", "bra", "br"] },
  { name: "Canadá", aliases: ["canada", "can", "ca"] },
  { name: "Chile", aliases: ["chl", "cl"] },
  { name: "Colombia", aliases: ["col", "co"] },
  { name: "Costa Rica", aliases: ["cri", "cr"] },
  { name: "Cuba", aliases: ["cub", "cu"] },
  { name: "Curazao", aliases: ["curacao", "curaçao", "cuw", "cw"] },
  { name: "Ecuador", aliases: ["ecu", "ec"] },
  { name: "El Salvador", aliases: ["salvador", "slv", "sv"] },
  {
    name: "Estados Unidos",
    aliases: [
      "estados unidos de america",
      "eeuu",
      "ee uu",
      "ee.uu.",
      "ee. uu.",
      "usa",
      "u.s.a.",
      "us",
      "u.s.",
      "united states",
      "united states of america",
      "norteamerica usa",
    ],
  },
  { name: "Guatemala", aliases: ["gtm", "gt"] },
  { name: "Guyana", aliases: ["guy", "gy"] },
  { name: "Haití", aliases: ["haiti", "hti", "ht"] },
  { name: "Honduras", aliases: ["hnd", "hn"] },
  { name: "Jamaica", aliases: ["jam", "jm"] },
  { name: "México", aliases: ["mexico", "mejico", "mex", "mx"] },
  { name: "Nicaragua", aliases: ["nic", "ni"] },
  { name: "Panamá", aliases: ["panama", "pan", "pa"] },
  { name: "Paraguay", aliases: ["pry", "py"] },
  { name: "Perú", aliases: ["peru", "per", "pe"] },
  { name: "Puerto Rico", aliases: ["pri", "pr"] },
  {
    name: "República Dominicana",
    aliases: [
      "republica dominicana",
      "dominicana",
      "rep dominicana",
      "rep. dominicana",
      "dominican republic",
      "dom",
      "do",
      "rd",
    ],
  },
  { name: "Surinam", aliases: ["suriname", "sur", "sr"] },
  { name: "Trinidad y Tobago", aliases: ["trinidad and tobago", "trinidad & tobago", "trinidad", "tto", "tt"] },
  { name: "Uruguay", aliases: ["ury", "uy"] },
  { name: "Venezuela", aliases: ["ven", "ve"] },
];

// ── Diccionario de plazas ───────────────────────────────────────────────────
// `country` es el `name` canónico del país al que pertenece la plaza.
//
// `ambiguous: true` marca las plazas que NO se pueden resolver solas, porque
// el nombre pelado también es otra cosa:
//   • existe la misma ciudad en más de un país (Santiago → Chile y RD;
//     San José → Costa Rica y EE.UU.; Valencia → Venezuela y España),
//   • o el nombre es también un ESTADO de EE.UU. y otro cliente (Félix)
//     tiene su catálogo cargado por estado (New York, Washington, Georgia).
// Un mercado que dice sólo "Santiago" o sólo "New York" se deja como está y
// se reporta sin mapear: lo desambigua una persona escribiendo el país
// delante. Con el país delante ("Chile - Santiago") sí se canoniza.
//
// Las plazas de EE.UU. y Brasil van en su forma local (Miami, São Paulo), que
// es como las escribe el planner; el PAÍS siempre en español.
export type PlaceDef = {
  name: string;
  country: string;
  aliases: string[];
  /** No se resuelve sola: hace falta el país delante (ver arriba). */
  ambiguous?: boolean;
  /** "state" = estado/provincia; por defecto, ciudad. Sólo cambia cómo se agrupa en el form. */
  kind?: "state";
};

export const CITIES: PlaceDef[] = [
  // ── Panamá ────────────────────────────────────────────────────────────────
  { name: "Ciudad de Panamá", country: "Panamá", aliases: ["ciudad de panama", "panama city", "panamá city", "cd de panama", "cdad de panama", "pty"] },
  { name: "David", country: "Panamá", aliases: [], ambiguous: true },
  { name: "Colón", country: "Panamá", aliases: ["colon"], ambiguous: true },
  { name: "Bocas del Toro", country: "Panamá", aliases: ["bocas del toro", "boc"] },
  // ── México ────────────────────────────────────────────────────────────────
  { name: "Ciudad de México", country: "México", aliases: ["ciudad de mexico", "cdmx", "mexico df", "méxico df", "df", "mexico city", "distrito federal", "mex city"] },
  { name: "Guadalajara", country: "México", aliases: ["gdl"] },
  { name: "Monterrey", country: "México", aliases: ["mty"] },
  { name: "Cancún", country: "México", aliases: ["cancun", "cun"] },
  { name: "Los Cabos", country: "México", aliases: ["los cabos", "san jose del cabo", "cabo san lucas", "sjd"] },
  { name: "Puerto Vallarta", country: "México", aliases: ["pvr"] },
  { name: "Mérida", country: "México", aliases: ["merida", "mid"] },
  { name: "Tijuana", country: "México", aliases: ["tij"] },
  { name: "Querétaro", country: "México", aliases: ["queretaro", "qro"] },
  { name: "Puebla", country: "México", aliases: [] },
  { name: "Huatulco", country: "México", aliases: ["hux"] },
  // ── Colombia ──────────────────────────────────────────────────────────────
  { name: "Bogotá", country: "Colombia", aliases: ["bogota", "bog"] },
  { name: "Medellín", country: "Colombia", aliases: ["medellin", "mde"] },
  { name: "Cali", country: "Colombia", aliases: ["clo"] },
  { name: "Barranquilla", country: "Colombia", aliases: ["baq"] },
  { name: "Cartagena", country: "Colombia", aliases: ["ctg"] },
  { name: "Bucaramanga", country: "Colombia", aliases: ["bga"] },
  { name: "Pereira", country: "Colombia", aliases: ["pei"] },
  { name: "Santa Marta", country: "Colombia", aliases: ["smr"] },
  { name: "Armenia", country: "Colombia", aliases: ["axm"], ambiguous: true },
  { name: "Cúcuta", country: "Colombia", aliases: ["cucuta", "cuc"] },
  { name: "Montería", country: "Colombia", aliases: ["monteria", "mtr"] },
  // ── Argentina ─────────────────────────────────────────────────────────────
  { name: "Buenos Aires", country: "Argentina", aliases: ["caba", "capital federal", "bs as", "bsas", "eze", "aep"] },
  { name: "Córdoba", country: "Argentina", aliases: ["cordoba", "cor"], ambiguous: true },
  { name: "Mendoza", country: "Argentina", aliases: ["mdz"] },
  { name: "Rosario", country: "Argentina", aliases: ["ros"] },
  { name: "Salta", country: "Argentina", aliases: ["sla"] },
  { name: "Tucumán", country: "Argentina", aliases: ["tucuman", "san miguel de tucuman", "tuc"] },
  // ── Brasil ────────────────────────────────────────────────────────────────
  { name: "São Paulo", country: "Brasil", aliases: ["sao paulo", "san pablo", "gru"] },
  { name: "Río de Janeiro", country: "Brasil", aliases: ["rio de janeiro", "rio", "gig"] },
  { name: "Brasilia", country: "Brasil", aliases: ["brasília", "bsb"] },
  { name: "Belo Horizonte", country: "Brasil", aliases: ["cnf"] },
  { name: "Porto Alegre", country: "Brasil", aliases: ["poa"] },
  { name: "Manaos", country: "Brasil", aliases: ["manaus", "mao"] },
  { name: "Recife", country: "Brasil", aliases: ["rec"] },
  { name: "Fortaleza", country: "Brasil", aliases: ["for"] },
  { name: "Salvador de Bahía", country: "Brasil", aliases: ["salvador de bahia", "salvador bahia", "ssa"] },
  { name: "Curitiba", country: "Brasil", aliases: ["cwb"] },
  // ── Chile ─────────────────────────────────────────────────────────────────
  { name: "Santiago", country: "Chile", aliases: ["santiago de chile", "scl"], ambiguous: true },
  // ── Perú ──────────────────────────────────────────────────────────────────
  { name: "Lima", country: "Perú", aliases: ["lim"] },
  { name: "Cusco", country: "Perú", aliases: ["cuzco", "cuz"] },
  // ── Ecuador ───────────────────────────────────────────────────────────────
  { name: "Quito", country: "Ecuador", aliases: ["uio"] },
  { name: "Guayaquil", country: "Ecuador", aliases: ["gye"] },
  // ── Bolivia ───────────────────────────────────────────────────────────────
  { name: "La Paz", country: "Bolivia", aliases: ["lpb"] },
  { name: "Santa Cruz de la Sierra", country: "Bolivia", aliases: ["santa cruz de la sierra", "santa cruz", "vvi"] },
  { name: "Cochabamba", country: "Bolivia", aliases: ["cbb"] },
  // ── Cono sur / resto ──────────────────────────────────────────────────────
  { name: "Montevideo", country: "Uruguay", aliases: ["mvd"] },
  { name: "Asunción", country: "Paraguay", aliases: ["asuncion", "asu"] },
  { name: "Caracas", country: "Venezuela", aliases: ["ccs"] },
  { name: "Maracaibo", country: "Venezuela", aliases: ["mar"] },
  { name: "Valencia", country: "Venezuela", aliases: ["vln"], ambiguous: true },
  // ── Centroamérica ─────────────────────────────────────────────────────────
  { name: "San José", country: "Costa Rica", aliases: ["san jose", "sjo"], ambiguous: true },
  { name: "Liberia", country: "Costa Rica", aliases: ["lir"], ambiguous: true },
  { name: "Ciudad de Guatemala", country: "Guatemala", aliases: ["ciudad de guatemala", "guatemala city", "guate", "gua"] },
  { name: "San Salvador", country: "El Salvador", aliases: ["sal"] },
  { name: "San Pedro Sula", country: "Honduras", aliases: ["sap"] },
  { name: "Tegucigalpa", country: "Honduras", aliases: ["tgu"] },
  { name: "Roatán", country: "Honduras", aliases: ["roatan", "rtb"] },
  { name: "Managua", country: "Nicaragua", aliases: ["mga"] },
  { name: "Ciudad de Belice", country: "Belice", aliases: ["ciudad de belice", "belize city", "bze"] },
  // ── Caribe ────────────────────────────────────────────────────────────────
  { name: "Santo Domingo", country: "República Dominicana", aliases: ["sdq"] },
  { name: "Punta Cana", country: "República Dominicana", aliases: ["puj"] },
  { name: "Santiago de los Caballeros", country: "República Dominicana", aliases: ["santiago de los caballeros", "sti"] },
  { name: "San Juan", country: "Puerto Rico", aliases: ["sju"], ambiguous: true },
  { name: "La Habana", country: "Cuba", aliases: ["la habana", "habana", "havana", "hav"] },
  { name: "Kingston", country: "Jamaica", aliases: ["kin"] },
  { name: "Montego Bay", country: "Jamaica", aliases: ["mbj"] },
  { name: "Puerto Príncipe", country: "Haití", aliases: ["puerto principe", "port au prince", "port-au-prince", "pap"] },
  { name: "Puerto España", country: "Trinidad y Tobago", aliases: ["puerto espana", "port of spain", "pos"] },
  { name: "Oranjestad", country: "Aruba", aliases: ["aua"] },
  { name: "Willemstad", country: "Curazao", aliases: ["cur"] },
  { name: "Bridgetown", country: "Barbados", aliases: ["bgi"] },
  { name: "Nassau", country: "Bahamas", aliases: ["nas"] },
  { name: "Georgetown", country: "Guyana", aliases: ["geo"], ambiguous: true },
  { name: "Paramaribo", country: "Surinam", aliases: ["pbm"] },
  // ── Estados Unidos ────────────────────────────────────────────────────────
  { name: "Miami", country: "Estados Unidos", aliases: ["mia"] },
  { name: "Orlando", country: "Estados Unidos", aliases: ["mco"] },
  { name: "Tampa", country: "Estados Unidos", aliases: ["tpa"] },
  { name: "Fort Lauderdale", country: "Estados Unidos", aliases: ["fll"] },
  { name: "Los Angeles", country: "Estados Unidos", aliases: ["los angeles", "los ángeles", "lax"] },
  { name: "San Francisco", country: "Estados Unidos", aliases: ["sfo"] },
  { name: "Chicago", country: "Estados Unidos", aliases: ["ord"] },
  { name: "Boston", country: "Estados Unidos", aliases: ["bos"] },
  { name: "Washington D.C.", country: "Estados Unidos", aliases: ["washington dc", "washington d c", "iad", "dca"] },
  { name: "Denver", country: "Estados Unidos", aliases: ["den"] },
  { name: "Las Vegas", country: "Estados Unidos", aliases: ["las"] },
  { name: "Houston", country: "Estados Unidos", aliases: ["iah"] },
  { name: "Dallas", country: "Estados Unidos", aliases: ["dfw"] },
  { name: "Atlanta", country: "Estados Unidos", aliases: ["atl"] },
  { name: "Raleigh", country: "Estados Unidos", aliases: ["raleigh durham", "rdu"] },
  { name: "San Diego", country: "Estados Unidos", aliases: ["san"] },
  // El plan de San Diego de Copa se abre por plaza del condado, no por ciudad.
  { name: "La Jolla", country: "Estados Unidos", aliases: ["la joya"] },
  { name: "Coronado", country: "Estados Unidos", aliases: [] },
  { name: "Encinitas", country: "Estados Unidos", aliases: [] },
  { name: "Del Mar", country: "Estados Unidos", aliases: [] },
  { name: "Austin", country: "Estados Unidos", aliases: ["aus"] },
  { name: "Nueva Orleans", country: "Estados Unidos", aliases: ["nueva orleans", "new orleans", "msy"] },
  { name: "Baltimore", country: "Estados Unidos", aliases: ["bwi"] },
  { name: "Filadelfia", country: "Estados Unidos", aliases: ["philadelphia", "phl"] },
  { name: "Phoenix", country: "Estados Unidos", aliases: ["phx"] },
  { name: "Kansas City", country: "Estados Unidos", aliases: ["mci"] },
  { name: "Detroit", country: "Estados Unidos", aliases: ["dtw"] },
  // ── Estados de EE.UU. ─────────────────────────────────────────────────────
  // Félix planifica por ESTADO, no por ciudad: un estado es una plaza dentro
  // del país, igual que una ciudad, y entra en la misma forma "País - Plaza".
  { name: "Alabama", country: "Estados Unidos", aliases: [], kind: "state" },
  { name: "Alaska", country: "Estados Unidos", aliases: [], kind: "state" },
  { name: "Arizona", country: "Estados Unidos", aliases: [], kind: "state" },
  { name: "Arkansas", country: "Estados Unidos", aliases: [], kind: "state" },
  { name: "California", country: "Estados Unidos", aliases: [], kind: "state" },
  { name: "Colorado", country: "Estados Unidos", aliases: [], kind: "state" },
  { name: "Connecticut", country: "Estados Unidos", aliases: [], kind: "state" },
  { name: "Delaware", country: "Estados Unidos", aliases: [], kind: "state" },
  { name: "Florida", country: "Estados Unidos", aliases: [], kind: "state" },
  { name: "Georgia", country: "Estados Unidos", aliases: [], kind: "state" },
  { name: "Hawaii", country: "Estados Unidos", aliases: ["hawai", "hawái"], kind: "state" },
  { name: "Idaho", country: "Estados Unidos", aliases: [], kind: "state" },
  { name: "Illinois", country: "Estados Unidos", aliases: [], kind: "state" },
  { name: "Indiana", country: "Estados Unidos", aliases: [], kind: "state" },
  { name: "Iowa", country: "Estados Unidos", aliases: [], kind: "state" },
  { name: "Kansas", country: "Estados Unidos", aliases: [], kind: "state" },
  { name: "Kentucky", country: "Estados Unidos", aliases: [], kind: "state" },
  { name: "Louisiana", country: "Estados Unidos", aliases: ["luisiana"], kind: "state" },
  { name: "Maine", country: "Estados Unidos", aliases: [], kind: "state" },
  { name: "Maryland", country: "Estados Unidos", aliases: [], kind: "state" },
  { name: "Massachusetts", country: "Estados Unidos", aliases: [], kind: "state" },
  { name: "Michigan", country: "Estados Unidos", aliases: [], kind: "state" },
  { name: "Minnesota", country: "Estados Unidos", aliases: [], kind: "state" },
  { name: "Mississippi", country: "Estados Unidos", aliases: [], kind: "state" },
  { name: "Missouri", country: "Estados Unidos", aliases: [], kind: "state" },
  { name: "Montana", country: "Estados Unidos", aliases: [], kind: "state" },
  { name: "Nebraska", country: "Estados Unidos", aliases: [], kind: "state" },
  { name: "Nevada", country: "Estados Unidos", aliases: [], kind: "state" },
  { name: "New Hampshire", country: "Estados Unidos", aliases: ["nuevo hampshire"], kind: "state" },
  { name: "New Jersey", country: "Estados Unidos", aliases: ["nueva jersey"], kind: "state" },
  { name: "New Mexico", country: "Estados Unidos", aliases: ["nuevo mexico", "nuevo méxico"], kind: "state" },
  { name: "New York", country: "Estados Unidos", aliases: ["nueva york"], kind: "state" },
  { name: "North Carolina", country: "Estados Unidos", aliases: ["carolina del norte"], kind: "state" },
  { name: "North Dakota", country: "Estados Unidos", aliases: ["dakota del norte"], kind: "state" },
  { name: "Ohio", country: "Estados Unidos", aliases: [], kind: "state" },
  { name: "Oklahoma", country: "Estados Unidos", aliases: [], kind: "state" },
  { name: "Oregon", country: "Estados Unidos", aliases: [], kind: "state" },
  { name: "Pennsylvania", country: "Estados Unidos", aliases: ["pensilvania"], kind: "state" },
  { name: "Rhode Island", country: "Estados Unidos", aliases: [], kind: "state" },
  { name: "South Carolina", country: "Estados Unidos", aliases: ["carolina del sur"], kind: "state" },
  { name: "South Dakota", country: "Estados Unidos", aliases: ["dakota del sur"], kind: "state" },
  { name: "Tennessee", country: "Estados Unidos", aliases: [], kind: "state" },
  { name: "Texas", country: "Estados Unidos", aliases: [], kind: "state" },
  { name: "Utah", country: "Estados Unidos", aliases: [], kind: "state" },
  { name: "Vermont", country: "Estados Unidos", aliases: [], kind: "state" },
  { name: "Virginia", country: "Estados Unidos", aliases: ["virginia"], kind: "state" },
  { name: "Washington", country: "Estados Unidos", aliases: [], kind: "state" },
  { name: "West Virginia", country: "Estados Unidos", aliases: ["virginia occidental"], kind: "state" },
  { name: "Wisconsin", country: "Estados Unidos", aliases: [], kind: "state" },
  { name: "Wyoming", country: "Estados Unidos", aliases: [], kind: "state" },
  // ── Canadá ────────────────────────────────────────────────────────────────
  { name: "Toronto", country: "Canadá", aliases: ["yyz"] },
  { name: "Montreal", country: "Canadá", aliases: ["montréal", "yul"] },
];

// ── Regiones supranacionales ────────────────────────────────────────────────
// No entran en la forma "País - …": no tienen país que las anteceda. Se
// canoniza sólo su ortografía para que no convivan "LATAM" y "Latinoamérica".
type RegionDef = { name: string; aliases: string[] };

export const REGIONS: RegionDef[] = [
  { name: "Centroamérica", aliases: ["centroamerica", "centro america", "central america", "cam"] },
  { name: "Sudamérica", aliases: ["sudamerica", "sud america", "sudamérica", "south america", "america del sur", "américa del sur"] },
  { name: "Norteamérica", aliases: ["norteamerica", "norte america", "north america", "america del norte"] },
  { name: "LATAM", aliases: ["latam", "latinoamerica", "latinoamérica", "latino america", "latin america", "america latina", "américa latina"] },
  { name: "Caribe", aliases: ["caribbean", "el caribe"] },
  { name: "Región Andina", aliases: ["region andina", "andina", "paises andinos", "países andinos"] },
  { name: "Cono Sur", aliases: ["cono sur"] },
];

// ── Marcadores ──────────────────────────────────────────────────────────────
// Palabras que, en el lugar de la plaza, significan "el país entero".
export const COUNTRY_MARKERS = new Set([
  "pais", "país", "country", "nacional", "national", "total", "general",
  "todo-el-pais", "todo", "all",
].map(norm));

// Palabras que, en el lugar de la plaza, significan "varias plazas del país".
export const MULTI_MARKERS = new Set([
  "varios", "varias", "varias-ciudades", "varias-plazas", "multiples",
  "múltiples", "multiple", "multi", "otros", "otras", "resto", "mix",
  "varios-mercados", "several",
].map(norm));

// Sufijo canónico del país entero y de las multi-plaza.
export const COUNTRY_SUFFIX = "(País)";
export const MULTI_SUFFIX = "Varios";
export const SEPARATOR = " - ";

// ── Índices ─────────────────────────────────────────────────────────────────
// Los cuatro índices se exportan porque `scripts/gen-markets-sql.ts` emite el
// SQL de la migración a partir de ELLOS, no de los arrays: así el mapeo que
// corre en la base es exactamente el que corre en la app (mismo alias gana,
// mismo desempate) y no pueden divergir.
export const COUNTRY_BY_KEY = new Map<string, string>();
for (const c of COUNTRIES) {
  COUNTRY_BY_KEY.set(norm(c.name), c.name);
  for (const a of c.aliases) COUNTRY_BY_KEY.set(norm(a), c.name);
}

export const CITY_BY_KEY = new Map<string, PlaceDef>();
for (const c of CITIES) {
  CITY_BY_KEY.set(norm(c.name), c);
  for (const a of c.aliases) CITY_BY_KEY.set(norm(a), c);
}

export const REGION_BY_KEY = new Map<string, string>();
for (const r of REGIONS) {
  REGION_BY_KEY.set(norm(r.name), r.name);
  for (const a of r.aliases) REGION_BY_KEY.set(norm(a), r.name);
}

// ── Resultado ───────────────────────────────────────────────────────────────
export type MarketShape =
  | "country"  // el país entero          → "Argentina (País)"
  | "city"     // una plaza               → "México - Ciudad de México"
  | "multi"    // varias plazas del país  → "Argentina - Varios"
  | "region"   // agrupación supranacional→ "Centroamérica"
  | "unknown"; // no se reconoció: se deja como está

export type CanonicalMarket = {
  /** Nombre canónico. En `unknown` es el original, sólo con espacios normalizados. */
  name: string;
  /** Slug del nombre canónico — el que va a `markets.slug`. */
  slug: string;
  shape: MarketShape;
  /** País canónico, si se reconoció. */
  country: string | null;
  /** Plaza canónica, sólo en `shape: "city"`. */
  place: string | null;
  /** Etiqueta del grupo, sólo en `shape: "multi"`: "" si no tiene (ver `multiName`). */
  label: string | null;
  /** true si el nombre canónico difiere del que entró. */
  changed: boolean;
};

// Separadores que puede haber usado quien cargó el mercado.
const SPLIT_RE = /\s*[-–—|/:]\s*/;

// Title-case sólo si vino todo en minúsculas: si el planner escribió "T1",
// "CDMX" o "NY", su capitalización se respeta.
function titleIfLower(s: string): string {
  if (s !== s.toLowerCase()) return s;
  return s.replace(/\b[a-záéíóúüñ]/g, (ch) => ch.toUpperCase());
}

function collapse(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

// Un grupo de plazas puede necesitar etiqueta: dos agrupaciones distintas del
// mismo país no pueden llamarse las dos "Estados Unidos - Varios" (colisionan
// en el slug). Los tiers de Félix son exactamente ese caso →
// "Estados Unidos - Varios (T1)".
function multiName(country: string, label: string): string {
  const l = collapse(label);
  return l
    ? `${country}${SEPARATOR}${MULTI_SUFFIX} (${titleIfLower(l)})`
    : `${country}${SEPARATOR}${MULTI_SUFFIX}`;
}

// Reconoce la parte-plaza de un mercado multi-plaza: "Varios", "Varios (T1)",
// "Varios T1" y el tier pelado "T1" / "Tier 2" (así entraron los de Félix).
function parseMulti(rest: string): { label: string } | null {
  const cleaned = collapse(rest);
  const tier = cleaned.match(/^(?:t|tier)\s*[-.]?\s*(\d{1,2})$/i);
  if (tier) return { label: `T${tier[1]}` };
  const m = cleaned.match(/^([^\s(]+)\s*(?:\(([^()]*)\)|(.*))$/);
  if (!m || !MULTI_MARKERS.has(norm(m[1]))) return null;
  return { label: collapse(m[2] ?? m[3] ?? "") };
}

/**
 * Lleva un nombre de mercado libre a la nomenclatura canónica.
 * Nunca tira: lo que no reconoce vuelve como `shape: "unknown"` con el nombre
 * intacto, para que una persona lo resuelva a mano.
 */
export function canonicalMarketName(raw: string): CanonicalMarket {
  const original = collapse(raw ?? "");
  const done = (
    name: string,
    shape: MarketShape,
    country: string | null,
    place: string | null,
    label: string | null = null,
  ): CanonicalMarket => ({
    name,
    slug: norm(name),
    shape,
    country,
    place,
    label,
    changed: name !== original,
  });

  if (!original) return done("", "unknown", null, null);

  // 1) ¿Es una región supranacional? Match exacto sobre el nombre entero.
  const region = REGION_BY_KEY.get(norm(original));
  if (region) return done(region, "region", null, null);

  // 2) Paréntesis final: "Argentina (País)" o "Santiago (Chile)".
  let base = original;
  let parenCountry: string | null = null;
  let parenIsCountryMarker = false;
  const paren = original.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  if (paren) {
    const inner = norm(paren[2]);
    if (COUNTRY_MARKERS.has(inner)) {
      parenIsCountryMarker = true;
      base = collapse(paren[1]);
    } else if (COUNTRY_BY_KEY.has(inner)) {
      parenCountry = COUNTRY_BY_KEY.get(inner)!;
      base = collapse(paren[1]);
    }
    // Un paréntesis que no es ni país ni marcador (ej. "(Q1)") se deja donde
    // está: forma parte del nombre de la plaza.
  }
  if (!base) base = original;

  // 3) Partir por separador y buscar el país.
  const segs = base.split(SPLIT_RE).map(collapse).filter(Boolean);
  let country: string | null = parenCountry;
  let rest = "";

  if (country) {
    rest = segs.join(SEPARATOR);
  } else if (segs.length === 1) {
    const only = norm(segs[0]);
    if (COUNTRY_BY_KEY.has(only)) {
      country = COUNTRY_BY_KEY.get(only)!;
    } else {
      const city = CITY_BY_KEY.get(only);
      // Una plaza pelada sólo se resuelve si NO es ambigua (ver CITIES).
      if (city && !city.ambiguous) {
        country = city.country;
        rest = city.name;
      }
    }
  } else if (segs.length > 1) {
    const head = COUNTRY_BY_KEY.get(norm(segs[0]));
    const tail = COUNTRY_BY_KEY.get(norm(segs[segs.length - 1]));
    if (head) {
      country = head;
      rest = segs.slice(1).join(SEPARATOR);
    } else if (tail) {
      // Orden invertido: "Ciudad de México - México".
      country = tail;
      rest = segs.slice(0, -1).join(SEPARATOR);
    } else {
      // Sin país explícito: si el primer segmento es una plaza inequívoca, su
      // país lo aporta ella ("Ciudad de Panamá - Awareness").
      const city = CITY_BY_KEY.get(norm(segs[0]));
      if (city && !city.ambiguous) {
        country = city.country;
        rest = [city.name, ...segs.slice(1)].join(SEPARATOR);
      }
    }
  }

  // 3.b) Todavía sin país, y sin separador que ayude: buscar el país como
  //       PREFIJO de la clave normalizada. Es lo que destapa "Panama Country"
  //       (= Panamá entera), que no tiene guión y por eso no entraba por el
  //       split. El SQL generado siempre hizo esto; sin este paso, el TS y la
  //       base daban resultados distintos para el mismo nombre.
  let restIsKey = false;
  if (!country) {
    const key = norm(base);
    let best = "";
    for (const alias of COUNTRY_BY_KEY.keys()) {
      if (key.startsWith(`${alias}-`) && alias.length > best.length) best = alias;
    }
    if (best) {
      country = COUNTRY_BY_KEY.get(best)!;
      rest = key.slice(best.length + 1);
      restIsKey = true;
    }
  }

  // 4) Sin país reconocido → no se toca. Es la red de seguridad: mercados como
  //    "Santiago" o "Q3 Boosting" salen intactos y se listan aparte.
  if (!country) return done(original, "unknown", null, null);

  // 5) Resolver la plaza.
  const restKey = norm(rest);
  if (parenIsCountryMarker || !rest || COUNTRY_MARKERS.has(restKey)) {
    return done(`${country} ${COUNTRY_SUFFIX}`, "country", country, null, null);
  }
  if (MULTI_MARKERS.has(restKey)) {
    return done(multiName(country, ""), "multi", country, null, "");
  }
  const multi = parseMulti(rest);
  if (multi) {
    return done(multiName(country, multi.label), "multi", country, null, multi.label);
  }
  const city = CITY_BY_KEY.get(restKey);
  // Si el país salió del prefijo, el resto es un slug ("la-jolla"), no texto
  // que se pueda presentar. Sin plaza conocida se deja sin mapear, igual que
  // hace el SQL: una migración no inventa nombres.
  if (!city && restIsKey) return done(original, "unknown", null, null);
  const place = city ? city.name : titleIfLower(rest);
  return done(`${country}${SEPARATOR}${place}`, "city", country, place, null);
}

/** Slug canónico de un nombre de mercado (el que termina en `markets.slug`). */
export function canonicalMarketSlug(raw: string): string {
  return canonicalMarketName(raw).slug;
}

/** Texto de ayuda para los formularios del catálogo. */
export const NOMENCLATURE_HINT =
  "Siempre país primero: «Argentina (País)» para el país entero, " +
  "«México - Ciudad de México» para una plaza, «Argentina - Varios» para " +
  "varias plazas del mismo país. Las regiones (Centroamérica, LATAM) van solas.";


// ════════════════════════════════════════════════════════════════════════════
// API del formulario — cargar un mercado dejó de ser texto libre.
//
// La UI (components/market-picker.tsx) elige NIVEL + PAÍS + PLAZA de estas
// listas y arma el nombre con `buildMarketName`. `parseMarketName` hace el
// camino inverso para precargar el form al editar. Las dos funciones son
// consistentes con `canonicalMarketName`:
//     canonicalMarketName(buildMarketName(v)).name === buildMarketName(v)
// para todo `v` (lo cubre scripts/check-market-nomenclature.mjs).
// ════════════════════════════════════════════════════════════════════════════

export type MarketFormValue =
  | { level: "country"; country: string }
  | { level: "city"; country: string; place: string }
  | { level: "multi"; country: string; label?: string }
  | { level: "region"; region: string };

/** Arma el nombre canónico desde lo que eligió el form. */
export function buildMarketName(v: MarketFormValue): string {
  switch (v.level) {
    case "country":
      return `${collapse(v.country)} ${COUNTRY_SUFFIX}`;
    case "multi":
      return multiName(collapse(v.country), v.label ?? "");
    case "city": {
      const place = CITY_BY_KEY.get(norm(v.place))?.name ?? titleIfLower(collapse(v.place));
      return `${collapse(v.country)}${SEPARATOR}${place}`;
    }
    case "region":
      return REGION_BY_KEY.get(norm(v.region)) ?? collapse(v.region);
  }
}

/**
 * Precarga del form a partir de un nombre ya guardado. Devuelve null si el
 * nombre no entra en la taxonomía (mercados viejos sin normalizar): la UI cae
 * al modo libre para que una persona lo resuelva.
 */
export function parseMarketName(name: string): MarketFormValue | null {
  const c = canonicalMarketName(name);
  switch (c.shape) {
    case "country":
      return { level: "country", country: c.country! };
    case "city":
      return { level: "city", country: c.country!, place: c.place! };
    case "multi":
      return { level: "multi", country: c.country!, label: c.label ?? "" };
    case "region":
      return { level: "region", region: c.name };
    default:
      return null;
  }
}

/** Países del selector, ordenados en español. */
export const COUNTRY_NAMES: string[] = COUNTRIES.map((c) => c.name).sort((a, b) =>
  a.localeCompare(b, "es"),
);

/** Regiones supranacionales del selector. */
export const REGION_NAMES: string[] = REGIONS.map((r) => r.name);

const PLACES_BY_COUNTRY = new Map<string, PlaceDef[]>();
for (const c of CITIES) {
  const list = PLACES_BY_COUNTRY.get(c.country) ?? [];
  list.push(c);
  PLACES_BY_COUNTRY.set(c.country, list);
}
for (const list of PLACES_BY_COUNTRY.values()) {
  list.sort((a, b) => a.name.localeCompare(b.name, "es"));
}

/**
 * Plazas conocidas de un país, para el selector. Vacío no es error: el país
 * puede no tener plazas cargadas todavía y el form ofrece "Otra…" para
 * escribirla a mano (queda igual de canónica: "País - Plaza").
 */
export function placesForCountry(country: string): PlaceDef[] {
  return PLACES_BY_COUNTRY.get(country) ?? [];
}

/** true si el nombre ya está en su forma canónica. */
export function isCanonicalMarketName(name: string): boolean {
  const c = canonicalMarketName(name);
  return c.shape !== "unknown" && !c.changed;
}
