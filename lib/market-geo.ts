// ════════════════════════════════════════════════════════════════════════════
// Geocoding de mercados → centroide (lat/lng) + nombre del país en la topología
// (world-atlas) para el mapa de América. Todo se resuelve DESDE LA UI: los
// `markets` son per-cliente y vienen como nombres/slugs libres (países como
// "Costa Rica" o "Estados Unidos - Varios", o agrupaciones como "LATAM"); no
// tienen coordenadas ni se tocan en la DB. Acá mapeamos por:
//   1. match exacto del nombre/slug normalizado, y si no
//   2. match por "token": una clave conocida que aparece como palabra dentro
//      del nombre (ej. "estados-unidos-varios" → estados-unidos), prefiriendo
//      siempre la más específica (plaza > región > país).
// Los que no matchean se listan aparte (no se fuerzan al mapa).
//
// Para sumar un mercado nuevo: agregá su forma normalizada a GEO con centroide
// [lat, lng] y, si es país, el `feature` (nombre exacto en world-atlas) para
// que el mapa pueda hacer zoom a su silueta.
// ════════════════════════════════════════════════════════════════════════════

export type MarketGeo = {
  lat: number;
  lng: number;
  // "country" — el país entero. "city" — una plaza dentro de un país (ciudad o
  // estado). "region" — agrupación supranacional (LATAM, Centroamérica).
  kind: "country" | "region" | "city";
  // Nombre del país tal cual en world-atlas/countries-110m (para fitear el
  // zoom a la silueta del país). Solo para `kind: "country"`.
  feature?: string;
};

// Nivel del mercado (ver resolveMarketGeo):
//   • "country" — el nombre ES un país entero: match exacto a una key país,
//                 tolerando el sufijo calificador de la nomenclatura canónica
//                 ("Argentina (País)" → `argentina-pais` → `argentina`).
//   • "city"    — una plaza dentro de un país: o matcheó una key `city`
//                 (ciudad o estado), o matcheó un país por token y entonces el
//                 mercado es más específico que el país ("México - Cancún").
//   • "region"  — agrupación supranacional (LATAM, Centroamérica, los tiers).
// El mapa colorea País en azul para diferenciarlo de ciudad/región (bordó).
export type MarketLevel = "country" | "city" | "region";

