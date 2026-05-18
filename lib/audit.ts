import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";

// Wrapper único para insertar en audit_log que enriquece la row con el
// user logueado. Las server actions usan esto en lugar de
// `db.insert(auditLog).values({...})` directo para que el user_id /
// user_email queden grabados sin tener que repetir el lookup en cada
// action.
//
// Si no hay user logueado (ej: script de seed, llamada interna sin
// sesión), inserta con null y se renderiza como "Sistema" en /auditoria.
export async function recordAudit(entry: {
  entityType: string;
  entityId: string;
  action: "create" | "update" | "delete" | (string & {});
  beforeJson?: unknown;
  afterJson?: unknown;
}): Promise<void> {
  let userId: string | null = null;
  let userEmail: string | null = null;
  try {
    const user = await getCurrentUser();
    if (user) {
      userId = user.id;
      userEmail = user.email;
    }
  } catch {
    // getCurrentUser puede fallar si lo llaman fuera de un contexto de
    // request (ej: script de seed). En ese caso queda como "Sistema".
  }

  await db.insert(auditLog).values({
    entityType: entry.entityType,
    entityId: entry.entityId,
    action: entry.action,
    beforeJson: (entry.beforeJson ?? null) as never,
    afterJson: (entry.afterJson ?? null) as never,
    userId,
    userEmail,
  });
}
