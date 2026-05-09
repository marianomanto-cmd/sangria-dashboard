"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { auditLog, publishers } from "@/db/schema";

type Result<T = void> =
  | (T extends void ? { ok: true } : { ok: true } & T)
  | { ok: false; error: string };

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function createPublisher(input: {
  name: string;
  slug?: string;
  agencyPaysDefault?: boolean;
}): Promise<Result<{ id: string }>> {
  if (!input.name.trim()) return { ok: false, error: "Nombre requerido" };
  const slug = (input.slug?.trim() || slugify(input.name)).slice(0, 64);
  if (!slug) return { ok: false, error: "No se pudo generar el slug" };

  const [{ next }] = await db
    .select({
      next: sql<number>`coalesce(max(${publishers.sortOrder}), -1) + 1`,
    })
    .from(publishers);

  try {
    const [pub] = await db
      .insert(publishers)
      .values({
        name: input.name.trim(),
        slug,
        agencyPaysDefault: input.agencyPaysDefault ?? true,
        sortOrder: next,
        enabled: true,
      })
      .returning();

    await db.insert(auditLog).values({
      entityType: "publisher",
      entityId: pub.id,
      action: "create",
      afterJson: pub,
    });

    revalidatePath("/configuracion/publishers");
    return { ok: true, id: pub.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error desconocido";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return { ok: false, error: `Ya existe un publisher con slug "${slug}"` };
    }
    return { ok: false, error: msg };
  }
}

export async function updatePublisher(input: {
  id: string;
  name?: string;
  agencyPaysDefault?: boolean;
  enabled?: boolean;
}): Promise<Result> {
  const [before] = await db
    .select()
    .from(publishers)
    .where(eq(publishers.id, input.id))
    .limit(1);
  if (!before) return { ok: false, error: "Publisher no encontrado" };

  const update: Record<string, unknown> = {};
  if (input.name !== undefined) update.name = input.name.trim();
  if (input.agencyPaysDefault !== undefined)
    update.agencyPaysDefault = input.agencyPaysDefault;
  if (input.enabled !== undefined) update.enabled = input.enabled;
  if (Object.keys(update).length === 0) return { ok: true };

  const [after] = await db
    .update(publishers)
    .set(update)
    .where(eq(publishers.id, input.id))
    .returning();

  await db.insert(auditLog).values({
    entityType: "publisher",
    entityId: input.id,
    action: "update",
    beforeJson: before,
    afterJson: after,
  });

  revalidatePath("/configuracion/publishers");
  return { ok: true };
}

export async function deletePublisher(id: string): Promise<Result> {
  const [before] = await db
    .select()
    .from(publishers)
    .where(eq(publishers.id, id))
    .limit(1);
  if (!before) return { ok: false, error: "No encontrado" };

  // No borramos publishers usados en planes; los disable.
  try {
    await db.delete(publishers).where(eq(publishers.id, id));
    await db.insert(auditLog).values({
      entityType: "publisher",
      entityId: id,
      action: "delete",
      beforeJson: before,
    });
    revalidatePath("/configuracion/publishers");
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error desconocido";
    if (msg.includes("violates foreign key")) {
      return {
        ok: false,
        error:
          "Este publisher está en uso en planes existentes. Marcalo como deshabilitado en lugar de borrarlo.",
      };
    }
    return { ok: false, error: msg };
  }
}
