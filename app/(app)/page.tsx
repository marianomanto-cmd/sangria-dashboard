import { unstable_cache } from "next/cache";
import { DashboardView } from "@/components/dashboard-view";
import {
  getDashboardKpis,
  getDashboardProjects,
  getMonthlyTotals,
} from "@/db/queries/dashboard";
import { getDashboardPendings } from "@/db/queries/pendings";
import { resolveClientFromSearchParams } from "@/lib/client-filter.server";
import { DEFAULT_LANGUAGE } from "@/lib/i18n";

type Props = {
  searchParams: Promise<{ client?: string }>;
};

// El dashboard es la página más pesada: dispara ~15-20 queries por carga
// (KPIs + proyectos/planes + monthly + pendientes). Para no pegarle a la DB en
// cada request ni en cada refresh —lo que saturaba el pooler de Supabase y
// tiraba la página— cacheamos cada bloque por cliente con revalidación de 60s.
// Los números pueden quedar hasta 60s desactualizados (aceptable para un
// dashboard interno). Para invalidar al instante tras una edición se puede
// llamar revalidateTag("dashboard") desde la Server Action correspondiente.
const REVALIDATE_SECONDS = 60;

const loadKpis = unstable_cache(
  (clientId: string | null) => getDashboardKpis({ clientId }),
  ["dashboard-kpis"],
  { revalidate: REVALIDATE_SECONDS, tags: ["dashboard"] },
);
const loadProjects = unstable_cache(
  (clientId: string | null) => getDashboardProjects({ clientId }),
  ["dashboard-projects"],
  { revalidate: REVALIDATE_SECONDS, tags: ["dashboard"] },
);
const loadMonthly = unstable_cache(
  (clientId: string | null) => getMonthlyTotals({ clientId }),
  ["dashboard-monthly"],
  { revalidate: REVALIDATE_SECONDS, tags: ["dashboard"] },
);
const loadPendings = unstable_cache(
  (clientId: string | null) => getDashboardPendings(clientId),
  ["dashboard-pendings"],
  { revalidate: REVALIDATE_SECONDS, tags: ["dashboard"] },
);

export default async function DashboardPage({ searchParams }: Props) {
  const sp = await searchParams;
  const client = await resolveClientFromSearchParams(sp);
  const clientId = client?.id ?? null;
  const lang = client?.language ?? DEFAULT_LANGUAGE;
  const [kpis, projects, monthly, pendings] = await Promise.all([
    loadKpis(clientId),
    loadProjects(clientId),
    loadMonthly(clientId),
    loadPendings(clientId),
  ]);

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
