import type {
  BenchmarkRow,
  ScenarioMode,
  ScenarioRow,
} from "@/lib/simulator-types";

// Encuentra el benchmark que matchea la combinación (publisher × market ×
// costMethod). Si no hay market o costMethod en la fila, igual buscamos uno
// que coincida sólo con el publisher. Devuelve null si no hay match.
export function findBenchmark(
  benchmarks: BenchmarkRow[],
  row: ScenarioRow,
): BenchmarkRow | null {
  if (!row.publisherId) return null;
  // Match estricto primero.
  const exact = benchmarks.find(
    (b) =>
      b.publisherId === row.publisherId &&
      (row.marketId == null || b.marketId === row.marketId) &&
      (row.costMethod == null || b.costMethod === row.costMethod),
  );
  if (exact) return exact;
  // Fallback: cualquier benchmark de ese publisher (con más sample size).
  const fallback = benchmarks
    .filter((b) => b.publisherId === row.publisherId)
    .sort((a, b) => b.placements - a.placements)[0];
  return fallback ?? null;
}

// Dado modo + benchmark, devuelve el rate efectivo para cada métrica. En modo
// manual usa los overrides; si no hay benchmark, también cae a overrides.
export function effectiveRates(row: ScenarioRow, bench: BenchmarkRow | null) {
  if (row.mode === "manual" || !bench) {
    return {
      cpm: row.overrides.cpm ?? null,
      cpc: row.overrides.cpc ?? null,
      cpv: row.overrides.cpv ?? null,
      ctr: row.overrides.ctr ?? null,
      source: "manual" as const,
    };
  }
  const key = row.mode; // 'p25' | 'p50' | 'p75'
  return {
    cpm: bench.cpm[key],
    cpc: bench.cpc[key],
    cpv: bench.cpv[key],
    ctr: bench.ctr[key],
    source: "benchmark" as const,
  };
}

// Estimaciones de delivery a partir del cost method de la fila. Si el cost
// method es CPM/dCPM derivamos impressions; CPC derivamos clicks; CPV deriva
// views. CTR se usa para inferir clicks cuando ya derivamos impressions.
// Flat y Other no derivan nada — el planner ya sabe el delivery por afuera.
export type RowEstimate = {
  impressions: number | null;
  clicks: number | null;
  views: number | null;
};

export function estimateDelivery(
  row: ScenarioRow,
  rates: { cpm: number | null; cpc: number | null; cpv: number | null; ctr: number | null },
): RowEstimate {
  const out: RowEstimate = { impressions: null, clicks: null, views: null };
  const cm = row.costMethod;
  if (!cm) return out;

  const cmUp = cm.replace(/^d/, ""); // dCPM → CPM
  if (cmUp === "CPM" && rates.cpm && rates.cpm > 0) {
    out.impressions = (row.budgetUsd / rates.cpm) * 1000;
    if (rates.ctr && rates.ctr > 0) {
      out.clicks = (out.impressions * rates.ctr) / 100;
    }
  } else if (cmUp === "CPC" && rates.cpc && rates.cpc > 0) {
    out.clicks = row.budgetUsd / rates.cpc;
  } else if (cmUp === "CPV" && rates.cpv && rates.cpv > 0) {
    out.views = row.budgetUsd / rates.cpv;
  }
  return out;
}

// Suma de estimaciones de un set de filas + blended rates.
export type ScenarioTotals = {
  budgetUsd: number;
  impressions: number;
  clicks: number;
  views: number;
  blendedCpm: number | null; // sólo si hay impressions
  blendedCpc: number | null;
  blendedCpv: number | null;
};

export function aggregateTotals(
  rows: ScenarioRow[],
  benchmarks: BenchmarkRow[],
): ScenarioTotals {
  let budget = 0;
  let imps = 0;
  let clicks = 0;
  let views = 0;
  for (const row of rows) {
    const bench = findBenchmark(benchmarks, row);
    const rates = effectiveRates(row, bench);
    const est = estimateDelivery(row, rates);
    budget += row.budgetUsd || 0;
    if (est.impressions) imps += est.impressions;
    if (est.clicks) clicks += est.clicks;
    if (est.views) views += est.views;
  }
  return {
    budgetUsd: budget,
    impressions: imps,
    clicks,
    views,
    blendedCpm: imps > 0 ? (budget / imps) * 1000 : null,
    blendedCpc: clicks > 0 ? budget / clicks : null,
    blendedCpv: views > 0 ? budget / views : null,
  };
}

export const MODES: Array<{ value: ScenarioMode; label: string; hint: string }> = [
  { value: "p25", label: "P25", hint: "Agresivo: precios bajos del histórico" },
  { value: "p50", label: "P50", hint: "Mediana del histórico" },
  { value: "p75", label: "P75", hint: "Conservador: precios altos del histórico" },
  { value: "manual", label: "Manual", hint: "Overrides manuales (ignora benchmark)" },
];

// ── Promoción a plan real ───────────────────────────────────────────────────
//
// Cost method de una fila → métrica direct principal que aplica.
export function primaryMetricKeyFor(costMethod: string | null): string | null {
  if (!costMethod) return null;
  const cm = costMethod.replace(/^d/, "");
  if (cm === "CPM") return "impressions";
  if (cm === "CPC") return "clicks";
  if (cm === "CPV") return "views";
  if (cm === "CPA") return "conversions";
  return null;
}

// Dado una fila + el benchmark efectivo para esa fila, devuelve el
// metrics_json que se persiste en el placement promovido. A diferencia del
// builder (que solo muestra estimaciones derivadas), acá necesitamos
// persistir las direct metrics — el plan real las usa como goals.
export function placementMetricsFromRow(
  row: ScenarioRow,
  bench: BenchmarkRow | null,
): Record<string, number> {
  const rates = effectiveRates(row, bench);
  const est = estimateDelivery(row, rates);
  const result: Record<string, number> = {};
  if (est.impressions != null) result.impressions = Math.round(est.impressions);
  if (est.clicks != null) result.clicks = Math.round(est.clicks);
  if (est.views != null) result.views = Math.round(est.views);
  return result;
}

export function newRow(): ScenarioRow {
  return {
    id: crypto.randomUUID(),
    publisherId: null,
    marketId: null,
    formatText: null,
    costMethod: null,
    budgetUsd: 0,
    mode: "p50",
    overrides: {},
  };
}
