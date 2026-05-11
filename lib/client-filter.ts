// Helpers PUROS del filtro global ?client=slug. NO importar nada
// server-only (db, server-only, etc.) acá — este módulo lo usan el sidebar
// y el topbar-client-picker que son client components. Para el resolver
// con acceso a la DB usar `lib/client-filter.server.ts`.

// Listado canónico de rutas que aceptan el filtro de cliente. Las rutas
// dinámicas (/proyectos/[code], /clientes/[slug], /proyectos/.../planes/...)
// no aceptan el filtro porque ya están scopeadas por su propio param; al
// cambiar de cliente desde el picker estando en una de esas, redirigimos a
// la lista correspondiente (ver `redirectTargetForClientChange`).
const CLIENT_FILTER_ROUTES = [
  "/",
  "/proyectos",
  "/planes",
  "/billing",
  "/auditoria",
  "/reportes",
  "/configuracion",
  "/configuracion/publishers",
  "/configuracion/markets",
  "/configuracion/metricas",
] as const;

export function routeAcceptsClientFilter(pathname: string): boolean {
  return CLIENT_FILTER_ROUTES.includes(pathname as (typeof CLIENT_FILTER_ROUTES)[number]);
}

// Cuando el usuario cambia de cliente desde el picker y la URL actual no
// acepta el filtro (ej. /proyectos/COPA.m2025X01), lo mandamos a la lista
// más cercana al contexto en el que estaba.
export function redirectTargetForClientChange(pathname: string): string {
  if (routeAcceptsClientFilter(pathname)) return pathname;
  if (pathname.startsWith("/proyectos/")) return "/proyectos";
  if (pathname.startsWith("/planes/")) return "/planes";
  if (pathname.startsWith("/billing/")) return "/billing";
  if (pathname.startsWith("/clientes/")) return "/proyectos";
  if (pathname.startsWith("/configuracion/")) return "/configuracion";
  return "/";
}

// Construye una URL preservando el client slug + cualquier otro param que
// pasemos explícitamente. Si `clientSlug` es null se elimina del query.
export function buildHrefWithClient(
  basePath: string,
  clientSlug: string | null,
  otherParams: Record<string, string | undefined | null> = {},
): string {
  const params = new URLSearchParams();
  if (clientSlug) params.set("client", clientSlug);
  for (const [k, v] of Object.entries(otherParams)) {
    if (v != null && v !== "") params.set(k, v);
  }
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

// Lee y valida el slug del query string. Retorna null si no hay slug o si
// no matchea ninguno de los slugs permitidos. El caller pasa la lista de
// slugs válidos (típicamente todos los clientes activos).
export function parseClientSlug(
  raw: string | string[] | undefined,
  allowedSlugs: readonly string[],
): string | null {
  const slug = Array.isArray(raw) ? raw[0] : raw;
  if (!slug) return null;
  return allowedSlugs.includes(slug) ? slug : null;
}
