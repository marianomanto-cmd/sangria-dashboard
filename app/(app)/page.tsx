import { DashboardView } from "@/components/dashboard/dashboard-view";
import { normalizeDashView } from "@/components/dashboard/types";
import {
  type DashboardKpis,
  type DashboardProjects,
  type MonthlyTotal,
} from "@/db/queries/dashboard";
import { type DashboardPendings } from "@/db/queries/pendings";
import {
  cachedKpis,
  cachedMonthly,
  cachedPendings,
  cachedProjects,
} from "@/db/queries/cached";
import {
  resolveClientFromSearchParams,
  type ResolvedClientFilter,
} from "@/lib/client-filter.server";
import { getCurrentUser } from "@/lib/auth";
import { DEFAULT_LANGUAGE } from "@/lib/i18n";

type Props = {
  searchParams: Promise<{ client?: string; view?: string }>;
};

// Timeout de la función. La PRIMERA carga en frío (cache miss) dispara las ~15
// queries pesadas y, sobre la conexión fría a la DB, puede tardar; le damos
// 60s de aire para que complete y deje el Data Cache poblado. Las cargas
// siguientes salen del cache (instantáneas), así que este tope solo aplica al
// arranque en frío.
export const maxDuration = 60;

// Los envoltorios cacheados viven en `db/queries/cached.ts`: los comparte
// `/proyectos`, que usa la MISMA `getDashboardProjects` (12 round-trips). Ver
// ese módulo para el porqué y la política de invalidación.

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
  console.error(`DASHQ[${label}]:${msg.slice(0, 80)}`, r.reason);
  return fallback;
}

export default async function DashboardPage({ searchParams }: Props) {
  const sp = await searchParams;
  const view = normalizeDashView(sp.view);

  // Resolver el cliente del filtro NO debe tumbar la página: si la DB falla
  // transitoriamente, seguimos sin filtro (cliente = "todos") en vez de tirar
  // el error boundary de ruta ("Reintentar").
  let client: ResolvedClientFilter = null;
  try {
    client = await resolveClientFromSearchParams(sp);
  } catch (e) {
    console.error("DASHQ[client]:", e instanceof Error ? e.message : e);
  }
  const clientId = client?.id ?? null;
  const lang = client?.language ?? DEFAULT_LANGUAGE;

  // El user (saludo de la vista Ejecutivo) en paralelo; si falla, greeting genérico.
  const userP = getCurrentUser().catch(() => null);
  const [kpisR, projectsR, monthlyR, pendingsR] = await Promise.allSettled([
    cachedKpis(clientId),
    cachedProjects(clientId),
    cachedMonthly(clientId),
    cachedPendings(clientId),
  ]);
  const user = await userP;

  const kpis = unwrap(kpisR, EMPTY_KPIS, "kpis");
  const projects = unwrap(projectsR, EMPTY_PROJECTS, "projects");
  const monthly = unwrap<MonthlyTotal[]>(monthlyR, [], "monthly");
  const pendings = unwrap(pendingsR, EMPTY_PENDINGS, "pendings");

  return (
    <DashboardView
      initialView={view}
      kpis={kpis}
      projects={projects}
      monthly={monthly}
      pendings={pendings}
      clientName={client?.name ?? null}
      clientSlug={client?.slug ?? null}
      userName={user?.name ?? null}
      lang={lang}
    />
  );
}
