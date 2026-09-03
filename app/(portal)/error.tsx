"use client";

import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";

// ════════════════════════════════════════════════════════════════════════════
// Error boundary del PORTAL DEL CLIENTE. Esto lo ve el cliente, no el equipo.
//
// POR QUÉ EXISTE (03/sep/2026): `app/(portal)/` no tenía NINGÚN boundary, y
// `app/(app)/error.tsx` no lo cubre — son segmentos distintos. Está en la doc
// de Next 16 que viene en el repo:
//
//   > `error.js` wraps `loading.js`, `not-found.js`, `page.js`, and nested
//   > `layout.js` files in a React error boundary. It does **not** wrap the
//   > `layout.js` or `template.js` above it in the same segment.
//   (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md:96)
//
// Sin esto, cualquier falla transitoria le mostraba al cliente la pantalla
// cruda de Next: sin marca, sin mensaje y sin forma de reintentar. Pasó en
// prod el 03/sep a las 14:39 en /felix, mientras el equipo tenía 49 renders
// del editor de ese mismo plan compitiendo por el pooler.
//
// DIFERENCIAS CON EL BOUNDARY INTERNO (`app/(app)/error.tsx`):
//
// 1. DOS reintentos, no uno. El portal es de SOLO LECTURA, así que reintentar
//    no puede duplicar nada, y la causa dominante —contención de conexiones
//    por actividad interna— se cura en segundos. Que el cliente no vea nunca
//    el error vale más que ahorrarse un reintento.
// 2. Bilingüe. Acá no tenemos el `language` del cliente (el boundary no puede
//    leer la DB), así que va en los dos idiomas.
// 3. Sin jerga interna. No dice "avisá al equipo" ni muestra un stack. El
//    `ref` queda, chico y al pie, porque es lo que nos deja rastrearlo si el
//    cliente lo menciona.
//
// ⚠️ EL CONTADOR VA EN SCOPE DE MÓDULO, NO EN UN useRef/useState. Cuando
// `reset()` re-renderiza y vuelve a fallar, React DESMONTA este fallback y
// monta una instancia NUEVA: un `useRef` se reinicializa ahí y el componente
// reintenta para siempre, cada 2s. Ese bucle pasó en prod el 02/sep/2026 con
// el boundary interno. El módulo sobrevive a los remounts.
// ════════════════════════════════════════════════════════════════════════════

const RETRY_DELAYS_MS = [1500, 3500];
const MAX_AUTO_RETRIES = RETRY_DELAYS_MS.length;

// Keyado por digest del error: si al cliente le aparece OTRA falla distinta más
// adelante, ésa tiene derecho a sus propios reintentos. Un reload de la página
// crea un módulo nuevo y por lo tanto un contador nuevo, que es lo que
// queremos: el cliente que recarga a mano no arrastra el conteo anterior.
const attemptsByKey = new Map<string, number>();

// Devuelve el nº de intento (1-based) si queda alguno, o null si se agotaron.
function takeAttempt(key: string): number | null {
  const used = attemptsByKey.get(key) ?? 0;
  if (used >= MAX_AUTO_RETRIES) return null;
  attemptsByKey.set(key, used + 1);
  return used + 1;
}

export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Se decide en el PRIMER render, antes de pintar: así el spinner sólo
  // aparece si de verdad vamos a reintentar.
  const [attempt] = useState(() =>
    takeAttempt(error.digest ?? error.message),
  );

  useEffect(() => {
    // Queda en los logs de Vercel con un prefijo buscable.
    console.error("PORTAL[boundary]:", error);
  }, [error]);

  useEffect(() => {
    if (attempt === null) return;
    const t = setTimeout(reset, RETRY_DELAYS_MS[attempt - 1] ?? 3500);
    return () => clearTimeout(t);
  }, [attempt, reset]);

  return (
    <div className="min-h-[100dvh] bg-paper flex flex-col">
      <header className="border-b border-line bg-white dark:bg-paper-2">
        <div className="max-w-[1400px] mx-auto px-6 py-4">
          <p className="text-[11px] font-semibold tracking-[0.18em] uppercase text-accent">
            Sangria
          </p>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-20">
        {attempt !== null ? (
          <div className="text-center flex flex-col items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-paper-2 border border-line flex items-center justify-center text-muted">
              <RotateCcw size={22} strokeWidth={2} className="animate-spin" />
            </div>
            <div>
              <p className="text-sm text-ink-2">Cargando el reporte…</p>
              <p className="text-sm text-muted mt-0.5">Loading your report…</p>
            </div>
          </div>
        ) : (
          <div className="max-w-md text-center flex flex-col items-center gap-5">
            <div>
              <h1 className="text-lg font-semibold text-ink">
                No pudimos cargar el reporte
              </h1>
              <p className="text-sm text-muted mt-1 leading-relaxed">
                Fue algo temporal de nuestro lado. Probá de nuevo en unos
                segundos — tus datos están intactos.
              </p>
              <div className="mt-4 pt-4 border-t border-line-soft">
                <h2 className="text-sm font-semibold text-ink-2">
                  We couldn&apos;t load your report
                </h2>
                <p className="text-sm text-muted mt-1 leading-relaxed">
                  This was a temporary issue on our side. Please try again in a
                  few seconds — your data is safe.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => reset()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium bg-accent text-white hover:opacity-90 transition-opacity"
            >
              <RotateCcw size={14} strokeWidth={2} />
              Reintentar · Retry
            </button>

            {error.digest && (
              <p className="text-[10px] font-mono text-muted/70">
                ref: {error.digest}
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
