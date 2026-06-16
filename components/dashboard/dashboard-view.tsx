"use client";

import { useState } from "react";
import { SectionBoundary } from "@/components/section-boundary";
import { DashboardCuentas } from "@/components/dashboard/view-cuentas";
import { DashboardOperaciones } from "@/components/dashboard/view-operaciones";
import { DashboardEjecutivo } from "@/components/dashboard/view-ejecutivo";
import { DashViewContext } from "@/components/dashboard/view-context";
import type { DashView } from "@/components/dashboard/types";
import type {
  DashboardKpis,
  DashboardProjects,
  MonthlyTotal,
} from "@/db/queries/dashboard";
import type { DashboardPendings } from "@/db/queries/pendings";
import type { Language } from "@/lib/i18n";

const VIEWS: ReadonlyArray<readonly [DashView, string]> = [
  ["cuentas", "Cuentas"],
  ["operaciones", "Operaciones"],
  ["ejecutivo", "Ejecutivo"],
];

type Props = {
  initialView: DashView;
  kpis: DashboardKpis;
  projects: DashboardProjects;
  monthly: MonthlyTotal[];
  pendings: DashboardPendings;
  clientName: string | null;
  clientSlug: string | null;
  userName: string | null;
  lang: Language;
};

// Contenedor del dashboard rediseñado. El toggle de vistas vive ACÁ (estado de
// cliente) → conmutar es INSTANTÁNEO: las 3 vistas reciben la misma data ya
// cargada, no se re-fetchea nada. Refleja la vista en la URL con
// history.replaceState (deep-link/refresh) SIN disparar navegación de Next.
// Cada vista va en su SectionBoundary (degradación por sección).
export function DashboardView({ initialView, ...rest }: Props) {
  const [view, setView] = useState<DashView>(initialView);

  const select = (v: DashView) => {
    setView(v);
    try {
      const url = new URL(window.location.href);
      if (v === "cuentas") url.searchParams.delete("view");
      else url.searchParams.set("view", v);
      window.history.replaceState(null, "", url.toString());
    } catch {
      /* no-op si no hay window */
    }
  };

  return (
    <main className="px-5 sm:px-7 lg:px-8 py-7 max-w-[1320px] mx-auto w-full">
      <div className="mb-6">
        <div className="inline-flex items-center gap-0.5 rounded-[10px] border border-line bg-paper-2 p-[3px]">
          {VIEWS.map(([id, label]) => {
            const on = id === view;
            return (
              <button
                key={id}
                type="button"
                onClick={() => select(id)}
                aria-pressed={on}
                className={`px-3.5 py-1.5 rounded-lg text-[13px] transition-colors ${
                  on
                    ? "bg-surface text-ink shadow-sm font-medium"
                    : "text-muted hover:text-ink"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <DashViewContext.Provider value={select}>
        <SectionBoundary name={`dashboard-${view}`}>
          {view === "operaciones" ? (
            <DashboardOperaciones {...rest} />
          ) : view === "ejecutivo" ? (
            <DashboardEjecutivo {...rest} />
          ) : (
            <DashboardCuentas {...rest} />
          )}
        </SectionBoundary>
      </DashViewContext.Provider>
    </main>
  );
}
