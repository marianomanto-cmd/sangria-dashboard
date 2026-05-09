import Link from "next/link";
import { Plus } from "lucide-react";
import { Sparkline } from "@/components/sparkline";
import { StatusBadge } from "@/components/status-badge";
import { PageShell } from "@/components/page-shell";
import { getDashboardProjects } from "@/db/queries/dashboard";
import { formatPct, formatUsd } from "@/lib/format";

export default async function ProyectosPage() {
  const data = await getDashboardProjects();

  return (
    <PageShell
      eyebrow="Proyectos"
      title="Todos los proyectos"
      subtitle={`${data.rows.length} proyecto${data.rows.length === 1 ? "" : "s"} en el sistema`}
      actions={
        <Link
          href="/proyectos/nuevo"
          className="inline-flex items-center gap-1.5 rounded-md bg-ink text-white px-3 py-1.5 text-sm font-medium hover:bg-ink-2 transition-colors"
        >
          <Plus size={14} strokeWidth={2.5} />
          Nuevo proyecto
        </Link>
      }
    >
      <section className="rounded-lg border border-line bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-paper">
            <tr className="text-[11px] uppercase tracking-[0.06em] text-muted">
              <th className="text-left font-medium px-5 py-2.5">Proyecto</th>
              <th className="text-left font-medium px-5 py-2.5">Cliente</th>
              <th className="text-left font-medium px-5 py-2.5">Estado</th>
              <th className="text-right font-medium px-5 py-2.5">Budget</th>
              <th className="text-right font-medium px-5 py-2.5">Gastado</th>
              <th className="text-left font-medium px-5 py-2.5 w-[140px]">
                Spark
              </th>
              <th className="text-left font-medium px-5 py-2.5 w-[180px]">
                Avance
              </th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((p) => {
              const overConsumed = p.consumptionPct > 100;
              const barWidth = Math.min(p.consumptionPct, 100);
              return (
                <tr
                  key={p.id}
                  className="border-t border-line-soft hover:bg-paper-2 transition-colors"
                >
                  <td className="px-5 py-3">
                    <Link
                      href={`/proyectos/${p.code}`}
                      className="font-medium text-ink hover:underline"
                    >
                      {p.name}
                    </Link>
                    <div className="font-mono text-[11px] text-muted">
                      {p.code}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-ink-2">{p.clientName}</td>
                  <td className="px-5 py-3">
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-ink-2">
                    {formatUsd(p.totalBudgetUsd)}
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-ink-2">
                    {p.spentUsd > 0 ? formatUsd(p.spentUsd) : "—"}
                  </td>
                  <td className="px-5 py-3">
                    <Sparkline values={p.monthlySpend} />
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
                        {formatPct(p.consumptionPct, 0)}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </PageShell>
  );
}
