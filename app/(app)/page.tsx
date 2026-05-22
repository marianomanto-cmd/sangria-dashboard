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
  // DEBUG (tablero-alertas): markers para Runtime Logs de Vercel.
  console.log("[dashboard] lanzando queries", { clientId });
  const [kpis, projects, monthly, pendings] = await Promise.all([
    getDashboardKpis({ clientId }).then((r) => {
      console.log("[dashboard] kpis OK");
      return r;
    }),
    getDashboardProjects({ clientId }).then((r) => {
      console.log("[dashboard] projects OK", r.rows.length);
      return r;
    }),
    getMonthlyTotals({ clientId }).then((r) => {
      console.log("[dashboard] monthly OK", r.length);
      return r;
    }),
    getDashboardPendings(clientId).then((r) => {
      console.log("[dashboard] pendings OK");
      return r;
    }),
  ]);
  console.log("[dashboard] todas OK, renderizando");

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
