// Catálogo de columnas del generador de reportes históricos. Compartido entre
// el form (checkboxes), la página (preview) y el Excel (descarga), para que
// todos hablen los mismos IDs y los tres respeten la misma selección via URL
// `?cols=client,plan,placement,planned,impressions,...`.
//
// Default (sin `cols` en URL) = todas las columnas (identity + money + todas
// las métricas que tengan data). Esto preserva el comportamiento original del
// generador y evita romper links viejos.

import type { Language } from "@/lib/i18n";

export type IdentityColId =
  | "client"
  | "project"
  | "budgetOrigin"
  | "plan"
  | "publisher"
  | "placement"
  | "market"
  | "costMethod"
  | "dates"
  | "audience";

export type MoneyColId = "planned" | "billed";

export const IDENTITY_COL_IDS = [
  "client",
  "project",
  "budgetOrigin",
  "plan",
  "publisher",
  "placement",
  "market",
  "costMethod",
  "dates",
  "audience",
] as const satisfies readonly IdentityColId[];

export const MONEY_COL_IDS = ["planned", "billed"] as const satisfies readonly MoneyColId[];

const IDENTITY_LABELS: Record<IdentityColId, { en: string; es: string }> = {
  client: { en: "Client", es: "Cliente" },
  project: { en: "Project", es: "Proyecto" },
  budgetOrigin: { en: "Budget Origin", es: "Budget Origin" },
  plan: { en: "Plan", es: "Plan" },
  publisher: { en: "Publisher", es: "Publisher" },
  placement: { en: "Placement", es: "Placement" },
  market: { en: "Market", es: "Mercado" },
  costMethod: { en: "Cost method", es: "Cost method" },
  dates: { en: "Period", es: "Período" },
  audience: { en: "Audience", es: "Audiencia" },
};

const MONEY_LABELS: Record<MoneyColId, { en: string; es: string }> = {
  planned: { en: "Planned (USD)", es: "Planeado (USD)" },
  billed: { en: "Billed share (USD)", es: "Facturado share (USD)" },
};

export function identityLabel(id: IdentityColId, lang: Language): string {
  return IDENTITY_LABELS[id][lang];
}

export function moneyLabel(id: MoneyColId, lang: Language): string {
  return MONEY_LABELS[id][lang];
}

// Parsea el URL param `cols` a un Set, o null si no está presente.
// null = "default": todas las columnas; Set vacío = "ninguna seleccionada"
// (caso raro: si el usuario destildó todo, mostramos solo Placement como
// columna mínima — manejo en resolveReportColumns).
export function parseColsParam(raw: string | null | undefined): Set<string> | null {
  if (raw == null) return null;
  const set = new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  return set;
}

export function serializeColsParam(set: Set<string>): string {
  return [...set].join(",");
}

export type MetricMeta = { slug: string; name: string; unit: string | null };

// Resuelve las columnas a mostrar según la selección del usuario, el catálogo
// del cliente y las métricas que efectivamente tienen data en la ventana.
export function resolveReportColumns(
  selected: Set<string> | null,
  metricsInCatalog: MetricMeta[],
  metricsWithData: MetricMeta[],
): {
  identity: IdentityColId[];
  money: MoneyColId[];
  metrics: MetricMeta[];
} {
  if (selected == null) {
    return {
      identity: [...IDENTITY_COL_IDS],
      money: [...MONEY_COL_IDS],
      metrics: metricsWithData,
    };
  }
  const identity = IDENTITY_COL_IDS.filter((id) => selected.has(id));
  const money = MONEY_COL_IDS.filter((id) => selected.has(id));
  // El slug → metadata se resuelve preferentemente desde el catálogo
  // (tiene name + unit canónicos); si no, desde la data (fallback con slug
  // como name). Esto permite que el usuario seleccione una métrica que aún
  // no tenga data: aparece la columna vacía.
  const byCatalog = new Map(metricsInCatalog.map((m) => [m.slug, m]));
  const byData = new Map(metricsWithData.map((m) => [m.slug, m]));
  const metrics: MetricMeta[] = [];
  for (const slug of selected) {
    if ((IDENTITY_COL_IDS as readonly string[]).includes(slug)) continue;
    if ((MONEY_COL_IDS as readonly string[]).includes(slug)) continue;
    const meta = byCatalog.get(slug) ?? byData.get(slug);
    if (meta) metrics.push(meta);
  }
  // Si el usuario destildó TODO, mostramos al menos placement (no tiene
  // sentido un Excel sin ninguna columna).
  if (identity.length === 0 && money.length === 0 && metrics.length === 0) {
    return {
      identity: ["placement"],
      money: [],
      metrics: [],
    };
  }
  return { identity, money, metrics };
}

// Lista plana de todos los IDs "preseteables" del column picker para un
// cliente dado (identity + money + todas las métricas del catálogo). Útil
// para inicializar checkboxes en el form.
export function allColumnIds(metrics: MetricMeta[]): string[] {
  return [
    ...IDENTITY_COL_IDS,
    ...MONEY_COL_IDS,
    ...metrics.map((m) => m.slug),
  ];
}
