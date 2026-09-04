"use server";

import { and, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { invalidate } from "@/lib/cache-invalidate";
import { CATALOG_TAG } from "@/lib/cache-tags";
import { db } from "@/db";
import { markets } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import {
  buildMarketName,
  canonicalMarketName,
  type MarketFormValue,
} from "@/lib/market-nomenclature";
import { assertCanWrite } from "@/lib/read-only";

type Result<T = void> =
  | (T extends void ? { ok: true } : { ok: true } & T)
  | { ok: false; error: string };

function pathsToRevalidate(clientSlug?: string) {
  revalidatePath("/configuracion/markets");
  if (clientSlug) revalidatePath(`/configuracion/clientes/${clientSlug}`);
  invalidate(CATALOG_TAG);
}

// ────────────────────────────────────────────────────────────────────────────
// El nombre NO se tipea: lo arma `buildMarketName` con lo que eligió el form
// (nivel + país + plaza). Así el catálogo no puede volver a llenarse de
// variantes del mismo lugar ("Panama" / "Panamá" / "Panama City" /
// "Ciudad de Panamá" eran cuatro mercados distintos). Ver
// lib/market-nomenclature.ts para la taxonomía.
//
// El slug SIEMPRE se deriva del nombre canónico — también al renombrar, que
// antes lo dejaba congelado. Importa porque el mapa de /analisis geocodifica
// probando el slug ANTES que el nombre (lib/market-geo.ts): un slug viejo
// contra un nombre nuevo ponía la burbuja en el lugar equivocado.
// ────────────────────────────────────────────────────────────────────────────
function resolveName(value: MarketFormValue): { name: string; slug: string } | null {
  const name = buildMarketName(value).trim();
  if (!name) return null;
  const canon = canonicalMarketName(name);
  // `buildMarketName` ya devuelve la forma canónica; canonizar de nuevo es la
  // red de seguridad para la plaza escrita a mano en "Otra…".
  return { name: canon.name || name, slug: canon.slug };
}

/** Nombre del mercado que ya ocupa ese slug, si hay alguno. */
async function slugTakenBy(
  clientId: string,
  slug: string,
  exceptId?: string,
): Promise<string | null> {
  const conds = [eq(markets.clientId, clientId), eq(markets.slug, slug)];
  if (exceptId) conds.push(ne(markets.id, exceptId));
  const [row] = await db
    .select({ name: markets.name })
    .from(markets)
    .where(and(...conds))
    .limit(1);
  return row?.name ?? null;
}

export async function createMarket(input: {
  clientId: string;
  clientSlug?: string;
  value: MarketFormValue;
}): Promise<Result<{ id: string }>> {
  // Barrera de escritura: la sesión de auditoría y los usuarios con rol Viewer
  // no pueden mutar nada. Ver lib/read-only.ts.
  const denied = await assertCanWrite();
  if (denied) return denied;

  if (!input.clientId) return { ok: false, error: "Cliente requerido" };

  const resolved = resolveName(input.value);
  if (!resolved) return { ok: false, error: "Elegí país y nivel del mercado" };
  const { name, slug } = resolved;

  const taken = await slugTakenBy(input.clientId, slug);
  if (taken) {
    return {
      ok: false,
      error: `Ese mercado ya existe en el catálogo como "${taken}"`,
    };
  }

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
        name,
        slug,
        sortOrder: next,
        enabled: true,
      })
      .returning();

    await recordAudit({
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
      return { ok: false, error: `Ese mercado ya existe en el catálogo` };
    }
    return { ok: false, error: msg };
  }
}

export async function updateMarket(input: {
  id: string;
  clientSlug?: string;
  /** Nueva definición del mercado. Omitir para tocar sólo `enabled`. */
  value?: MarketFormValue;
  enabled?: boolean;
}): Promise<Result> {
  const denied = await assertCanWrite();
  if (denied) return denied;

  const [before] = await db
    .select()
    .from(markets)
    .where(eq(markets.id, input.id))
    .limit(1);
  if (!before) return { ok: false, error: "Mercado no encontrado" };

  const update: Record<string, unknown> = {};

  if (input.value !== undefined) {
    const resolved = resolveName(input.value);
    if (!resolved) return { ok: false, error: "Elegí país y nivel del mercado" };
    if (resolved.slug !== before.slug) {
      const taken = await slugTakenBy(before.clientId, resolved.slug, before.id);
      if (taken) {
        return {
          ok: false,
          error: `No se puede: "${taken}" ya ocupa ese lugar del catálogo. Pasá las líneas a ese mercado y borrá este.`,
        };
      }
    }
    update.name = resolved.name;
    update.slug = resolved.slug;
  }

  if (input.enabled !== undefined) update.enabled = input.enabled;
  if (Object.keys(update).length === 0) return { ok: true };

  const [after] = await db
    .update(markets)
    .set(update)
    .where(eq(markets.id, input.id))
    .returning();

  await recordAudit({
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
  const denied = await assertCanWrite();
  if (denied) return denied;

  const [before] = await db
    .select()
    .from(markets)
    .where(eq(markets.id, input.id))
    .limit(1);
  if (!before) return { ok: false, error: "No encontrado" };

  // El FK en placements tiene onDelete: "set null", así que se permite.
  await db.delete(markets).where(eq(markets.id, input.id));

  await recordAudit({
    entityType: "market",
    entityId: input.id,
    action: "delete",
    beforeJson: before,
  });

  pathsToRevalidate(input.clientSlug);
  return { ok: true };
}
