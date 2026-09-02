import { revalidateTag, updateTag } from "next/cache";

// ════════════════════════════════════════════════════════════════════════════
// Invalidar la caché de un área después de mutarla. Ver lib/cache-tags.ts.
//
// Preferimos `updateTag`: expira la entrada de una, así quien acaba de editar
// ve su cambio (read-your-own-writes). Pero `updateTag` SÓLO se puede llamar
// desde una server action — desde un route handler tira. Y hay al menos una
// action que se reusa desde un handler (`transitionBillingStatus`, que usa
// app/api/portal/billing/mark-paid). Por eso el fallback a `revalidateTag`,
// que ahí sí funciona (stale-while-revalidate: refresca en segundo plano).
//
// Nunca propaga: fallar al invalidar la caché no puede tumbar una mutación que
// ya se guardó. Lo peor que pasa es que la vista quede hasta el TTL desfasada.
// ════════════════════════════════════════════════════════════════════════════

export function invalidate(...tags: string[]): void {
  for (const tag of tags) {
    try {
      updateTag(tag);
    } catch {
      try {
        revalidateTag(tag, "max");
      } catch {
        // Fuera de todo contexto de request: no hay caché que invalidar.
      }
    }
  }
}
