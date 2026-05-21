"use server";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { recordAudit } from "@/lib/audit";
import {
  mediaPlanPlacements,
  mediaPlanPublishers,
  mediaPlans,
  projects,
  publishers,
  simulatorScenarios,
} from "@/db/schema";
import {
  getBenchmarkDetail,
  getBenchmarks,
  getScenario,
  listCompareablePlans,
  listProjectsForPromotion,
} from "@/db/queries/simulator";
import type {
  BenchmarkFilters,
  BenchmarkRow,
  ScenarioJson,
  ScenarioRow,
} from "@/lib/simulator-types";
import type {
  BenchmarkPlacementDetail,
  CompareablePlanSummary,
  PromoteTargetProject,
  ScenarioFull,
} from "@/db/queries/simulator";
import {
  findBenchmark,
  placementMetricsFromRow,
  primaryMetricKeyFor,
} from "@/components/simulator/builder-helpers";

type Result<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

// ════════════════════════════════════════════════════════════════════════════
// Simulator actions — CRUD de escenarios. Sin audit log (son sandbox), sin
// reglas de status, sin promoción a plan real (eso vendrá en otra iteración
// si los planners lo piden).
// ════════════════════════════════════════════════════════════════════════════

function validateRows(json: unknown): json is ScenarioJson {
  if (!json || typeof json !== "object") return false;
  const rows = (json as ScenarioJson).rows;
  if (!Array.isArray(rows)) return false;
  return rows.every(
    (r) =>
      typeof r === "object" &&
      r !== null &&
      typeof r.budgetUsd === "number" &&
      Number.isFinite(r.budgetUsd) &&
      r.budgetUsd >= 0,
  );
}

export async function createScenario(input: {
  clientId: string;
  name: string;
  rowsJson?: ScenarioJson;
}): Promise<Result<{ id: string }>> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "El nombre es obligatorio" };
  const json: ScenarioJson = input.rowsJson ?? { rows: [] };
  if (!validateRows(json)) {
    return { ok: false, error: "Filas inválidas" };
  }

  const [row] = await db
    .insert(simulatorScenarios)
    .values({
      clientId: input.clientId,
      name,
      rowsJson: json,
    })
    .returning({ id: simulatorScenarios.id });

  revalidatePath("/reportes/simulador");
  return { ok: true, data: { id: row.id } };
}

export async function updateScenario(input: {
  id: string;
  name?: string;
  rowsJson?: ScenarioJson;
}): Promise<Result> {
  const patch: Partial<typeof simulatorScenarios.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) return { ok: false, error: "El nombre no puede estar vacío" };
    patch.name = name;
  }
  if (input.rowsJson !== undefined) {
    if (!validateRows(input.rowsJson)) {
      return { ok: false, error: "Filas inválidas" };
    }
    patch.rowsJson = input.rowsJson;
  }

  const result = await db
    .update(simulatorScenarios)
    .set(patch)
    .where(eq(simulatorScenarios.id, input.id))
    .returning({ id: simulatorScenarios.id });
  if (!result.length) return { ok: false, error: "Escenario no encontrado" };

  revalidatePath("/reportes/simulador");
  return { ok: true };
}

export async function deleteScenario(input: {
  id: string;
}): Promise<Result> {
  const result = await db
    .delete(simulatorScenarios)
    .where(eq(simulatorScenarios.id, input.id))
    .returning({ id: simulatorScenarios.id });
  if (!result.length) return { ok: false, error: "Escenario no encontrado" };

  revalidatePath("/reportes/simulador");
  return { ok: true };
}

// Read-actions: el cliente las llama desde el navegador para refrescar
// data sin recargar la página (cambio de filtros, selección de escenario
// para comparar). No revalidan paths.

export async function fetchBenchmarks(
  filters: BenchmarkFilters,
): Promise<BenchmarkRow[]> {
  return getBenchmarks(filters);
}

