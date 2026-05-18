import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Callback de OAuth: Supabase nos manda acá con un ?code después del flow
// con Google. Intercambiamos el code por una sesión, validamos que el email
// sea @sangria.agency, y redirigimos al destino original (?next=) o al
// home. Si algo falla, vuelve a /login con un ?error que la página muestra.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=oauth`);
  }

  const supabase = await createClient();
  const { error: exchangeError } =
    await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    return NextResponse.redirect(`${origin}/login?error=exchange`);
  }

  // Validar dominio: solo @sangria.agency. Si no, signOut inmediato y
  // mandar a /login con el error correspondiente para que la UI lo
  // explique.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email || !user.email.endsWith("@sangria.agency")) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=domain`);
  }

  // Sanitización del next: solo permitir paths relativos para evitar
  // open-redirect.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return NextResponse.redirect(`${origin}${safeNext}`);
}
