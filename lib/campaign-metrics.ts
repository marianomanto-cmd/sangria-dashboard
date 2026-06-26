// Métricas del Campaign Tracker.
//
// Los GOALS salen del plan vigente: `amount` = placement.amountUsd y cada
// métrica delivery (impressions, views, clicks…) = placement.metricsJson[key].
// La trafficker carga el valor REAL acumulado de esas mismas métricas direct.
// Las métricas calculadas (CPM, CTR, ROAS, CPT…) NO se cargan ni se persisten:
// se derivan on-the-fly tanto para el goal como para el real con las fórmulas
// del metrics_catalog del cliente (evalFormula en lib/plan-metrics.ts). Qué
// métricas son direct vs calculated sale del catálogo per-cliente, no de una
// lista hardcodeada.

import { evalFormula, formulaDirectInputs } from "@/lib/plan-metrics";

export type MetricUnit = "$" | "%" | "x" | "count";

// Definición mínima de una métrica del catálogo del cliente (metrics_catalog)
// que el tracker necesita para construir filas: las direct se cargan a mano;
// las calculated se derivan con su fórmula. La clasificación direct vs
// calculated sale del catálogo per-cliente (NO de una lista hardcodeada), así
// el tracker muestra TODAS las métricas que el plan realmente usa — incluidas
// las custom del cliente (tickets, reservas, etc.).
export type CatalogMetricDef = {
  slug: string;
  name: string;
  kind: "direct" | "calculated";
  unit: string | null;
  formula: string | null;
};

// Mapea la unidad descriptiva del catálogo ("$", "%", "x", "imp"…) a la unidad
// de formato del tracker. Las calculadas en "%" se guardan como fracción en el
// resto de la app (CTR = clicks/impressions = 0.02); el tracker las muestra
// ×100, así que el builder escala ese caso (ver buildMetricRows).
function catalogUnitToMetricUnit(unit: string | null): MetricUnit {
  if (unit === "$") return "$";
  if (unit === "%") return "%";
  if (unit === "x") return "x";
  return "count";
}

// Labels fallback en español para las métricas direct. Si el cliente tiene
// la métrica en su metrics_catalog se usa ese nombre; esto cubre el resto.
export const DIRECT_METRIC_LABELS: Record<string, string> = {
  amount: "Inversión (USD)",
  impressions: "Impresiones",
  clicks: "Clicks",
  views: "Views",
  conversions: "Conversiones",
  reach: "Reach",
  engagements: "Engagements",
  followers: "Followers",
  leads: "Leads",
  installs: "Installs",
  visits: "Visitas",
};

export type CalcMetricDef = {
  key: string;
  name: string;
  unit: MetricUnit;
  inputs: string[]; // claves direct necesarias para derivarla
  compute: (v: Record<string, number>) => number | null;
  // Para CPM/CPC/etc. consumir por debajo del goal es bueno; para CTR es malo.
  lowerIsBetter: boolean;
};

export const CALC_METRICS: CalcMetricDef[] = [
  {
    key: "cpm",
    name: "CPM",
    unit: "$",
    inputs: ["amount", "impressions"],
    compute: (v) =>
      v.impressions > 0 ? (v.amount / v.impressions) * 1000 : null,
    lowerIsBetter: true,
  },
  {
    key: "cpc",
    name: "CPC",
    unit: "$",
    inputs: ["amount", "clicks"],
    compute: (v) => (v.clicks > 0 ? v.amount / v.clicks : null),
    lowerIsBetter: true,
  },
  {
    key: "cpv",
    name: "CPV",
    unit: "$",
    inputs: ["amount", "views"],
    compute: (v) => (v.views > 0 ? v.amount / v.views : null),
    lowerIsBetter: true,
  },
  {
    key: "cpa",
    name: "CPA",
    unit: "$",
    inputs: ["amount", "conversions"],
    compute: (v) => (v.conversions > 0 ? v.amount / v.conversions : null),
    lowerIsBetter: true,
  },
  {
    key: "ctr",
    name: "CTR",
    unit: "%",
    inputs: ["clicks", "impressions"],
    compute: (v) =>
      v.impressions > 0 ? (v.clicks / v.impressions) * 100 : null,
    lowerIsBetter: false,
  },
  {
    key: "frequency",
    name: "Frequency",
    unit: "x",
    inputs: ["impressions", "reach"],
    compute: (v) => (v.reach > 0 ? v.impressions / v.reach : null),
    lowerIsBetter: false,
  },
];

// Posición temporal de "hoy" dentro de un período [start, end] en %. 0 antes
// de empezar, 100 después de terminar. Las fechas son YYYY-MM-DD; se parsean
// como locales para evitar el off-by-one de timezone (ver lib/i18n.ts).
export function computePacePct(
  periodStart: string | null,
  periodEnd: string | null,
  today: Date = new Date(),
): number {
  if (!periodStart || !periodEnd) return 0;
  const start = parseLocalDate(periodStart);
  const end = parseLocalDate(periodEnd);
  if (!start || !end || end <= start) return 0;
  const now = today.getTime();
  if (now <= start.getTime()) return 0;
  if (now >= end.getTime()) return 100;
  return ((now - start.getTime()) / (end.getTime() - start.getTime())) * 100;
}