export async function fetchScenario(
  id: string,
): Promise<ScenarioFull | null> {
  return getScenario(id);
}

export async function fetchBenchmarkDetail(input: {
  filters: BenchmarkFilters;
  publisherId: string;
  marketId: string | null;
  costMethod: string | null;
}): Promise<BenchmarkPlacementDetail[]> {
  return getBenchmarkDetail(input);
}

export async function fetchCompareablePlans(
  clientId: string,
): Promise<CompareablePlanSummary[]> {
  return listCompareablePlans(clientId);
}

export async function fetchProjectsForPromotion(
  clientId: string,
): Promise<PromoteTargetProject[]> {
  return listProjectsForPromotion(clientId);
}

// ════════════════════════════════════════════════════════════════════════════
// Promoción de escenario a plan real
//
// Crea un media_plan en el proyecto destino + media_plan_publishers
// (agrupando filas por publisher) + media_plan_placements (una por fila del
// escenario). El metricsJson de cada placement lleva la métrica direct que
// corresponde al cost method (impressions/clicks/views) calculada a partir
// del budget + el rate efectivo de la fila.
//
// El plan queda en status='draft' — el planner lo termina de afinar desde el
// editor del plan. Audit log estándar (create) para el plan y cada publisher.
// ════════════════════════════════════════════════════════════════════════════

export async function promoteScenarioToPlan(input: {
  scenarioId: string;
  projectId: string;
  planName: string;
}): Promise<Result<{ planId: string; projectCode: string }>> {
  const name = input.planName.trim();
  if (!name) return { ok: false, error: "El nombre del plan es obligatorio" };

  const [scenario] = await db
    .select()
    .from(simulatorScenarios)
    .where(eq(simulatorScenarios.id, input.scenarioId))
    .limit(1);
  if (!scenario) return { ok: false, error: "Escenario no encontrado" };

  const [project] = await db
    .select({
      id: projects.id,
      code: projects.code,
      clientId: projects.clientId,
      status: projects.status,
    })
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1);
  if (!project) return { ok: false, error: "Proyecto no encontrado" };
  if (project.clientId !== scenario.clientId) {
    return {
      ok: false,
      error: "El proyecto pertenece a otro cliente",
    };
  }
  if (project.status === "reportado") {
    return {
      ok: false,
      error: "No se puede crear planes en un proyecto reportado",
    };
  }

  // Nombre único en el proyecto
  const [existing] = await db
    .select({ id: mediaPlans.id })
    .from(mediaPlans)
    .where(and(eq(mediaPlans.projectId, input.projectId), eq(mediaPlans.name, name), isNull(mediaPlans.deletedAt)))
    .limit(1);
  if (existing) {
    return {
      ok: false,
      error: `Ya existe un plan llamado "${name}" en este proyecto`,
    };
  }

  const rows: ScenarioRow[] = scenario.rowsJson?.rows ?? [];
  const validRows = rows.filter((r) => r.publisherId && r.budgetUsd > 0);
  if (!validRows.length) {
    return {
      ok: false,
      error:
        "El escenario no tiene filas con publisher y budget — no hay nada que promover",
    };
  }

  // Agrupar por publisher
  const byPub = new Map<string, ScenarioRow[]>();
  for (const r of validRows) {
    const arr = byPub.get(r.publisherId!);
    if (arr) arr.push(r);
    else byPub.set(r.publisherId!, [r]);
  }

  // Validar publishers existentes (puede haber IDs huérfanos si se borró un
  // publisher después de armar el escenario).
  const pubIds = [...byPub.keys()];
  const existingPubs = await db
    .select({ id: publishers.id })
    .from(publishers)
    .where(inArray(publishers.id, pubIds));
  const existingPubIds = new Set(existingPubs.map((p) => p.id));
  for (const pid of pubIds) {
    if (!existingPubIds.has(pid)) {
      return {
        ok: false,
        error: "Algunos publishers del escenario ya no existen — editalo antes de promover",
      };
    }
  }

  // Pre-cargar benchmarks del cliente para resolver rates efectivos por
  // fila (cuando el modo es P25/P50/P75 los overrides están vacíos y los
  // rates se sacan del benchmark vigente).
  const benchmarks = await getBenchmarks({ clientId: scenario.clientId });

  // Crear el plan
  const [plan] = await db
    .insert(mediaPlans)
    .values({ projectId: input.projectId, name, status: "draft" })
    .returning();

  await recordAudit({
    entityType: "media_plan",
    entityId: plan.id,
    action: "create",
    afterJson: { ...plan, promotedFromScenarioId: scenario.id },
  });

  // Crear publishers + placements
  let sortOrder = 0;
  for (const [publisherId, pubRows] of byPub) {
    const totalPlanned = pubRows.reduce((s, r) => s + r.budgetUsd, 0);
    const [mpp] = await db
      .insert(mediaPlanPublishers)
      .values({
        mediaPlanId: plan.id,
        publisherId,
        totalPlannedUsd: totalPlanned.toFixed(2),
        sortOrder: sortOrder++,
      })
      .returning();

    await recordAudit({
      entityType: "media_plan_publisher",
      entityId: mpp.id,
      action: "create",
      afterJson: mpp,
    });

    // Placements
    let placementSort = 0;
    for (const row of pubRows) {
      const bench = findBenchmark(benchmarks, row);
      const metricsJson = placementMetricsFromRow(row, bench);
      const primaryKey = primaryMetricKeyFor(row.costMethod);
      // Nombre del placement: si no se especificó formato, usar slug
      // generado del cost method para que sea distinguible.
      const placementName =
        row.formatText?.trim() ||
        `${row.costMethod ?? "Placement"}${primaryKey ? ` (${primaryKey})` : ""}`;

      await db.insert(mediaPlanPlacements).values({
        mediaPlanPublisherId: mpp.id,
        placementName,
        marketId: row.marketId,
        amountUsd: row.budgetUsd.toFixed(2),
        costMethod: validateCostMethod(row.costMethod),
        metricsJson,
        sortOrder: placementSort++,
      });
    }
  }

  revalidatePath(`/proyectos/${project.code}`);
  revalidatePath("/planes");
  revalidatePath("/reportes/simulador");

  return { ok: true, data: { planId: plan.id, projectCode: project.code } };
}

