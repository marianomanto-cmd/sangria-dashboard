import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { EmptyState } from "@/components/page-shell";
import { PlanStatusBadge } from "@/components/plan-status-badge";
import { StatusBadge } from "@/components/status-badge";
import { formatUsd, formatUsdCompact, formatPct } from "@/lib/format";
import type { DashboardV2 } from "@/db/queries/dashboard-v2";

// Server component: no hay estado ni interactividad, así que no manda nada al
// bundle del browser. El dashboard viejo montaba tres vistas de cliente con su
// toggle; esta versión muestra una sola pantalla y se lee de una.

function Kpi({
  label,
  value,
  hint,
  accent = false,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-5 ${
        accent
          ? "border-transparent bg-ink text-white"
          : "border-line bg-white dark:bg-paper-2"
      }`}
    >
      <p
        className={`text-[11px] uppercase tracking-[0.08em] font-medium ${
          accent ? "text-white/60" : "text-muted"
        }`}
      >
        {label}
      </p>
      <p className="text-3xl font-semibold mt-2 tabular-nums">{value}</p>
      {hint && (
        <p className={`text-xs mt-1 ${accent ? "text-white/60" : "text-muted"}`}>
          {hint}
        </p>
      )}
    </div>
  );
}

function MonthlyChart({ rows }: { rows: DashboardV2["monthly"] }) {
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => r.totalUsd), 1);
  // Últimos 18 meses: más que eso no entra legible y no es lo que se mira.
  const shown = rows.slice(-18);
  return (
    <div className="rounded-lg border border-line bg-white dark:bg-paper-2 p-5">
      <h2 className="text-sm font-semibold text-ink">Facturación real por mes</h2>
      <div className="mt-5 flex items-end gap-1.5 h-40">
        {shown.map((r) => (
          <div
            key={r.month}
            className="flex-1 flex flex-col items-center justify-end gap-1.5 group min-w-0"
          >
            <span className="text-[10px] text-muted tabular-nums opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
              {formatUsdCompact(r.totalUsd)}
            </span>
            <div
              className="w-full rounded-t bg-accent/80 group-hover:bg-accent transition-colors min-h-[2px]"
              style={{ height: `${Math.max((r.totalUsd / max) * 100, 1)}%` }}
              title={`${r.month}: ${formatUsd(r.totalUsd)}`}
            />
            <span className="text-[9px] text-muted tabular-nums rotate-45 origin-left whitespace-nowrap h-4">
              {r.month.slice(2)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DashboardV2View({
  data,
  failed,
}: {
  data: DashboardV2;
  failed: string | null;
}) {
  const { kpis, projects, monthly, plansInFlight } = data;

  if (failed) {
    return (
      <div className="rounded-lg border border-danger/30 bg-danger-soft/40 px-5 py-6 flex items-start gap-3">
        <AlertTriangle size={18} className="text-danger shrink-0 mt-0.5" />
        <div className="text-[13px] leading-relaxed text-ink-2">
          <p className="font-semibold text-ink">No se pudo leer la base</p>
          <p className="mt-1">
            La vista no muestra nada en vez de mostrar ceros: un dashboard en $0
            se lee como un dato real y no lo es. Recargá en unos segundos.
          </p>
          <p className="mt-2 font-mono text-[11px] text-muted">{failed}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi
          accent
          label="Pipeline activo"
          value={formatUsd(kpis.pipelineActiveUsd)}
          hint={`${kpis.activeClients} cliente${kpis.activeClients === 1 ? "" : "s"} con proyectos activos`}
        />
        <Kpi label="Facturado en el año" value={formatUsd(kpis.invoicedYtdUsd)} />
        <Kpi
          label="Consumo del pipeline"
          value={formatPct(kpis.consumptionPct)}
          hint="Gastado real sobre presupuesto activo"
        />
        <Kpi
          label="Planes en curso"
          value={String(plansInFlight.length)}
          hint="Aprobados, en QA o live"
        />
      </div>

      <MonthlyChart rows={monthly} />

      <div className="rounded-lg border border-line overflow-hidden">
        <div className="px-5 py-3.5 border-b border-line bg-paper-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">
            Proyectos por consumo
          </h2>
          <Link
            href="/proyectos"
            className="text-xs text-accent hover:underline"
            prefetch={false}
          >
            Ver todos →
          </Link>
        </div>
        {projects.length === 0 ? (
          <EmptyState title="No hay proyectos" hint="Todavía no se cargó ninguno." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-[0.08em] text-muted">
                <tr className="border-b border-line">
                  <th className="text-left font-medium px-5 py-2.5">Proyecto</th>
                  <th className="text-left font-medium px-5 py-2.5">Estado</th>
                  <th className="text-right font-medium px-5 py-2.5">Presupuesto</th>
                  <th className="text-right font-medium px-5 py-2.5">Gastado</th>
                  <th className="text-right font-medium px-5 py-2.5">Consumo</th>
                  <th className="text-right font-medium px-5 py-2.5">Planes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {projects.slice(0, 25).map((p) => (
                  <tr key={p.id} className="bg-white dark:bg-paper-2">
                    <td className="px-5 py-2.5">
                      <Link
                        href={`/proyectos/${p.code}`}
                        className="font-medium text-ink hover:text-accent"
                        prefetch={false}
                      >
                        {p.name}
                      </Link>
                      <div className="text-xs text-muted">{p.clientName}</div>
                    </td>
                    <td className="px-5 py-2.5">
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-ink-2">
                      {formatUsd(p.budgetUsd)}
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-ink-2">
                      {formatUsd(p.spentUsd)}
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums">
                      <span
                        className={
                          p.consumptionPct > 100 ? "text-danger font-medium" : "text-ink-2"
                        }
                      >
                        {formatPct(p.consumptionPct)}
                      </span>
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-muted">
                      {p.planCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-line overflow-hidden">
        <div className="px-5 py-3.5 border-b border-line bg-paper-2">
          <h2 className="text-sm font-semibold text-ink">Planes en curso</h2>
        </div>
        {plansInFlight.length === 0 ? (
          <EmptyState title="No hay planes en curso" hint="Ninguno aprobado, en QA o live." />
        ) : (
          <ul className="divide-y divide-line">
            {plansInFlight.slice(0, 15).map((p) => (
              <li
                key={p.id}
                className="px-5 py-3 flex items-center justify-between gap-4 bg-white dark:bg-paper-2"
              >
                <div className="min-w-0">
                  <p className="font-medium text-ink truncate">{p.name}</p>
                  <p className="text-xs text-muted truncate">
                    {p.clientName} · {p.projectName}
                  </p>
                </div>
                <PlanStatusBadge status={p.status} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
