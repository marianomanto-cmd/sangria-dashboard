import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { CLIENT_PORTAL_PASSWORD } from "@/lib/client-portal";
import { setPortalSession } from "@/lib/client-portal.server";

// Login del portal de cliente (público, read-only). Endpoint dedicado y
// autovalidante: NO es un Server Action (esos se gatean en el proxy). Gate
// intencionalmente simple: usuario = nombre o slug del cliente + password
// compartido. No es auth real — es para compartir un link de solo lectura.
export async function POST(req: Request) {
  let body: { slug?: string; username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Body inválido" }, { status: 400 });
  }

  const slug = (body.slug ?? "").trim().toLowerCase();
  const username = (body.username ?? "").trim().toLowerCase();
  const password = body.password ?? "";

  const fail = () =>
    Response.json(
      { ok: false, error: "Usuario o contraseña incorrectos." },
      { status: 401 },
    );

  if (!slug || !username || !password) return fail();
  if (password !== CLIENT_PORTAL_PASSWORD) return fail();

  const [client] = await db
    .select({ slug: clients.slug, name: clients.name })
    .from(clients)
    .where(and(eq(clients.slug, slug), ne(clients.status, "archived")))
    .limit(1);
  if (!client) return fail();

  const matches =
    username === client.slug.toLowerCase() ||
    username === client.name.toLowerCase();
  if (!matches) return fail();

  await setPortalSession(client.slug);
  return Response.json({ ok: true });
}
