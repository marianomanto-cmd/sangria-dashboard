"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Sparkline } from "@/components/sparkline";
import { StatusBadge } from "@/components/status-badge";
import type {
  DashboardPlanSummary,
  DashboardProjectRow,
  FeeBreakdownRow,
  PublisherBreakdownRow,
} from "@/db/queries/dashboard";
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
  const [expandedPlans, setExpandedPlans] = useState<Set<string>>(new Set());

  const togglePlan = (id: string) => {
    setExpandedPlans((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="border-t-2 border-accent/30 px-8 py-3">
      <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted mb-2">
        Planes del proyecto · {plans.length}
      </p>
      <div className="rounded-md border border-line-soft bg-white overflow-hidden">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.06em] text-muted bg-paper-2/50">
              <th className="w-6"></th>
              <th className="text-left font-medium px-3 py-1.5">Plan</th>
              <th className="text-left font-medium px-3 py-1.5">Estado</th>
              <th className="text-left font-medium px-3 py-1.5">Período</th>
              <th className="text-right font-medium px-3 py-1.5">Total</th>
              <th className="text-right font-medium px-3 py-1.5">Facturado</th>
              <th className="text-right font-medium px-3 py-1.5">Pendiente</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => {
              const style = PLAN_STATUS_STYLE[p.status] ?? PLAN_STATUS_STYLE.draft;
              const isOpen = expandedPlans.has(p.id);
              const hasBreakdown =
                p.publisherBreakdown.length > 0 || p.feeBreakdown.length > 0;
              return (
                <PlanWithBreakdown
                  key={p.id}
                  plan={p}
                  isOpen={isOpen}
                  hasBreakdown={hasBreakdown}
                  onToggle={() => togglePlan(p.id)}
                  style={style}
                  projectCode={projectCode}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PlanWithBreakdown({
  plan,
  isOpen,
  hasBreakdown,
  onToggle,
  style,
  projectCode,
}: {
  plan: DashboardPlanSummary;
  isOpen: boolean;
  hasBreakdown: boolean;
  onToggle: () => void;
  style: { label: string; cls: string; dot: string };
  projectCode: string;
}) {
  return (
    <>
      <tr
        className={`border-t border-line-soft hover:bg-paper-2/30 ${
          isOpen ? "bg-paper-2/40" : ""
        }`}
      >
        <td className="px-2 py-1.5 text-center">
          <button
            type="button"
            onClick={onToggle}
            disabled={!hasBreakdown}
            className="text-muted hover:text-ink disabled:opacity-30"
            aria-label={isOpen ? "Colapsar" : "Expandir"}
            title={hasBreakdown ? "Ver desglose por publisher y fee" : "Sin desglose"}
          >
            {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        </td>
        <td className="px-3 py-1.5">
          <Link
            href={`/proyectos/${projectCode}/planes/${plan.id}`}
            className="font-medium text-ink hover:underline"
          >
            {plan.name}
          </Link>
          {plan.currentVersion > 0 && (
            <span className="ml-2 font-mono text-[10px] text-muted">
              v{plan.currentVersion}
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
          {plan.periodStart ?? "—"}
          <span className="text-stone-300"> → </span>
          {plan.periodEnd ?? "—"}
        </td>
        <td className="px-3 py-1.5 text-right font-mono font-semibold text-ink tabular-nums">
          {formatUsdCompact(plan.totalUsd)}
        </td>
        <td className="px-3 py-1.5 text-right font-mono tabular-nums">
          {plan.billedTotalUsd > 0 ? (
            <span className="text-success">
              {formatUsdCompact(plan.billedTotalUsd)}
            </span>
          ) : (
            <span className="text-stone-300">—</span>
          )}
        </td>
        <td className="px-3 py-1.5 text-right font-mono tabular-nums">
          {plan.pendingTotalUsd > 0 ? (
            <span className="text-warn">
              {formatUsdCompact(plan.pendingTotalUsd)}
            </span>
          ) : (
            <span className="text-success">$0</span>
          )}
        </td>
      </tr>
      {isOpen && hasBreakdown && (
        <tr className="bg-paper">
          <td colSpan={7} className="p-0">
            <BillingBreakdown plan={plan} />
          </td>
        </tr>
      )}
    </>
  );
}

function BillingBreakdown({ plan }: { plan: DashboardPlanSummary }) {
  return (
    <div className="border-t-2 border-accent/20 px-6 py-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
      <BreakdownPublishersTable rows={plan.publisherBreakdown} />
      <BreakdownFeesTable rows={plan.feeBreakdown} />
    </div>
  );
}

function BreakdownPublishersTable({ rows }: { rows: PublisherBreakdownRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-line-soft bg-white p-3 text-[11px] text-muted text-center">
        Sin publishers cargados.
      </div>
    );
  }
  const totalPlanned = rows.reduce((s, r) => s + r.plannedUsd, 0);
  const totalBilled = rows.reduce((s, r) => s + r.billedUsd, 0);
  const totalPending = rows.reduce((s, r) => s + r.pendingUsd, 0);
  return (
    <div className="rounded-md border border-line-soft bg-white overflow-hidden">
      <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted px-3 py-1.5 bg-paper-2/40 border-b border-line-soft">
        Publishers
      </p>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-[0.06em] text-muted">
            <th className="text-left font-medium px-3 py-1">Publisher</th>
            <th className="text-right font-medium px-3 py-1">Planeado</th>
            <th className="text-right font-medium px-3 py-1">Facturado</th>
            <th className="text-right font-medium px-3 py-1">Pendiente</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.publisherId} className="border-t border-line-soft">
              <td className="px-3 py-1 text-ink-2">{r.publisherName}</td>
              <td className="px-3 py-1 text-right font-mono text-ink-2 tabular-nums">
                {formatUsdCompact(r.plannedUsd)}
              </td>
              <td className="px-3 py-1 text-right font-mono text-success tabular-nums">
                {r.billedUsd > 0 ? formatUsdCompact(r.billedUsd) : "—"}
              </td>
              <td className="px-3 py-1 text-right font-mono text-warn tabular-nums">
                {r.pendingUsd > 0 ? formatUsdCompact(r.pendingUsd) : "$0"}
              </td>
            </tr>
          ))}
          <tr className="border-t-2 border-line bg-paper-2/30">
            <td className="px-3 py-1 font-semibold text-ink">Total</td>
            <td className="px-3 py-1 text-right font-mono font-semibold text-ink tabular-nums">
              {formatUsdCompact(totalPlanned)}
            </td>
            <td className="px-3 py-1 text-right font-mono font-semibold text-success tabular-nums">
              {formatUsdCompact(totalBilled)}
            </td>
            <td className="px-3 py-1 text-right font-mono font-semibold text-warn tabular-nums">
              {formatUsdCompact(totalPending)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function BreakdownFeesTable({ rows }: { rows: FeeBreakdownRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-line-soft bg-white p-3 text-[11px] text-muted text-center">
        Sin fees cargados.
      </div>
    );
  }
  const totalPlanned = rows.reduce((s, r) => s + r.totalUsd, 0);
  const totalBilled = rows.reduce((s, r) => s + r.billedUsd, 0);
  const totalPending = rows.reduce((s, r) => s + r.pendingUsd, 0);
  return (
    <div className="rounded-md border border-line-soft bg-white overflow-hidden">
      <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted px-3 py-1.5 bg-paper-2/40 border-b border-line-soft">
        Fees
      </p>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-[0.06em] text-muted">
            <th className="text-left font-medium px-3 py-1">Fee</th>
            <th className="text-right font-medium px-3 py-1">Total</th>
            <th className="text-right font-medium px-3 py-1">Facturado</th>
            <th className="text-right font-medium px-3 py-1">Pendiente</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.feeId} className="border-t border-line-soft">
              <td className="px-3 py-1 text-ink-2">
                {r.feeName}
                {r.isAutoComputed && (
                  <span
                    className="ml-1 text-[9px] text-muted font-mono"
                    title="Calculado desde rate %"
                  >
                    auto
                  </span>
                )}
              </td>
              <td className="px-3 py-1 text-right font-mono text-ink-2 tabular-nums">
                {formatUsdCompact(r.totalUsd)}
              </td>
              <td className="px-3 py-1 text-right font-mono text-success tabular-nums">
                {r.billedUsd > 0 ? formatUsdCompact(r.billedUsd) : "—"}
              </td>
              <td className="px-3 py-1 text-right font-mono text-warn tabular-nums">
                {r.pendingUsd > 0 ? formatUsdCompact(r.pendingUsd) : "$0"}
              </td>
            </tr>
          ))}
          <tr className="border-t-2 border-line bg-paper-2/30">
            <td className="px-3 py-1 font-semibold text-ink">Total</td>
            <td className="px-3 py-1 text-right font-mono font-semibold text-ink tabular-nums">
              {formatUsdCompact(totalPlanned)}
            </td>
            <td className="px-3 py-1 text-right font-mono font-semibold text-success tabular-nums">
              {formatUsdCompact(totalBilled)}
            </td>
            <td className="px-3 py-1 text-right font-mono font-semibold text-warn tabular-nums">
              {formatUsdCompact(totalPending)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
