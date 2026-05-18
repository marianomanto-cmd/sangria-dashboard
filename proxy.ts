import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Next.js 16 renombró middleware.ts → proxy.ts. La lógica de auth vive en
// `lib/supabase/middleware.ts` (el archivo lo nombramos así por convención
// supabase, no por el feature de Next).
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // Matcher excluye assets estáticos / imágenes optimizadas / favicon /
  // public files con extensiones comunes. Todo lo demás pasa por el proxy.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
