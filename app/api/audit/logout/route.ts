import { clearAuditSession } from "@/lib/audit-session.server";

// Cierre de la sesión de auditoría. Lo dispara el mismo <form method="post">
// del menú de usuario que usa /auth/signout para las cuentas de Google, así
// que responde con un redirect (303) y no con JSON.
//
// Exento del GET-only del proxy (ver la rama `isAudit` en
// lib/supabase/middleware.ts): sin esa excepción, cerrar sesión daría 403.
export async function POST(req: Request) {
  await clearAuditSession();
  return Response.redirect(new URL("/login", req.url), 303);
}
