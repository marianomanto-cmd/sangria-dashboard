import { getRoleByEmail } from "@/db/queries/app-users";
import { APPROVER_ROLES, type AppUserRole } from "@/lib/roles";

// ════════════════════════════════════════════════════════════════════════════
// Quién puede APROBAR planes (ready_to_send → approved). Aprobar congela un
// snapshot inmutable, así que la acción está restringida.
//
// Fuente de verdad: el rol en `app_users` (Configuración → Usuarios y roles).
// La allowlist de abajo quedó como RED DE SEGURIDAD y se usa cuando el rol no
// se puede resolver: la tabla todavía no existe (falta correr db/app-users.sql),
// el usuario no está cargado, o la DB no responde. Sin ella, un problema de
// lectura dejaría a todo el mundo sin poder aprobar.
//
// El chequeo REAL (barrera de seguridad) vive en la server action
// `transitionPlanStatus` (app/actions/plans.ts). La UI solo esconde el botón.
// ════════════════════════════════════════════════════════════════════════════

export const PLAN_APPROVER_EMAILS = [
  "mariano.mantovani@sangria.agency",
  "herman.grabosky@sangria.agency",
] as const;

function isFallbackApprover(email: string | null | undefined): boolean {
  if (!email) return false;
  return (PLAN_APPROVER_EMAILS as readonly string[]).includes(
    email.trim().toLowerCase(),
  );
}

export async function canApprovePlans(
  email: string | null | undefined,
): Promise<boolean> {
  if (!email) return false;
  let role: AppUserRole | null = null;
  try {
    role = await getRoleByEmail(email);
  } catch {
    // Lectura fallida: caemos a la allowlist en vez de bloquear a todos.
    return isFallbackApprover(email);
  }
  if (role) return APPROVER_ROLES.includes(role);
  return isFallbackApprover(email);
}

// Sólo los admin entran a Configuración → Usuarios y roles y cambian roles.
export async function canManageUsers(
  email: string | null | undefined,
): Promise<boolean> {
  if (!email) return false;
  let role: AppUserRole | null = null;
  try {
    role = await getRoleByEmail(email);
  } catch {
    return isFallbackApprover(email);
  }
  if (role) return role === "admin";
  // Antes de la migración, los aprobadores hardcodeados son los admins.
  return isFallbackApprover(email);
}
