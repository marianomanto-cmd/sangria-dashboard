"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Sparkline } from "@/components/sparkline";
import { StatusBadge } from "@/components/status-badge";
import type { DashboardProjectRow, DashboardPlanSummary } from "@/db/queries/dashboard";
import { formatPct, formatUsd, formatUsdCompact } from "@/lib/format";

const PLAN_STATUS_STYLE: Record<
  string,
  { label: string; cls: string; dot: string }
> = {
  draft: { label: "draft", cls: "bg-paper-2 text-muted border-line", dot: "bg-muted" },
  ready_to_send: { label: "ready", cls: "bg-warn-soft text-warn border-warn-soft", dot: "bg-warn" },
  approved: { label: "approved", cls: "bg-success-soft text-success border-success-soft", dot: "bg-success" },
  archived: { label: "archived", cls: "bg-paper-2 text-stone-400 border-line", dot: "bg-stone-400" },
};

type Props = {
  rows: DashboardProjectRow[];
  // Mostrar columna cliente. False si la tabla está dentro de una vista
  // que ya filtra por cliente.
  showClient?: boolean;
  dense?: boolean;
};

export function ProjectsTableExpandable({
  rows,
  showClient = true,
  dense = false,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const cellPad = dense ? "px-5 py-2" : "px-5 py-3";
  const headerPad = dense ? "px-5 py-2" : "px-5 py-2.5";

  return (
    <table className="w-full text-sm">
      <thead className="bg-paper">
        <tr className="text-[11px] uppercase tracking-[0.06em] text-muted">
          <th className="w-8"></th>
          <th className={`text-left font-medium ${headerPad}`}>Proyecto</th>
          {showClient && (
            <th className={`text-left font-medium ${headerPad}`}>Cliente</th>
          )}
          <th className={`text-left font-medium ${headerPad}`}>Estado</th>
          <th className={`text-right font-medium ${headerPad}`}>Budget</th>
          <th className={`text-right font-medium ${headerPad}`}>Gastado</th>
          <th className={`text-left font-medium ${headerPad} w-[140px]`}>Spark</th>
          <th className={`text-left font-medium ${headerPad} w-[180px]`}>
            Avance
          </th>
          <th className={`text-right font-medium ${headerPad} w-[60px]`}>
            Planes
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <ProjectRowExpandable
            key={p.id}
            project={p}
            isOpen={expanded.has(p.id)}
            onToggle={() => toggle(p.id)}
            showClient={showClient}
            cellPad={cellPad}
          />
        ))}
      </tbody>
    </table>
  );
}

function ProjectRowExpandable({
  project,
  isOpen,
  onToggle,
  showClient,
  cellPad,
}: {
  project: DashboardProjectRow;
  isOpen: boolean;
  onToggle: () => void;
  showClient: boolean;
  cellPad: string;
}) {
  const overConsumed = project.consumptionPct > 100;
  const barWidth = Math.min(project.consumptionPct, 100);
  const hasPlans = project.plans.length > 0;

  const colSpan = (showClient ? 9 : 8);

  return (
    <>
      <tr
        className={`border-t border-line-soft hover:bg-paper-2 transition-colors ${
          isOpen ? "bg-paper-2/40" : ""
        }`}
      >
        <td className={`${cellPad} text-center`}>
          <button
            type="button"
            onClick={onToggle}
            disabled={!hasPlans}
            className="text-muted hover:text-ink disabled:opacity-30"
            aria-label={isOpen ? "Colapsar" : "Expandir"}
            title={hasPlans ? "Ver planes" : "Sin planes"}
          >
            {isOpen ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronRight size={14} />
            )}
          </button>
        </td>
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
          <td className={`${cellPad} text-ink-2`}>
            <Link
              href={`/clientes/${project.clientSlug}`}
              className="hover:underline"
            >
              {project.clientName}
            </Link>
          </td>
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
        <td className={`${cellPad} text-right font-mono text-xs text-muted`}>
          {project.planCount}
        </td>
      </tr>

      {isOpen && hasPlans && (
        <tr className="bg-paper">
          <td colSpan={colSpan} className="p-0">
            <PlansSubTable
              projectCode={project.code}
              plans={project.plans}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function PlansSubTable({
  projectCode,
  plans,
}: {
  projectCode: string;
  plans: DashboardPlanSummary[];
}) {
  return (
    <div className="border-t-2 border-accent/30 px-8 py-3">
      <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted mb-2">
        Planes del proyecto · {plans.length}
      </p>
      <div className="rounded-md border border-line-soft bg-white overflow-hidden">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.06em] text-muted bg-paper-2/50">
              <th className="text-left font-medium px-3 py-1.5">Plan</th>
              <th className="text-left font-medium px-3 py-1.5">Estado</th>
              <th className="text-left font-medium px-3 py-1.5">Período</th>
              <th className="text-right font-medium px-3 py-1.5">Media</th>
              <th className="text-right font-medium px-3 py-1.5">Fees</th>
              <th className="text-right font-medium px-3 py-1.5">Total</th>
              <th className="text-right font-medium px-3 py-1.5">Gastado</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => {
              const style = PLAN_STATUS_STYLE[p.status] ?? PLAN_STATUS_STYLE.draft;
              return (
                <tr
                  key={p.id}
                  className="border-t border-line-soft hover:bg-paper-2/30"
                >
                  <td className="px-3 py-1.5">
                    <Link
                      href={`/proyectos/${projectCode}/planes/${p.id}`}
                      className="font-medium text-ink hover:underline"
                    >
                      {p.name}
                    </Link>
                    {p.currentVersion > 0 && (
                      <span className="ml-2 font-mono text-[10px] text-muted">
                        v{p.currentVersion}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5 text-[10px] font-medium ${style.cls}`}
                    >
                      <span
                        className={`inline-block h-1 w-1 rounded-full ${style.dot}`}
                      />
                      {style.label}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 font-mono text-[11px] text-ink-2">
                    {p.periodStart ?? "—"}
                    <span className="text-stone-300"> → </span>
                    {p.periodEnd ?? "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-ink-2 tabular-nums">
                    {formatUsdCompact(p.totalMediaUsd)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-muted text-[11px] tabular-nums">
                    {formatUsdCompact(p.totalFeesUsd)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono font-semibold text-ink tabular-nums">
                    {formatUsdCompact(p.totalUsd)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-ink-2 tabular-nums">
                    {p.spentRealUsd > 0
                      ? formatUsdCompact(p.spentRealUsd)
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
