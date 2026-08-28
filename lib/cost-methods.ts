// Mapeo cost_method → métrica principal (slug del catálogo).
// Para Flat/Other no hay métrica principal canónica.
export const COST_METHOD_PRIMARY_METRIC: Record<string, string | null> = {
  dCPV: "views",
  CPV: "views",
  dCPM: "impressions",
  CPM: "impressions",
  dCPC: "clicks",
  CPC: "clicks",
  dCPA: "conversions",
  CPA: "conversions",
  Flat: null,
  Other: null,
};

// Par tarifa↔delivery para auto-cálculo bidireccional, indexado por
// slug de la métrica direct (la "delivery"). Permite al editor del plan
// presentar la misma UX de doble cálculo para CUALQUIER indicador
// estimado que el planner agregue, no solo el principal del cost method.
//
//   delivery = (amount × multiplier) / rate
//   rate     = (amount × multiplier) / delivery
//
// (CPM tiene multiplier=1000 porque es "por cada mil"; el resto =1.)
//
// `frequency` queda fuera porque es un ratio (impressions/reach), no
// admite "costo unitario".
export const DIRECT_METRIC_RATES: Record<
  string,
  { rate: string; rateName: string; multiplier: number }
> = {
  impressions: { rate: "cpm", rateName: "CPM", multiplier: 1000 },
  clicks: { rate: "cpc", rateName: "CPC", multiplier: 1 },
  views: { rate: "cpv", rateName: "CPV", multiplier: 1 },
  conversions: { rate: "cpa", rateName: "CPA", multiplier: 1 },
  reach: { rate: "cpr", rateName: "CPR", multiplier: 1 },
  engagements: { rate: "cpe", rateName: "CPE", multiplier: 1 },
  followers: { rate: "cpf", rateName: "CPF", multiplier: 1 },
  leads: { rate: "cpl", rateName: "CPL", multiplier: 1 },
  installs: { rate: "cpi", rateName: "CPI", multiplier: 1 },
  visits: { rate: "cpvis", rateName: "CPVis", multiplier: 1 },
};

// Mapping cost_method → par (delegado a DIRECT_METRIC_RATES vía la métrica
// principal). Se mantiene exportado para no romper imports existentes.
export const COST_METHOD_PAIR: Record<
  string,
  { rate: string; delivery: string; multiplier: number } | null
> = Object.fromEntries(
  Object.entries(COST_METHOD_PRIMARY_METRIC).map(([cm, primary]) => {
    if (!primary) return [cm, null];
    const r = DIRECT_METRIC_RATES[primary];
    return r
      ? [cm, { rate: r.rate, delivery: primary, multiplier: r.multiplier }]
      : [cm, null];
  }),
);

export type CostMethod =
  | "dCPV"
  | "dCPC"
  | "dCPM"
  | "dCPA"
  | "CPM"
  | "CPC"
  | "CPV"
  | "CPA"
  | "Flat"
  | "Other";

export const COST_METHODS: CostMethod[] = [
  "dCPV", "dCPC", "dCPM", "dCPA", "CPM", "CPC", "CPV", "CPA", "Flat", "Other",
];

// ════════════════════════════════════════════════════════════════════════════
// Par tarifa↔delivery DERIVADO DEL CATÁLOGO del cliente.
// ════════════════════════════════════════════════════════════════════════════
//
// `DIRECT_METRIC_RATES` (arriba) sólo conoce los 10 slugs canónicos, así que
// toda métrica custom del cliente (tickets, LC tickets, reservas…) nacía sin
// columna Tarifa: el editor le pintaba un "—" y el planner sólo podía cargar
// delivery a mano.
//
// Pero el catálogo YA tiene la relación: una métrica calculated con fórmula
// `amount / tickets` ES, por definición, el costo unitario de `tickets`. Así
// que el par se deriva de ahí en vez de hardcodearse — igual que el Campaign
// Tracker deriva sus filas del catálogo y no de una lista fija. Métrica custom
// nueva = par nuevo, sin tocar código.
//
// El orden de precedencia importa, y arranca por lo que YA existe para no
// mover ni un dato de los planes cargados:
//   1. Par canónico confirmado por el catálogo — si el cliente tiene la
//      calculada canónica (`cpm` para impressions, `cpc` para clicks…) y su
//      fórmula apunta a esa misma delivery, ese es el par, con el multiplier
//      CANÓNICO (no el de la fórmula): así un `cpm` mal escrito en el catálogo,
//      sin el `× 1000`, no cambia la cuenta que vienen usando los planes.
//   2. Catálogo — cualquier otra calculated `amount / <delivery>` (con `× N`
//      opcional) define el par de esa delivery y RESERVA su slug de tarifa.
//   3. Fallback canónico — para las delivery que el catálogo no cubre, siempre
//      que su slug de tarifa no lo haya reservado ya un paso anterior (un
//      cliente que define "cpa = amount / tickets" no puede además heredar
//      `cpa` para `conversions`: serían dos deliveries pisándose la misma key).
//   4. Sin tarifa en el catálogo → `rate: null`. La columna Tarifa se habilita
//      igual (editarla define el delivery), pero el valor se deriva al vuelo de
//      `amount / delivery` en vez de persistirse. Lo único que se pierde hasta
//      que exista la calculada es el rate-anchoring al cambiar el monto.

