"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { PlanStatusBadge } from "@/components/plan-status-badge";
import type {
  DashboardPlanSummary,
  DashboardProjectRow,
  FeeBreakdownRow,
  PublisherBreakdownRow,
} from "@/db/queries/dashboard";
import { formatPct, formatUsd, formatUsdCompact } from "@/lib/format";
import { formatDate, type Language } from "@/lib/i18n";

type Props = {
  rows: DashboardProjectRow[];
  // Mostrar columna cliente. False si la tabla está dentro de una vista
  // que ya filtra por cliente.
  showClient?: boolean;
  dense?: boolean;
  lang?: Language;
  // Cuando true, antepone un buscador en vivo (nombre/código) y ordena A-Z
  // por nombre. Usado en la tab Proyectos; el dashboard lo deja en false para
  // conservar el orden de la query y no mostrar el buscador.
  searchable?: boolean;
};

export function ProjectsTableExpandable({
  rows,
  showClient = true,
  dense = false,
  lang = "en",
  searchable = false,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Orden A-Z por nombre del proyecto como default (locale-aware para acentos).
  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      ),
    [rows],
  );

  // Filtro en vivo por nombre del proyecto o código.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(
      (p) =>
        p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q),
    );
  }, [sorted, query]);

  // Densidades unificadas. Antes había una mezcla de py-2 / py-2.5 / py-3
  // según componente; ahora los dos modos son consistentes y reusables.
  const cellPad = dense ? "px-5 py-2" : "px-5 py-3";
  const headerPad = dense ? "px-5 py-2" : "px-5 py-2.5";

  const displayRows = searchable ? filtered : rows;

  // overflow-x-auto + min-w-[820px] para que en pantallas chicas la tabla
  // siga siendo legible (scroll horizontal) en vez de comprimirse.
  const table = (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-sm">
        <thead className="bg-paper-2/60">
          <tr className="text-[11px] uppercase tracking-[0.06em] text-muted">
            <th className="w-8"></th>
            <th className={`text-left font-medium ${headerPad}`}>Proyecto</th>
            {showClient && (
              <th className={`text-left font-medium ${headerPad}`}>Cliente</th>
            )}
            <th className={`text-left font-medium ${headerPad}`}>Estado</th>
            <th className={`text-right font-medium ${headerPad}`}>Budget</th>
            <th className={`text-right font-medium ${headerPad}`}>Gastado</th>
            <th className={`text-left font-medium ${headerPad} w-[180px]`}>
              Avance
            </th>
            <th className={`text-right font-medium ${headerPad} w-[60px]`}>
              Planes
            </th>
          </tr>
        </thead>
        <tbody>
          {displayRows.map((p) => (
            <ProjectRowExpandable
              key={p.id}
              project={p}
              isOpen={expanded.has(p.id)}
              onToggle={() => toggle(p.id)}
              showClient={showClient}
              cellPad={cellPad}
              lang={lang}
            />
          ))}
        </tbody>
      </table>
    </div>
  );

  if (!searchable) return table;

  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
        <Search
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            lang === "es"
              ? "Buscar por nombre o código…"
              : "Search by name or code…"
          }
          className="w-full rounded-md border border-line bg-white dark:bg-paper-2 pl-9 pr-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      {displayRows.length === 0 ? (
        <div className="rounded-lg border border-line border-dashed bg-paper-2 px-5 py-12 text-center text-sm text-muted">
          {lang === "es"
            ? "Ningún proyecto coincide con la búsqueda."
            : "No projects match your search."}
        </div>
      ) : (
        <section className="rounded-lg border border-line bg-white dark:bg-paper-2 overflow-hidden">
          {table}
        </section>
      )}
    </div>
  );
}

