import { DashboardView } from "@/components/dashboard-view";
import {
  getDashboardKpis,
  getDashboardProjects,
  getMonthlyTotals,
  type DashboardKpis,
  type DashboardProjects,
  type MonthlyTotal,
} from "@/db/queries/dashboard";
import { getDashboardPendings, type DashboardPendings } from "@/db/queries/pendings";
import { resolveClientFromSearchParams } from "@/lib/client-filter.server";
import { DEFAULT_LANGUAGE } from "@/lib/i18n";

type Props = {
  searchParams: Promise<{ client?: string }>;
};

// Headroom para los picos de carga: el dashboard dispara ~12 queries agregadas
// en paralelo y bajo contención puede cruzar el timeout default de la función.
export const maxDuration = 30;

// Fallbacks vacíos por sección. Si una query falla, degradamos esa parte (la UI
// muestra ceros / vacío) en vez de tumbar toda la vista con el error boundary.
const EMPTY_KPIS: DashboardKpis = {
  pipelineActiveUsd: 0,
  activeClients: 0,
  invoicedYtdUsd: 0,
  consumptionPct: 0,
};
const EMPTY_PROJECTS: DashboardProjects = { rows: [], monthLabels: [] };
const EMPTY_PENDINGS: DashboardPendings = {
  billings: [],
  tracking: [],
  reportsUpcoming: [],
  reportsOverdue: [],
  invoices: [],
};

function unwrap<T>(r: PromiseSettledResult<T>, fallback: T, label: string): T {
  if (r.status === "fulfilled") return r.value;
  const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
  // El nombre de la query va primero por si la observabilidad trunca el mensaje.
  console.error(`DASHQ[${label}]:${msg.slice(0, 80)}`, r.reason);
  return fallback;
}

export default async function DashboardPage({ searchParams }: Props) {
  const sp = await searchParams;
  const client = await resolveClientFromSearchParams(sp);
  const clientId = client?.id ?? null;
  const lang = client?.language ?? DEFAULT_LANGUAGE;
  const [kpisR, projectsR, monthlyR, pendingsR] = await Promise.allSettled([
    getDashboardKpis({ clientId }),
    getDashboardProjects({ clientId }),
    getMonthlyTotals({ clientId }),
    getDashboardPendings(clientId),
  ]);

  const kpis = unwrap(kpisR, EMPTY_KPIS, "kpis");
  const projects = unwrap(projectsR, EMPTY_PROJECTS, "projects");
  const monthly = unwrap<MonthlyTotal[]>(monthlyR, [], "monthly");
  const pendings = unwrap(pendingsR, EMPTY_PENDINGS, "pendings");

  return (
    <DashboardView
      kpis={kpis}
      projects={projects}
      monthly={monthly}
      pendings={pendings}
      clientName={client?.name ?? null}
      lang={lang}
    />
  );
}
