"use client";

import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

// Error boundary a nivel SECCIÓN (no de ruta como app/(app)/error.tsx). Aísla
// un widget del dashboard: si su render tira una excepción, mostramos un
// placeholder compacto en su lugar y el RESTO de la página sigue funcionando,
// en vez de tumbar toda la vista. Además deja rastro del error con el nombre
// de la sección y la propiedad que rompió (cuando es un "reading 'x'"), para
// poder ubicar la causa raíz desde la consola del browser / observabilidad.

type Props = {
  name: string;
  children: ReactNode;
  fallback?: ReactNode;
};

type State = { hasError: boolean };

export class SectionBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    // El dato más útil (la propiedad que se intentó leer) va primero por si la
    // observabilidad trunca el mensaje.
    const field = msg.match(/reading '([^']+)'/)?.[1];
    console.error(`DASHERR[${this.props.name}]:${field ?? msg.slice(0, 80)}`, error);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="rounded-lg border border-line border-dashed bg-paper-2 px-4 py-6 text-center text-[13px] text-muted flex items-center justify-center gap-2">
            <AlertTriangle size={15} className="text-warn shrink-0" />
            No se pudo cargar esta sección.
          </div>
        )
      );
    }
    return this.props.children;
  }
}
