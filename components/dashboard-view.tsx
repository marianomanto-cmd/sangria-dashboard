"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { LayoutGrid, Table2 } from "lucide-react";
import { FacturacionChart } from "@/components/facturacion-chart";
import { KpiCard } from "@/components/kpi-card";
import { Sparkline } from "@/components/sparkline";
import { StatusBadge } from "@/components/status-badge";
import type {
  DashboardKpis,
  DashboardProjectRow,
  DashboardProjects,
  MonthlyTotal,
} from "@/db/queries/dashboard";
import { formatPct, formatUsd, formatUsdCompact } from "@/lib/format";

type DashboardLayout = "A" | "C";
const STORAGE_KEY = "sangria-dashboard-layout";
const CHANGE_EVENT = "sangria:layout-change";

function readLayout(): DashboardLayout {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "A" || stored === "C" ? stored : "A";
}

function writeLayout(v: DashboardLayout) {
  localStorage.setItem(STORAGE_KEY, v);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribeLayout(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(CHANGE_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(CHANGE_EVENT, cb);
  };
}

type Props = {
  kpis: DashboardKpis;
  projects: DashboardProjects;
  monthly: MonthlyTotal[];
};

export function DashboardView({ kpis, projects, monthly }: Props) {
  const layout = useSyncExternalStore<DashboardLayout>(
    subscribeLayout,
    readLayout,
    () => "A",
  );
  const setLayout = writeLayout;

  return (
    <main className="px-8 py-10 max-w-[1380px] mx-auto w-full">
      <header className="mb-8 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] uppercase text-accent">
            Sangria · Project OS
          </p>
          <h1 className="text-3xl font-semibold tracking-tight mt-2">
            Dashboard
          </h1>
          <p className="text-sm text-muted mt-1">
            Resumen ejecutivo · datos del seed Q2 2026
          </p>
        </div>
        <LayoutToggle value={layout} onChange={setLayout} />
      </header>

      {layout === "A" ? (
        <LayoutA kpis={kpis} projects={projects} monthly={monthly} />
      ) : (
        <LayoutC kpis={kpis} projects={projects} />
      )}
    </main>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Toggle — switch entre A y C
// ────────────────────────────────────────────────────────────────────────────

function LayoutToggle({
  value,
  onChange,
}: {
  value: DashboardLayout;
  onChange: (v: DashboardLayout) => void;
}) {
  return (
    <div className="inline-flex border border-line rounded-md p-0.5 bg-paper-2">
      <button
        type="button"
        onClick={() => onChange("A")}
        data-active={value === "A"}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-muted data-[active=true]:bg-white data-[active=true]:text-ink data-[active=true]:shadow-sm transition-colors"
      >
        <LayoutGrid size={13} strokeWidth={2} />
        KPIs Hero
      </button>
      <button
        type="button"
        onClick={() => onChange("C")}
        data-active={value === "C"}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-muted data-[active=true]:bg-white data-[active=true]:text-ink data-[active=true]:shadow-sm transition-colors"
      >
        <Table2 size={13} strokeWidth={2} />
        Tabla protagonista
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Layout A — KPIs Hero (presentación / management)
// ────────────────────────────────────────────────────────────────────────────

function LayoutA({ kpis, projects, monthly }: Props) {
  return (
    <>
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

      <section className="mt-6">
        <FacturacionChart data={monthly} />
      </section>

      <ProjectsTable rows={projects.rows} dense={false} groupByClient={false} />
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Layout C — Tabla protagonista (operativo diario)
// ────────────────────────────────────────────────────────────────────────────

function LayoutC({
  kpis,
  projects,
}: {
  kpis: DashboardKpis;
  projects: DashboardProjects;
}) {
  return (
    <>
      <section className="rounded-lg border border-line bg-white px-5 py-3 grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-3">
        <CompactKpi
          label="Pipeline activo"
          value={formatUsdCompact(kpis.pipelineActiveUsd)}
        />
        <CompactKpi
          label="Clientes activos"
          value={String(kpis.activeClients)}
        />
        <CompactKpi
          label="Facturado YTD"
          value={
            kpis.invoicedYtdUsd > 0
              ? formatUsdCompact(kpis.invoicedYtdUsd)
              : "—"
          }
          dim={kpis.invoicedYtdUsd === 0}
        />
        <CompactKpi
          label="Avance promedio"
          value={formatPct(kpis.consumptionPct)}
        />
      </section>

      <ProjectsTable rows={projects.rows} dense groupByClient />
    </>
  );
}

function CompactKpi({
  label,
  value,
  dim = false,
}: {
  label: string;
  value: string;
  dim?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted truncate">
        {label}
      </span>
      <span
        className={`font-mono text-lg font-semibold tabular-nums ${
          dim ? "text-stone-300" : "text-ink"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Projects table — modos default y dense, opcionalmente agrupada por cliente
// ────────────────────────────────────────────────────────────────────────────

function ProjectsTable({
  rows,
  dense,
  groupByClient,
}: {
  rows: DashboardProjectRow[];
  dense: boolean;
  groupByClient: boolean;
}) {
  const groups: { clientName: string; items: DashboardProjectRow[] }[] = [];
  if (groupByClient) {
    const map = new Map<string, DashboardProjectRow[]>();
    for (const r of rows) {
      const list = map.get(r.clientName) ?? [];
      list.push(r);
      map.set(r.clientName, list);
    }
    for (const [clientName, items] of map) groups.push({ clientName, items });
  }

  const cellPad = dense ? "px-5 py-2" : "px-5 py-3";
  const headerPad = dense ? "px-5 py-2" : "px-5 py-2.5";

  return (
    <section className="mt-6 rounded-lg border border-line bg-white overflow-hidden">
      <div className={`${headerPad} border-b border-line flex items-baseline justify-between`}>
        <h2 className="text-sm font-semibold">Proyectos</h2>
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
          {rows.length} totales
        </span>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-paper">
          <tr className="text-[11px] uppercase tracking-[0.06em] text-muted">
            <th className={`text-left font-medium ${headerPad}`}>Proyecto</th>
            {!groupByClient && (
              <th className={`text-left font-medium ${headerPad}`}>Cliente</th>
            )}
            <th className={`text-left font-medium ${headerPad}`}>Estado</th>
            <th className={`text-right font-medium ${headerPad}`}>Budget</th>
            <th className={`text-right font-medium ${headerPad}`}>Gastado</th>
            <th className={`text-left font-medium ${headerPad} w-[140px]`}>
              Spark
            </th>
            <th className={`text-left font-medium ${headerPad} w-[180px]`}>
              Avance
            </th>
          </tr>
        </thead>
        <tbody>
          {groupByClient
            ? groups.map((g) => (
                <ClientGroup
                  key={g.clientName}
                  clientName={g.clientName}
                  items={g.items}
                  cellPad={cellPad}
                />
              ))
            : rows.map((p) => (
                <ProjectRow
                  key={p.id}
                  project={p}
                  showClient
                  cellPad={cellPad}
                />
              ))}
        </tbody>
      </table>
    </section>
  );
}

function ClientGroup({
  clientName,
  items,
  cellPad,
}: {
  clientName: string;
  items: DashboardProjectRow[];
  cellPad: string;
}) {
  return (
    <>
      <tr className="bg-paper-2">
        <td colSpan={6} className={`${cellPad} text-[11px] font-semibold uppercase tracking-[0.08em] text-muted`}>
          {clientName}
          <span className="ml-2 font-normal normal-case tracking-normal">
            · {items.length} proyecto{items.length === 1 ? "" : "s"}
          </span>
        </td>
      </tr>
      {items.map((p) => (
        <ProjectRow key={p.id} project={p} showClient={false} cellPad={cellPad} />
      ))}
    </>
  );
}

function ProjectRow({
  project,
  showClient,
  cellPad,
}: {
  project: DashboardProjectRow;
  showClient: boolean;
  cellPad: string;
}) {
  const overConsumed = project.consumptionPct > 100;
  const barWidth = Math.min(project.consumptionPct, 100);

  return (
    <tr className="border-t border-line-soft hover:bg-paper-2 transition-colors">
      <td className={cellPad}>
        <Link
          href={`/proyectos/${project.code}`}
          className="font-medium text-ink hover:underline"
        >
          {project.name}
        </Link>
        <div className="font-mono text-[11px] text-muted">{project.code}</div>
      </td>
      {showClient && (
        <td className={`${cellPad} text-ink-2`}>{project.clientName}</td>
      )}
      <td className={cellPad}>
        <StatusBadge status={project.status} />
      </td>
      <td className={`${cellPad} text-right font-mono text-ink-2`}>
        {formatUsd(project.totalBudgetUsd)}
      </td>
      <td className={`${cellPad} text-right font-mono text-ink-2`}>
        {project.spentUsd > 0 ? formatUsd(project.spentUsd) : "—"}
      </td>
      <td className={cellPad}>
        <Sparkline values={project.monthlySpend} />
      </td>
      <td className={cellPad}>
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
