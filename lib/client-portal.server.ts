import { cookies } from "next/headers";
import { PORTAL_COOKIE_NAME } from "@/lib/client-portal";
import { getCurrentUser } from "@/lib/auth";
import { hasAuditSession } from "@/lib/audit-session.server";

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
  // La sesión de auditoría ve la app completa, y en este proyecto los exports
  // son un espejo descargable de la pantalla: si puede ver el plan, puede
  // bajarlo. Es GET y no muta nada.
  if (await hasAuditSession()) return true;
  return hasPortalAccess(clientSlug);
}

// ¿Puede el request actual ESCRIBIR en nombre de este cliente desde el portal?
// Misma barrera que el export (sesión interna O cookie de portal del mismo
// cliente), pero con nombre propio porque acá se muta la DB y el que la use
// tiene que chequear ADEMÁS que la entidad tocada sea del cliente.
//
// El portal es público con password compartido: todo lo que pase por acá tiene
// que ser una mutación acotada y reversible desde la app interna. Hoy la única
// es marcar una factura facturada → pagada.
export async function canWriteAsClientPortal(
  clientSlug: string,
): Promise<boolean> {
  // OJO: NO es `canAccessClientExport`. Ese habilita también a la sesión de
  // auditoría, que puede leer todo pero no escribir nada. Acá se escribe, así
  // que la auditoría queda afuera por construcción.
  const user = await getCurrentUser();
  if (user) return true;
  return hasPortalAccess(clientSlug);
}
