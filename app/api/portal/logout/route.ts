import { clearPortalSession } from "@/lib/client-portal.server";

// Logout del portal de cliente — borra el cookie de sesión del portal.
export async function POST() {
  await clearPortalSession();
  return Response.json({ ok: true });
}
