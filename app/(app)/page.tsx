import { DashboardView } from "@/components/dashboard-view";
import {
  getDashboardKpis,
  getDashboardProjects,
  getMonthlyTotals,
} from "@/db/queries/dashboard";
import { resolveClientFromSearchParams } from "@/lib/client-filter.server";

type Props = {
  searchParams: Promise<{ client?: string }>;
};

export default async function DashboardPage({ searchParams }: Props) {
  const sp = await searchParams;
  const client = await resolveClientFromSearchParams(sp);
  const clientId = client?.id ?? null;
  const [kpis, projects, monthly] = await Promise.all([
    getDashboardKpis({ clientId }),
    getDashboardProjects({ clientId }),
    getMonthlyTotals({ clientId }),
  ]);

  return (
    <DashboardView
      kpis={kpis}
      projects={projects}
      monthly={monthly}
      clientName={client?.name ?? null}
    />
  );
}
