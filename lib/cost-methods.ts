// Mapeo cost_method → métrica principal (slug del catálogo).
// Para Flat/Other no hay métrica principal canónica.
export const COST_METHOD_PRIMARY_METRIC: Record<string, string | null> = {
  dCPV: "views",
  CPV: "views",
  dCPM: "impressions",
  CPM: "impressions",
  dCPC: "clicks",
  CPC: "clicks",
  CPA: "conversions",
  Flat: null,
  Other: null,
};

// Par tarifa↔delivery para auto-cálculo bidireccional.
// delivery = (amount × multiplier) / rate
// rate     = (amount × multiplier) / delivery
// (CPM tiene multiplier=1000 porque es "por cada mil")
export const COST_METHOD_PAIR: Record<
  string,
  { rate: string; delivery: string; multiplier: number } | null
> = {
  dCPV: { rate: "cpv", delivery: "views", multiplier: 1 },
  CPV: { rate: "cpv", delivery: "views", multiplier: 1 },
  dCPM: { rate: "cpm", delivery: "impressions", multiplier: 1000 },
  CPM: { rate: "cpm", delivery: "impressions", multiplier: 1000 },
  dCPC: { rate: "cpc", delivery: "clicks", multiplier: 1 },
  CPC: { rate: "cpc", delivery: "clicks", multiplier: 1 },
  CPA: { rate: "cpa", delivery: "conversions", multiplier: 1 },
  Flat: null,
  Other: null,
};

export type CostMethod =
  | "dCPV"
  | "dCPC"
  | "dCPM"
  | "CPM"
  | "CPC"
  | "CPV"
  | "CPA"
  | "Flat"
  | "Other";

export const COST_METHODS: CostMethod[] = [
  "dCPV", "dCPC", "dCPM", "CPM", "CPC", "CPV", "CPA", "Flat", "Other",
];
