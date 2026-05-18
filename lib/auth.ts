import { createClient } from "@/lib/supabase/server";

// ════════════════════════════════════════════════════════════════════════════
// Helpers de auth server-side. Todas las pages y server actions pueden usar
// estos para leer al user logueado. Tirar de getUser() (no getSession())
// porque getSession se basa solo en el cookie sin validar contra el server.
// ════════════════════════════════════════════════════════════════════════════

export type AppUser = {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
};

export async function getCurrentUser(): Promise<AppUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) return null;

  // Google OAuth pone el nombre en user_metadata.full_name (o name); el
  // avatar en avatar_url o picture. Robusto con fallbacks.
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const name =
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.name === "string" && meta.name) ||
    null;
  const avatarUrl =
    (typeof meta.avatar_url === "string" && meta.avatar_url) ||
    (typeof meta.picture === "string" && meta.picture) ||
    null;

  return { id: user.id, email: user.email, name, avatarUrl };
}

// Convierte un email en un "name" amigable cuando user_metadata no trae nada.
// "mariano.manto@sangria.agency" → "Mariano Manto".
export function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join(" ");
}