// El cost_method del placement es un enum: descarta valores que no caen en
// la lista válida del schema.
const VALID_COST_METHODS = new Set([
  "dCPV",
  "dCPC",
  "dCPM",
  "dCPA",
  "CPM",
  "CPC",
  "CPV",
  "CPA",
  "Flat",
  "Other",
]);

function validateCostMethod(
  cm: string | null,
):
  | "dCPV"
  | "dCPC"
  | "dCPM"
  | "dCPA"
  | "CPM"
  | "CPC"
  | "CPV"
  | "CPA"
  | "Flat"
  | "Other"
  | null {
  if (!cm || !VALID_COST_METHODS.has(cm)) return null;
  return cm as
    | "dCPV"
    | "dCPC"
    | "dCPM"
    | "dCPA"
    | "CPM"
    | "CPC"
    | "CPV"
    | "CPA"
    | "Flat"
    | "Other";
}

export async function duplicateScenario(input: {
  id: string;
  newName?: string;
}): Promise<Result<{ id: string }>> {
  const [src] = await db
    .select()
    .from(simulatorScenarios)
    .where(eq(simulatorScenarios.id, input.id))
    .limit(1);
  if (!src) return { ok: false, error: "Escenario no encontrado" };

  const [row] = await db
    .insert(simulatorScenarios)
    .values({
      clientId: src.clientId,
      name: input.newName?.trim() || `${src.name} (copia)`,
      rowsJson: src.rowsJson,
    })
    .returning({ id: simulatorScenarios.id });

  revalidatePath("/reportes/simulador");
  return { ok: true, data: { id: row.id } };
}
