"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { recordAudit } from "@/lib/audit";
import {
  AUX_SHEET_DEFAULT_COLS,
  AUX_SHEET_DEFAULT_ROWS,
  sanitizeAuxGrid,
} from "@/lib/aux-sheet";
import { mediaPlanAuxSheets, mediaPlans, projects } from "@/db/schema";

type Result<T = void> =
  | (T extends void ? { ok: true } : { ok: true } & T)
  | { ok: false; error: string };

async function revalidatePlanPaths(planId: string) {
  const [row] = await db
    .select({ code: projects.code })
    .from(mediaPlans)
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
    .where(eq(mediaPlans.id, planId))
    .limit(1);
  if (row) {
    revalidatePath(`/proyectos/${row.code}`);
    revalidatePath(`/proyectos/${row.code}/planes/${planId}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Sheet auxiliar del plan (máx. 1 por plan) — ver lib/aux-sheet.ts
// ════════════════════════════════════════════════════════════════════════════

export async function createAuxSheet(input: {
  planId: string;
}): Promise<Result<{ sheetId: string }>> {
  if (!input.planId) return { ok: false, error: "Falta plan_id" };

  const [plan] = await db
    .select()
    .from(mediaPlans)
    .where(eq(mediaPlans.id, input.planId))
    .limit(1);
  if (!plan || plan.deletedAt) return { ok: false, error: "Plan no encontrado" };
  if (plan.status === "archived") return { ok: false, error: "Plan archivado" };

  const [existing] = await db
    .select({ id: mediaPlanAuxSheets.id })
    .from(mediaPlanAuxSheets)
    .where(eq(mediaPlanAuxSheets.mediaPlanId, input.planId))
    .limit(1);
  if (existing) {
    return { ok: false, error: "El plan ya tiene un sheet auxiliar" };
  }

  // La grilla nace con el tamaño default para que el editor muestre filas
  // vacías listas para tipear (como un tab nuevo de Excel).
  const emptyGrid = Array.from({ length: AUX_SHEET_DEFAULT_ROWS }, () =>
    Array<string>(AUX_SHEET_DEFAULT_COLS).fill(""),
  );

  try {
    const [sheet] = await db
      .insert(mediaPlanAuxSheets)
      .values({ mediaPlanId: input.planId, gridJson: emptyGrid })
      .returning();

    await recordAudit({
      entityType: "media_plan_aux_sheet",
      entityId: sheet.id,
      action: "create",
      afterJson: sheet,
    });

    await revalidatePlanPaths(input.planId);
    return { ok: true, sheetId: sheet.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    return { ok: false, error: `No se pudo crear el sheet auxiliar: ${msg}` };
  }
}

export async function updateAuxSheet(input: {
  sheetId: string;
  name?: string;
  grid?: string[][];
}): Promise<Result> {
  if (!input.sheetId) return { ok: false, error: "Falta sheet_id" };

  const [before] = await db
    .select()
    .from(mediaPlanAuxSheets)
    .where(eq(mediaPlanAuxSheets.id, input.sheetId))
    .limit(1);
  if (!before) return { ok: false, error: "Sheet auxiliar no encontrado" };

  const update: Record<string, unknown> = {};
  if (input.name !== undefined) {
    if (!input.name.trim()) {
      return { ok: false, error: "El sheet necesita un nombre" };
    }
    update.name = input.name.trim();
  }
  if (input.grid !== undefined) {
    const grid = sanitizeAuxGrid(input.grid);
    if (!grid) return { ok: false, error: "Grilla inválida" };
    update.gridJson = grid;
  }
  if (Object.keys(update).length === 0) return { ok: true };
  update.updatedAt = new Date();

  const [after] = await db
    .update(mediaPlanAuxSheets)
    .set(update)
    .where(eq(mediaPlanAuxSheets.id, input.sheetId))
    .returning();

  await recordAudit({
    entityType: "media_plan_aux_sheet",
    entityId: input.sheetId,
    action: "update",
    beforeJson: before,
    afterJson: after,
  });

  await revalidatePlanPaths(before.mediaPlanId);
  return { ok: true };
}

// Hard delete: el sheet es material de trabajo, no pasa por la papelera.
export async function deleteAuxSheet(input: {
  sheetId: string;
}): Promise<Result> {
  if (!input.sheetId) return { ok: false, error: "Falta sheet_id" };

  const [before] = await db
    .select()
    .from(mediaPlanAuxSheets)
    .where(eq(mediaPlanAuxSheets.id, input.sheetId))
    .limit(1);
  if (!before) return { ok: true }; // ya no existe

  await db
    .delete(mediaPlanAuxSheets)
    .where(eq(mediaPlanAuxSheets.id, input.sheetId));

  await recordAudit({
    entityType: "media_plan_aux_sheet",
    entityId: input.sheetId,
    action: "delete",
    beforeJson: before,
  });

  await revalidatePlanPaths(before.mediaPlanId);
  return { ok: true };
}
