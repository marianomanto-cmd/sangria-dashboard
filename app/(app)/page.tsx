import { unstable_cache } from "next/cache";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { normalizeDashView } from "@/components/dashboard/types";
import {
  getDashboardKpis,
  getDashboardProjects,
  getMonthlyTotals,
  type DashboardKpis,
  type DashboardProjects,
  type MonthlyTotal,
} from "@/db/queries/dashboard";
import { getDashboardPendings, type DashboardPendings } from "@/db/queries/pendings";
import {
  resolveClientFromSearchParams,
  type ResolvedClientFilter,
} from "@/lib/client-filter.server";
import { getCurrentUser } from "@/lib/auth";
import { DEFAULT_LANGUAGE } from "@/lib/i18n";

type Props = {
  searchParams: Promise<{ client?: string; view?: string }>;
};

export const maxDuration = 30;

// ─── Cache de datos del dashboard ─────────────────────────────────────────────
// El dashboard es la página más pesada (dispara ~15-20 queries agregadas por
// carga). Sin cache, cada (re)carga / cambio de cliente arma una tormenta de
// conexiones concurrentes contra el pooler de Supabase, que bajo carga se
// satura/corrompe ("Postgres.js: Unknown Message", "Failed query", timeouts).
// Cacheamos por cliente (revalida cada 60s): tras la primera carga, las
// siguientes salen del Data Cache → 0 queries, instantáneo y sin presión sobre
// la DB. Si una query falla en un cache-miss, unstable_cache NO cachea el error
// → el `allSettled` de abajo degrada esa sección y el próximo intento reintenta.
const REVALIDATE = 60;
const cachedKpis = unstable_cache(
  (clientId: string | null) => getDashboardKpis({ clientId }),
  ["dash-kpis-v1"],
  { revalidate: REVALIDATE },
);
const cachedProjects = unstable_cache(
  (clientId: string | null) => getDashboardProjects({ clientId }),
  ["dash-projects-v1"],
  { revalidate: REVALIDATE },
);
const cachedMonthly = unstable_cache(
  (clientId: string | null) => getMonthlyTotals({ clientId }),
  ["dash-monthly-v1"],
  { revalidate: REVALIDATE },
);
const cachedPendings = unstable_cache(
  (clientId: string | null) => getDashboardPendings(clientId),
  ["dash-pendings-v1"],
  { revalidate: REVALIDATE },
);

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
