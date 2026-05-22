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

// NOTE (tablero-alertas / debug): unstable_cache sacado a propósito para aislar
// si la capa de caché era la causante del cuelgue de la preview (durante el
// hang no había NINGUNA conexión de la app a Postgres → el cuelgue era antes de
// llamar a la DB, sospechoso #1: la caché). Con los datos actuales (tiny) las
// queries directas son instantáneas, así que la caché no aporta performance.
export default async function DashboardPage({ searchParams }: Props) {
  const sp = await searchParams;
  const client = await resolveClientFromSearchParams(sp);
  const clientId = client?.id ?? null;
  const lang = client?.language ?? DEFAULT_LANGUAGE;
  const [kpis, projects, monthly, pendings] = await Promise.all([
    getDashboardKpis({ clientId }),
    getDashboardProjects({ clientId }),
    getMonthlyTotals({ clientId }),
    getDashboardPendings(clientId),
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
