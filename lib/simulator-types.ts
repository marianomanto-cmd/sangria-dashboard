// Tipos compartidos para el simulador. Las filas de un escenario son
// blobs JSONB libres porque los planners no están armando un plan formal:
// están explorando "qué pasa si". Si más adelante un escenario tiene que
// convertirse en un plan real, la promoción se hace por código mapeando
// estas filas a media_plan_publishers + media_plan_placements.

export type ScenarioMode = "p25" | "p50" | "p75" | "manual";

export type ScenarioRow = {
  id: string;                          // uuid local para keys de React
  publisherId: string | null;
  marketId: string | null;
  formatText: string | null;
  costMethod: string | null;            // valor del enum cost_method
  budgetUsd: number;                    // inversión asignada a esta línea
  mode: ScenarioMode;
  // Overrides manuales. Solo se usan si mode === 'manual' o el benchmark
  // no tiene data para ese (publisher × market × costMethod).
  overrides: {
    cpm?: number;
    cpc?: number;
    cpv?: number;
    ctr?: number;                       // porcentaje (0-100)
  };
};

export type ScenarioJson = {
  rows: ScenarioRow[];
  notes?: string;
};

export const EMPTY_SCENARIO: ScenarioJson = { rows: [] };

// ─────────────────────────────────────────────────────────────────────────────
// Benchmarks: resultado agregado que se muestra en el tab Benchmarks y que
// también consume el Builder cuando autocompleta CPM/CPC/CPV.
// ─────────────────────────────────────────────────────────────────────────────

export type BenchmarkKey = {
  publisherId: string;
  publisherName: string;
  marketId: string | null;
  marketName: string | null;
  costMethod: string | null;
};

export type BenchmarkStats = {
  placements: number;                   // cuántos placements aportaron data
  totalSpendUsd: number;                // suma de amount real
  deliveryPctMedian: number | null;     // mediana de (real/goal) cuando hay goal
  cpm: { p25: number | null; p50: number | null; p75: number | null };
  cpc: { p25: number | null; p50: number | null; p75: number | null };
  cpv: { p25: number | null; p50: number | null; p75: number | null };
  ctr: { p25: number | null; p50: number | null; p75: number | null }; // %
};

export type BenchmarkRow = BenchmarkKey & BenchmarkStats;

export type BenchmarkFilters = {
  clientId: string | null;              // null = todos los clientes
  publisherId?: string | null;
  marketId?: string | null;
  costMethod?: string | null;
  dateFrom?: string | null;             // YYYY-MM-DD
  dateTo?: string | null;
};
