import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { appUsers } from "@/db/schema";
import type { AppUserRole, AppUserRow } from "@/lib/roles";

// Los tipos y el catálogo de roles viven en lib/roles.ts (sin nada server-only)
// para que los pueda importar el componente cliente. Se re-exportan acá por
// comodidad de los call sites del servidor.
export {
  APPROVER_ROLES,
  ROLE_META,
  ROLE_VALUES,
  isValidRole,
  type AppUserRole,
  type AppUserRow,
} from "@/lib/roles";

export function isMissingTableError(e: unknown): boolean {
  // 42P01 = undefined_table. Pasa si todavía no se corrió db/app-users.sql.
  const code = (e as { cause?: { code?: string }; code?: string })?.code
    ?? (e as { cause?: { code?: string } })?.cause?.code;
  if (code === "42P01") return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /relation .*app_users.* does not exist/i.test(msg);
}

// `null` = la tabla todavía no existe (falta correr la migración). La página
// distingue ese caso de "no hay usuarios" para poder explicarlo en pantalla.
export async function listAppUsers(): Promise<AppUserRow[] | null> {
  try {
    const rows = await db
      .select({
        id: appUsers.id,
        email: appUsers.email,
        name: appUsers.name,
        role: appUsers.role,
        active: appUsers.active,
        lastSeenAt: sql<string | null>`to_char(${appUsers.lastSeenAt}, 'YYYY-MM-DD"T"HH24:MI:SSOF')`,
        createdAt: sql<string>`to_char(${appUsers.createdAt}, 'YYYY-MM-DD"T"HH24:MI:SSOF')`,
      })
      .from(appUsers)
      .orderBy(asc(appUsers.email));
    return rows as AppUserRow[];
  } catch (e) {
    if (isMissingTableError(e)) return null;
    throw e;
  }
}

// Rol del usuario logueado. `null` si no está en la tabla o si la tabla no
// existe todavía — quien llama decide el fallback (ver lib/permissions.ts).
export async function getRoleByEmail(
  email: string | null | undefined,
): Promise<AppUserRole | null> {
  if (!email) return null;
  try {
    const [row] = await db
      .select({ role: appUsers.role, active: appUsers.active })
      .from(appUsers)
      .where(eq(appUsers.email, email.trim().toLowerCase()))
      .limit(1);
    if (!row || !row.active) return null;
    return row.role as AppUserRole;
  } catch (e) {
    if (isMissingTableError(e)) return null;
    throw e;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Auto-registro de quien entra.
//
// Se llama desde getCurrentUser(), o sea potencialmente en CADA render — por
// eso va THROTTLEADO en scope de módulo (sobrevive entre invocaciones de la
// misma instancia caliente de Lambda) y fire-and-forget: como mucho un upsert
// chiquito por email por hora y por instancia, y nunca bloquea ni rompe el
// render. Sin esto la lista de usuarios estaría vacía hasta cargarlos a mano.
// ────────────────────────────────────────────────────────────────────────────

const SYNC_WINDOW_MS = 60 * 60 * 1000;
const lastSync = new Map<string, number>();

export function touchUser(input: {
  email: string;
  name: string | null;
  authUserId: string | null;
}): void {
  const email = input.email.trim().toLowerCase();
  const now = Date.now();
  const prev = lastSync.get(email);
  if (prev && now - prev < SYNC_WINDOW_MS) return;
  lastSync.set(email, now);

  void db
    .insert(appUsers)
    .values({
      email,
      name: input.name,
      authUserId: input.authUserId,
      lastSeenAt: new Date(),
    })
    .onConflictDoUpdate({
      target: appUsers.email,
      set: {
        // El rol y `active` NO se tocan: los maneja un admin desde la UI.
        name: sql`coalesce(excluded.name, ${appUsers.name})`,
        authUserId: sql`coalesce(excluded.auth_user_id, ${appUsers.authUserId})`,
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      },
    })
    .catch(() => {
      // Falta la migración, o la DB está saturada. Registrar a quien entró es
      // lo menos importante que pasa en este request: nunca rompe la vista.
      lastSync.delete(email);
    });
}
