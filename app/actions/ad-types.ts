"use server";

import { asc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { adTypes } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { DEFAULT_AD_TYPES } from "@/lib/ad-types";

// ════════════════════════════════════════════════════════════════════════════
// Catálogo de TIPOS DE AD — per-cliente, mismo criterio que metrics_catalog.
//
// Alimenta el desplegable "Tipo de ad" que completa el AM/PM en la ventana de
// Tráfico. Cada cliente tiene su lista (un cliente que no hace PMAX no tiene
// por qué verlo) y se administra en /configuracion/clientes/[slug].
//
// `requiresDetail` marca las entradas tipo "Otro": el ad queda incompleto
// —y por lo tanto bloquea el QA— hasta que se escriba a mano de qué se trata.
// ════════════════════════════════════════════════════════════════════════════

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

function pathsToRevalidate(clientSlug?: string) {
  if (clientSlug) revalidatePath(`/configuracion/clientes/${clientSlug}`);
}

export async function listAdTypesForClient(clientId: string) {
  if (!clientId) return [];
  return db
    .select()
    .from(adTypes)
    .where(eq(adTypes.clientId, clientId))
    .orderBy(asc(adTypes.sortOrder), asc(adTypes.name));
}

export async function createAdType(input: {
  clientId: string;
  clientSlug?: string;
  name: string;
  slug?: string;
  requiresDetail?: boolean;
}): Promise<Result<{ id: string }>> {
  if (!input.clientId) return { ok: false, error: "Cliente requerido" };
  if (!input.name.trim()) return { ok: false, error: "Nombre requerido" };
  const slug = (input.slug?.trim() || slugify(input.name)).slice(0, 64);
  if (!slug) return { ok: false, error: "No se pudo generar el slug" };

  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${adTypes.sortOrder}), -1) + 1` })
    .from(adTypes)
    .where(eq(adTypes.clientId, input.clientId));

  try {
    const [row] = await db
      .insert(adTypes)
      .values({
        clientId: input.clientId,
        name: input.name.trim(),
        slug,
        requiresDetail: input.requiresDetail ?? false,
        sortOrder: next,
        enabled: true,
      })
      .returning();

    await recordAudit({
      entityType: "ad_type",
      entityId: row.id,
      action: "create",
      afterJson: row,
    });

    pathsToRevalidate(input.clientSlug);
    return { ok: true, id: row.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error desconocido";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return {
        ok: false,
        error: `Ya existe un tipo de ad con slug "${slug}" para este cliente`,
      };
    }
    return { ok: false, error: msg };
  }
}

export async function updateAdType(input: {
  id: string;
  clientSlug?: string;
  name?: string;
  requiresDetail?: boolean;
  enabled?: boolean;
}): Promise<Result> {
  const [before] = await db
    .select()
    .from(adTypes)
    .where(eq(adTypes.id, input.id))
    .limit(1);
  if (!before) return { ok: false, error: "Tipo de ad no encontrado" };

  const update: Record<string, unknown> = {};
  if (input.name !== undefined) {
    if (!input.name.trim()) return { ok: false, error: "Nombre requerido" };
    update.name = input.name.trim();
  }
  if (input.requiresDetail !== undefined) {
    update.requiresDetail = input.requiresDetail;
  }
  if (input.enabled !== undefined) update.enabled = input.enabled;
  if (Object.keys(update).length === 0) return { ok: true };

  const [after] = await db
    .update(adTypes)
    .set(update)
    .where(eq(adTypes.id, input.id))
    .returning();

  await recordAudit({
    entityType: "ad_type",
    entityId: input.id,
    action: "update",
    beforeJson: before,
    afterJson: after,
  });

  pathsToRevalidate(input.clientSlug);
  return { ok: true };
}

// Borrar un tipo NO borra los ads que lo usaban: la FK es onDelete set null, así
// que esos ads quedan sin tipo y la regla los marca incompletos (que es lo
// correcto — hay que re-clasificarlos). Para sacarlo de circulación sin tocar
// lo cargado, deshabilitarlo es mejor que borrarlo.
export async function deleteAdType(input: {
  id: string;
  clientSlug?: string;
}): Promise<Result> {
  const [before] = await db
    .select()
    .from(adTypes)
    .where(eq(adTypes.id, input.id))
    .limit(1);
  if (!before) return { ok: false, error: "No encontrado" };

  await db.delete(adTypes).where(eq(adTypes.id, input.id));

  await recordAudit({
    entityType: "ad_type",
    entityId: input.id,
    action: "delete",
    beforeJson: before,
  });

  pathsToRevalidate(input.clientSlug);
  return { ok: true };
}

// Siembra los tipos estándar que faltan (no pisa ni duplica los existentes).
export async function seedDefaultAdTypes(input: {
  clientId: string;
  clientSlug?: string;
}): Promise<Result<{ created: number }>> {
  if (!input.clientId) return { ok: false, error: "Cliente requerido" };

  const existing = await db
    .select({ slug: adTypes.slug })
    .from(adTypes)
    .where(eq(adTypes.clientId, input.clientId));
  const have = new Set(existing.map((r) => r.slug));

  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${adTypes.sortOrder}), -1) + 1` })
    .from(adTypes)
    .where(eq(adTypes.clientId, input.clientId));

  const toCreate = DEFAULT_AD_TYPES.filter((t) => !have.has(t.slug));
  if (toCreate.length === 0) {
    pathsToRevalidate(input.clientSlug);
    return { ok: true, created: 0 };
  }

  const rows = await db
    .insert(adTypes)
    .values(
      toCreate.map((t, i) => ({
        clientId: input.clientId,
        slug: t.slug,
        name: t.name,
        requiresDetail: t.requiresDetail ?? false,
        sortOrder: next + i,
        enabled: true,
      })),
    )
    .returning();

  for (const row of rows) {
    await recordAudit({
      entityType: "ad_type",
      entityId: row.id,
      action: "create",
      afterJson: row,
    });
  }

  pathsToRevalidate(input.clientSlug);
  return { ok: true, created: rows.length };
}
