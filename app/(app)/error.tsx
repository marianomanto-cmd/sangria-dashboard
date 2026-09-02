"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/button";

// Error boundary del grupo (app). Captura errores de render/datos de las
// páginas y muestra una pantalla recuperable (retry vía reset()) en vez de la
// pantalla cruda de Next. La chrome (sidebar/topbar) persiste.
//
// REINTENTO AUTOMÁTICO: la causa abrumadoramente más común acá es un timeout
// de query por saturación transitoria del pooler (ver README → "Pool de
// conexiones"). Ese tipo de falla se cura sola en un par de segundos, así que
// antes de mostrarle un error a nadie probamos UNA vez más. Si el segundo
// intento también falla, ahí sí es algo real y se muestra la pantalla con el
// ref para reportarlo.
//
// Sólo un reintento, y con delay: reintentar en loop contra una DB saturada es
// exactamente lo que la satura más.
const RETRY_DELAY_MS = 2000;

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [retrying, setRetrying] = useState(true);
  // Por digest: si el segundo intento falla con OTRO error, es un problema
  // distinto y merece su propio reintento.
  const triedRef = useRef<string | null>(null);

  useEffect(() => {
    // Deja rastro en consola/observabilidad del server logs de Vercel.
    console.error("App error boundary:", error);
  }, [error]);

  useEffect(() => {
    const key = error.digest ?? error.message;
    if (triedRef.current === key) {
      setRetrying(false);
      return;
    }
    triedRef.current = key;
    setRetrying(true);
    const t = setTimeout(() => {
      setRetrying(false);
      reset();
    }, RETRY_DELAY_MS);
    return () => clearTimeout(t);
  }, [error, reset]);

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
