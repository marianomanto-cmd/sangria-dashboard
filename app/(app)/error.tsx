"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/button";

// Error boundary del grupo (app). Captura errores de render/datos de las
// páginas y muestra una pantalla recuperable (retry vía reset()) en vez de la
// pantalla cruda de Next. La chrome (sidebar/topbar) persiste.
//
// REINTENTO AUTOMÁTICO: la causa más común acá es un timeout de query por
// saturación transitoria del pooler (ver README → "Pool de conexiones"), que se
// cura sola en un par de segundos. Antes de mostrarle un error a nadie probamos
// UNA vez más.
//
// ⚠️ EL CONTADOR VA EN SCOPE DE MÓDULO, NO EN UN useRef/useState.
//
// Cuando `reset()` re-renderiza los children y vuelven a fallar, React DESMONTA
// este fallback y monta una instancia NUEVA. Un `useRef` se reinicializa ahí, o
// sea que el "ya reintenté" se pierde y el componente reintenta otra vez… y
// otra, cada 2s, para siempre. Cada reintento del dashboard son ~24 queries
// pesadas: el bucle no es un detalle cosmético, es una tormenta de carga contra
// la misma DB que ya estaba ahogada. Pasó en prod el 02/sep/2026.
//
// El módulo persiste mientras viva la página, así que el contador sobrevive a
// los remounts. Se resetea al navegar a otra ruta (abajo) para que un error
// nuevo en otra vista tenga derecho a su propio reintento.
const RETRY_DELAY_MS = 2000;
const MAX_AUTO_RETRIES = 1;

let attemptsByKey = new Map<string, number>();
let attemptsPath: string | null = null;

function takeAttempt(path: string, key: string): boolean {
  if (attemptsPath !== path) {
    attemptsPath = path;
    attemptsByKey = new Map();
  }
  const used = attemptsByKey.get(key) ?? 0;
  if (used >= MAX_AUTO_RETRIES) return false;
  attemptsByKey.set(key, used + 1);
  return true;
}

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const pathname = usePathname();
  // Se decide en el primer render, ANTES de pintar: así el spinner sólo aparece
  // si de verdad vamos a reintentar.
  const [retrying] = useState(() =>
    takeAttempt(pathname, error.digest ?? error.message),
  );

  useEffect(() => {
    // Deja rastro en consola/observabilidad del server logs de Vercel.
    console.error("App error boundary:", error);
  }, [error]);

  useEffect(() => {
    if (!retrying) return;
    const t = setTimeout(reset, RETRY_DELAY_MS);
    return () => clearTimeout(t);
  }, [retrying, reset]);

  if (retrying) {
    return (
      <main className="px-8 py-20 max-w-md mx-auto w-full text-center flex flex-col items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-paper-2 border border-line flex items-center justify-center text-muted">
          <RotateCcw size={22} strokeWidth={2} className="animate-spin" />
        </div>
        <p className="text-sm text-muted">Reintentando…</p>
      </main>
    );
  }

  return (
    <main className="px-8 py-20 max-w-md mx-auto w-full text-center flex flex-col items-center gap-4">
      <div className="w-12 h-12 rounded-full bg-danger-soft border border-danger/20 flex items-center justify-center text-danger">
        <AlertTriangle size={22} strokeWidth={2} />
      </div>
      <div>
        <h1 className="text-lg font-semibold text-ink">Algo salió mal</h1>
        <p className="text-sm text-muted mt-1 leading-relaxed">
          Reintentamos una vez y siguió fallando. Podés probar de nuevo; si
          persiste, recargá la página o avisá al equipo con el ref de abajo.
        </p>
        {error.digest && (
          <p className="text-[11px] font-mono text-muted mt-2">
            ref: {error.digest}
          </p>
        )}
      </div>
      <Button onClick={() => reset()}>
        <RotateCcw size={14} strokeWidth={2} />
        Reintentar
      </Button>
    </main>
  );
}
