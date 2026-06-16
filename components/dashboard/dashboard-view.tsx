import { SectionBoundary } from "@/components/section-boundary";
import { DashboardCuentas } from "@/components/dashboard/view-cuentas";
import { DashboardOperaciones } from "@/components/dashboard/view-operaciones";
import { DashboardEjecutivo } from "@/components/dashboard/view-ejecutivo";
import type {
  DashboardKpis,
  DashboardProjects,
  MonthlyTotal,
} from "@/db/queries/dashboard";
import type { DashboardPendings } from "@/db/queries/pendings";
import type { Language } from "@/lib/i18n";

export type DashView = "cuentas" | "operaciones" | "ejecutivo";

export function normalizeDashView(raw: string | undefined): DashView {
  return raw === "operaciones" || raw === "ejecutivo" ? raw : "cuentas";
}

type Props = {
  view: DashView;
  kpis: DashboardKpis;
  projects: DashboardProjects;
  monthly: MonthlyTotal[];
  pendings: DashboardPendings;
  clientName: string | null;
  clientSlug: string | null;
  userName: string | null;
  lang: Language;
};

// Contenedor del dashboard rediseñado: el toggle del topbar setea ?view= y acá
// elegimos la vista. Cada vista va envuelta en SectionBoundary para que un fallo
// de render degrade esa vista sin tumbar la página (mismo patrón resiliente).
export function DashboardView({ view, ...rest }: Props) {
  return (
    <main className="px-5 sm:px-7 lg:px-8 py-7 max-w-[1320px] mx-auto w-full">
      <SectionBoundary name={`dashboard-${view}`}>
        {view === "operaciones" ? (
          <DashboardOperaciones {...rest} />
        ) : view === "ejecutivo" ? (
          <DashboardEjecutivo {...rest} />
        ) : (
          <DashboardCuentas {...rest} />
        )}
      </SectionBoundary>
    </main>
  );
}