export function parseLocalDate(iso: string): Date | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(
    Number.parseInt(m[1], 10),
    Number.parseInt(m[2], 10) - 1,
    Number.parseInt(m[3], 10),
  );
}

// Estado de pace de un plan/placement comparando avance real vs pace esperado.
//   behind    → consumo por debajo del pace (se está atrasando)
//   over_pace → consumo muy por encima del pace o cerca de agotar el goal
//   on_pace   → dentro de la banda razonable
export type PaceStatus = "behind" | "on_pace" | "over_pace";

export function computePaceStatus(
  progressPct: number,
  pacePct: number,
): PaceStatus {
  if (progressPct > pacePct + 25 || progressPct > 90) return "over_pace";
  if (progressPct < pacePct - 10) return "behind";
  return "on_pace";
}

// Formato de valores para mostrar (no para el input editable).
export function formatMetricValue(
  value: number | null,
  unit: MetricUnit,
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  switch (unit) {
    case "$":
      return `$${value.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    case "%":
      return `${value.toFixed(1)}%`;
    case "x":
      return `${value.toFixed(1)}x`;
    default:
      return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }
}

// Valor crudo para el input editable: agrupa miles, decimales solo si el
// monto los tiene (mismo criterio visual que el mockup).
export function formatCellValue(value: number, unit: MetricUnit): string {
  if (!value) return "";
  if (unit === "$") {
    return value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

export function parseCellValue(raw: string): number {
  const n = Number.parseFloat(raw.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// ── Construcción de filas de métrica ────────────────────────────────────────
// Misma lógica para el server (query) y el client (editor con autosave): a
// partir de los goals direct del placement + los valores reales cargados,
// produce las filas direct (editables) y las calculadas (derivadas).

export type MetricRow = {
  key: string;
  label: string;
  kind: "direct" | "calculated";
  unit: MetricUnit;
  goal: number | null;
  actual: number;
  goalPct: number | null;
  lowerIsBetter: boolean;
};

export type DirectGoal = { key: string; goal: number };

export function buildMetricRows(
  directGoals: DirectGoal[],
  actuals: Record<string, number>,
  labelFor: (key: string, fallback: string) => string,
  // Métricas calculadas del catálogo del cliente: cada fila calculated se
  // deriva con su fórmula (incluye custom como ROAS/CPT). Una calculada solo
  // aparece si su fórmula es parseable y todos sus inputs direct están en el
  // plan. Todos los consumidores (tracker server+client, pacing.xlsx) pasan
  // las defs del catálogo — no hay fallback a una lista hardcodeada.
  calcDefs: CatalogMetricDef[],
): MetricRow[] {
  const directKeys = directGoals.map((d) => d.key);
  const goalByKey: Record<string, number> = {};
  for (const d of directGoals) goalByKey[d.key] = d.goal;

  const rows: MetricRow[] = [];

  for (const d of directGoals) {
    const actual = actuals[d.key] ?? 0;
    const goal = d.goal > 0 ? d.goal : null;
    rows.push({
      key: d.key,
      label: labelFor(
        d.key,
        DIRECT_METRIC_LABELS[d.key] ?? d.key,
      ),
      kind: "direct",
      unit: d.key === "amount" ? "$" : "count",
      goal,
      actual,
      goalPct: goal != null ? (actual / goal) * 100 : null,
      lowerIsBetter: false,
    });
  }

  // Catálogo del cliente: derivamos cada calculada con su fórmula.
  const goalAmount = goalByKey.amount ?? 0;
  const actualAmount = actuals.amount ?? 0;
  for (const def of calcDefs) {
    const inputs = formulaDirectInputs(def.formula);
    // Fórmula no soportada (no es num/den ×N) → no derivable: la saltamos para
    // no mostrar una fila fantasma (consistente con resolveMetricColumns en
    // los exports). Una calculada aplica si todos sus inputs direct están en
    // el plan.
    if (inputs == null) continue;
    if (!inputs.every((i) => directKeys.includes(i))) continue;
    const unit = catalogUnitToMetricUnit(def.unit);
    // Las "%" del catálogo son fracciones (0.02); el tracker las muestra ×100.
    const scale = unit === "%" ? 100 : 1;
    const goalRaw = evalFormula(def.formula, goalAmount, goalByKey);
    const actualRaw = evalFormula(def.formula, actualAmount, actuals);
    const goal = goalRaw != null && goalRaw > 0 ? goalRaw * scale : null;
    const actual = actualRaw != null ? actualRaw * scale : 0;
    rows.push({
      key: def.slug,
      label: labelFor(def.slug, def.name),
      kind: "calculated",
      unit,
      goal,
      actual,
      // Sin actual derivable todavía (denominador 0, ej. CPM antes de cargar
      // delivery) → "—", no "-100%". Se gatea en actualRaw, no en actual (que
      // colapsa a 0).
      goalPct: goal != null && actualRaw != null ? (actual / goal) * 100 : null,
      // Para los "costo por X" (en $) consumir por debajo del goal es bueno;
      // para ratios (%/x) más alto suele ser mejor.
      lowerIsBetter: unit === "$",
    });
  }

  return rows;
}
