"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { publishers } from "@/db/schema";
import { recordAudit } from "@/lib/audit";

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

function pathsToRevalidate(clientSlug?: string) {
  if (clientSlug) revalidatePath(`/configuracion/clientes/${clientSlug}`);
}

// ════════════════════════════════════════════════════════════════════════════
// Publishers — per-cliente. Mismo patrón que markets / metrics: cada cliente
// tiene su propia lista, con su slug/nombre, su agency_pays y su flag enabled.
// Se administra desde /configuracion/clientes/[slug].
// ════════════════════════════════════════════════════════════════════════════

export async function createPublisher(input: {
  clientId: string;
  clientSlug?: string;
  name: string;
  slug?: string;
  agencyPays?: boolean;
}): Promise<Result<{ id: string }>> {
  if (!input.clientId) return { ok: false, error: "Cliente requerido" };
  if (!input.name.trim()) return { ok: false, error: "Nombre requerido" };
  const slug = (input.slug?.trim() || slugify(input.name)).slice(0, 64);
  if (!slug) return { ok: false, error: "No se pudo generar el slug" };

  const [{ next }] = await db
    .select({
      next: sql<number>`coalesce(max(${publishers.sortOrder}), -1) + 1`,
    })
    .from(publishers)
    .where(eq(publishers.clientId, input.clientId));

  try {
    const [pub] = await db
      .insert(publishers)
      .values({
        clientId: input.clientId,
        name: input.name.trim(),
        slug,
        agencyPays: input.agencyPays ?? true,
        sortOrder: next,
        enabled: true,
      })
      .returning();

    await recordAudit({
      entityType: "publisher",
      entityId: pub.id,
      action: "create",
      afterJson: pub,
    });

    pathsToRevalidate(input.clientSlug);
    return { ok: true, id: pub.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error desconocido";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return {
        ok: false,
        error: `Ya existe un publisher con slug "${slug}" para este cliente`,
      };
    }
    return { ok: false, error: msg };
  }
}

export async function updatePublisher(input: {
  id: string;
  clientSlug?: string;
  name?: string;
  agencyPays?: boolean;
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
  if (input.agencyPays !== undefined) update.agencyPays = input.agencyPays;
  if (input.enabled !== undefined) update.enabled = input.enabled;
  if (Object.keys(update).length === 0) return { ok: true };

  const [after] = await db
    .update(publishers)
    .set(update)
    .where(eq(publishers.id, input.id))
    .returning();

  await recordAudit({
    entityType: "publisher",
    entityId: input.id,
    action: "update",
    beforeJson: before,
    afterJson: after,
  });

  pathsToRevalidate(input.clientSlug);
  return { ok: true };
}

export async function deletePublisher(input: {
  id: string;
  clientSlug?: string;
}): Promise<Result> {
  const [before] = await db
    .select()
    .from(publishers)
    .where(eq(publishers.id, input.id))
    .limit(1);
  if (!before) return { ok: false, error: "No encontrado" };

  // Los publishers usados en planes/billings/snapshots tienen FK con
  // onDelete: "restrict" — no se pueden borrar. La UI sugiere deshabilitar.
  try {
    await db.delete(publishers).where(eq(publishers.id, input.id));
    await recordAudit({
      entityType: "publisher",
      entityId: input.id,
      action: "delete",
      beforeJson: before,
    });
    pathsToRevalidate(input.clientSlug);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error desconocido";
    if (msg.includes("violates foreign key")) {
      return {
        ok: false,
        error:
          "Este publisher está en uso en planes existentes. Deshabilitalo en lugar de borrarlo.",
      };
    }
    return { ok: false, error: msg };
  }
}
