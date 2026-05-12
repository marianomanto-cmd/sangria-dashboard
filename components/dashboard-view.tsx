"use client";

import { useSyncExternalStore } from "react";
import { LayoutGrid, Table2 } from "lucide-react";
import { FacturacionChart } from "@/components/facturacion-chart";
import { KpiCard } from "@/components/kpi-card";
import { ProjectsTableExpandable } from "@/components/projects-table-expandable";
import type {
  DashboardKpis,
  DashboardProjects,
  MonthlyTotal,
} from "@/db/queries/dashboard";
import { formatPct, formatUsd, formatUsdCompact } from "@/lib/format";
import type { Language } from "@/lib/i18n";

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
  clientName?: string | null;
  lang?: Language;
};

export function DashboardView({
  kpis,
  projects,
  monthly,
  clientName,
  lang = "en",
}: Props) {
  const layout = useSyncExternalStore<DashboardLayout>(
    subscribeLayout,
    readLayout,
    () => "A",
  );
  const setLayout = writeLayout;
  const labels = LABELS[lang];

  return (
    <main className="px-8 py-10 max-w-[1380px] mx-auto w-full">
      <header className="mb-8 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] uppercase text-accent">
            {labels.eyebrow}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight mt-2">
            {labels.title}
          </h1>
          <p className="text-sm text-muted mt-1">
            {clientName
              ? labels.filteredBy(clientName)
              : labels.executiveSummary}
          </p>
        </div>
        <LayoutToggle value={layout} onChange={setLayout} lang={lang} />
      </header>

      {layout === "A" ? (
        <LayoutA
          kpis={kpis}
          projects={projects}
          monthly={monthly}
          lang={lang}
        />
      ) : (
        <LayoutC kpis={kpis} projects={projects} lang={lang} />
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
  lang,
}: {
  value: DashboardLayout;
  onChange: (v: DashboardLayout) => void;
  lang: Language;
}) {
  const labels = LABELS[lang];
  return (
    <div className="inline-flex border border-line rounded-md p-0.5 bg-paper-2">
      <button
        type="button"
        onClick={() => onChange("A")}
        data-active={value === "A"}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-muted data-[active=true]:bg-white data-[active=true]:text-ink data-[active=true]:shadow-sm transition-colors"
      >
        <LayoutGrid size={13} strokeWidth={2} />
        {labels.layoutA}
      </button>
      <button
        type="button"
        onClick={() => onChange("C")}
        data-active={value === "C"}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-muted data-[active=true]:bg-white data-[active=true]:text-ink data-[active=true]:shadow-sm transition-colors"
      >
        <Table2 size={13} strokeWidth={2} />
        {labels.layoutC}
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Layout A — KPIs Hero (presentación / management)
// ────────────────────────────────────────────────────────────────────────────

function LayoutA({
  kpis,
  projects,
  monthly,
  lang = "en",
}: Props) {
  const labels = LABELS[lang];
  return (
    <>
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label={labels.pipelineActive}
          value={formatUsdCompact(kpis.pipelineActiveUsd)}
          hint={`${formatUsd(kpis.pipelineActiveUsd)} ${labels.inActiveProjects}`}
        />
        <KpiCard
          label={labels.activeClients}
          value={String(kpis.activeClients)}
          hint={labels.activeClientsHint}
        />
        <KpiCard
          label={labels.invoicedYtd}
          value={
            kpis.invoicedYtdUsd > 0
              ? formatUsdCompact(kpis.invoicedYtdUsd)
              : "—"
          }
          hint={
            kpis.invoicedYtdUsd > 0
              ? formatUsd(kpis.invoicedYtdUsd)
              : labels.invoicedYtdEmpty
          }
          variant={kpis.invoicedYtdUsd > 0 ? "default" : "empty"}
        />
        <KpiCard
          label={labels.avgProgress}
          value={formatPct(kpis.consumptionPct)}
          hint={labels.avgProgressHint}
          variant="ink"
        />
      </section>

      <section className="mt-6">
        <FacturacionChart data={monthly} lang={lang} />
      </section>

      <ProjectsSection rows={projects.rows} dense={false} lang={lang} />
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Layout C — Tabla protagonista (operativo diario)
// ────────────────────────────────────────────────────────────────────────────

function LayoutC({
  kpis,
  projects,
  lang,
}: {
  kpis: DashboardKpis;
  projects: DashboardProjects;
  lang: Language;
}) {
  const labels = LABELS[lang];
  return (
    <>
      <section className="rounded-lg border border-line bg-white px-5 py-3 grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-3">
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
            kpis.invoicedYtdUsd > 0
              ? formatUsdCompact(kpis.invoicedYtdUsd)
              : "—"
          }
          dim={kpis.invoicedYtdUsd === 0}
        />
        <CompactKpi
          label={labels.avgProgress}
          value={formatPct(kpis.consumptionPct)}
        />
      </section>

      <ProjectsSection rows={projects.rows} dense lang={lang} />
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

function ProjectsSection({
  rows,
  dense,
  lang,
}: {
  rows: DashboardProjects["rows"];
  dense: boolean;
  lang: Language;
}) {
  const headerPad = dense ? "px-5 py-2" : "px-5 py-2.5";
  return (
    <section className="mt-6 rounded-lg border border-line bg-white overflow-hidden">
      <div
        className={`${headerPad} border-b border-line flex items-baseline justify-between`}
      >
        <h2 className="text-sm font-semibold">
          {lang === "es" ? "Proyectos" : "Projects"}
        </h2>
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
          {rows.length}{" "}
          {lang === "es"
            ? "totales · click ▶ para ver planes"
            : "total · click ▶ to see plans"}
        </span>
      </div>
      <ProjectsTableExpandable rows={rows} showClient dense={dense} lang={lang} />
    </section>
  );
}

const LABELS = {
  en: {
    title: "Dashboard",
    eyebrow: "Sangria · Project OS",
    filteredBy: (n: string) => `Filtered by ${n}`,
    executiveSummary: "Executive summary · all clients",
    layoutA: "KPIs Hero",
    layoutC: "Table-focused",
    pipelineActive: "Active pipeline",
    inActiveProjects: "across active projects",
    activeClients: "Active clients",
    activeClientsHint: "with at least one project in progress",
    invoicedYtd: "Invoiced YTD",
    invoicedYtdEmpty: "updates as billings are issued",
    avgProgress: "Average progress",
    avgProgressHint: "real spend / active pipeline",
  },
  es: {
    title: "Dashboard",
    eyebrow: "Sangria · Project OS",
    filteredBy: (n: string) => `Filtrado por ${n}`,
    executiveSummary: "Resumen ejecutivo · todos los clientes",
    layoutA: "KPIs Hero",
    layoutC: "Tabla protagonista",
    pipelineActive: "Pipeline activo",
    inActiveProjects: "en proyectos activos",
    activeClients: "Clientes activos",
    activeClientsHint: "con al menos un proyecto en curso",
    invoicedYtd: "Facturado YTD",
    invoicedYtdEmpty: "se actualiza al emitir billings",
    avgProgress: "Avance promedio",
    avgProgressHint: "gasto real / pipeline activo",
  },
} as const;
