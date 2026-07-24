// ════════════════════════════════════════════════════════════════════════════
// Geocoding de mercados → centroide (lat/lng) + nombre del país en la topología
// (world-atlas) para el mapa de América. Todo se resuelve DESDE LA UI: los
// `markets` son per-cliente y vienen como nombres/slugs libres (países como
// "Costa Rica" o "Estados Unidos - Varios", o agrupaciones como "LATAM"); no
// tienen coordenadas ni se tocan en la DB. Acá mapeamos por:
//   1. match exacto del nombre/slug normalizado, y si no
//   2. match por "token": una clave conocida que aparece como palabra dentro
//      del nombre (ej. "estados-unidos-varios" → estados-unidos).
// Los que no matchean se listan aparte (no se fuerzan al mapa).
//
// Para sumar un mercado nuevo: agregá su forma normalizada a GEO con centroide
// [lat, lng] y, si es país, el `feature` (nombre exacto en world-atlas) para
// que el mapa pueda hacer zoom a su silueta.
// ════════════════════════════════════════════════════════════════════════════

export type MarketGeo = {
  lat: number;
  lng: number;
  kind: "country" | "region";
  // Nombre del país tal cual en world-atlas/countries-110m (para fitear el
  // zoom a la silueta del país). Solo para `kind: "country"`.
  feature?: string;
};

// Nivel del mercado, inferido por CÓMO matcheó (ver resolveMarketGeo):
//   • "country" — el nombre ES un país entero (match exacto a una key país).
//   • "city"    — el nombre contiene un país pero es más específico (match por
//                 token, ej. "Ciudad de Panamá", "México DF"): una plaza dentro
//                 del país, no el país entero.
//   • "region"  — agrupación supranacional (LATAM, Centroamérica…).
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

// Claves ordenadas por longitud desc para preferir el match más específico
// (ej. "estados-unidos" antes que "usa").
const GEO_KEYS = Object.keys(GEO).sort((a, b) => b.length - a.length);

// Resuelve un mercado por slug y/o nombre. Primero exacto; si no, busca una
// clave conocida que aparezca como token dentro del nombre normalizado.
export function resolveMarketGeo(
  slug: string | null,
  name: string | null,
): MarketGeoResolved | null {
  const cands = [slug, name]
    .filter((x): x is string => !!x)
    .map(norm)
    .filter(Boolean);

  // 1) match exacto → el nombre ES el país/región (nivel país o región).
  for (const m of cands) {
    const geo = GEO[m];
    if (geo) {
      return { ...geo, level: geo.kind === "region" ? "region" : "country" };
    }
  }
  // 2) match por token: la clave aparece como palabra (delimitada por "-"). Si
  // la key es un país, el mercado es más específico que el país entero → ciudad
  // (ej. "ciudad-de-panama" → panama). Si es región, sigue siendo región.
  for (const m of cands) {
    for (const key of GEO_KEYS) {
      const re = new RegExp(`(^|-)${key}(-|$)`);
      if (re.test(m)) {
        const geo = GEO[key];
        return { ...geo, level: geo.kind === "region" ? "region" : "city" };
      }
    }
  }
  return null;
}
