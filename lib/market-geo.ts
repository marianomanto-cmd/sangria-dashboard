// ════════════════════════════════════════════════════════════════════════════
// Geocoding de mercados → centroides (lat/lng) para el mapa de América.
// Los `markets` son per-cliente y vienen como nombres/slugs (países como
// "Costa Rica" o agrupaciones como "Centroamérica" / "LATAM"); no tienen
// coordenadas. Acá mapeamos los nombres/slugs conocidos a un centroide.
// Los que no matcheen se muestran en una lista aparte (no se fuerzan al mapa).
//
// Para agregar un mercado nuevo: sumá su forma normalizada a GEO con su
// centroide aproximado [lat, lng].
// ════════════════════════════════════════════════════════════════════════════

export type MarketGeo = {
  lat: number;
  lng: number;
  kind: "country" | "region";
};

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// Centroides aproximados. Keys ya normalizadas.
const GEO: Record<string, MarketGeo> = {
  // ── Países ──────────────────────────────────────────────
  argentina: { lat: -38.4, lng: -63.6, kind: "country" },
  bolivia: { lat: -16.3, lng: -63.6, kind: "country" },
  brasil: { lat: -10.3, lng: -53.2, kind: "country" },
  brazil: { lat: -10.3, lng: -53.2, kind: "country" },
  chile: { lat: -35.7, lng: -71.5, kind: "country" },
  colombia: { lat: 4.6, lng: -74.3, kind: "country" },
  "costa-rica": { lat: 9.7, lng: -83.8, kind: "country" },
  cuba: { lat: 21.5, lng: -79.5, kind: "country" },
  ecuador: { lat: -1.8, lng: -78.2, kind: "country" },
  "el-salvador": { lat: 13.8, lng: -88.9, kind: "country" },
  guatemala: { lat: 15.5, lng: -90.3, kind: "country" },
  honduras: { lat: 14.7, lng: -86.6, kind: "country" },
  mexico: { lat: 23.6, lng: -102.5, kind: "country" },
  nicaragua: { lat: 12.9, lng: -85.2, kind: "country" },
  panama: { lat: 8.5, lng: -80.1, kind: "country" },
  paraguay: { lat: -23.4, lng: -58.4, kind: "country" },
  peru: { lat: -9.2, lng: -75.0, kind: "country" },
  "puerto-rico": { lat: 18.2, lng: -66.5, kind: "country" },
  "republica-dominicana": { lat: 18.7, lng: -70.2, kind: "country" },
  "dominican-republic": { lat: 18.7, lng: -70.2, kind: "country" },
  uruguay: { lat: -32.5, lng: -55.8, kind: "country" },
  venezuela: { lat: 6.4, lng: -66.6, kind: "country" },
  "estados-unidos": { lat: 39.8, lng: -98.6, kind: "country" },
  usa: { lat: 39.8, lng: -98.6, kind: "country" },
  "united-states": { lat: 39.8, lng: -98.6, kind: "country" },
  canada: { lat: 56.1, lng: -106.3, kind: "country" },
  // ── Agrupaciones ────────────────────────────────────────
  centroamerica: { lat: 12.8, lng: -85.6, kind: "region" },
  "central-america": { lat: 12.8, lng: -85.6, kind: "region" },
  latam: { lat: -8, lng: -62, kind: "region" },
  latinoamerica: { lat: -8, lng: -62, kind: "region" },
  "latin-america": { lat: -8, lng: -62, kind: "region" },
  sudamerica: { lat: -15, lng: -60, kind: "region" },
  "south-america": { lat: -15, lng: -60, kind: "region" },
  norteamerica: { lat: 45, lng: -100, kind: "region" },
  "north-america": { lat: 45, lng: -100, kind: "region" },
  caribe: { lat: 18, lng: -73, kind: "region" },
  caribbean: { lat: 18, lng: -73, kind: "region" },
  andina: { lat: -10, lng: -75, kind: "region" },
  "region-andina": { lat: -10, lng: -75, kind: "region" },
  "cono-sur": { lat: -35, lng: -65, kind: "region" },
};

// Resuelve un mercado por slug y/o nombre. Devuelve null si no se reconoce.
export function resolveMarketGeo(
  slug: string | null,
  name: string | null,
): MarketGeo | null {
  for (const cand of [slug, name]) {
    if (!cand) continue;
    const hit = GEO[norm(cand)];
    if (hit) return hit;
  }
  return null;
}
