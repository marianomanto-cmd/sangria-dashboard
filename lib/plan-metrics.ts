import type { PlanPlacement } from "@/db/queries/project-detail";

// Metadata mínima de una métrica del catálogo (metrics_catalog). Las filas que
// devuelve `listMetricsForClient` son estructuralmente compatibles con esto.
export type MetricMeta = {
  slug: string;
  name: string;
  kind: "direct" | "calculated";
  unit: string | null;
  formula: string | null;
  sortOrder: number;
};

// Evalúa fórmulas simples del catálogo de métricas:
//   "amount / clicks", "clicks / impressions", "amount / impressions × 1000",
//   "views / impressions", etc. Devuelve null si falta algún input o si la
//   fórmula no encaja con el patrón soportado (num/den, con "×N" opcional).
export function evalFormula(
  formula: string | null | undefined,
  amount: number,
  directs: Record<string, number>,
): number | null {
  if (!formula) return null;
  let f = formula.toLowerCase().replace(/\s+/g, "");
  let multiplier = 1;
  const xMatch = f.match(/×(\d+)/);
  if (xMatch) {
    multiplier = Number.parseInt(xMatch[1], 10);
    f = f.replace(/×\d+/, "");
  }
  const m = f.match(/^([a-z_]+)\/([a-z_]+)$/);
  if (!m) return null;
  const [, num, den] = m;
  const n = num === "amount" ? amount : directs[num];
  const d = den === "amount" ? amount : directs[den];
  if (
    n == null ||
    d == null ||
    !Number.isFinite(n) ||
    !Number.isFinite(d) ||
    d === 0
  )
    return null;
  return (n / d) * multiplier;
}

// Slugs de métricas direct que una fórmula necesita como inputs (excluye
// "amount", que siempre está disponible vía el monto del placement). Mismo
// parseo que `evalFormula`: "num / den ×N".
//
// Devuelve `null` si la fórmula NO es del patrón soportado (no derivable) —
// distinto de `[]`, que significa "parseable pero sin inputs direct" (p. ej.
// "amount / amount"). El Campaign Tracker usa esto para decidir si una métrica
// calculada del catálogo aplica a un placement: `null` → no se muestra (evita
// filas fantasma), `[]`/lista → aplica si todos sus inputs están en el plan.
export function formulaDirectInputs(
  formula: string | null | undefined,
): string[] | null {
  if (!formula) return null;
  const f = formula
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/×\d+/, "");
  const m = f.match(/^([a-z_]+)\/([a-z_]+)$/);
  if (!m) return null;
  return [m[1], m[2]].filter((s) => s !== "amount");
}

// Valor de una métrica para un placement: el guardado en metrics_json si es un
// número finito (honra lo cargado a mano), o el computado por su fórmula a
// partir de los directs + amount del placement (para calculated como CTR, CPM,
// engagement rate, que el editor no persiste). null si no aplica.
export function placementMetricValue(
  meta: MetricMeta,
  pl: PlanPlacement,
): number | null {
  const stored = pl.metricsJson?.[meta.slug];
  if (typeof stored === "number" && Number.isFinite(stored)) return stored;
  if (meta.kind === "calculated" && meta.formula) {
    return evalFormula(meta.formula, pl.amountUsd, pl.metricsJson ?? {});
  }
  return null;
}

// Columnas de métricas a mostrar en los exports, ordenadas direct→calculated y
// por sortOrder del catálogo:
//   - direct: las que aparecen con valor finito en algún placement.
//   - calculated: las que resuelven (valor finito) en al menos un placement.
export function resolveMetricColumns<M extends MetricMeta>(
  allMetrics: M[],
  placements: PlanPlacement[],
): M[] {
  const bySlug = new Map(allMetrics.map((m) => [m.slug, m]));

  const usedDirect = new Set<string>();
  for (const pl of placements) {
    for (const [slug, v] of Object.entries(pl.metricsJson ?? {})) {
      if (
        typeof v === "number" &&
        Number.isFinite(v) &&
        bySlug.get(slug)?.kind === "direct"
      ) {
        usedDirect.add(slug);
      }
    }
  }

  const sortFn = (a: M, b: M) =>
    a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);

  const direct = allMetrics
    .filter((m) => m.kind === "direct" && usedDirect.has(m.slug))
    .sort(sortFn);
  const calculated = allMetrics
    .filter(
      (m) =>
        m.kind === "calculated" &&
        placements.some((pl) => placementMetricValue(m, pl) != null),
    )
    .sort(sortFn);

  return [...direct, ...calculated];
}

// Período cubierto por una lista de placements: la fecha de inicio más temprana
// y la de fin más tardía. Las fechas son ISO (YYYY-MM-DD), que ordenan
// lexicográficamente = cronológicamente. Devuelve null en cada extremo si no
// hay ninguna fecha cargada. Usado por los exports (período del plan y de cada
// publisher).
export function placementsPeriod(
  placements: PlanPlacement[],
): { start: string | null; end: string | null } {
  const starts = placements
    .map((p) => p.startDate)
    .filter((d): d is string => !!d)
    .sort();
  const ends = placements
    .map((p) => p.endDate)
    .filter((d): d is string => !!d)
    .sort();
  return {
    start: starts[0] ?? null,
    end: ends[ends.length - 1] ?? null,
  };
}

// Suma de cada métrica direct sobre una lista de placements (ignora calculated
// y valores no finitos). Base para los subtotales por publisher y el TOTAL
// MEDIA de los exports y del preview tipo Excel del editor.
export function sumDirectMetrics(
  placements: PlanPlacement[],
  directSlugs: string[],
): Record<string, number> {
  const acc: Record<string, number> = {};
  for (const slug of directSlugs) acc[slug] = 0;
  for (const pl of placements) {
    for (const slug of directSlugs) {
      const v = pl.metricsJson?.[slug];
      if (typeof v === "number" && Number.isFinite(v)) acc[slug] += v;
    }
  }
  return acc;
}
