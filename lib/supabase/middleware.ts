import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  isClientPortalPath,
  isPublicPlanExportPath,
} from "@/lib/client-portal";

// Helper para el proxy (ex-middleware) de Next.js: crea un cliente Supabase
// que usa los cookies del request para leer/refrescar la sesión, y devuelve
// el NextResponse listo para emitir. Si no hay sesión válida y la ruta no es
// pública, redirige a /login con `?next=<originalPath>`.
//
// Sangria.agency-only: si el email del user no termina en @sangria.agency,
// lo cerramos automáticamente y mandamos a /login con `?error=domain`. Es
// defensa en profundidad — el bloqueo principal está en el callback de OAuth.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // IMPORTANTE: tiene que ser getUser() (no getSession()) porque getSession
  // confía en lo que está en el cookie sin validar con el server. getUser()
  // pega contra Supabase y valida la JWT — es lo que recomienda la doc para
  // server-side checks.
  const { data: { user } } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  // IMPORTANTE: solo abrimos GET para el portal. Los Server Actions se
  // despachan por POST a la ruta actual SIN importar el path, y la app confía
  // en este proxy como gate de auth de sus mutaciones. Si dejáramos POST
  // público en `/<slug>`, cualquiera podría invocar acciones internas sin
  // sesión. Por eso: el portal (GET) y sus endpoints públicos dedicados
  // (`/api/portal/*`, login/logout que se autovalidan) son lo único abierto;
  // los Server Actions siguen gateados.
  const isGet = request.method === "GET";
  const isPublic =
    path === "/login" ||
    path.startsWith("/auth/") ||
    path === "/favicon.ico" ||
    // Endpoints públicos del portal (login/logout): se autovalidan adentro.
    path.startsWith("/api/portal/") ||
    // Descarga de export de planes (GET): el route handler valida sesión OR
    // cookie de portal del cliente dueño del plan.
    (isGet && isPublicPlanExportPath(path)) ||
    // Export de benchmarks (GET): el route se autovalida con canAccessClientExport.
    (isGet && path.startsWith("/api/benchmarks/export")) ||
    // Páginas del portal de cliente (`/<slug>`), solo lectura → solo GET.
    (isGet && isClientPortalPath(path));

  // Bloqueo de dominio en server-side. El callback ya lo hace, pero acá lo
  // re-chequeamos por si la sesión vino de otra cuenta.
  if (user && user.email && !user.email.endsWith("@sangria.agency")) {
    await supabase.auth.signOut();
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "?error=domain";
    return NextResponse.redirect(url);
  }

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Preservamos el destino original para volver después del login.
    if (path !== "/") url.search = `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }

  // Si está logueado y entra a /login, mandalo al home.
  if (user && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
