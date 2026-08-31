// ════════════════════════════════════════════════════════════════════════════
// Lecturas del QA de PLANIFICACIÓN (el del media planner, antes de la firma).
//
//   • getPlanningQaRows  → las líneas del plan como las muestra el modal.
//   • getPlanningQaItems → los ítems tildables (hoy, una por línea).
//   • getPlanningQaState → el run de la versión que el draft va a ser + qué
//                          ítems ya están tildados.
//
// Las dos alimentan tanto el modal como la barrera de `transitionPlanStatus`,
// que es lo que garantiza que la pantalla y el server cuenten lo mismo.
// ════════════════════════════════════════════════════════════════════════════

import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  markets,
  mediaPlanPlacements,
  mediaPlanPlanningQaChecks,
  mediaPlanPlanningQaRuns,
  mediaPlanPublishers,
  publishers,
} from "@/db/schema";
import {
  buildPlanningQaItems,
  isPlanningQaItemKind,
  planningQaKey,
  type PlanningQaItem,
  type PlanningQaItemKind,
} from "@/lib/plan-planning-qa";

export type PlanningQaCheck = {
  itemKind: PlanningQaItemKind;
  itemId: string;
  checkedAt: Date;
  checkedByEmail: string | null;
};

export type PlanningQaState = {
  // null = todavía no se abrió el QA de esta versión (el run se crea al primer
  // tilde). El modal igual funciona: arranca en cero.
  runId: string | null;
  versionNumber: number;
  completedAt: Date | null;
  completedByEmail: string | null;
  notes: string | null;
  checks: PlanningQaCheck[];
};

// La versión que un draft VA A SER al aprobarse. Es la clave del run: así el QA
// de planificación de la v3 y el de armado de la v3 hablan de la misma versión.
export function planningQaVersion(currentVersion: number): number {
  return (Number.isFinite(currentVersion) ? currentVersion : 0) + 1;
}

// ── Los ítems tildables ─────────────────────────────────────────────────────

// Una línea del plan tal como la muestra el modal: lo que el planner tiene que
// mirar para poder decir "esto está bien".
export type PlanningQaRow = {
  placementId: string;
  publisherName: string;
  placementName: string | null;
  marketName: string | null;
  audience: string | null;
  amountUsd: number;
  costMethod: string | null;
  startDate: string | null;
  endDate: string | null;
};

// Placements vivos del plan, en el MISMO orden que la planilla: publisher por
// sortOrder y, dentro, el sortOrder del placement.
export async function getPlanningQaRows(planId: string): Promise<PlanningQaRow[]> {
  const pubRows = await db
    .select({ id: mediaPlanPublishers.id, name: publishers.name })
    .from(mediaPlanPublishers)
    .innerJoin(publishers, eq(mediaPlanPublishers.publisherId, publishers.id))
    .where(eq(mediaPlanPublishers.mediaPlanId, planId))
    .orderBy(asc(mediaPlanPublishers.sortOrder));
  if (pubRows.length === 0) return [];

  const pubName = new Map(pubRows.map((p) => [p.id, p.name]));
  const pubOrder = new Map(pubRows.map((p, i) => [p.id, i]));

  const rows = await db
    .select({ placement: mediaPlanPlacements, marketName: markets.name })
    .from(mediaPlanPlacements)
    .leftJoin(markets, eq(mediaPlanPlacements.marketId, markets.id))
    .where(
      inArray(
        mediaPlanPlacements.mediaPlanPublisherId,
        pubRows.map((p) => p.id),
      ),
    );

  return [...rows]
    .sort((a, b) => {
      const oa = pubOrder.get(a.placement.mediaPlanPublisherId) ?? 0;
      const ob = pubOrder.get(b.placement.mediaPlanPublisherId) ?? 0;
      return oa - ob || a.placement.sortOrder - b.placement.sortOrder;
    })
    .map((r) => ({
      placementId: r.placement.id,
      publisherName: pubName.get(r.placement.mediaPlanPublisherId) ?? "—",
      placementName: r.placement.placementName,
      marketName: r.marketName,
      audience: r.placement.audience,
      amountUsd: Number.parseFloat(r.placement.amountUsd),
      costMethod: r.placement.costMethod,
      startDate: r.placement.startDate,
      endDate: r.placement.endDate,
    }));
}

export async function getPlanningQaItems(
  planId: string,
): Promise<PlanningQaItem[]> {
  return buildPlanningQaItems(await getPlanningQaRows(planId));
}

// ── El estado del run ───────────────────────────────────────────────────────

export async function getPlanningQaState(
  planId: string,
  versionNumber: number,
): Promise<PlanningQaState> {
  const empty: PlanningQaState = {
    runId: null,
    versionNumber,
    completedAt: null,
    completedByEmail: null,
    notes: null,
    checks: [],
  };
  if (!Number.isInteger(versionNumber) || versionNumber < 1) return empty;

  const [run] = await db
    .select()
    .from(mediaPlanPlanningQaRuns)
    .where(
      and(
        eq(mediaPlanPlanningQaRuns.mediaPlanId, planId),
        eq(mediaPlanPlanningQaRuns.versionNumber, versionNumber),
      ),
    )
    .limit(1);
  if (!run) return empty;

  const rows = await db
    .select({
      itemKind: mediaPlanPlanningQaChecks.itemKind,
      itemId: mediaPlanPlanningQaChecks.itemId,
      checkedAt: mediaPlanPlanningQaChecks.checkedAt,
      checkedByEmail: mediaPlanPlanningQaChecks.checkedByEmail,
    })
    .from(mediaPlanPlanningQaChecks)
    .where(eq(mediaPlanPlanningQaChecks.qaRunId, run.id));

  // El enum de la base todavía admite 'adset' (la columna quedó de cuando el QA
  // también tildaba adsets, y sacarle un valor a un enum de Postgres no vale la
  // pena). Los tildes viejos de adsets se ignoran: ya no hay adsets que mirar.
  const checks: PlanningQaCheck[] = rows.filter(
    (r): r is PlanningQaCheck => isPlanningQaItemKind(r.itemKind),
  );

  return {
    runId: run.id,
    versionNumber: run.versionNumber,
    completedAt: run.completedAt,
    completedByEmail: run.completedByEmail,
    notes: run.notes,
    checks,
  };
}

// Set de claves tildadas, listo para las reglas de lib/plan-planning-qa.
export function planningQaCheckedKeys(
  checks: readonly PlanningQaCheck[],
): Set<string> {
  return new Set(checks.map((c) => planningQaKey(c.itemKind, c.itemId)));
}