export type MarketGeoResolved = MarketGeo & { level: MarketLevel };

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// Centroides aproximados. Keys ya normalizadas. `feature` = nombre en world-atlas.
const GEO: Record<string, MarketGeo> = {
  // ── Países ──────────────────────────────────────────────
  argentina: { lat: -38.4, lng: -63.6, kind: "country", feature: "Argentina" },
  bolivia: { lat: -16.3, lng: -63.6, kind: "country", feature: "Bolivia" },
  brasil: { lat: -10.3, lng: -53.2, kind: "country", feature: "Brazil" },
  brazil: { lat: -10.3, lng: -53.2, kind: "country", feature: "Brazil" },
  chile: { lat: -35.7, lng: -71.5, kind: "country", feature: "Chile" },
  colombia: { lat: 4.6, lng: -74.3, kind: "country", feature: "Colombia" },
  "costa-rica": { lat: 9.7, lng: -83.8, kind: "country", feature: "Costa Rica" },
  cuba: { lat: 21.5, lng: -79.5, kind: "country", feature: "Cuba" },
  ecuador: { lat: -1.8, lng: -78.2, kind: "country", feature: "Ecuador" },
  "el-salvador": { lat: 13.8, lng: -88.9, kind: "country", feature: "El Salvador" },
  guatemala: { lat: 15.5, lng: -90.3, kind: "country", feature: "Guatemala" },
  honduras: { lat: 14.7, lng: -86.6, kind: "country", feature: "Honduras" },
  mexico: { lat: 23.6, lng: -102.5, kind: "country", feature: "Mexico" },
  nicaragua: { lat: 12.9, lng: -85.2, kind: "country", feature: "Nicaragua" },
  panama: { lat: 8.5, lng: -80.1, kind: "country", feature: "Panama" },
  paraguay: { lat: -23.4, lng: -58.4, kind: "country", feature: "Paraguay" },
  peru: { lat: -9.2, lng: -75.0, kind: "country", feature: "Peru" },
  "puerto-rico": { lat: 18.2, lng: -66.5, kind: "country", feature: "Puerto Rico" },
  "republica-dominicana": { lat: 18.7, lng: -70.2, kind: "country", feature: "Dominican Rep." },
  "dominican-republic": { lat: 18.7, lng: -70.2, kind: "country", feature: "Dominican Rep." },
  uruguay: { lat: -32.5, lng: -55.8, kind: "country", feature: "Uruguay" },
  venezuela: { lat: 6.4, lng: -66.6, kind: "country", feature: "Venezuela" },
  "estados-unidos": { lat: 39.8, lng: -98.6, kind: "country", feature: "United States of America" },
  usa: { lat: 39.8, lng: -98.6, kind: "country", feature: "United States of America" },
  "united-states": { lat: 39.8, lng: -98.6, kind: "country", feature: "United States of America" },
  eeuu: { lat: 39.8, lng: -98.6, kind: "country", feature: "United States of America" },
  "ee-uu": { lat: 39.8, lng: -98.6, kind: "country", feature: "United States of America" },
  canada: { lat: 56.1, lng: -106.3, kind: "country", feature: "Canada" },
  // ── Estados de EE.UU. y tiers de Félix ──────────────────────────────────
  // Los dos TIERS de Félix. Cada línea del plan corre sobre TODOS los estados
  // del tier a la vez, así que el tier —no el estado— es lo que entra en el
  // `market_id`. Centroide = promedio de los estados que lo componen, para que
  // las dos burbujas no se pisen. Se dejan las dos formas: la canónica de hoy
  // ("Estados Unidos - Varios (T1)") y la vieja, por si queda algún slug sin
  // migrar.
  "estados-unidos-varios-t1": { lat: 36.1, lng: -90.3, kind: "region" }, // CA NY NJ TX FL
  "estados-unidos-varios-t2": { lat: 38.0, lng: -96.7, kind: "region" }, // AZ IL CO NC GA WA PA NM
  "estados-unidos-t1": { lat: 36.1, lng: -90.3, kind: "region" },
  "estados-unidos-t2": { lat: 38.0, lng: -96.7, kind: "region" },
  // Los 50 estados. Van como `city`: un estado es una plaza DENTRO del país
  // (world-atlas/countries-110m no tiene siluetas sub-nacionales, así que no
  // hay `feature` al que fitear — se fitean por centroide).
  alabama: { lat: 32.8, lng: -86.8, kind: "city" },
  alaska: { lat: 63.6, lng: -152.5, kind: "city" },
  arizona: { lat: 34.3, lng: -111.7, kind: "city" },
  arkansas: { lat: 34.8, lng: -92.4, kind: "city" },
  california: { lat: 37.2, lng: -119.7, kind: "city" },
  colorado: { lat: 39.0, lng: -105.5, kind: "city" },
  connecticut: { lat: 41.6, lng: -72.7, kind: "city" },
  delaware: { lat: 39.0, lng: -75.5, kind: "city" },
  florida: { lat: 28.6, lng: -82.4, kind: "city" },
  georgia: { lat: 32.6, lng: -83.4, kind: "city" },
  hawaii: { lat: 20.8, lng: -156.3, kind: "city" },
  idaho: { lat: 44.4, lng: -114.6, kind: "city" },
  illinois: { lat: 40.0, lng: -89.2, kind: "city" },
  indiana: { lat: 39.9, lng: -86.3, kind: "city" },
  iowa: { lat: 42.1, lng: -93.5, kind: "city" },
  kansas: { lat: 38.5, lng: -98.4, kind: "city" },
  kentucky: { lat: 37.5, lng: -85.3, kind: "city" },
  louisiana: { lat: 31.1, lng: -92.0, kind: "city" },
  maine: { lat: 45.4, lng: -69.2, kind: "city" },
  maryland: { lat: 39.0, lng: -76.8, kind: "city" },
  massachusetts: { lat: 42.3, lng: -71.8, kind: "city" },
  michigan: { lat: 44.3, lng: -85.4, kind: "city" },
  minnesota: { lat: 46.3, lng: -94.3, kind: "city" },
  mississippi: { lat: 32.7, lng: -89.7, kind: "city" },
  missouri: { lat: 38.4, lng: -92.5, kind: "city" },
  montana: { lat: 47.0, lng: -109.6, kind: "city" },
  nebraska: { lat: 41.5, lng: -99.8, kind: "city" },
  nevada: { lat: 39.3, lng: -116.6, kind: "city" },
  "new-hampshire": { lat: 43.7, lng: -71.6, kind: "city" },
  "new-jersey": { lat: 40.1, lng: -74.7, kind: "city" },
  "new-mexico": { lat: 34.4, lng: -106.1, kind: "city" },
  "new-york": { lat: 43.0, lng: -75.5, kind: "city" },
  "north-carolina": { lat: 35.5, lng: -79.4, kind: "city" },
  "north-dakota": { lat: 47.4, lng: -100.5, kind: "city" },
  ohio: { lat: 40.3, lng: -82.8, kind: "city" },
  oklahoma: { lat: 35.6, lng: -97.5, kind: "city" },
  oregon: { lat: 43.9, lng: -120.6, kind: "city" },
  pennsylvania: { lat: 40.9, lng: -77.8, kind: "city" },
  "rhode-island": { lat: 41.7, lng: -71.6, kind: "city" },
  "south-carolina": { lat: 33.9, lng: -80.9, kind: "city" },
  "south-dakota": { lat: 44.4, lng: -100.2, kind: "city" },
  tennessee: { lat: 35.8, lng: -86.4, kind: "city" },
  texas: { lat: 31.5, lng: -99.3, kind: "city" },
  utah: { lat: 39.3, lng: -111.7, kind: "city" },
  vermont: { lat: 44.1, lng: -72.7, kind: "city" },
  virginia: { lat: 37.5, lng: -78.8, kind: "city" },
  washington: { lat: 47.4, lng: -120.5, kind: "city" },
  "west-virginia": { lat: 38.6, lng: -80.6, kind: "city" },
  wisconsin: { lat: 44.6, lng: -89.7, kind: "city" },
  wyoming: { lat: 43.0, lng: -107.6, kind: "city" },
  // ── Plazas (ciudades) ───────────────────────────────────────────────────
  // Centroides de las plazas del diccionario de `lib/market-nomenclature.ts`.
  // Un mercado "México - Ciudad de México" matchea acá por token y la burbuja
  // cae sobre la ciudad, no sobre el centroide del país (antes todas las plazas
  // de un mismo país se apilaban en el mismo punto).
  "ciudad-de-panama": { lat: 8.98, lng: -79.52, kind: "city" },
  david: { lat: 8.43, lng: -82.43, kind: "city" },
  colon: { lat: 9.36, lng: -79.9, kind: "city" },
  "bocas-del-toro": { lat: 9.34, lng: -82.24, kind: "city" },
  "ciudad-de-mexico": { lat: 19.43, lng: -99.13, kind: "city" },
  guadalajara: { lat: 20.67, lng: -103.35, kind: "city" },
  monterrey: { lat: 25.69, lng: -100.32, kind: "city" },
  cancun: { lat: 21.16, lng: -86.85, kind: "city" },
  "los-cabos": { lat: 22.89, lng: -109.91, kind: "city" },
  "puerto-vallarta": { lat: 20.62, lng: -105.23, kind: "city" },
  merida: { lat: 20.97, lng: -89.62, kind: "city" },
  tijuana: { lat: 32.51, lng: -117.04, kind: "city" },
  queretaro: { lat: 20.59, lng: -100.39, kind: "city" },
  puebla: { lat: 19.04, lng: -98.2, kind: "city" },
  huatulco: { lat: 15.77, lng: -96.13, kind: "city" },
  bogota: { lat: 4.71, lng: -74.07, kind: "city" },
  medellin: { lat: 6.25, lng: -75.56, kind: "city" },
  cali: { lat: 3.44, lng: -76.52, kind: "city" },
  barranquilla: { lat: 10.97, lng: -74.8, kind: "city" },
  cartagena: { lat: 10.39, lng: -75.51, kind: "city" },
  bucaramanga: { lat: 7.12, lng: -73.13, kind: "city" },
  pereira: { lat: 4.81, lng: -75.69, kind: "city" },
  "santa-marta": { lat: 11.24, lng: -74.2, kind: "city" },
  armenia: { lat: 4.53, lng: -75.68, kind: "city" },
  cucuta: { lat: 7.89, lng: -72.5, kind: "city" },
  monteria: { lat: 8.75, lng: -75.88, kind: "city" },
  "buenos-aires": { lat: -34.6, lng: -58.44, kind: "city" },
  cordoba: { lat: -31.42, lng: -64.19, kind: "city" },
  mendoza: { lat: -32.89, lng: -68.84, kind: "city" },
  rosario: { lat: -32.95, lng: -60.65, kind: "city" },
  salta: { lat: -24.79, lng: -65.41, kind: "city" },
  tucuman: { lat: -26.82, lng: -65.22, kind: "city" },
  "sao-paulo": { lat: -23.55, lng: -46.63, kind: "city" },
  "rio-de-janeiro": { lat: -22.91, lng: -43.17, kind: "city" },
  brasilia: { lat: -15.79, lng: -47.88, kind: "city" },
  "belo-horizonte": { lat: -19.92, lng: -43.94, kind: "city" },
  "porto-alegre": { lat: -30.03, lng: -51.23, kind: "city" },
  manaos: { lat: -3.12, lng: -60.02, kind: "city" },
  recife: { lat: -8.05, lng: -34.88, kind: "city" },
  fortaleza: { lat: -3.73, lng: -38.53, kind: "city" },
  "salvador-de-bahia": { lat: -12.97, lng: -38.51, kind: "city" },
  curitiba: { lat: -25.43, lng: -49.27, kind: "city" },
  santiago: { lat: -33.45, lng: -70.67, kind: "city" },
  lima: { lat: -12.05, lng: -77.04, kind: "city" },
  cusco: { lat: -13.53, lng: -71.97, kind: "city" },
  quito: { lat: -0.18, lng: -78.47, kind: "city" },
  guayaquil: { lat: -2.17, lng: -79.92, kind: "city" },
  "la-paz": { lat: -16.5, lng: -68.15, kind: "city" },
  "santa-cruz-de-la-sierra": { lat: -17.78, lng: -63.18, kind: "city" },
  cochabamba: { lat: -17.39, lng: -66.16, kind: "city" },
  montevideo: { lat: -34.9, lng: -56.16, kind: "city" },
  asuncion: { lat: -25.28, lng: -57.63, kind: "city" },
  caracas: { lat: 10.49, lng: -66.88, kind: "city" },
  maracaibo: { lat: 10.65, lng: -71.64, kind: "city" },
  valencia: { lat: 10.16, lng: -68.01, kind: "city" },
  "san-jose": { lat: 9.93, lng: -84.09, kind: "city" },
  liberia: { lat: 10.63, lng: -85.44, kind: "city" },
  "ciudad-de-guatemala": { lat: 14.63, lng: -90.51, kind: "city" },
  "san-salvador": { lat: 13.69, lng: -89.19, kind: "city" },
  "san-pedro-sula": { lat: 15.5, lng: -88.03, kind: "city" },
  tegucigalpa: { lat: 14.07, lng: -87.19, kind: "city" },
  roatan: { lat: 16.33, lng: -86.53, kind: "city" },
  managua: { lat: 12.11, lng: -86.24, kind: "city" },
  "ciudad-de-belice": { lat: 17.5, lng: -88.2, kind: "city" },
  "santo-domingo": { lat: 18.49, lng: -69.93, kind: "city" },
  "punta-cana": { lat: 18.58, lng: -68.4, kind: "city" },
  "santiago-de-los-caballeros": { lat: 19.45, lng: -70.7, kind: "city" },
  "san-juan": { lat: 18.47, lng: -66.11, kind: "city" },
  "la-habana": { lat: 23.11, lng: -82.37, kind: "city" },
  kingston: { lat: 17.97, lng: -76.79, kind: "city" },
  "montego-bay": { lat: 18.47, lng: -77.92, kind: "city" },
  "puerto-principe": { lat: 18.54, lng: -72.34, kind: "city" },
  "puerto-espana": { lat: 10.65, lng: -61.51, kind: "city" },
  oranjestad: { lat: 12.52, lng: -70.03, kind: "city" },
  willemstad: { lat: 12.11, lng: -68.93, kind: "city" },
  bridgetown: { lat: 13.1, lng: -59.62, kind: "city" },
  nassau: { lat: 25.06, lng: -77.34, kind: "city" },
  georgetown: { lat: 6.8, lng: -58.16, kind: "city" },
  paramaribo: { lat: 5.85, lng: -55.2, kind: "city" },
  miami: { lat: 25.77, lng: -80.19, kind: "city" },
  orlando: { lat: 28.54, lng: -81.38, kind: "city" },
  tampa: { lat: 27.95, lng: -82.46, kind: "city" },
  "fort-lauderdale": { lat: 26.12, lng: -80.14, kind: "city" },
  "los-angeles": { lat: 34.05, lng: -118.24, kind: "city" },
  "san-francisco": { lat: 37.77, lng: -122.42, kind: "city" },
  chicago: { lat: 41.88, lng: -87.63, kind: "city" },
  boston: { lat: 42.36, lng: -71.06, kind: "city" },
  "washington-d-c": { lat: 38.91, lng: -77.04, kind: "city" },
  denver: { lat: 39.74, lng: -104.99, kind: "city" },
  "las-vegas": { lat: 36.17, lng: -115.14, kind: "city" },
  houston: { lat: 29.76, lng: -95.37, kind: "city" },
  dallas: { lat: 32.78, lng: -96.8, kind: "city" },
  atlanta: { lat: 33.75, lng: -84.39, kind: "city" },
  raleigh: { lat: 35.78, lng: -78.64, kind: "city" },
  "san-diego": { lat: 32.72, lng: -117.16, kind: "city" },
  austin: { lat: 30.27, lng: -97.74, kind: "city" },
  "nueva-orleans": { lat: 29.95, lng: -90.07, kind: "city" },
  baltimore: { lat: 39.29, lng: -76.61, kind: "city" },
  filadelfia: { lat: 39.95, lng: -75.17, kind: "city" },
  phoenix: { lat: 33.45, lng: -112.07, kind: "city" },
  "kansas-city": { lat: 39.1, lng: -94.58, kind: "city" },
  detroit: { lat: 42.33, lng: -83.05, kind: "city" },
  toronto: { lat: 43.65, lng: -79.38, kind: "city" },
  montreal: { lat: 45.5, lng: -73.57, kind: "city" },
  // ── Agrupaciones (sin feature: se fitean por centroide + span) ──────────
  centroamerica: { lat: 12.8, lng: -85.6, kind: "region" },
  "central-america": { lat: 12.8, lng: -85.6, kind: "region" },
  "centro-america": { lat: 12.8, lng: -85.6, kind: "region" },
  latam: { lat: -8, lng: -62, kind: "region" },
  latinoamerica: { lat: -8, lng: -62, kind: "region" },
  "latino-america": { lat: -8, lng: -62, kind: "region" },
  "latin-america": { lat: -8, lng: -62, kind: "region" },
  sudamerica: { lat: -15, lng: -60, kind: "region" },
  "sud-america": { lat: -15, lng: -60, kind: "region" },
  "south-america": { lat: -15, lng: -60, kind: "region" },
  norteamerica: { lat: 45, lng: -100, kind: "region" },
  "norte-america": { lat: 45, lng: -100, kind: "region" },
  "north-america": { lat: 45, lng: -100, kind: "region" },
  caribe: { lat: 18, lng: -73, kind: "region" },
  caribbean: { lat: 18, lng: -73, kind: "region" },
  andina: { lat: -10, lng: -75, kind: "region" },
  "region-andina": { lat: -10, lng: -75, kind: "region" },
  "cono-sur": { lat: -35, lng: -65, kind: "region" },
};

