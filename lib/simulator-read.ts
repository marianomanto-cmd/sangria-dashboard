import type {
  BenchmarkFilters,
  BenchmarkRow,
} from "@/lib/simulator-types";
import type {
  BenchmarkPlacementDetail,
  CompareablePlanSummary,
  PromoteTargetProject,
  ScenarioFull,
} from "@/db/queries/simulator";

// ════════════════════════════════════════════════════════════════════════════
// Lecturas del simulador desde el browser, por GET.
//
// Reemplaza a las "read-actions" de `app/actions/simulator.ts`, que eran server
// actions que sólo leían. El problema no era la lectura sino el transporte: un
// Server Action viaja por POST, y la sesión de auditoría (solo lectura) tiene
// cerrado todo lo que no sea GET en el proxy. Con read-actions, los tabs
// Benchmarks, Comparativa y Builder le quedaban colgados en "Cargando…".
//
// Las firmas son IDÉNTICAS a las de las actions que reemplazan, así que en los
// componentes el cambio es una línea de import y nada más.
//
// El handler está en `app/api/simulator/read/route.ts`.
// ════════════════════════════════════════════════════════════════════════════

const ENDPOINT = "/api/simulator/read";

function qs(params: Record<string, string | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== "") sp.set(k, v);
  }
  return sp.toString();
}

async function get<T>(params: Record<string, string | null | undefined>): Promise<T> {
  const res = await fetch(`${ENDPOINT}?${qs(params)}`);
  if (!res.ok) {
    let msg = `Error ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      // respuesta sin JSON (por ejemplo el redirect a /login): queda el status
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

function filterParams(f: BenchmarkFilters) {
  return {
    clientId: f.clientId,
    publisherId: f.publisherId,
    marketId: f.marketId,
    costMethod: f.costMethod,
    dateFrom: f.dateFrom,
    dateTo: f.dateTo,
  };
}

export async function fetchBenchmarks(
  filters: BenchmarkFilters,
): Promise<BenchmarkRow[]> {
  const { rows } = await get<{ rows: BenchmarkRow[] }>({
    op: "benchmarks",
    ...filterParams(filters),
  });
  return rows;
}

export async function fetchBenchmarkDetail(input: {
  filters: BenchmarkFilters;
  publisherId: string;
  marketId: string | null;
  costMethod: string | null;
}): Promise<BenchmarkPlacementDetail[]> {
  const { rows } = await get<{ rows: BenchmarkPlacementDetail[] }>({
    op: "benchmarkDetail",
    ...filterParams(input.filters),
    detailPublisherId: input.publisherId,
    detailMarketId: input.marketId,
    detailCostMethod: input.costMethod,
  });
  return rows;
}

export async function fetchCompareablePlans(
  clientId: string,
): Promise<CompareablePlanSummary[]> {
  const { rows } = await get<{ rows: CompareablePlanSummary[] }>({
    op: "compareablePlans",
    clientId,
  });
  return rows;
}

export async function fetchProjectsForPromotion(
  clientId: string,
): Promise<PromoteTargetProject[]> {
  const { rows } = await get<{ rows: PromoteTargetProject[] }>({
    op: "projectsForPromotion",
    clientId,
  });
  return rows;
}

export async function fetchScenario(id: string): Promise<ScenarioFull | null> {
  const { scenario } = await get<{ scenario: ScenarioFull | null }>({
    op: "scenario",
    id,
  });
  return scenario;
}
