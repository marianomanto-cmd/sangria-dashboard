"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { auditLog, budgetOrigins, projects } from "@/db/schema";

type Result<T = void> =
  | (T extends void ? { ok: true } : { ok: true } & T)
  | { ok: false; error: string };

// numeric(14,2) — drizzle espera string. Devolvemos null si viene vacío o no
// es un número finito.
function normalizeNumeric(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(2);
}

function pathsToRevalidate(clientSlug?: string) {
  revalidatePath("/proyectos");
  revalidatePath("/planes");
  if (clientSlug) revalidatePath(`/configuracion/clientes/${clientSlug}`);
}

export async function createBudgetOrigin(input: {
  clientId: string;
  clientSlug?: string;
  name: string;
  monthlyTargetUsd?: string | null;
  colorHex?: string | null;
}): Promise<Result<{ id: string }>> {
  if (!input.clientId) return { ok: false, error: "Cliente requerido" };
  if (!input.name.trim()) return { ok: false, error: "Nombre requerido" };

  try {
    const [bo] = await db
      .insert(budgetOrigins)
      .values({
        clientId: input.clientId,
        name: input.name.trim(),
        monthlyTargetUsd: normalizeNumeric(input.monthlyTargetUsd),
        colorHex: input.colorHex?.trim() || null,
      })
      .returning();

    await db.insert(auditLog).values({
      entityType: "budget_origin",
      entityId: bo.id,
      action: "create",
      afterJson: bo,
    });

    pathsToRevalidate(input.clientSlug);
    return { ok: true, id: bo.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error desconocido";
    return { ok: false, error: msg };
  }
}

export async function updateBudgetOrigin(input: {
  id: string;
  clientSlug?: string;
  name?: string;
  monthlyTargetUsd?: string | null;
  colorHex?: string | null;
}): Promise<Result> {
  const [before] = await db
    .select()
    .from(budgetOrigins)
    .where(eq(budgetOrigins.id, input.id))
    .limit(1);
  if (!before) return { ok: false, error: "Budget origin no encontrado" };

  const update: Record<string, unknown> = {};
  if (input.name !== undefined) update.name = input.name.trim();
  if (input.monthlyTargetUsd !== undefined)
    update.monthlyTargetUsd = normalizeNumeric(input.monthlyTargetUsd);
  if (input.colorHex !== undefined)
    update.colorHex = input.colorHex?.trim() || null;
  if (Object.keys(update).length === 0) return { ok: true };

  const [after] = await db
    .update(budgetOrigins)
    .set(update)
    .where(eq(budgetOrigins.id, input.id))
    .returning();

  await db.insert(auditLog).values({
    entityType: "budget_origin",
    entityId: input.id,
    action: "update",
    beforeJson: before,
    afterJson: after,
  });

  pathsToRevalidate(input.clientSlug);
  return { ok: true };
}

export async function deleteBudgetOrigin(input: {
  id: string;
  clientSlug?: string;
}): Promise<Result> {
  const [before] = await db
    .select()
    .from(budgetOrigins)
    .where(eq(budgetOrigins.id, input.id))
    .limit(1);
  if (!before) return { ok: false, error: "No encontrado" };

  // projects.budget_origin_id tiene onDelete: "restrict" — chequeamos antes
  // para dar un error claro en vez de reventar la FK.
  const [inUse] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.budgetOriginId, input.id))
    .limit(1);
  if (inUse) {
    return {
      ok: false,
      error:
        "No se puede eliminar: hay proyectos que usan este budget origin",
    };
  }

  await db.delete(budgetOrigins).where(eq(budgetOrigins.id, input.id));

  await db.insert(auditLog).values({
    entityType: "budget_origin",
    entityId: input.id,
    action: "delete",
    beforeJson: before,
  });

  pathsToRevalidate(input.clientSlug);
  return { ok: true };
}
