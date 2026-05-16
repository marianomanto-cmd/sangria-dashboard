import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  campaignActualSnapshots,
  markets,
  mediaPlanPlacements,
  publishers,
  simulatorScenarios,
} from "@/db/schema";
import { CALC_METRICS } from "@/lib/campaign-metrics";
import type {
  BenchmarkFilters,
  BenchmarkRow,
  ScenarioJson,
} from "@/lib/simulator-types";

// ════════════════════════════════════════════════════════════════════════════
// Simulator queries — separadas en tres bloques:
//   1) getBenchmarks(): agrega históricos de campaign_actual_snapshots por
//      (publisher × market × costMethod), calculando CPM/CPC/CPV/CTR por
//      placement y devolviendo p25/p50/p75 + % delivery mediano.
//   2) getSimulatorCatalogs(): publishers globales + markets del cliente +
//      cost methods. Lo consume el Builder para los selects.
//   3) listScenarios() / getScenario(): CRUD read sobre simulator_scenarios.
// ════════════════════════════════════════════════════════════════════════════

// ── Benchmarks ──────────────────────────────────────────────────────────────

// Por cada placement quedan agrupadas todas sus métricas direct (amount,
// impressions, clicks, views, conversions) tomando siempre la snapshot más
// reciente del rango. Eso evita doble-contar y refleja el estado de cierre.
type PlacementAgg = {
  placementId: string;
  publisherId: string;
  publisherName: string;
  marketId: string | null;
  marketName: string | null;
  costMethod: string | null;
  // Última snapshot por metric_key
  realByKey: Record<string, number>;
  goalByKey: Record<string, number>;
  // Para sort/recencia interna
  latestDate: string;
};

export async function getBenchmarks(
  filters: BenchmarkFilters,
): Promise<BenchmarkRow[]> {
  const conds = [];
  if (filters.clientId) {
    conds.push(eq(campaignActualSnapshots.clientId, filters.clientId));
  }
  if (filters.publisherId) {
    conds.push(eq(campaignActualSnapshots.publisherId, filters.publisherId));
  }
  if (filters.marketId) {
    conds.push(eq(campaignActualSnapshots.marketId, filters.marketId));
  }
  if (filters.costMethod) {
    // Comparamos contra el cost_method del placement, no del snapshot
    // (el snapshot no lo tiene). Hacemos el join y filtramos abajo.
  }
  if (filters.dateFrom) {
    conds.push(gte(campaignActualSnapshots.snapshotDate, filters.dateFrom));
  }
  if (filters.dateTo) {
    conds.push(lte(campaignActualSnapshots.snapshotDate, filters.dateTo));
  }

  const rows = await db
    .select({
      placementId: campaignActualSnapshots.placementId,
      metricKey: campaignActualSnapshots.metricKey,
      valueAccumulated: campaignActualSnapshots.valueAccumulated,
      goalValue: campaignActualSnapshots.goalValue,
      snapshotDate: campaignActualSnapshots.snapshotDate,
      publisherId: campaignActualSnapshots.publisherId,
      publisherName: publishers.name,
      marketId: campaignActualSnapshots.marketId,
      marketName: markets.name,
      costMethod: mediaPlanPlacements.costMethod,
    })
    .from(campaignActualSnapshots)
    .innerJoin(
      publishers,
      eq(publishers.id, campaignActualSnapshots.publisherId),
    )
    .leftJoin(markets, eq(markets.id, campaignActualSnapshots.marketId))
    .innerJoin(
      mediaPlanPlacements,
      eq(mediaPlanPlacements.id, campaignActualSnapshots.placementId),
    )
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(
      asc(campaignActualSnapshots.placementId),
      desc(campaignActualSnapshots.snapshotDate),
    );

  // Por placement, quedarse con la snapshot más reciente de cada metric_key.
  const placements = new Map<string, PlacementAgg>();
  for (const r of rows) {
    if (filters.costMethod && r.costMethod !== filters.costMethod) continue;

    let agg = placements.get(r.placementId);
    if (!agg) {
      agg = {
        placementId: r.placementId,
        publisherId: r.publisherId,
        publisherName: r.publisherName,
        marketId: r.marketId,
        marketName: r.marketName,
        costMethod: r.costMethod,
        realByKey: {},
        goalByKey: {},
        latestDate: r.snapshotDate,
      };
      placements.set(r.placementId, agg);
    }
    // Por venir en desc(snapshotDate), la primera ocurrencia de cada
    // metric_key es la más reciente. Las siguientes se ignoran.
    if (agg.realByKey[r.metricKey] === undefined) {
      agg.realByKey[r.metricKey] = Number(r.valueAccumulated);
      if (r.goalValue != null) {
        agg.goalByKey[r.metricKey] = Number(r.goalValue);
      }
    }
  }

  // Agrupar placements por (publisherId, marketId, costMethod).
  const groups = new Map<string, PlacementAgg[]>();
  for (const p of placements.values()) {
    const key = `${p.publisherId}|${p.marketId ?? "_"}|${p.costMethod ?? "_"}`;
    const arr = groups.get(key);
    if (arr) arr.push(p);
    else groups.set(key, [p]);
  }

  const out: BenchmarkRow[] = [];
  for (const [, ps] of groups) {
    const first = ps[0];
    out.push({
      publisherId: first.publisherId,
      publisherName: first.publisherName,
      marketId: first.marketId,
      marketName: first.marketName,
      costMethod: first.costMethod,
      ...computeStats(ps),
    });
  }

  // Orden por # de placements observados desc — los benchmarks con más
  // sample size arriba.
  out.sort((a, b) => b.placements - a.placements);
  return out;
}

