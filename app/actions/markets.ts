"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { auditLog, markets } from "@/db/schema";

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

function pathsToRevalidate(clientSlug?: string) {
  revalidatePath("/configuracion/markets");
  if (clientSlug) revalidatePath(`/configuracion/clientes/${clientSlug}`);
}

export async function createMarket(input: {
  clientId: string;
  clientSlug?: string;
  name: string;
  slug?: string;
}): Promise<Result<{ id: string }>> {
  if (!input.clientId) return { ok: false, error: "Cliente requerido" };
  if (!input.name.trim()) return { ok: false, error: "Nombre requerido" };
  const slug = (input.slug?.trim() || slugify(input.name)).slice(0, 64);
  if (!slug) return { ok: false, error: "No se pudo generar el slug" };

  const [{ next }] = await db
    .select({
      next: sql<number>`coalesce(max(${markets.sortOrder}), -1) + 1`,
    })
    .from(markets)
    .where(eq(markets.clientId, input.clientId));

  try {
    const [m] = await db
      .insert(markets)
      .values({
        clientId: input.clientId,
        name: input.name.trim(),
        slug,
        sortOrder: next,
        enabled: true,
      })
      .returning();

    await db.insert(auditLog).values({
      entityType: "market",
      entityId: m.id,
      action: "create",
      afterJson: m,
    });

    pathsToRevalidate(input.clientSlug);
    return { ok: true, id: m.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error desconocido";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return {
        ok: false,
        error: `Ya existe un mercado con slug "${slug}" para este cliente`,
      };
    }
    return { ok: false, error: msg };
  }
}

export async function updateMarket(input: {
  id: string;
  clientSlug?: string;
  name?: string;
  enabled?: boolean;
}): Promise<Result> {
  const [before] = await db
    .select()
    .from(markets)
    .where(eq(markets.id, input.id))
    .limit(1);
  if (!before) return { ok: false, error: "Mercado no encontrado" };

  const update: Record<string, unknown> = {};
  if (input.name !== undefined) update.name = input.name.trim();
  if (input.enabled !== undefined) update.enabled = input.enabled;
  if (Object.keys(update).length === 0) return { ok: true };

  const [after] = await db
    .update(markets)
    .set(update)
    .where(eq(markets.id, input.id))
    .returning();

  await db.insert(auditLog).values({
    entityType: "market",
    entityId: input.id,
    action: "update",
    beforeJson: before,
    afterJson: after,
  });

  pathsToRevalidate(input.clientSlug);
  return { ok: true };
}

export async function deleteMarket(input: {
  id: string;
  clientSlug?: string;
}): Promise<Result> {
  const [before] = await db
    .select()
    .from(markets)
    .where(eq(markets.id, input.id))
    .limit(1);
  if (!before) return { ok: false, error: "No encontrado" };

  // El FK en placements tiene onDelete: "set null", así que se permite.
  await db.delete(markets).where(eq(markets.id, input.id));

  await db.insert(auditLog).values({
    entityType: "market",
    entityId: input.id,
    action: "delete",
    beforeJson: before,
  });

  pathsToRevalidate(input.clientSlug);
  return { ok: true };
}