export type MetricRatePair = {
  // Slug de metrics_catalog bajo el que se persiste la tarifa dentro de
  // metrics_json. null = el catálogo del cliente no tiene métrica de costo
  // para esta delivery (ver punto 3 arriba).
  rate: string | null;
  rateName: string;
  multiplier: number;
};

// Metadata mínima del catálogo que necesitamos. Compatible estructuralmente
// con las filas de `listMetricsForClient` y con MetricMeta de lib/plan-metrics.
export type RatePairMetric = {
  slug: string;
  name: string;
  kind: "direct" | "calculated";
  unit?: string | null;
  formula: string | null;
};

// Métricas direct que NO admiten tarifa porque son RATIOS, no volumen:
// "costo por frequency" no significa nada. `frequency` (impressions/reach) es
// la del catálogo estándar y ya estaba excluida antes de derivar los pares del
// catálogo; se mantiene por slug porque su `unit` del seed ("freq") no la
// delata. Para las custom del cliente alcanza con la unidad: una direct medida
// en % o en x es un ratio, y una en $ es plata (no hay "costo por dólares").
const NO_RATE_DIRECT_SLUGS = new Set(["frequency"]);
const NO_RATE_DIRECT_UNITS = new Set(["%", "x", "$"]);

function acceptsRate(m: RatePairMetric): boolean {
  if (NO_RATE_DIRECT_SLUGS.has(m.slug)) return false;
  return !NO_RATE_DIRECT_UNITS.has((m.unit ?? "").trim());
}

// Parseo de la fórmula del catálogo, mismo patrón que `evalFormula`
// (lib/plan-metrics.ts): "num / den" con "×N" opcional. Duplicado a propósito
// —son 8 líneas— para que este módulo siga sin dependencias.
function parseCostFormula(
  formula: string | null | undefined,
): { delivery: string; multiplier: number } | null {
  if (!formula) return null;
  let f = formula.toLowerCase().replace(/\s+/g, "");
  let multiplier = 1;
  const xMatch = f.match(/×(\d+)/);
  if (xMatch) {
    multiplier = Number.parseInt(xMatch[1], 10);
    f = f.replace(/×\d+/, "");
  }
  const m = f.match(/^([a-z0-9_]+)\/([a-z0-9_]+)$/);
  if (!m) return null;
  const [, num, den] = m;
  // Sólo "amount / X" es un costo unitario. "clicks / impressions" (CTR) o
  // "impressions / reach" (frequency) son ratios: no admiten tarifa.
  if (num !== "amount" || den === "amount") return null;
  return { delivery: den, multiplier };
}

export function buildMetricRatePairs(
  metrics: readonly RatePairMetric[],
): Record<string, MetricRatePair> {
  const pairs: Record<string, MetricRatePair> = {};
  const claimedRates = new Set<string>();
  const calculated = metrics.filter((m) => m.kind === "calculated");
  const bySlug = new Map(calculated.map((m) => [m.slug, m]));

  // 1. El par canónico gana si el catálogo lo confirma. Esto es lo que blinda
  //    a los planes existentes: `impressions` sigue apareando con `cpm` aunque
  //    el cliente tenga otra calculada sobre impressions ordenada antes.
  for (const [delivery, legacy] of Object.entries(DIRECT_METRIC_RATES)) {
    const canonical = bySlug.get(legacy.rate);
    if (!canonical) continue;
    const parsed = parseCostFormula(canonical.formula);
    if (parsed?.delivery !== delivery) continue;
    pairs[delivery] = {
      rate: canonical.slug,
      rateName: canonical.name,
      multiplier: legacy.multiplier,
    };
    claimedRates.add(canonical.slug);
  }

  // 2. Resto del catálogo: cada calculated "amount / <delivery>" define el par
  //    de su delivery. Primera que gane — si el cliente definiera dos costos
  //    para la misma delivery, el orden del catálogo (sortOrder) decide.
  for (const m of calculated) {
    const parsed = parseCostFormula(m.formula);
    if (!parsed) continue;
    if (pairs[parsed.delivery] || claimedRates.has(m.slug)) continue;
    pairs[parsed.delivery] = {
      rate: m.slug,
      rateName: m.name,
      multiplier: parsed.multiplier,
    };
    claimedRates.add(m.slug);
  }

  // 3. Fallback canónico para las delivery que el catálogo no cubrió.
  for (const [delivery, legacy] of Object.entries(DIRECT_METRIC_RATES)) {
    if (pairs[delivery] || claimedRates.has(legacy.rate)) continue;
    pairs[delivery] = { ...legacy };
    claimedRates.add(legacy.rate);
  }

  // 4. Direct del catálogo sin tarifa: par sin key de persistencia. Los ratios
  //    quedan afuera — no admiten costo unitario.
  for (const m of metrics) {
    if (m.kind !== "direct") continue;
    if (pairs[m.slug] || !acceptsRate(m)) continue;
    pairs[m.slug] = { rate: null, rateName: `Costo por ${m.name}`, multiplier: 1 };
  }

  return pairs;
}
