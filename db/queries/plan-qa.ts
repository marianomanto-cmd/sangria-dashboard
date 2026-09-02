// ════════════════════════════════════════════════════════════════════════════
// Lecturas del QA del plan + del historial de versiones con su diff.
//
//   • getPlanQaState        → estado del QA de UNA versión (el run + qué líneas
//                             ya están controladas). Alimenta el modal de QA.
//   • getPlanVersionList    → una fila por versión aprobada SIN el diff (o sea
//                             sin tocar `snapshot_json`). Es lo que renderiza
//                             la página del plan.
//   • getPlanVersionDiff    → el diff de UNA versión contra la anterior. Se
//                             pide al desplegar esa versión en el historial.
//   • getPlanVersionHistory → todas las versiones CON su diff. Carga todos los
//                             `snapshot_json` del plan, así que queda sólo para
//                             el Excel, que los necesita todos de una.
//
// Por qué está partido: `snapshot_json` congela el plan ENTERO (publishers,
// placements, fees) por versión. Traerlos todos en cada render de la página era
// transferir megabytes por una conexión del pooler en cada carga y en cada
// `router.refresh()` post-guardado — y peor con cada versión nueva. Fue la
// causa de que la página del plan se colgara (incidente del 02/sep/2026).
// ════════════════════════════════════════════════════════════════════════════

import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  markets,
  mediaPlanQaChecks,
  mediaPlanQaRuns,
  mediaPlanSnapshots,
  metricsCatalog,
  publishers,
} from "@/db/schema";
import {
  buildPlanVersionDiff,
  type CapturedSnapshot,
  type PlanVersionDiff,
} from "@/lib/plan-version-diff";

export type PlanQaCheck = {
  placementId: string;
  checkedAt: Date;
  checkedByEmail: string | null;
};

export type PlanQaState = {
  // null = todavía no se abrió el QA de esta versión (el run se crea al primer
  // check). El modal igual funciona: arranca en cero.
  runId: string | null;
  versionNumber: number;
  completedAt: Date | null;
  completedByEmail: string | null;
  notes: string | null;
  checks: PlanQaCheck[];
};

