import { DashboardView } from "@/components/dashboard-view";
import {
  getDashboardKpis,
  getDashboardProjects,
  getMonthlyTotals,
} from "@/db/queries/dashboard";

export default async function DashboardPage() {
  const [kpis, projects, monthly] = await Promise.all([
    getDashboardKpis(),
    getDashboardProjects(),
    getMonthlyTotals(),
  ]);

  return <DashboardView kpis={kpis} projects={projects} monthly={monthly} />;
}
