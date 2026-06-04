// ════════════════════════════════════════════════════════════════════════════
// Portal de cliente (público, read-only) — constantes + helpers PUROS.
//
// Este módulo NO importa nada server-only (db, next/headers): lo usa también el
// proxy (`lib/supabase/middleware.ts`), que corre en el edge runtime. La
// lectura/escritura del cookie de sesión vive en `lib/client-portal.server.ts`.
//
// Modelo de acceso (a propósito de baja seguridad, para compartir el link):
//   • URL = el slug del cliente (`/copa-airlines`), el mismo que ya existe.
//   • Gate = usuario (nombre o slug del cliente) + password compartido.
//   • El password es el MISMO para todos y se muestra en el admin para que
//     cualquiera del equipo se lo pase al cliente.
// ════════════════════════════════════════════════════════════════════════════

export const CLIENT_PORTAL_PASSWORD = "sangriaagency";

// Cookie que marca qué portal (slug) desbloqueó el visitante. httpOnly, se
// setea en el server action de login.
export const PORTAL_COOKIE_NAME = "sangria_portal";

// Segmentos top-level RESERVADOS por la app interna. El portal vive en
// `/<slug>` (bare), así que el proxy trata como PÚBLICO cualquier path cuyo
// primer segmento NO esté en esta lista. **Si agregás una nueva sección a la
// app con su propia ruta top-level, sumala acá** o quedaría accesible sin login.
export const RESERVED_TOP_LEVEL_SLUGS = new Set<string>([
  "login",
  "auth",
  "api",
  "clientes",
  "proyectos",
  "planes",
  "billing",
  "billing-tracker",
  "campaign-tracker",
  "auditoria",
  "configuracion",
  "reportes",
  // técnicos / assets
  "_next",
  "favicon.ico",
  "icon",
  "icon.svg",
  "apple-icon",
  "sangria-logo.png",
  "robots.txt",
  "sitemap.xml",
]);

export function isReservedTopLevelSlug(segment: string): boolean {
  return RESERVED_TOP_LEVEL_SLUGS.has(segment);
}

// Primer segmento del path (sin el slash inicial). "" para "/".
function firstSegment(pathname: string): string {
  return pathname.split("/").filter(Boolean)[0] ?? "";
}

// ¿Es un path del portal de cliente? = top-level, no root, no reservado.
// (El page del portal igual valida que el slug exista en la DB; acá solo
// decidimos si el proxy lo deja pasar sin sesión de Supabase.)
export function isClientPortalPath(pathname: string): boolean {
  const seg = firstSegment(pathname);
  return seg.length > 0 && !isReservedTopLevelSlug(seg);
}

// El export de planes (PDF/Excel) tiene que poder bajarlo el cliente desde el
// portal (sin login de Supabase). El route handler igual valida sesión OR
// cookie de portal del dueño del plan (ver el route).
export function isPublicPlanExportPath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/plans/") &&
    (pathname.endsWith("/export.pdf") || pathname.endsWith("/export.xlsx"))
  );
}
