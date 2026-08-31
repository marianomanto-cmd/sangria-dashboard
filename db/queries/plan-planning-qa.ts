// ════════════════════════════════════════════════════════════════════════════
// Lecturas del QA de PLANIFICACIÓN (el del media planner, antes de la firma).
//
//   • getPlanningQaItems → los ítems tildables del plan (cada placement y cada
//                          adset), en orden de pantalla.
//   • getPlanningQaState → el run de la versión que el draft va a ser + qué
//                          ítems ya están tildados.
//
// Las dos alimentan tanto el modal como la barrera de `transitionPlanStatus`,
// que es lo que garantiza que la pantalla y el server cuenten lo mismo.
// ════════════════════════════════════════════════════════════════════════════

import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  mediaPlanPlacements,
  mediaPlanPlanningQaChecks,
  mediaPlanPlanningQaRuns,
  mediaPlanPublishers,
  mediaPlanTrafficAdsets,
  mediaPlanTrafficBriefs,
  publishers,
} from "@/db/schema";
import {
  buildPlanningQaItems,
  planningQaKey,
  type PlanningQaItem,
  type PlanningQaItemKind,
  type PlanningQaPlacement,
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

// Placements vivos del plan, cada uno con sus adsets, en el MISMO orden que la
// planilla: publisher por sortOrder y, dentro, el sortOrder del placement.
export async function getPlanningQaPlacements(
  planId: string,
): Promise<PlanningQaPlacement[]> {
  const pubRows = await db
    .select({ id: mediaPlanPublishers.id, name: publishers.name })
    .from(mediaPlanPublishers)
    .innerJoin(publishers, eq(mediaPlanPublishers.publisherId, publishers.id))
    .where(eq(mediaPlanPublishers.mediaPlanId, planId))
    .orderBy(asc(mediaPlanPublishers.sortOrder));
  if (pubRows.length === 0) return [];

  const pubName = new Map(pubRows.map((p) => [p.id, p.name]));
  const pubOrder = new Map(pubRows.map((p, i) => [p.id, i]));

  const placementRows = await db
    .select({
      id: mediaPlanPlacements.id,
      mediaPlanPublisherId: mediaPlanPlacements.mediaPlanPublisherId,
      placementName: mediaPlanPlacements.placementName,
      sortOrder: mediaPlanPlacements.sortOrder,
    })
    .from(mediaPlanPlacements)
    .where(
      inArray(
        mediaPlanPlacements.mediaPlanPublisherId,
        pubRows.map((p) => p.id),
      ),
    );
  if (placementRows.length === 0) return [];

  const briefRows = await db
    .select({
      id: mediaPlanTrafficBriefs.id,
      placementId: mediaPlanTrafficBriefs.placementId,
    })
    .from(mediaPlanTrafficBriefs)
    .where(
      inArray(
        mediaPlanTrafficBriefs.placementId,
        placementRows.map((r) => r.id),
      ),
    );

  const adsetRows =
    briefRows.length === 0
      ? []
      : await db
          .select({
            id: mediaPlanTrafficAdsets.id,
            briefId: mediaPlanTrafficAdsets.briefId,
            name: mediaPlanTrafficAdsets.name,
          })
          .from(mediaPlanTrafficAdsets)
          .where(
            inArray(
              mediaPlanTrafficAdsets.briefId,
              briefRows.map((b) => b.id),
            ),
          )
          .orderBy(
            asc(mediaPlanTrafficAdsets.sortOrder),
            asc(mediaPlanTrafficAdsets.createdAt),
          );

  const adsetsByBrief = new Map<string, { id: string; name: string | null }[]>();
  for (const a of adsetRows) {
    const list = adsetsByBrief.get(a.briefId) ?? [];
    list.push({ id: a.id, name: a.name });
    adsetsByBrief.set(a.briefId, list);
  }
  const adsetsByPlacement = new Map<string, { id: string; name: string | null }[]>();
  for (const b of briefRows) {
    adsetsByPlacement.set(b.placementId, adsetsByBrief.get(b.id) ?? []);
  }

  return [...placementRows]
    .sort((a, b) => {
      const oa = pubOrder.get(a.mediaPlanPublisherId) ?? 0;
      const ob = pubOrder.get(b.mediaPlanPublisherId) ?? 0;
      return oa - ob || a.sortOrder - b.sortOrder;
    })
    .map((p) => ({
      placementId: p.id,
      publisherName: pubName.get(p.mediaPlanPublisherId) ?? "—",
      placementName: p.placementName,
      adsets: adsetsByPlacement.get(p.id) ?? [],
    }));
}

export async function getPlanningQaItems(
  planId: string,
): Promise<PlanningQaItem[]> {
  return buildPlanningQaItems(await getPlanningQaPlacements(planId));
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

  const checks = await db
    .select({
      itemKind: mediaPlanPlanningQaChecks.itemKind,
      itemId: mediaPlanPlanningQaChecks.itemId,
      checkedAt: mediaPlanPlanningQaChecks.checkedAt,
      checkedByEmail: mediaPlanPlanningQaChecks.checkedByEmail,
    })
    .from(mediaPlanPlanningQaChecks)
    .where(eq(mediaPlanPlanningQaChecks.qaRunId, run.id));

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
