"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { budgetOrigins, projects } from "@/db/schema";
import { recordAudit } from "@/lib/audit";

type Result<T = void> =
  | (T extends void ? { ok: true } : { ok: true } & T)
  | { ok: false; error: string };

function pathsToRevalidate(clientSlug?: string) {
  revalidatePath("/proyectos");
  revalidatePath("/planes");
  if (clientSlug) revalidatePath(`/configuracion/clientes/${clientSlug}`);
}

export async function createBudgetOrigin(input: {
  clientId: string;
  clientSlug?: string;
  name: string;
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
        colorHex: input.colorHex?.trim() || null,
      })
      .returning();

    await recordAudit({
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
  if (input.colorHex !== undefined)
    update.colorHex = input.colorHex?.trim() || null;
  if (Object.keys(update).length === 0) return { ok: true };

  const [after] = await db
    .update(budgetOrigins)
    .set(update)
    .where(eq(budgetOrigins.id, input.id))
    .returning();

  await recordAudit({
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

  await recordAudit({
    entityType: "budget_origin",
    entityId: input.id,
    action: "delete",
    beforeJson: before,
  });

  pathsToRevalidate(input.clientSlug);
  return { ok: true };
}