function ProjectRowExpandable({
  project,
  isOpen,
  onToggle,
  showClient,
  cellPad,
  lang,
}: {
  project: DashboardProjectRow;
  isOpen: boolean;
  onToggle: () => void;
  showClient: boolean;
  cellPad: string;
  lang: Language;
}) {
  const overConsumed = project.consumptionPct > 100;
  const barWidth = Math.min(project.consumptionPct, 100);
  const hasPlans = project.plans.length > 0;

  const colSpan = (showClient ? 8 : 7);

  return (
    <>
      <tr
        className={`border-t border-line-soft hover:bg-paper-2 transition-colors duration-150 ${
          isOpen ? "bg-paper-2/40" : ""
        }`}
      >
        <td className={`${cellPad} text-center`}>
          <button
            type="button"
            onClick={onToggle}
            disabled={!hasPlans}
            className="text-muted hover:text-ink disabled:opacity-30 transition-transform duration-150 hover:scale-110 inline-flex"
            aria-label={isOpen ? "Colapsar" : "Expandir"}
            aria-expanded={isOpen}
            title={hasPlans ? "Ver planes" : "Sin planes"}
          >
            {/* Rotación animada del chevron en vez de swap de íconos:
                permite micro-interaction suave al abrir/cerrar. */}
            <ChevronRight
              size={14}
              className={`transition-transform duration-200 ${
                isOpen ? "rotate-90" : "rotate-0"
              }`}
            />
          </button>
        </td>
        <td className={cellPad}>
          <Link
            href={`/proyectos/${project.code}`}
            className="font-medium text-ink hover:underline"
          >
            {project.name}
          </Link>
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
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1.5 rounded-full bg-paper-2 overflow-hidden">
              <div
                className={`h-full rounded-full transition-[width] duration-300 ease-out ${
                  overConsumed ? "bg-warn" : "bg-gradient-to-r from-accent to-accent-2"
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
        <tr className="bg-paper animate-row-in">
          <td colSpan={colSpan} className="p-0">
            <PlansSubTable
              projectCode={project.code}
              plans={project.plans}
              lang={lang}
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
  lang,
}: {
  projectCode: string;
  plans: DashboardPlanSummary[];
  lang: Language;
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
      <div className="rounded-md border border-line-soft bg-white dark:bg-paper-2 overflow-hidden">
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
                  projectCode={projectCode}
                  lang={lang}
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
  projectCode,
  lang,
}: {
  plan: DashboardPlanSummary;
  isOpen: boolean;
  hasBreakdown: boolean;
  onToggle: () => void;
  projectCode: string;
  lang: Language;
}) {
  return (
    <>
      <tr
        className={`border-t border-line-soft hover:bg-paper-2/30 transition-colors duration-150 ${
          isOpen ? "bg-paper-2/40" : ""
        }`}
      >
        <td className="px-2 py-1.5 text-center">
          <button
            type="button"
            onClick={onToggle}
            disabled={!hasBreakdown}
            className="text-muted hover:text-ink disabled:opacity-30 inline-flex"
            aria-label={isOpen ? "Colapsar" : "Expandir"}
            aria-expanded={isOpen}
            title={hasBreakdown ? "Ver desglose por publisher y fee" : "Sin desglose"}
          >
            <ChevronRight
              size={12}
              className={`transition-transform duration-200 ${
                isOpen ? "rotate-90" : "rotate-0"
              }`}
            />
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
          <PlanStatusBadge status={plan.status} size="sm" />
        </td>
        <td className="px-3 py-1.5 font-mono text-[11px] text-ink-2">
          {formatDate(plan.periodStart, lang)}
          <span className="text-line"> → </span>
          {formatDate(plan.periodEnd, lang)}
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
            <span className="text-line">—</span>
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
        <tr className="bg-paper animate-row-in">
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
      <div className="rounded-md border border-line-soft bg-white dark:bg-paper-2 p-3 text-[11px] text-muted text-center">
        Sin publishers cargados.
      </div>
    );
  }
  const totalPlanned = rows.reduce((s, r) => s + r.plannedUsd, 0);
  const totalBilled = rows.reduce((s, r) => s + r.billedUsd, 0);
  const totalPending = rows.reduce((s, r) => s + r.pendingUsd, 0);
  return (
    <div className="rounded-md border border-line-soft bg-white dark:bg-paper-2 overflow-hidden">
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
      <div className="rounded-md border border-line-soft bg-white dark:bg-paper-2 p-3 text-[11px] text-muted text-center">
        Sin fees cargados.
      </div>
    );
  }
  const totalPlanned = rows.reduce((s, r) => s + r.totalUsd, 0);
  const totalBilled = rows.reduce((s, r) => s + r.billedUsd, 0);
  const totalPending = rows.reduce((s, r) => s + r.pendingUsd, 0);
  return (
    <div className="rounded-md border border-line-soft bg-white dark:bg-paper-2 overflow-hidden">
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
