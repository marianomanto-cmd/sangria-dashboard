"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { appUsers } from "@/db/schema";
import { isMissingTableError } from "@/db/queries/app-users";
import { isValidRole } from "@/lib/roles";
import { recordAudit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { canManageUsers } from "@/lib/permissions";

type Result = { ok: true } | { ok: false; error: string };

const MIGRATION_MISSING =
  "Falta correr db/app-users.sql en el SQL Editor de Supabase.";

// Barrera real: la UI esconde la sección, pero el permiso se chequea acá.
async function requireAdmin(): Promise<
  { ok: true; email: string } | { ok: false; error: string }
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "No hay sesión." };
  if (!(await canManageUsers(user.email))) {
    return { ok: false, error: "Solo un Admin puede gestionar usuarios." };
  }
  return { ok: true, email: user.email };
}

export async function setUserRole(input: {
  userId: string;
  role: string;
}): Promise<Result> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin;
  if (!isValidRole(input.role)) return { ok: false, error: "Rol inválido." };

  try {
    const [before] = await db
      .select()
      .from(appUsers)
      .where(eq(appUsers.id, input.userId))
      .limit(1);
    if (!before) return { ok: false, error: "Usuario no encontrado." };
    if (before.role === input.role) return { ok: true };

    // No dejar la app sin ningún admin: si éste es el último, se bloquea.
    if (before.role === "admin" && input.role !== "admin") {
      const admins = await db
        .select({ id: appUsers.id })
        .from(appUsers)
        .where(eq(appUsers.role, "admin"));
      if (admins.filter((a) => a.id !== before.id).length === 0) {
        return {
          ok: false,
          error: "Es el único Admin. Asigná otro antes de cambiarle el rol.",
        };
      }
    }

    await db
      .update(appUsers)
      .set({ role: input.role, updatedAt: new Date() })
      .where(eq(appUsers.id, input.userId));

    await recordAudit({
      entityType: "app_user",
      entityId: input.userId,
      action: "role_update",
      beforeJson: { email: before.email, role: before.role },
      afterJson: { email: before.email, role: input.role },
    });
  } catch (e) {
    if (isMissingTableError(e)) return { ok: false, error: MIGRATION_MISSING };
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Error desconocido",
    };
  }

  revalidatePath("/configuracion/usuarios");
  return { ok: true };
}

export async function setUserActive(input: {
  userId: string;
  active: boolean;
}): Promise<Result> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin;

  try {
    const [before] = await db
      .select()
      .from(appUsers)
      .where(eq(appUsers.id, input.userId))
      .limit(1);
    if (!before) return { ok: false, error: "Usuario no encontrado." };
    if (before.email === admin.email && !input.active) {
      return { ok: false, error: "No podés desactivarte a vos mismo." };
    }
    if (before.active === input.active) return { ok: true };

    await db
      .update(appUsers)
      .set({ active: input.active, updatedAt: new Date() })
      .where(eq(appUsers.id, input.userId));

    await recordAudit({
      entityType: "app_user",
      entityId: input.userId,
      action: input.active ? "activate" : "deactivate",
      beforeJson: { email: before.email, active: before.active },
      afterJson: { email: before.email, active: input.active },
    });
  } catch (e) {
    if (isMissingTableError(e)) return { ok: false, error: MIGRATION_MISSING };
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Error desconocido",
    };
  }

  revalidatePath("/configuracion/usuarios");
  return { ok: true };
}

// Pre-carga a alguien por email antes de su primer login. NO crea la cuenta:
// la identidad la sigue dando Supabase Auth. Cuando esa persona entre, su fila
// ya tiene el rol asignado.
export async function addUserByEmail(input: {
  email: string;
  name: string;
  role: string;
}): Promise<Result> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin;

  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Email inválido." };
  }
  if (!isValidRole(input.role)) return { ok: false, error: "Rol inválido." };

  try {
    const [existing] = await db
      .select({ id: appUsers.id })
      .from(appUsers)
      .where(eq(appUsers.email, email))
      .limit(1);
    if (existing) return { ok: false, error: "Ese email ya está cargado." };

    const [created] = await db
      .insert(appUsers)
      .values({
        email,
        name: input.name.trim() || null,
        role: input.role,
      })
      .returning({ id: appUsers.id });

    await recordAudit({
      entityType: "app_user",
      entityId: created.id,
      action: "create",
      afterJson: { email, role: input.role },
    });
  } catch (e) {
    if (isMissingTableError(e)) return { ok: false, error: MIGRATION_MISSING };
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Error desconocido",
    };
  }

  revalidatePath("/configuracion/usuarios");
  return { ok: true };
}
