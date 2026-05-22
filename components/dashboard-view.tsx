"use client";

import { FacturacionChart } from "@/components/facturacion-chart";
import { PendingBoard } from "@/components/pending-board";
import { ProjectsTableExpandable } from "@/components/projects-table-expandable";
import type {
  DashboardKpis,
  DashboardProjects,
  MonthlyTotal,
} from "@/db/queries/dashboard";
import type { DashboardPendings } from "@/db/queries/pendings";
import { formatPct, formatUsdCompact } from "@/lib/format";
import type { Language } from "@/lib/i18n";

type Props = {
  kpis: DashboardKpis;
  projects: DashboardProjects;
  monthly: MonthlyTotal[];
  pendings: DashboardPendings;
  clientName?: string | null;
  lang?: Language;
};

// Layout "Operativo": lo primero es qué necesita acción (pendientes/alertas);
// los KPIs quedan como contexto (strip compacto), y abajo el chart + la tabla
// de proyectos para análisis y drill-down.
export function DashboardView({
  kpis,
  projects,
  monthly,
  pendings,
  clientName,
  lang = "en",
}: Props) {
  const labels = LABELS[lang];

  return (
    <main className="px-8 py-10 max-w-[1380px] mx-auto w-full">
      <header className="mb-8 flex flex-col gap-2.5">
        <p className="text-[11px] font-semibold tracking-[0.18em] uppercase text-accent">
          {labels.eyebrow}
        </p>
        <h1 className="text-[32px] leading-[1.1] font-semibold tracking-tight text-ink">
          {labels.title}
        </h1>
        <p className="text-sm text-muted leading-relaxed">
          {clientName ? labels.filteredBy(clientName) : labels.executiveSummary}
        </p>
      </header>

      {/* 1. Pendientes + alertas (lo más importante, arriba) */}
      <PendingBoard pendings={pendings} lang={lang} />

      {/* 2. KPIs como strip de contexto */}
      <section className="mt-6 rounded-lg border border-line bg-white dark:bg-paper-2 px-5 py-3 grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-3">
        <CompactKpi
          label={labels.pipelineActive}
          value={formatUsdCompact(kpis.pipelineActiveUsd)}
        />
        <CompactKpi
          label={labels.activeClients}
          value={String(kpis.activeClients)}
        />
        <CompactKpi
          label={labels.invoicedYtd}
          value={
            kpis.invoicedYtdUsd > 0 ? formatUsdCompact(kpis.invoicedYtdUsd) : "—"
          }
          dim={kpis.invoicedYtdUsd === 0}
        />
        <CompactKpi
          label={labels.avgProgress}
          value={formatPct(kpis.consumptionPct)}
        />
      </section>

      {/* 3. Chart de facturación mensual */}
      <section className="mt-6">
        <FacturacionChart data={monthly} lang={lang} />
      </section>

      {/* 4. Tabla de proyectos (drill-down a planes) */}
      <section className="mt-6 rounded-lg border border-line bg-white dark:bg-paper-2 overflow-hidden">
        <div className="px-5 py-2.5 border-b border-line flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">
            {lang === "es" ? "Proyectos" : "Projects"}
          </h2>
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
            {projects.rows.length}{" "}
            {lang === "es"
              ? "totales · click ▶ para ver planes"
              : "total · click ▶ to see plans"}
          </span>
        </div>
        <ProjectsTableExpandable
          rows={projects.rows}
          showClient
          dense={false}
          lang={lang}
        />
      </section>
    </main>
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
          dim ? "text-line" : "text-ink"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

const LABELS = {
  en: {
    title: "Dashboard",
    eyebrow: "Sangria · Project OS",
    filteredBy: (n: string) => `Filtered by ${n}`,
    executiveSummary: "Executive summary · all clients",
    pipelineActive: "Active pipeline",
    activeClients: "Active clients",
    invoicedYtd: "Invoiced YTD",
    avgProgress: "Average progress",
  },
  es: {
    title: "Dashboard",
    eyebrow: "Sangria · Project OS",
    filteredBy: (n: string) => `Filtrado por ${n}`,
    executiveSummary: "Resumen ejecutivo · todos los clientes",
    pipelineActive: "Pipeline activo",
    activeClients: "Clientes activos",
    invoicedYtd: "Facturado YTD",
    avgProgress: "Avance promedio",
  },
} as const;
