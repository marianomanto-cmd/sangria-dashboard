import { cache } from "react";
import { getCurrentUser, type AppUser } from "@/lib/auth";
import { getRoleByEmail } from "@/db/queries/app-users";
import { hasAuditSession } from "@/lib/audit-session.server";
import { READ_ONLY_ROLES, type AppUserRole } from "@/lib/roles";

// ════════════════════════════════════════════════════════════════════════════
// Solo lectura: la barrera de servidor.
//
// Dos poblaciones caen acá:
//   • La sesión de AUDITORÍA (`lib/audit-session.ts`), que además ya viene
//     cerrada de raíz en el proxy — sólo la deja pasar en GET, y los Server
//     Actions son POST. Este chequeo es la segunda barrera, no la única.
//   • Los usuarios internos cuyo rol esté marcado como solo-lectura en
//     `READ_ONLY_ROLES` (lib/roles.ts). Hoy esa lista va VACÍA a propósito:
//     el default de la columna es `viewer` y todo el que entra queda así sin
//     que nadie lo haya decidido, así que activarla sin antes asignar roles
//     de verdad dejaría al equipo sin poder trabajar. El gancho queda puesto
//     para el día que los roles se usen en serio.
//
// Cómo se usa, al principio de toda action que escriba:
//
//     const denied = await assertCanWrite();
//     if (denied) return denied;
//
// El valor de retorno ya tiene la forma `{ ok: false, error }` que usan las
// actions, así que el call-site no cambia y el error le llega al usuario por
// el toast de siempre.
// ════════════════════════════════════════════════════════════════════════════

export const AUDIT_DENIAL =
  "Vista de auditoría: es solo lectura. Este cambio no se aplicó.";

export const VIEWER_DENIAL =
  "Tu rol es Viewer (solo lectura). Pedile a un Admin que te cambie el rol para poder hacer cambios.";

export type WriteDenial = { ok: false; error: string };

export type ReadOnlyMode = {
  readOnly: boolean;
  // "audit" = sesión de auditoría externa; "viewer" = usuario interno con rol
  // de solo lectura; null = puede escribir.
  reason: "audit" | "viewer" | null;
};

// El rol se pide una sola vez por request aunque lo consulten el layout y
// varias actions: `cache()` de React memoiza por request. Sin esto, cada
// render de página sumaba una query más a la base — y el fan-out de queries
// por página es justamente lo que este proyecto cuida (ver README, "Caché de
// lecturas e invalidación").
const roleForRequest = cache(
  async (email: string): Promise<AppUserRole | null> => getRoleByEmail(email),
);

// Modo del request actual. Lo usan el layout (para pintar la UI en modo
// auditoría) y `assertCanWrite` (para frenar la escritura).
//
// `knownUser` existe para que el layout, que YA leyó el usuario, no fuerce una
// segunda llamada a Supabase Auth (getUser() es un round-trip de red, no una
// lectura de cookie).
export async function getReadOnlyMode(
  knownUser?: AppUser | null,
): Promise<ReadOnlyMode> {
  if (await hasAuditSession()) return { readOnly: true, reason: "audit" };

  // Atajo: si no hay ningún rol marcado como solo-lectura —que es el estado de
  // hoy, ver el comentario largo en lib/roles.ts— no hace falta ni resolver el
  // usuario ni consultar su rol. Se ahorra una consulta por action y por
  // render de página.
  if (READ_ONLY_ROLES.length === 0) return { readOnly: false, reason: null };

  let user: AppUser | null;
  try {
    user = knownUser !== undefined ? knownUser : await getCurrentUser();
  } catch {
    // Igual que arriba: fuera de un request (scripts) no hay sesión que leer.
    return { readOnly: false, reason: null };
  }
  if (!user) return { readOnly: false, reason: null };

  let role: AppUserRole | null = null;
  try {
    role = await roleForRequest(user.email);
  } catch {
    // La tabla puede no existir todavía (falta correr db/app-users.sql) o la
    // DB puede no responder. Igual que en `lib/permissions.ts`, una lectura
    // fallida no puede dejar a todo el equipo sin poder trabajar: se asume que
    // puede escribir. La sesión de auditoría, que es el caso que importa acá,
    // ya se resolvió arriba sin tocar la base.
    return { readOnly: false, reason: null };
  }

  if (role && (READ_ONLY_ROLES as readonly string[]).includes(role)) {
    return { readOnly: true, reason: "viewer" };
  }
  return { readOnly: false, reason: null };
}

// Devuelve null si el request puede escribir, o el `{ ok: false, error }` a
// retornar tal cual si no.
export async function assertCanWrite(): Promise<WriteDenial | null> {
  const mode = await getReadOnlyMode();
  if (!mode.readOnly) return null;
  return {
    ok: false,
    error: mode.reason === "audit" ? AUDIT_DENIAL : VIEWER_DENIAL,
  };
}

// Variante para los route handlers, que responden HTTP y no `Result`.
export async function readOnlyResponse(): Promise<Response | null> {
  const mode = await getReadOnlyMode();
  if (!mode.readOnly) return null;
  return Response.json(
    { ok: false, error: mode.reason === "audit" ? AUDIT_DENIAL : VIEWER_DENIAL },
    { status: 403 },
  );
}
