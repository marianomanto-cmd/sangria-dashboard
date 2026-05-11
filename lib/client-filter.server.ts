// Server-only: importa `db` y por convención el sufijo `.server.ts` indica
// que sólo páginas/server-actions deben importarlo. NO importar desde
// componentes client ("use client") — rompería el bundle del navegador.

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";

// Resolver server-side del filtro global de cliente. Lee `?client=slug` de
// los searchParams de una página y devuelve {id, slug, name} si el slug
// existe; null si no hay slug o si es inválido. Las páginas con filtro
// global llaman esto para obtener el clientId que pasan a las queries.

export type ResolvedClientFilter = {
  id: string;
  slug: string;
  name: string;
} | null;

export async function resolveClientFromSearchParams(searchParams: {
  client?: string | string[];
}): Promise<ResolvedClientFilter> {
  const raw = searchParams.client;
  const slug = Array.isArray(raw) ? raw[0] : raw;
  if (!slug) return null;
  const [row] = await db
    .select({ id: clients.id, slug: clients.slug, name: clients.name })
    .from(clients)
    .where(eq(clients.slug, slug))
    .limit(1);
  return row ?? null;
}
