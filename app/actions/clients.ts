"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { auditLog, clients } from "@/db/schema";
import type { Language } from "@/lib/i18n";

type Result<T = void> =
  | (T extends void ? { ok: true } : { ok: true } & T)
  | { ok: false; error: string };

type ClientStatus = "active" | "paused" | "archived";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function createClient(input: {
  name: string;
  slug?: string;
  prefix?: string | null;
  language: Language;
  status?: ClientStatus;
}): Promise<Result<{ id: string; slug: string }>> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Nombre requerido" };

  const slug = (input.slug?.trim() || slugify(name)).slice(0, 64);
  if (!slug) return { ok: false, error: "No se pudo generar el slug" };

  const prefix = input.prefix?.trim() || null;
  const status: ClientStatus = input.status ?? "active";

  try {
    const [row] = await db
      .insert(clients)
      .values({
        name,
        slug,
        prefix,
        language: input.language,
        status,
      })
      .returning();

    await db.insert(auditLog).values({
      entityType: "client",
      entityId: row.id,
      action: "create",
      afterJson: row,
    });

    revalidatePath("/configuracion/clientes");
    revalidatePath("/clientes");
    return { ok: true, id: row.id, slug: row.slug };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error desconocido";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return { ok: false, error: `Ya existe un cliente con slug "${slug}"` };
    }
    return { ok: false, error: msg };
  }
}

export async function updateClient(input: {
  id: string;
  name?: string;
  prefix?: string | null;
  language?: Language;
  status?: ClientStatus;
}): Promise<Result> {
  const [before] = await db
    .select()
    .from(clients)
    .where(eq(clients.id, input.id))
    .limit(1);
  if (!before) return { ok: false, error: "Cliente no encontrado" };

  const update: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const v = input.name.trim();
    if (!v) return { ok: false, error: "Nombre requerido" };
    update.name = v;
  }
  if (input.prefix !== undefined) {
    update.prefix = input.prefix?.trim() || null;
  }
  if (input.language !== undefined) update.language = input.language;
  if (input.status !== undefined) update.status = input.status;
  if (Object.keys(update).length === 0) return { ok: true };

  const [after] = await db
    .update(clients)
    .set(update)
    .where(eq(clients.id, input.id))
    .returning();

  await db.insert(auditLog).values({
    entityType: "client",
    entityId: input.id,
    action: "update",
    beforeJson: before,
    afterJson: after,
  });

  revalidatePath("/configuracion/clientes");
  revalidatePath("/clientes");
  revalidatePath(`/clientes/${after.slug}`);
  return { ok: true };
}

// Nota: no exponemos deleteClient por ahora. La FK desde projects es
// onDelete: "restrict" → borrar un cliente con proyectos rompería. Si
// hace falta, se hace via "archived" + filtrar en UI.
