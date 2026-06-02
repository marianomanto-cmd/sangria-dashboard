"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/button";

// Error boundary del grupo (app). Captura errores de render/datos de las
// páginas y muestra una pantalla recuperable (retry vía reset()) en vez de la
// pantalla cruda de Next. La chrome (sidebar/topbar) persiste.
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Deja rastro en consola/observabilidad del server logs de Vercel.
    console.error("App error boundary:", error);
  }, [error]);

  return (
    <main className="px-8 py-20 max-w-md mx-auto w-full text-center flex flex-col items-center gap-4">
      <div className="w-12 h-12 rounded-full bg-danger-soft border border-danger/20 flex items-center justify-center text-danger">
        <AlertTriangle size={22} strokeWidth={2} />
      </div>
      <div>
        <h1 className="text-lg font-semibold text-ink">Algo salió mal</h1>
        <p className="text-sm text-muted mt-1 leading-relaxed">
          Ocurrió un error al cargar esta vista. Podés reintentar; si persiste,
          recargá la página o avisá al equipo.
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
