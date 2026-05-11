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
  | "CPM"
  | "CPC"
  | "CPV"
  | "CPA"
  | "Flat"
  | "Other";

export const COST_METHODS: CostMethod[] = [
  "dCPV", "dCPC", "dCPM", "CPM", "CPC", "CPV", "CPA", "Flat", "Other",
];
