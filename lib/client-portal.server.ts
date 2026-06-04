import { cookies } from "next/headers";
import { PORTAL_COOKIE_NAME } from "@/lib/client-portal";
import { getCurrentUser } from "@/lib/auth";

// Helpers server-only para la sesión del portal de cliente. El cookie guarda
// el slug del cliente que el visitante desbloqueó (un portal por browser, que
// es el caso real: un cliente mirando SU portal). httpOnly → no lo lee el JS
// del cliente, pero viaja en cada request (incluido el download del export).

const THIRTY_DAYS = 60 * 60 * 24 * 30;

export async function getPortalSessionSlug(): Promise<string | null> {
  const store = await cookies();
  return store.get(PORTAL_COOKIE_NAME)?.value ?? null;
}

export async function hasPortalAccess(slug: string): Promise<boolean> {
  const current = await getPortalSessionSlug();
  return current === slug;
}

export async function setPortalSession(slug: string): Promise<void> {
  const store = await cookies();
  store.set(PORTAL_COOKIE_NAME, slug, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: THIRTY_DAYS,
  });
}

export async function clearPortalSession(): Promise<void> {
  const store = await cookies();
  store.delete(PORTAL_COOKIE_NAME);
}

// ¿Puede el request actual bajar el export de un plan de este cliente?
// Sí si hay un usuario logueado de Sangria (uso interno), o si el visitante
// tiene una sesión de portal del MISMO cliente dueño del plan. Las rutas de
// export son públicas en el proxy, así que este chequeo es la barrera real.
export async function canAccessClientExport(
  clientSlug: string,
): Promise<boolean> {
  const user = await getCurrentUser();
  if (user) return true;
  return hasPortalAccess(clientSlug);
}
