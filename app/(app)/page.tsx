import { KpiCard } from "@/components/kpi-card";
import { StatusBadge } from "@/components/status-badge";
import {
  getDashboardKpis,
  getDashboardProjects,
} from "@/db/queries/dashboard";
import { formatPct, formatUsd, formatUsdCompact } from "@/lib/format";

export default async function DashboardPage() {
  const [kpis, projects] = await Promise.all([
    getDashboardKpis(),
    getDashboardProjects(),
  ]);

  return (
    <main className="px-8 py-10 max-w-[1380px] mx-auto w-full">
      {/* Header */}
      <header className="mb-8">
        <p className="text-xs font-semibold tracking-[0.16em] uppercase text-accent">
          Sangria · Project OS
        </p>
        <h1 className="text-3xl font-semibold tracking-tight mt-2">Dashboard</h1>
        <p className="text-sm text-muted mt-1">
          Resumen ejecutivo · datos del seed Q2 2026
        </p>
      </header>

      {/* KPIs */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Pipeline activo"
          value={formatUsdCompact(kpis.pipelineActiveUsd)}
          hint={`${formatUsd(kpis.pipelineActiveUsd)} en proyectos activos`}
        />
        <KpiCard
          label="Clientes activos"
          value={String(kpis.activeClients)}
          hint="con al menos un proyecto en curso"
        />
        <KpiCard
          label="Facturado YTD"
          value={
            kpis.invoicedYtdUsd > 0
              ? formatUsdCompact(kpis.invoicedYtdUsd)
              : "—"
          }
          hint={
            kpis.invoicedYtdUsd > 0
              ? formatUsd(kpis.invoicedYtdUsd)
              : "se actualiza al emitir billings"
          }
          variant={kpis.invoicedYtdUsd > 0 ? "default" : "empty"}
        />
        <KpiCard
          label="Avance promedio"
          value={formatPct(kpis.consumptionPct)}
          hint="gasto real / pipeline activo"
          variant="ink"
        />
      </section>

      {/* Chart placeholder — próximo commit */}
      <section className="mt-6 rounded-lg border border-line border-dashed bg-paper-2 px-5 py-10 text-center text-sm text-muted">
        Chart de facturación real vs proyectado · próximo commit
      </section>

      {/* Tabla de proyectos */}
      <section className="mt-6 rounded-lg border border-line bg-white overflow-hidden">
        <div className="px-5 py-3 border-b border-line flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Proyectos</h2>
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
            {projects.length} totales
          </span>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-paper">
            <tr className="text-[11px] uppercase tracking-[0.06em] text-muted">
              <th className="text-left font-medium px-5 py-2.5">Proyecto</th>
              <th className="text-left font-medium px-5 py-2.5">Cliente</th>
              <th className="text-left font-medium px-5 py-2.5">Estado</th>
              <th className="text-right font-medium px-5 py-2.5">Budget</th>
              <th className="text-right font-medium px-5 py-2.5">Gastado</th>
              <th className="text-left font-medium px-5 py-2.5 w-[180px]">
                Avance
              </th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <ProjectRow key={p.id} project={p} />
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function ProjectRow({
  project,
}: {
  project: Awaited<ReturnType<typeof getDashboardProjects>>[number];
}) {
  const overConsumed = project.consumptionPct > 100;
  const barWidth = Math.min(project.consumptionPct, 100);

  return (
    <tr className="border-t border-line-soft hover:bg-paper-2 transition-colors">
      <td className="px-5 py-3">
        <div className="font-medium text-ink">{project.name}</div>
        <div className="font-mono text-[11px] text-muted">{project.code}</div>
      </td>
      <td className="px-5 py-3 text-ink-2">{project.clientName}</td>
      <td className="px-5 py-3">
        <StatusBadge status={project.status} />
      </td>
      <td className="px-5 py-3 text-right font-mono text-ink-2">
        {formatUsd(project.totalBudgetUsd)}
      </td>
      <td className="px-5 py-3 text-right font-mono text-ink-2">
        {project.spentUsd > 0 ? formatUsd(project.spentUsd) : "—"}
      </td>
      <td className="px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="flex-1 h-1.5 rounded-full bg-paper-2 overflow-hidden">
            <div
              className={`h-full rounded-full ${
                overConsumed ? "bg-warn" : "bg-ink"
              }`}
              style={{ width: `${barWidth}%` }}
            />
          </div>
          <span
            className={`font-mono text-xs ${
              overConsumed ? "text-warn font-medium" : "text-ink-2"
            }`}
          >
            {formatPct(project.consumptionPct, 0)}
          </span>
        </div>
      </td>
    </tr>
  );
}
