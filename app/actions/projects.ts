"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  auditLog,
  budgetOrigins,
  clients,
  projects,
} from "@/db/schema";

type Result<T = void> =
  | (T extends void ? { ok: true } : { ok: true } & T)
  | { ok: false; error: string };

export async function createProject(input: {
  clientId: string;
  budgetOriginId: string;
  code: string;
  name: string;
  totalGrossBudgetUsd?: number;
  startDate?: string | null;
  endDate?: string | null;
  notesMd?: string | null;
}): Promise<Result<{ projectId: string; code: string }>> {
  if (!input.code.trim()) return { ok: false, error: "Code requerido" };
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
    const [proj] = await db
      .insert(projects)
      .values({
        clientId: input.clientId,
        budgetOriginId: input.budgetOriginId,
        code: input.code.trim(),
        name: input.name.trim(),
        status: "active",
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        totalGrossBudgetUsd:
          input.totalGrossBudgetUsd != null
            ? input.totalGrossBudgetUsd.toFixed(2)
            : null,
        notesMd: input.notesMd ?? null,
      })
      .returning();

    await db.insert(auditLog).values({
      entityType: "project",
      entityId: proj.id,
      action: "create",
      afterJson: proj,
    });

    revalidatePath("/proyectos");
    return { ok: true, projectId: proj.id, code: proj.code };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error desconocido";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return { ok: false, error: `Ya existe un proyecto con code "${input.code}"` };
    }
    return { ok: false, error: msg };
  }
}

// Lookup data for the new-project form
export async function getNewProjectFormData() {
  const allClients = await db.select().from(clients).where(eq(clients.status, "active"));
  const allOrigins = await db
    .select({
      id: budgetOrigins.id,
      clientId: budgetOrigins.clientId,
      name: budgetOrigins.name,
    })
    .from(budgetOrigins);

  // Helper: para sugerir el próximo m-id incremental.
  const [{ year }] = await db.execute<{ year: number }>(
    sql`select extract(year from now())::int as year`,
  );

  return { clients: allClients, origins: allOrigins, currentYear: year };
}
