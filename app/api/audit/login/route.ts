import {
  AUDIT_EMAIL,
  AUDIT_PASSWORD,
  isAuditLoginEnabled,
} from "@/lib/audit-session";
import { setAuditSession } from "@/lib/audit-session.server";

// Login de la sesión de auditoría (externa, solo lectura sobre TODA la app
// interna). Endpoint dedicado y autovalidante: NO es un Server Action —
// aquéllos se gatean en el proxy, y encima una sesión de auditoría no puede
// mandar POST a ningún otro lado. Mismo patrón que /api/portal/login.
export async function POST(req: Request) {
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Body inválido" }, { status: 400 });
  }

  if (!isAuditLoginEnabled()) {
    return Response.json(
      {
        ok: false,
        error:
          "El acceso de auditoría no está configurado en este entorno. Falta AUDIT_SESSION_SECRET (o DATABASE_URL).",
      },
      { status: 503 },
    );
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";

  // Mismo mensaje para usuario inexistente y password errado: no confirmamos
  // qué mitad falló.
  const fail = () =>
    Response.json(
      { ok: false, error: "Usuario o contraseña incorrectos." },
      { status: 401 },
    );

  if (email !== AUDIT_EMAIL.toLowerCase()) return fail();
  if (password !== AUDIT_PASSWORD) return fail();

  const ok = await setAuditSession();
  if (!ok) {
    return Response.json(
      { ok: false, error: "No se pudo abrir la sesión de auditoría." },
      { status: 503 },
    );
  }
  return Response.json({ ok: true });
}
