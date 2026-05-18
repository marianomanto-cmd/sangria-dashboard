"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { clientPublishers, publishers } from "@/db/schema";
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

    await recordAudit({
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

  await recordAudit({
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
    await recordAudit({
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

// ════════════════════════════════════════════════════════════════════════════
// Client_publishers — per-cliente mapping. Habilita/deshabilita publishers
// y sobrescribe el default global de "agencia paga" por cliente.
// ════════════════════════════════════════════════════════════════════════════

export async function upsertClientPublisher(input: {
  clientId: string;
  publisherId: string;
  enabled?: boolean;
  agencyPays?: boolean;
  clientSlug?: string;
}): Promise<Result> {
  if (!input.clientId) return { ok: false, error: "Cliente requerido" };
  if (!input.publisherId) return { ok: false, error: "Publisher requerido" };

  const [existing] = await db
    .select()
    .from(clientPublishers)
    .where(
      and(
        eq(clientPublishers.clientId, input.clientId),
        eq(clientPublishers.publisherId, input.publisherId),
      ),
    )
    .limit(1);

  // sortOrder por defecto: max + 1 dentro del cliente.
  let sortOrder = existing?.sortOrder ?? 0;
  if (!existing) {
    const [{ next }] = await db
      .select({
        next: sql<number>`coalesce(max(${clientPublishers.sortOrder}), -1) + 1`,
      })
      .from(clientPublishers)
      .where(eq(clientPublishers.clientId, input.clientId));
    sortOrder = next;
  }

  // Defaults para insert: enabled=true; agencyPays viene del catálogo global
  // si no se especifica. En update sólo tocamos lo que vino.
  const baseAgencyPays = await (async () => {
    if (input.agencyPays !== undefined) return input.agencyPays;
    if (existing) return existing.agencyPays;
    const [pub] = await db
      .select({ agencyPaysDefault: publishers.agencyPaysDefault })
      .from(publishers)
      .where(eq(publishers.id, input.publisherId))
      .limit(1);
    return pub?.agencyPaysDefault ?? true;
  })();

  const enabled = input.enabled ?? existing?.enabled ?? true;

  try {
    if (existing) {
      await db
        .update(clientPublishers)
        .set({ enabled, agencyPays: baseAgencyPays })
        .where(eq(clientPublishers.id, existing.id));
    } else {
      await db.insert(clientPublishers).values({
        clientId: input.clientId,
        publisherId: input.publisherId,
        enabled,
        agencyPays: baseAgencyPays,
        sortOrder,
      });
    }

    await recordAudit({
      entityType: "client_publisher",
      entityId: input.publisherId,
      action: existing ? "update" : "create",
      beforeJson: existing ?? null,
      afterJson: { clientId: input.clientId, publisherId: input.publisherId, enabled, agencyPays: baseAgencyPays },
    });

    if (input.clientSlug) {
      revalidatePath(`/configuracion/clientes/${input.clientSlug}`);
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error desconocido";
    return { ok: false, error: msg };
  }
}
