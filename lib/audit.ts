import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";

// Wrapper único para insertar en audit_log que enriquece la row con el
// user logueado. Las server actions usan esto en lugar de
// `db.insert(auditLog).values({...})` directo para que el user_id /
// user_email queden grabados sin tener que repetir el lookup en cada
// action.
//
// IMPORTANTE: nunca tira. Si el insert falla (ej: schema desync porque
// alguien se olvidó del `db:push`, DB caída, columna nueva sin migrar)
// logueamos el error pero no rompemos la acción del usuario — la
// auditoría es importante pero no crítica para el flow; perder un
// registro es menos malo que romper un guardado que ya se cometió.
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

  try {
    await db.insert(auditLog).values({
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      beforeJson: (entry.beforeJson ?? null) as never,
      afterJson: (entry.afterJson ?? null) as never,
      userId,
      userEmail,
    });
  } catch (err) {
    // Loggeamos para que aparezca en los runtime logs del host (Vercel).
    console.error("[audit] insert failed — el cambio se aplicó igual:", {
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      userEmail,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