function computeStats(placements: PlacementAgg[]): {
  placements: number;
  totalSpendUsd: number;
  deliveryPctMedian: number | null;
  cpm: { p25: number | null; p50: number | null; p75: number | null };
  cpc: { p25: number | null; p50: number | null; p75: number | null };
  cpv: { p25: number | null; p50: number | null; p75: number | null };
  ctr: { p25: number | null; p50: number | null; p75: number | null };
} {
  const calcByKey = Object.fromEntries(CALC_METRICS.map((m) => [m.key, m]));

  const cpmVals: number[] = [];
  const cpcVals: number[] = [];
  const cpvVals: number[] = [];
  const ctrVals: number[] = [];
  const deliveryPct: number[] = [];
  let totalSpend = 0;

  for (const p of placements) {
    const real = p.realByKey;
    totalSpend += real.amount ?? 0;

    const cpm = calcByKey.cpm.compute(real as Record<string, number>);
    const cpc = calcByKey.cpc.compute(real as Record<string, number>);
    const cpv = calcByKey.cpv.compute(real as Record<string, number>);
    const ctr = calcByKey.ctr.compute(real as Record<string, number>);
    if (cpm != null && Number.isFinite(cpm)) cpmVals.push(cpm);
    if (cpc != null && Number.isFinite(cpc)) cpcVals.push(cpc);
    if (cpv != null && Number.isFinite(cpv)) cpvVals.push(cpv);
    if (ctr != null && Number.isFinite(ctr)) ctrVals.push(ctr);

    const goalAmount = p.goalByKey.amount;
    const realAmount = real.amount;
    if (goalAmount && goalAmount > 0 && realAmount != null) {
      deliveryPct.push((realAmount / goalAmount) * 100);
    }
  }

  return {
    placements: placements.length,
    totalSpendUsd: round2(totalSpend),
    deliveryPctMedian: percentile(deliveryPct, 50),
    cpm: pBundle(cpmVals),
    cpc: pBundle(cpcVals),
    cpv: pBundle(cpvVals),
    ctr: pBundle(ctrVals),
  };
}

function pBundle(values: number[]) {
  return {
    p25: percentile(values, 25),
    p50: percentile(values, 50),
    p75: percentile(values, 75),
  };
}

// Percentil estilo "linear interpolation" sobre arrays no ordenados; devuelve
// null si no hay data suficiente.
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return round2(sorted[0]);
  const pos = ((p / 100) * (sorted.length - 1));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return round2(sorted[lo]);
  const w = pos - lo;
  return round2(sorted[lo] * (1 - w) + sorted[hi] * w);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Catálogos para el Builder ───────────────────────────────────────────────

export type SimulatorCatalogs = {
  publishers: { id: string; name: string }[];
  // markets vienen por cliente; si no hay cliente filtrado devolvemos []
  // (el Builder requiere cliente seleccionado vía topbar).
  markets: { id: string; name: string }[];
  costMethods: string[];
};

export async function getSimulatorCatalogs(
  clientId: string | null,
): Promise<SimulatorCatalogs> {
  const [pubRows, marketRows] = await Promise.all([
    db
      .select({ id: publishers.id, name: publishers.name })
      .from(publishers)
      .where(eq(publishers.enabled, true))
      .orderBy(asc(publishers.sortOrder), asc(publishers.name)),
    clientId
      ? db
          .select({ id: markets.id, name: markets.name })
          .from(markets)
          .where(and(eq(markets.clientId, clientId), eq(markets.enabled, true)))
          .orderBy(asc(markets.sortOrder), asc(markets.name))
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);

  return {
    publishers: pubRows,
    markets: marketRows,
    costMethods: ["CPM", "CPC", "CPV", "CPA", "Flat", "dCPM", "dCPC", "dCPV", "dCPA"],
  };
}

// ── Scenarios CRUD-read ─────────────────────────────────────────────────────

export type ScenarioSummary = {
  id: string;
  name: string;
  rowCount: number;
  totalBudgetUsd: number;
  updatedAt: string;
};

export async function listScenarios(
  clientId: string,
): Promise<ScenarioSummary[]> {
  const rows = await db
    .select({
      id: simulatorScenarios.id,
      name: simulatorScenarios.name,
      rowsJson: simulatorScenarios.rowsJson,
      updatedAt: simulatorScenarios.updatedAt,
    })
    .from(simulatorScenarios)
    .where(eq(simulatorScenarios.clientId, clientId))
    .orderBy(desc(simulatorScenarios.updatedAt));

  return rows.map((r) => {
    const scenarioRows = r.rowsJson?.rows ?? [];
    const total = scenarioRows.reduce((s, row) => s + (row.budgetUsd || 0), 0);
    return {
      id: r.id,
      name: r.name,
      rowCount: scenarioRows.length,
      totalBudgetUsd: round2(total),
      updatedAt:
        r.updatedAt instanceof Date
          ? r.updatedAt.toISOString()
          : String(r.updatedAt),
    };
  });
}

export type ScenarioFull = {
  id: string;
  clientId: string;
  name: string;
  rowsJson: ScenarioJson;
  updatedAt: string;
};

export async function getScenario(id: string): Promise<ScenarioFull | null> {
  const [r] = await db
    .select()
    .from(simulatorScenarios)
    .where(eq(simulatorScenarios.id, id))
    .limit(1);
  if (!r) return null;
  return {
    id: r.id,
    clientId: r.clientId,
    name: r.name,
    rowsJson: r.rowsJson,
    updatedAt:
      r.updatedAt instanceof Date
        ? r.updatedAt.toISOString()
        : String(r.updatedAt),
  };
}

