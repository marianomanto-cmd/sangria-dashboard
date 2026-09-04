import { cookies } from "next/headers";
import {
  AUDIT_COOKIE_NAME,
  AUDIT_SESSION_DAYS,
  mintAuditToken,
  verifyAuditToken,
} from "@/lib/audit-session";

// Helpers server-only de la sesión de auditoría. La parte pura (credenciales,
// firma, métodos permitidos) vive en `lib/audit-session.ts` porque la comparte
// el proxy, que corre en el edge.

const MAX_AGE = AUDIT_SESSION_DAYS * 24 * 60 * 60;

// ¿El request actual trae una sesión de auditoría VÁLIDA? Verifica la firma y
// el vencimiento, no la mera presencia del cookie.
export async function hasAuditSession(): Promise<boolean> {
  try {
    const store = await cookies();
    const token = store.get(AUDIT_COOKIE_NAME)?.value ?? null;
    return verifyAuditToken(token, Date.now());
  } catch {
    // `cookies()` tira si se la llama fuera de un contexto de request — por
    // ejemplo desde un script de seed o backfill que importe una action.
    // Ahí no hay sesión de auditoría posible, así que false es la respuesta
    // correcta y además no rompe el script. Mismo criterio que `recordAudit`
    // con getCurrentUser().
    return false;
  }
}

export async function setAuditSession(): Promise<boolean> {
  const token = await mintAuditToken(Date.now());
  // Sin secreto no se emite sesión (ver `auditSecret`): falla cerrado.
  if (!token) return false;
  const store = await cookies();
  store.set(AUDIT_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
  return true;
}

export async function clearAuditSession(): Promise<void> {
  const store = await cookies();
  store.delete(AUDIT_COOKIE_NAME);
}
