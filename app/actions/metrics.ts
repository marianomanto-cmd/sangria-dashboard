"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { auditLog, metricsCatalog } from "@/db/schema";

type Result<T = void> =
  | (T extends void ? { ok: true } : { ok: true } & T)
  | { ok: false; error: string };

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export async function createMetric(input: {
  name: string;
  slug?: string;
  kind: "direct" | "calculated";
  unit?: string | null;
  formula?: string | null;
}): Promise<Result<{ id: string }>> {
  if (!input.name.trim()) return { ok: false, error: "Nombre requerido" };
  const slug = (input.slug?.trim() || slugify(input.name)).slice(0, 64);
  if (!slug) return { ok: false, error: "No se pudo generar el slug" };
  if (input.kind === "calculated" && !input.formula?.trim()) {
    return { ok: false, error: "Las métricas calculadas requieren fórmula" };
  }

  const [{ next }] = await db
    .select({
      next: sql<number>`coalesce(max(${metricsCatalog.sortOrder}), -1) + 1`,
    })
    .from(metricsCatalog);

  try {
    const [m] = await db
      .insert(metricsCatalog)
      .values({
        name: input.name.trim(),
        slug,
        kind: input.kind,
        unit: input.unit ?? null,
        formula: input.formula ?? null,
        sortOrder: next,
        enabled: true,
      })
      .returning();

    await db.insert(auditLog).values({
      entityType: "metric",
      entityId: m.id,
      action: "create",
      afterJson: m,
    });

    revalidatePath("/configuracion/metricas");
    return { ok: true, id: m.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error desconocido";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return { ok: false, error: `Ya existe una métrica con slug "${slug}"` };
    }
    return { ok: false, error: msg };
  }
}

export async function updateMetric(input: {
  id: string;
  name?: string;
  unit?: string | null;
  formula?: string | null;
  enabled?: boolean;
}): Promise<Result> {
  const [before] = await db
    .select()
    .from(metricsCatalog)
    .where(eq(metricsCatalog.id, input.id))
    .limit(1);
  if (!before) return { ok: false, error: "Métrica no encontrada" };

  const update: Record<string, unknown> = {};
  if (input.name !== undefined) update.name = input.name.trim();
  if (input.unit !== undefined) update.unit = input.unit;
  if (input.formula !== undefined) update.formula = input.formula;
  if (input.enabled !== undefined) update.enabled = input.enabled;
  if (Object.keys(update).length === 0) return { ok: true };

  const [after] = await db
    .update(metricsCatalog)
    .set(update)
    .where(eq(metricsCatalog.id, input.id))
    .returning();

  await db.insert(auditLog).values({
    entityType: "metric",
    entityId: input.id,
    action: "update",
    beforeJson: before,
    afterJson: after,
  });

  revalidatePath("/configuracion/metricas");
  return { ok: true };
}

export async function deleteMetric(id: string): Promise<Result> {
  const [before] = await db
    .select()
    .from(metricsCatalog)
    .where(eq(metricsCatalog.id, id))
    .limit(1);
  if (!before) return { ok: false, error: "No encontrada" };

  await db.delete(metricsCatalog).where(eq(metricsCatalog.id, id));

  await db.insert(auditLog).values({
    entityType: "metric",
    entityId: id,
    action: "delete",
    beforeJson: before,
  });

  revalidatePath("/configuracion/metricas");
  return { ok: true };
}
