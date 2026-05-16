"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { simulatorScenarios } from "@/db/schema";
import { getBenchmarks, getScenario } from "@/db/queries/simulator";
import type {
  BenchmarkFilters,
  BenchmarkRow,
  ScenarioJson,
} from "@/lib/simulator-types";
import type { ScenarioFull } from "@/db/queries/simulator";

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