export async function getPlanQaState(
  planId: string,
  versionNumber: number,
): Promise<PlanQaState> {
  const empty: PlanQaState = {
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
    .from(mediaPlanQaRuns)
    .where(
      and(
        eq(mediaPlanQaRuns.mediaPlanId, planId),
        eq(mediaPlanQaRuns.versionNumber, versionNumber),
      ),
    )
    .limit(1);
  if (!run) return empty;

  const checks = await db
    .select({
      placementId: mediaPlanQaChecks.placementId,
      checkedAt: mediaPlanQaChecks.checkedAt,
      checkedByEmail: mediaPlanQaChecks.checkedByEmail,
    })
    .from(mediaPlanQaChecks)
    .where(eq(mediaPlanQaChecks.qaRunId, run.id));

  return {
    runId: run.id,
    versionNumber,
    completedAt: run.completedAt,
    completedByEmail: run.completedByEmail,
    notes: run.notes,
    checks,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Historial de versiones con diff
// ────────────────────────────────────────────────────────────────────────────

export type PlanVersionEntry = {
  versionNumber: number;
  approvedAt: Date;
  notes: string | null;
  pdfUrl: string | null;
  signedPdfUrl: string | null;
  diff: PlanVersionDiff;
  qa: {
    completedAt: Date | null;
    completedByEmail: string | null;
    notes: string | null;
    checkedCount: number;
  } | null;
};

// Metadata de cada versión, SIN `snapshot_json`. Es lo que la página necesita
// para dibujar la lista; el diff se pide aparte, al desplegar.
export type PlanVersionSummary = Omit<PlanVersionEntry, "diff">;

export async function getPlanVersionList(
  planId: string,
): Promise<PlanVersionSummary[]> {
  const [snaps, runs] = await Promise.all([
    db
      .select({
        versionNumber: mediaPlanSnapshots.versionNumber,
        approvedAt: mediaPlanSnapshots.approvedAt,
        notes: mediaPlanSnapshots.notes,
        pdfUrl: mediaPlanSnapshots.pdfUrl,
        signedPdfUrl: mediaPlanSnapshots.signedPdfUrl,
      })
      .from(mediaPlanSnapshots)
      .where(eq(mediaPlanSnapshots.mediaPlanId, planId))
      .orderBy(asc(mediaPlanSnapshots.versionNumber)),
    db
      .select()
      .from(mediaPlanQaRuns)
      .where(eq(mediaPlanQaRuns.mediaPlanId, planId)),
  ]);
  if (snaps.length === 0) return [];

  const runByVersion = new Map(runs.map((r) => [r.versionNumber, r]));
  const runIds = runs.map((r) => r.id);
  const checkRows = runIds.length
    ? await db
        .select({ qaRunId: mediaPlanQaChecks.qaRunId })
        .from(mediaPlanQaChecks)
        .where(inArray(mediaPlanQaChecks.qaRunId, runIds))
    : [];
  const checksByRun = new Map<string, number>();
  for (const c of checkRows) {
    checksByRun.set(c.qaRunId, (checksByRun.get(c.qaRunId) ?? 0) + 1);
  }

  const entries = snaps.map((snap) => {
    const run = runByVersion.get(snap.versionNumber) ?? null;
    return {
      versionNumber: snap.versionNumber,
      approvedAt: snap.approvedAt,
      notes: snap.notes,
      pdfUrl: snap.pdfUrl,
      signedPdfUrl: snap.signedPdfUrl,
      qa: run
        ? {
            completedAt: run.completedAt,
            completedByEmail: run.completedByEmail,
            notes: run.notes,
            checkedCount: checksByRun.get(run.id) ?? 0,
          }
        : null,
    };
  });

  // Más reciente arriba (mismo orden que getPlanVersionHistory).
  return entries.reverse();
}

// Diff de UNA versión contra la anterior: toca sólo esos dos `snapshot_json`,
// no los del plan entero. `null` si la versión no existe.
export async function getPlanVersionDiff(
  planId: string,
  versionNumber: number,
): Promise<PlanVersionDiff | null> {
  if (!Number.isInteger(versionNumber) || versionNumber < 1) return null;

  const rows = await db
    .select({
      versionNumber: mediaPlanSnapshots.versionNumber,
      snapshotJson: mediaPlanSnapshots.snapshotJson,
    })
    .from(mediaPlanSnapshots)
    .where(
      and(
        eq(mediaPlanSnapshots.mediaPlanId, planId),
        inArray(mediaPlanSnapshots.versionNumber, [
          versionNumber - 1,
          versionNumber,
        ]),
      ),
    );

  const curr = rows.find((r) => r.versionNumber === versionNumber);
  if (!curr) return null;
  // La primera versión no tiene anterior: el diff sale como "todo nuevo".
  const prev = rows.find((r) => r.versionNumber === versionNumber - 1) ?? null;

  const names = await catalogNames();
  return buildPlanVersionDiff(
    (prev?.snapshotJson ?? null) as CapturedSnapshot | null,
    (curr.snapshotJson ?? {}) as CapturedSnapshot,
    names,
  );
}

// Catálogos para resolver nombres: el snapshot congela ids, el nombre correcto
// es el de HOY (mismo criterio que getPlanDetailAtVersion).
async function catalogNames() {
  const [pubRows, mktRows, metricRows] = await Promise.all([
    db.select({ id: publishers.id, name: publishers.name }).from(publishers),
    db.select({ id: markets.id, name: markets.name }).from(markets),
    db
      .select({ slug: metricsCatalog.slug, name: metricsCatalog.name })
      .from(metricsCatalog),
  ]);
  const pubById = new Map(pubRows.map((r) => [r.id, r.name]));
  const mktById = new Map(mktRows.map((r) => [r.id, r.name]));
  // El catálogo de métricas es per-cliente, así que un mismo slug puede
  // repetirse con distinto nombre; para el label del diff cualquiera sirve.
  const metricBySlug = new Map(metricRows.map((r) => [r.slug, r.name]));
  return {
    publisherName: (id: string) => pubById.get(id) ?? "(publisher borrado)",
    marketName: (id: string | null) => (id ? (mktById.get(id) ?? null) : null),
    metricName: (slug: string) => metricBySlug.get(slug) ?? slug,
  };
}

// Historial COMPLETO con diffs. Carga todos los `snapshot_json` del plan: caro,
// así que queda sólo para el Excel (que arma una hoja con todo el historial).
// La página usa getPlanVersionList + getPlanVersionDiff.
export async function getPlanVersionHistory(
  planId: string,
): Promise<PlanVersionEntry[]> {
  const snaps = await db
    .select()
    .from(mediaPlanSnapshots)
    .where(eq(mediaPlanSnapshots.mediaPlanId, planId))
    .orderBy(asc(mediaPlanSnapshots.versionNumber));
  if (snaps.length === 0) return [];

  // Catálogos para resolver nombres: el snapshot congela ids, el nombre
  // correcto es el de HOY (mismo criterio que getPlanDetailAtVersion).
  const [pubRows, mktRows, metricRows, runs] = await Promise.all([
    db.select({ id: publishers.id, name: publishers.name }).from(publishers),
    db.select({ id: markets.id, name: markets.name }).from(markets),
    db
      .select({ slug: metricsCatalog.slug, name: metricsCatalog.name })
      .from(metricsCatalog),
    db
      .select()
      .from(mediaPlanQaRuns)
      .where(eq(mediaPlanQaRuns.mediaPlanId, planId)),
  ]);

  const pubById = new Map(pubRows.map((r) => [r.id, r.name]));
  const mktById = new Map(mktRows.map((r) => [r.id, r.name]));
  // El catálogo de métricas es per-cliente, así que un mismo slug puede
  // repetirse con distinto nombre; para el label del diff cualquiera sirve.
  const metricBySlug = new Map(metricRows.map((r) => [r.slug, r.name]));

  const names = {
    publisherName: (id: string) => pubById.get(id) ?? "(publisher borrado)",
    marketName: (id: string | null) => (id ? (mktById.get(id) ?? null) : null),
    metricName: (slug: string) => metricBySlug.get(slug) ?? slug,
  };

  const runByVersion = new Map(runs.map((r) => [r.versionNumber, r]));
  const runIds = runs.map((r) => r.id);
  const checkRows = runIds.length
    ? await db
        .select({ qaRunId: mediaPlanQaChecks.qaRunId })
        .from(mediaPlanQaChecks)
        .where(inArray(mediaPlanQaChecks.qaRunId, runIds))
    : [];
  const checksByRun = new Map<string, number>();
  for (const c of checkRows) {
    checksByRun.set(c.qaRunId, (checksByRun.get(c.qaRunId) ?? 0) + 1);
  }

  const entries: PlanVersionEntry[] = snaps.map((snap, i) => {
    const prev = i === 0 ? null : (snaps[i - 1].snapshotJson as CapturedSnapshot);
    const curr = snap.snapshotJson as CapturedSnapshot;
    const run = runByVersion.get(snap.versionNumber) ?? null;
    return {
      versionNumber: snap.versionNumber,
      approvedAt: snap.approvedAt,
      notes: snap.notes,
      pdfUrl: snap.pdfUrl,
      signedPdfUrl: snap.signedPdfUrl,
      diff: buildPlanVersionDiff(prev, curr ?? {}, names),
      qa: run
        ? {
            completedAt: run.completedAt,
            completedByEmail: run.completedByEmail,
            notes: run.notes,
            checkedCount: checksByRun.get(run.id) ?? 0,
          }
        : null,
    };
  });

  // Más reciente arriba.
  return entries.reverse();
}
