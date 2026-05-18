"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { recordAudit } from "@/lib/audit";
import {
  budgetOrigins,
  clients,
  projects,
} from "@/db/schema";

type Result<T = void> =
  | (T extends void ? { ok: true } : { ok: true } & T)
  | { ok: false; error: string };

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// El `code` es interno (URL slug + convención de nombres de planes). Se deriva
// del nombre del proyecto y se le agrega un sufijo -N si ya existe.
async function uniqueProjectCode(name: string): Promise<string> {
  const base = slugify(name) || "proyecto";
  let code = base;
  let n = 1;
  while (true) {
    const [hit] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.code, code))
      .limit(1);
    if (!hit) return code;
    n += 1;
    code = `${base}-${n}`;
  }
}

export async function createProject(input: {
  clientId: string;
  budgetOriginId: string;
  name: string;
  totalGrossBudgetUsd?: number;
  startDate?: string | null;
  notesMd?: string | null;
}): Promise<Result<{ projectId: string; code: string }>> {
  if (!input.name.trim()) return { ok: false, error: "Nombre requerido" };
  if (!input.clientId) return { ok: false, error: "Falta cliente" };
  if (!input.budgetOriginId) return { ok: false, error: "Falta budget origin" };

  // Validar que el budget origin pertenezca al cliente
  const [origin] = await db
    .select()
    .from(budgetOrigins)
    .where(eq(budgetOrigins.id, input.budgetOriginId))
    .limit(1);
  if (!origin) return { ok: false, error: "Budget origin no encontrado" };
  if (origin.clientId !== input.clientId) {
    return {
      ok: false,
      error: "El budget origin no pertenece al cliente seleccionado",
    };
  }

  try {
    const code = await uniqueProjectCode(input.name);
    const [proj] = await db
      .insert(projects)
      .values({
        clientId: input.clientId,
        budgetOriginId: input.budgetOriginId,
        code,
        name: input.name.trim(),
        status: "active",
        startDate: input.startDate ?? null,
        totalGrossBudgetUsd:
          input.totalGrossBudgetUsd != null
            ? input.totalGrossBudgetUsd.toFixed(2)
            : null,
        notesMd: input.notesMd ?? null,
      })
      .returning();

    await recordAudit({
      entityType: "project",
      entityId: proj.id,
      action: "create",
      afterJson: proj,
    });

    revalidatePath("/proyectos");
    return { ok: true, projectId: proj.id, code: proj.code };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error desconocido";
    return { ok: false, error: msg };
  }
}

export async function updateProject(input: {
  projectId: string;
  name?: string;
  budgetOriginId?: string;
  totalGrossBudgetUsd?: number | null;
  startDate?: string | null;
  notesMd?: string | null;
}): Promise<Result> {
  const [before] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1);
  if (!before) return { ok: false, error: "Proyecto no encontrado" };

  const update: Record<string, unknown> = {};

  if (input.name !== undefined) {
    if (!input.name.trim()) return { ok: false, error: "Nombre requerido" };
    update.name = input.name.trim();
  }

  if (input.budgetOriginId !== undefined) {
    const [origin] = await db
      .select()
      .from(budgetOrigins)
      .where(eq(budgetOrigins.id, input.budgetOriginId))
      .limit(1);
    if (!origin) return { ok: false, error: "Budget origin no encontrado" };
    if (origin.clientId !== before.clientId) {
      return {
        ok: false,
        error: "El budget origin no pertenece al cliente del proyecto",
      };
    }
    update.budgetOriginId = input.budgetOriginId;
  }

  if (input.totalGrossBudgetUsd !== undefined) {
    update.totalGrossBudgetUsd =
      input.totalGrossBudgetUsd != null
        ? input.totalGrossBudgetUsd.toFixed(2)
        : null;
  }

  if (input.startDate !== undefined) {
    update.startDate = input.startDate || null;
  }

  if (input.notesMd !== undefined) {
    update.notesMd = input.notesMd || null;
  }

  if (Object.keys(update).length === 0) return { ok: true };

  const [after] = await db
    .update(projects)
    .set(update)
    .where(eq(projects.id, input.projectId))
    .returning();

  await recordAudit({
    entityType: "project",
    entityId: input.projectId,
    action: "update",
    beforeJson: before,
    afterJson: after,
  });

  revalidatePath("/proyectos");
  revalidatePath(`/proyectos/${before.code}`);
  return { ok: true };
}

// Borra el proyecto. La cascada se lleva planes, publishers, placements,
// fees, snapshots, billings y reportes asociados.
export async function deleteProject(input: {
  projectId: string;
}): Promise<Result> {
  const [before] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1);
  if (!before) return { ok: false, error: "Proyecto no encontrado" };

  await db.delete(projects).where(eq(projects.id, input.projectId));

  await recordAudit({
    entityType: "project",
    entityId: input.projectId,
    action: "delete",
    beforeJson: before,
  });

  revalidatePath("/proyectos");
  return { ok: true };
}

// Lookup data for the new-project form
export async function getNewProjectFormData() {
  const allClients = await db
    .select()
    .from(clients)
    .where(eq(clients.status, "active"));
  const allOrigins = await db
    .select({
      id: budgetOrigins.id,
      clientId: budgetOrigins.clientId,
      name: budgetOrigins.name,
    })
    .from(budgetOrigins);

  return { clients: allClients, origins: allOrigins };
}
