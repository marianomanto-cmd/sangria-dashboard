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
