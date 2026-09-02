// Server-only: importa `db` y por convención el sufijo `.server.ts` indica
// que sólo páginas/server-actions deben importarlo. NO importar desde
// componentes client ("use client") — rompería el bundle del navegador.

import { eq } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { CATALOG_TAG } from "@/lib/cache-tags";
import type { Language } from "@/lib/i18n";
import { DEFAULT_LANGUAGE } from "@/lib/i18n";

// Resolver server-side del filtro global de cliente. Lee `?client=slug` de
// los searchParams de una página y devuelve {id, slug, name, language} si
// el slug existe; null si no hay slug o si es inválido. Las páginas con
// filtro global llaman esto para obtener el clientId que pasan a las queries
// y el `language` para localizar fechas y exports.

export type ResolvedClientFilter = {
  id: string;
  slug: string;
  name: string;
  language: Language;
} | null;

// Cacheado: lo llaman 14 páginas y es lo PRIMERO que corre en cada una, o sea
// que era un round-trip a la DB por carga de casi cualquier vista — y si fallaba,
// se caía la página entera antes de intentar nada. Los clientes cambian muy
// poco; las actions de clientes invalidan CATALOG_TAG.
const clientBySlug = unstable_cache(
  async (slug: string): Promise<ResolvedClientFilter> => {
    const [row] = await db
      .select({
        id: clients.id,
        slug: clients.slug,
        name: clients.name,
        language: clients.language,
      })
      .from(clients)
      .where(eq(clients.slug, slug))
      .limit(1);
    return row ?? null;
  },
  ["client-by-slug-v1"],
  { revalidate: 600, tags: [CATALOG_TAG] },
);

export async function resolveClientFromSearchParams(searchParams: {
  client?: string | string[];
}): Promise<ResolvedClientFilter> {
  const raw = searchParams.client;
  const slug = Array.isArray(raw) ? raw[0] : raw;
  if (!slug) return null;
  return clientBySlug(slug);
}

// Conveniencia para pages que sólo quieren saber qué idioma usar: cuando no
// hay cliente seleccionado, devuelve 'en' (default global). Cuando hay
// cliente, su `language`.
export async function resolveLanguageFromSearchParams(searchParams: {
  client?: string | string[];
}): Promise<Language> {
  const c = await resolveClientFromSearchParams(searchParams);
  return c?.language ?? DEFAULT_LANGUAGE;
}
