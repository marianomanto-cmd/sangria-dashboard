"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type {
  PlanBillingProjection,
  ProjectBillingProjection,
} from "@/db/queries/dashboard";
import { formatUsd, formatUsdCompact } from "@/lib/format";
import { formatMonth, type Language } from "@/lib/i18n";
import { PlanStatusBadge } from "@/components/plan-status-badge";

// Proyección de facturación por proyecto para el portal del cliente: cada
// proyecto tiene un botón para desplegar y ver el billing de cada uno de sus
// planes (total / facturado / falta facturar) + la proyección de lo que falta
// facturar prorrateada para cada mes que le queda al plan. Read-only; el
// despliegue es estado local de cliente (no navega ni postea).
export function BillingProjectionByProject({
  projects,
  lang,
}: {
  projects: ProjectBillingProjection[];
  lang: Language;
}) {
  if (projects.length === 0) return null;

  return (
    <section className="mt-8">
      <header className="mb-3">
        <h2 className="text-sm font-semibold text-ink">
          {lang === "es" ? "Proyección por proyecto" : "Projection by project"}
        </h2>
        <p className="text-xs text-muted">
          {lang === "es"
            ? "Desplegá un proyecto para ver el billing de cada plan y lo que falta facturar, prorrateado para cada mes que le queda al plan."
            : "Expand a project to see each plan's billing and what's left to invoice, prorated across each remaining month of the plan."}
        </p>
      </header>

      <div className="flex flex-col gap-3">
        {projects.map((proj) => (
          <ProjectRow key={proj.projectId} project={proj} lang={lang} />
        ))}
      </div>
    </section>
  );
}

function ProjectRow({
  project,
  lang,
}: {
  project: ProjectBillingProjection;
  lang: Language;
}) {
  const [open, setOpen] = useState(false);
  const planWord =
    project.plans.length === 1
      ? "plan"
      : lang === "es"
        ? "planes"
        : "plans";

  return (
    <section className="rounded-lg border border-line bg-white dark:bg-paper-2 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-4 px-5 py-3 text-left hover:bg-paper-2 transition-colors"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <ChevronRight
            size={16}
            className={`shrink-0 text-muted transition-transform ${
              open ? "rotate-90" : ""
            }`}
          />
          <div className="min-w-0">
            <p className="font-semibold text-ink truncate">{project.projectName}</p>
            <p className="font-mono text-[11px] text-muted">
              {project.projectCode} · {project.plans.length} {planWord}
            </p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] uppercase tracking-[0.08em] text-muted">
            {lang === "es" ? "Falta facturar" : "Left to invoice"}
          </p>
          <p className="font-mono text-lg font-semibold text-ink tabular-nums">
            {formatUsd(project.remainingUsd)}
          </p>
        </div>
      </button>

      {open && (
        <div className="border-t border-line-soft divide-y divide-line-soft">
          {project.plans.map((plan) => (
            <PlanRow key={plan.planId} plan={plan} lang={lang} />
          ))}
        </div>
      )}
    </section>
  );
}

function PlanRow({
  plan,
  lang,
}: {
  plan: PlanBillingProjection;
  lang: Language;
}) {
  return (
    <div className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="font-medium text-ink">{plan.planName}</span>
        <PlanStatusBadge status={plan.status} size="sm" />
        <span className="text-xs text-muted">
          {plan.periodStart && plan.periodEnd
            ? `${formatMonth(plan.periodStart.slice(0, 7), lang)} – ${formatMonth(plan.periodEnd.slice(0, 7), lang)}`
            : "—"}
        </span>
      </div>

      {/* Resumen de billing del plan: total a facturar, ya facturado y lo que
          falta. gross = billed + remaining (cuando billed ≤ gross). */}
      <div className="mt-3 grid grid-cols-3 gap-3">
        <Stat
          label={lang === "es" ? "Total" : "Total"}
          value={formatUsd(plan.grossUsd)}
        />
        <Stat
          label={lang === "es" ? "Facturado" : "Invoiced"}
          value={formatUsd(plan.billedUsd)}
          valueClassName="text-success"
        />
        <Stat
          label={lang === "es" ? "Falta facturar" : "Left to invoice"}
          value={formatUsd(plan.remainingUsd)}
          valueClassName="text-ink font-semibold"
        />
      </div>

      {/* Proyección de lo que falta, prorrateada por cada mes restante. */}
      <div className="mt-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted mb-1.5">
          {lang === "es"
            ? "Proyección por mes restante"
            : "Projection per remaining month"}
        </p>
        {plan.months.length === 0 ? (
          <p className="text-xs text-muted">
            {lang === "es"
              ? "Sin saldo pendiente de facturar."
              : "Nothing left to invoice."}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {plan.months.map((m) => (
              <div
                key={m.month}
                className="rounded-md border border-line-soft bg-paper-2/40 px-2.5 py-1.5"
                title={formatUsd(m.projectedUsd)}
              >
                <p className="text-[10px] uppercase tracking-[0.06em] text-muted">
                  {formatMonth(m.month, lang)}
                </p>
                <p className="font-mono text-xs font-semibold text-ink tabular-nums">
                  {formatUsdCompact(m.projectedUsd)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  valueClassName = "text-ink-2",
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
        {label}
      </p>
      <p className={`font-mono text-sm tabular-nums mt-0.5 ${valueClassName}`}>
        {value}
      </p>
    </div>
  );
}