// Claves ordenadas de más específica a menos: primero por tipo (una plaza gana
// sobre la región, y la región sobre el país) y después por longitud. Es lo que
// hace que "estados-unidos-california" caiga en California y no en el centroide
// de EE.UU., y que "santiago-de-los-caballeros" no matchee "santiago".
const KIND_RANK: Record<MarketGeo["kind"], number> = { city: 2, region: 1, country: 0 };
const GEO_KEYS = Object.keys(GEO).sort(
  (a, b) => KIND_RANK[GEO[b].kind] - KIND_RANK[GEO[a].kind] || b.length - a.length,
);

// Sufijos que CALIFICAN el nombre en vez de hacerlo más específico: el mercado
// "Argentina (País)" ES Argentina entera. Sin esto, el "-pais" del slug hacía
// fallar el match exacto y el mercado terminaba degradado a nivel ciudad.
const QUALIFIER_SUFFIXES = ["-pais", "-country", "-nacional", "-total"];

function stripQualifier(m: string): string {
  for (const suf of QUALIFIER_SUFFIXES) {
    if (m.endsWith(suf)) return m.slice(0, -suf.length);
  }
  return m;
}

function levelOf(kind: MarketGeo["kind"], exact: boolean): MarketLevel {
  if (kind === "region") return "region";
  if (kind === "city") return "city";
  // País: exacto = el país entero; por token = algo más chico adentro del país.
  return exact ? "country" : "city";
}

// Resuelve un mercado por slug y/o nombre. Primero exacto; si no, busca una
// clave conocida que aparezca como token dentro del nombre normalizado.
export function resolveMarketGeo(
  slug: string | null,
  name: string | null,
): MarketGeoResolved | null {
  const cands = [slug, name]
    .filter((x): x is string => !!x)
    .map(norm)
    .filter(Boolean)
    .flatMap((m) => {
      const s = stripQualifier(m);
      return s === m ? [m] : [m, s];
    });

  // 1) match exacto → el nombre ES ese país / plaza / región.
  for (const m of cands) {
    const geo = GEO[m];
    if (geo) return { ...geo, level: levelOf(geo.kind, true) };
  }
  // 2) match por token: la clave aparece como palabra (delimitada por "-"). Si
  // la key es un país, el mercado es más específico que el país entero → ciudad
  // (ej. "ciudad-de-panama" → panama). Si es plaza o región, conserva su nivel.
  for (const m of cands) {
    for (const key of GEO_KEYS) {
      const re = new RegExp(`(^|-)${key}(-|$)`);
      if (re.test(m)) {
        const geo = GEO[key];
        return { ...geo, level: levelOf(geo.kind, false) };
      }
    }
  }
  return null;
}
