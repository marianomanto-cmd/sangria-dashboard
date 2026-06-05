import Link from "next/link";
import { ChevronRight, Download, FileSpreadsheet } from "lucide-react";
import {
  getBillingEstimate,
  getDashboardKpis,
  getDashboardProjects,
  getMonthlyTotals,
} from "@/db/queries/dashboard";
import { getBillingTracker } from "@/db/queries/billing-tracker";
import { getReportingCalendar, getSentReports } from "@/db/queries/reports";
import { getCampaignTrackerPlan } from "@/db/queries/campaign-tracker";
import { getBenchmarks, getSimulatorCatalogs } from "@/db/queries/simulator";
import {
  getAnalysisFilterOptions,
  getMarketActivations,
} from "@/db/queries/analysis";
import { getClientSpendByPublisher } from "@/db/queries/client-portal";
import { MarketAnalysis } from "@/components/market-analysis";
import { FacturacionChart } from "@/components/facturacion-chart";
import {
  CumulativeBillingChart,
  SpendByPublisherChart,
} from "@/components/portal-charts";
import { BillingEstimateCard } from "@/components/billing-estimate-card";
import { BillingStatusBadge } from "@/components/billing-status-badge";
import { PlanStatusBadge } from "@/components/plan-status-badge";
import { ReportingGantt } from "@/components/reporting-gantt";
import { formatUsd, formatUsdCompact, formatPct } from "@/lib/format";
import { formatDate, formatMonth, type Language } from "@/lib/i18n";
import {
  endingSoonDays,
  endingSoonLabel,
  projectPeriod,
} from "@/lib/project-period";
import { PortalBenchmarksFilters } from "./portal-benchmarks-filters";

// ════════════════════════════════════════════════════════════════════════════
// Secciones (tabs) del portal de cliente. Todas read-only y scopeadas al
// cliente. Reusan las queries internas pasando clientId.
// ════════════════════════════════════════════════════════════════════════════

export type PortalParams = {
  tab: string;
  bo: string;
  proj: string;
  month: string;
  plan: string;
  pstatus: string; // "" (abiertos, default) | "cerrados"
};

// ─── Resumen ────────────────────────────────────────────────────────────────

export async function ResumenSection({
  clientId,
  lang,
}: {
  clientId: string;
  lang: Language;
}) {
  const [kpis, monthly, byPublisher] = await Promise.all([
    getDashboardKpis({ clientId }),
    getMonthlyTotals({ clientId }),
    getClientSpendByPublisher(clientId),
  ]);

  // Acumulado YTD; si no hay data del año en curso (ej. demo en otros años),
  // caemos a todos los meses para no mostrar un chart vacío.
  const year = new Date().getFullYear();
  const ytd = monthly.filter((m) => m.month.startsWith(`${year}-`));
  const cumData = ytd.length > 0 ? ytd : monthly;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard
          label={lang === "es" ? "Pipeline activo" : "Active pipeline"}
          value={formatUsd(kpis.pipelineActiveUsd)}
        />
        <KpiCard
          label={lang === "es" ? "Facturado (año)" : "Invoiced (YTD)"}
          value={formatUsd(kpis.invoicedYtdUsd)}
        />
        <KpiCard
          label={lang === "es" ? "Consumo" : "Consumption"}
          value={formatPct(kpis.consumptionPct)}
        />
      </div>
      <FacturacionChart data={monthly} lang={lang} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SpendByPublisherChart data={byPublisher} lang={lang} />
        <CumulativeBillingChart monthly={cumData} lang={lang} />
      </div>
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-white dark:bg-paper-2 px-5 py-4">
      <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
        {label}
      </p>
      <p className="font-mono text-2xl font-semibold tabular-nums mt-1">
        {value}
      </p>
    </div>
  );
}

// ─── Billing Tracker ──────────────────────────────────────────────────────────

export async function BillingSection({
  clientId,
  lang,
  params,
}: {
  clientId: string;
  lang: Language;
  params: PortalParams;
}) {
  const projects = await getBillingTracker({
    clientId,
    budgetOriginId: params.bo || null,
    projectId: params.proj || null,
    fromMonth: params.month || null,
    toMonth: params.month || null,
  });

  if (projects.length === 0) {
    return (
      <EmptyPortal
        text={
          lang === "es"
            ? "Sin facturas emitidas para los filtros aplicados."
            : "No emitted invoices for the current filters."
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {projects.map((proj) => (
        <section
          key={proj.id}
          className="rounded-lg border border-line bg-white dark:bg-paper-2 overflow-hidden"
        >
          <header className="flex items-start justify-between gap-4 px-5 py-3 border-b border-line bg-paper">
            <div className="min-w-0">
              <p className="font-semibold text-ink truncate">{proj.name}</p>
              <p className="font-mono text-[11px] text-muted">{proj.code}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-[10px] uppercase tracking-[0.08em] text-muted">
                Total
              </p>
              <p className="font-mono font-semibold text-ink">
                {formatUsd(proj.totalUsd)}
              </p>
            </div>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-paper-2">
                <tr className="text-[11px] uppercase tracking-[0.06em] text-muted">
                  <th className="text-left font-medium px-5 py-2">Plan</th>
                  <th className="text-left font-medium px-5 py-2">
                    {lang === "es" ? "N° factura" : "Invoice #"}
                  </th>
                  <th className="text-left font-medium px-5 py-2">
                    {lang === "es" ? "Mes" : "Month"}
                  </th>
                  <th className="text-right font-medium px-5 py-2">
                    {lang === "es" ? "Medios" : "Media"}
                  </th>
                  <th className="text-right font-medium px-5 py-2">Fees</th>
                  <th className="text-right font-medium px-5 py-2">Total</th>
                  <th className="text-left font-medium px-5 py-2">
                    {lang === "es" ? "Estado" : "Status"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {proj.plans.flatMap((plan) =>
                  plan.invoices.map((inv) => (
                    <tr
                      key={inv.id}
                      className="border-t border-line-soft"
                    >
                      <td className="px-5 py-2 text-ink font-medium">
                        {plan.name}
                      </td>
                      <td className="px-5 py-2 font-mono text-ink-2">
                        {inv.invoiceNumber}
                      </td>
                      <td className="px-5 py-2 text-ink-2">
                        {formatMonth(inv.month, lang)}
                      </td>
                      <td className="px-5 py-2 text-right font-mono text-ink-2">
                        {formatUsd(inv.mediaSubtotalUsd)}
                      </td>
                      <td className="px-5 py-2 text-right font-mono text-muted text-xs">
                        {formatUsd(inv.feeSubtotalUsd)}
                      </td>
                      <td className="px-5 py-2 text-right font-mono font-semibold text-ink">
                        {formatUsd(inv.totalUsd)}
                      </td>
                      <td className="px-5 py-2">
                        <BillingStatusBadge status={inv.status} lang={lang} size="sm" />
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

// ─── Estimación ───────────────────────────────────────────────────────────────

function nextMonths(count: number): string[] {
  const out: string[] = [];
  const now = new Date();
  let y = now.getFullYear();
  let m = now.getMonth() + 1;
  for (let i = 0; i < count; i++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

function previousMonth(): string {
  const now = new Date();
  let y = now.getFullYear();
  let m = now.getMonth();
  if (m === 0) {
    y -= 1;
    m = 12;
  }
  return `${y}-${String(m).padStart(2, "0")}`;
}

export async function EstimateSection({
  clientId,
  lang,
  params,
}: {
  clientId: string;
  lang: Language;
  params: PortalParams;
}) {
  const singleMonth = params.month || null;
  const months = singleMonth
    ? [singleMonth]
    : [previousMonth(), ...nextMonths(2)];

  const all = await getBillingEstimate({
    clientId,
    budgetOriginId: params.bo || null,
    projectId: params.proj || null,
    months,
  });

  const prev = singleMonth ? null : previousMonth();
  const previousEstimate = prev
    ? all.find((e) => e.month === prev) ?? null
    : null;
  const estimates = prev ? all.filter((e) => e.month !== prev) : all;

  if (estimates.length === 0 && !previousEstimate) {
    return (
      <EmptyPortal
        text={
          lang === "es"
            ? "Sin planes vigentes para estimar en el período."
            : "No active plans to estimate for the period."
        }
      />
    );
  }

  return (
    <BillingEstimateCard
      estimates={estimates}
      previousMonth={previousEstimate}
      lang={lang}
    />
  );
}

// ─── Reportes ─────────────────────────────────────────────────────────────────

export async function ReportsSection({
  clientId,
  lang,
}: {
  clientId: string;
  lang: Language;
}) {
  const [cal, sent] = await Promise.all([
    getReportingCalendar(clientId),
    getSentReports(clientId),
  ]);

  const upcoming = cal.inProgress;

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-sm font-semibold mb-3">
          {lang === "es" ? "Calendario de entregas" : "Delivery calendar"}
        </h2>
        <ReportingGantt reports={upcoming} lang={lang} readOnly />
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-3">
          {lang === "es" ? "Reportes enviados" : "Sent reports"}
        </h2>
        {sent.length === 0 ? (
          <EmptyPortal
            text={
              lang === "es" ? "Sin reportes enviados aún." : "No sent reports yet."
            }
          />
        ) : (
          <div className="rounded-lg border border-line bg-white dark:bg-paper-2 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-paper-2">
                <tr className="text-[11px] uppercase tracking-[0.06em] text-muted">
                  <th className="text-left font-medium px-5 py-2">
                    {lang === "es" ? "Reporte" : "Report"}
                  </th>
                  <th className="text-left font-medium px-5 py-2">
                    {lang === "es" ? "Enviado" : "Sent"}
                  </th>
                  <th className="text-left font-medium px-5 py-2">PPT</th>
                </tr>
              </thead>
              <tbody>
                {sent.map((r) => (
                  <tr key={r.reportId} className="border-t border-line-soft">
                    <td className="px-5 py-2 text-ink">{r.projectName}</td>
                    <td className="px-5 py-2 text-ink-2">
                      {formatDate(r.deliveredAt, lang)}
                    </td>
                    <td className="px-5 py-2">
                      {r.reportPptUrl ? (
                        <a
                          href={r.reportPptUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-accent hover:underline text-xs"
                        >
                          {lang === "es" ? "Ver reporte" : "View report"}
                          <ChevronRight size={12} />
                        </a>
                      ) : (
                        <span className="text-muted text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Proyectos (planes + export + pacing) ────────────────────────────────────

function monthInRange(
  month: string,
  start: string | null,
  end: string | null,
): boolean {
  if (!start || !end) return false;
  const s = start.slice(0, 7);
  const e = end.slice(0, 7);
  return month >= s && month <= e;
}

function hrefWith(params: PortalParams, changes: Partial<PortalParams>): string {
  const merged = { ...params, ...changes };
  const qs = new URLSearchParams();
  if (merged.tab) qs.set("tab", merged.tab);
  if (merged.bo) qs.set("bo", merged.bo);
  if (merged.proj) qs.set("proj", merged.proj);
  if (merged.month) qs.set("month", merged.month);
  if (merged.plan) qs.set("plan", merged.plan);
  const s = qs.toString();
  return s ? `?${s}` : "?";
}

export async function ProjectsSection({
  clientId,
  lang,
  params,
}: {
  clientId: string;
  lang: Language;
  params: PortalParams;
}) {
  const { rows } = await getDashboardProjects({
    clientId,
    budgetOriginId: params.bo || null,
  });

  // Filtro de estado: abiertos (default) o cerrados.
  const STATUSES =
    params.pstatus === "cerrados"
      ? new Set(["closed", "reportado"])
      : new Set(["planning", "active", "paused"]);

  // Filtro de mes: dejamos proyectos con al menos un plan cuyo período cubre
  // el mes; dentro de cada proyecto mostramos solo esos planes.
  // Solo planes APROBADOS: el portal es para el cliente, no mostramos borradores
  // ni versiones viejas (draft/ready/archived son internos).
  const monthFilter = params.month || null;
  const visible = rows
    .filter((proj) => STATUSES.has(proj.status))
    .map((proj) => {
      let plans = proj.plans.filter((p) => p.status === "approved");
      if (monthFilter) {
        plans = plans.filter((p) =>
          monthInRange(monthFilter, p.periodStart, p.periodEnd),
        );
      }
      return { ...proj, plans };
    })
    .filter((proj) => proj.plans.length > 0);

  if (visible.length === 0) {
    return (
      <EmptyPortal
        text={
          lang === "es"
            ? "Sin proyectos para los filtros aplicados."
            : "No projects for the current filters."
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {visible.map((proj) => {
        const period = projectPeriod(proj.plans);
        const endingDays = endingSoonDays(period.end);
        return (
        <section
          key={proj.id}
          className="rounded-lg border border-line bg-white dark:bg-paper-2 overflow-hidden"
        >
          <header className="flex items-start justify-between gap-4 px-5 py-3 border-b border-line bg-paper">
            <div className="min-w-0">
              <p className="font-semibold text-ink truncate">{proj.name}</p>
              <p className="font-mono text-[11px] text-muted">{proj.code}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-[10px] uppercase tracking-[0.08em] text-muted">
                {lang === "es" ? "Período" : "Period"}
              </p>
              <p className="font-mono text-xs text-ink-2">
                {period.start ? formatDate(period.start, lang) : "—"}
                <span className="text-line"> → </span>
                {period.end ? formatDate(period.end, lang) : "—"}
              </p>
              {endingDays !== null && (
                <p className="text-[11px] font-medium text-warn mt-0.5">
                  {endingSoonLabel(endingDays, lang)}
                </p>
              )}
            </div>
          </header>
          <div className="divide-y divide-line-soft">
            {proj.plans.map((plan) => {
              const expanded = params.plan === plan.id;
              return (
                <div key={plan.id} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="font-medium text-ink truncate">
                        {plan.name}
                      </span>
                      <PlanStatusBadge status={plan.status} size="sm" />
                      <span className="text-xs text-muted">
                        {plan.periodStart && plan.periodEnd
                          ? `${formatMonth(plan.periodStart.slice(0, 7), lang)} – ${formatMonth(plan.periodEnd.slice(0, 7), lang)}`
                          : "—"}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="font-mono text-sm text-ink-2">
                        {formatUsd(plan.totalUsd)}
                      </span>
                      <a
                        href={`/api/plans/${plan.id}/export.pdf`}
                        className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent"
                        title="PDF"
                      >
                        <Download size={13} />
                        PDF
                      </a>
                      <a
                        href={`/api/plans/${plan.id}/export.xlsx`}
                        className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent"
                        title="Excel"
                      >
                        <FileSpreadsheet size={13} />
                        Excel
                      </a>
                      <Link
                        href={hrefWith(params, {
                          plan: expanded ? "" : plan.id,
                        })}
                        scroll={false}
                        className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                      >
                        {expanded
                          ? lang === "es"
                            ? "Ocultar pacing"
                            : "Hide pacing"
                          : lang === "es"
                            ? "Ver pacing"
                            : "View pacing"}
                        <ChevronRight
                          size={12}
                          className={expanded ? "rotate-90 transition-transform" : "transition-transform"}
                        />
                      </Link>
                    </div>
                  </div>
                  {expanded && (
                    <div className="mt-3">
                      <PlanPacing planId={plan.id} lang={lang} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
        );
      })}
    </div>
  );
}

async function PlanPacing({
  planId,
  lang,
}: {
  planId: string;
  lang: Language;
}) {
  const data = await getCampaignTrackerPlan(planId);
  if (!data) {
    return (
      <p className="text-xs text-muted">
        {lang === "es" ? "Sin datos de pacing." : "No pacing data."}
      </p>
    );
  }

  const lastUpdate =
    data.lastUpdateAt ?? (data.lastCloseDate ? new Date(data.lastCloseDate) : null);

  return (
    <div className="rounded-md border border-line bg-paper-2/50 p-3">
      {/* Última actualización del pacing — chiquito, en azul. */}
      <p className="text-[11px] text-info mb-2">
        {lang === "es" ? "Pacing actualizado: " : "Pacing updated: "}
        {lastUpdate
          ? formatDate(lastUpdate.toISOString().slice(0, 10), lang)
          : lang === "es"
            ? "sin cargas aún"
            : "no loads yet"}
      </p>

      <div className="space-y-3">
        {data.publishers.map((pub) => (
          <div key={pub.id}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="font-medium text-ink-2">{pub.publisherName}</span>
              <span className="font-mono text-muted">
                {formatUsdCompact(pub.actualInvestmentUsd)} /{" "}
                {formatUsdCompact(pub.goalInvestmentUsd)} ·{" "}
                {pub.progressPct.toFixed(0)}%
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[520px]">
                <thead>
                  <tr className="text-[10px] uppercase tracking-[0.06em] text-muted">
                    <th className="text-left font-medium px-2 py-1">
                      {lang === "es" ? "Placement" : "Placement"}
                    </th>
                    <th className="text-right font-medium px-2 py-1">Goal</th>
                    <th className="text-right font-medium px-2 py-1">
                      {lang === "es" ? "Real" : "Actual"}
                    </th>
                    <th className="text-right font-medium px-2 py-1">
                      {lang === "es" ? "Avance" : "Progress"}
                    </th>
                    <th className="text-right font-medium px-2 py-1">Pace</th>
                  </tr>
                </thead>
                <tbody>
                  {pub.placements.map((pl) => (
                    <tr key={pl.id} className="border-t border-line-soft">
                      <td className="px-2 py-1 text-ink-2">{pl.name}</td>
                      <td className="px-2 py-1 text-right font-mono text-muted">
                        {formatUsdCompact(pl.goalInvestmentUsd)}
                      </td>
                      <td className="px-2 py-1 text-right font-mono text-ink-2">
                        {formatUsdCompact(pl.actualInvestmentUsd)}
                      </td>
                      <td className="px-2 py-1 text-right font-mono text-ink-2">
                        {pl.progressPct.toFixed(0)}%
                      </td>
                      <td className="px-2 py-1 text-right">
                        <PaceBadge status={pl.paceStatus} pct={pl.pacePct} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PaceBadge({ status, pct }: { status: string; pct: number }) {
  const cls =
    status === "on_pace"
      ? "bg-success-soft text-success"
      : status === "over_pace"
        ? "bg-info-soft text-info"
        : status === "behind"
          ? "bg-warn-soft text-warn"
          : "bg-paper-2 text-muted";
  return (
    <span
      className={`inline-block rounded-sm px-1.5 py-0.5 text-[10px] font-medium ${cls}`}
    >
      {pct.toFixed(0)}%
    </span>
  );
}

// ─── Benchmarks (server-rendered, URL-based — sin Server Actions) ─────────────

export type BenchmarkParams = {
  publisherId: string;
  marketId: string;
  costMethod: string;
  dateFrom: string;
  dateTo: string;
};

const LOW_SAMPLE = 3;

export async function BenchmarksSection({
  clientId,
  lang,
  bench,
}: {
  clientId: string;
  lang: Language;
  bench: BenchmarkParams;
}) {
  const [rows, catalogs] = await Promise.all([
    getBenchmarks({
      clientId,
      publisherId: bench.publisherId || null,
      marketId: bench.marketId || null,
      costMethod: bench.costMethod || null,
      dateFrom: bench.dateFrom || null,
      dateTo: bench.dateTo || null,
    }),
    getSimulatorCatalogs(clientId),
  ]);

  // Href del export con los filtros actuales (mismos params que la query).
  const exportHref = (fmt: "xlsx" | "pdf") => {
    const qs = new URLSearchParams({ clientId, fmt });
    if (bench.publisherId) qs.set("pub", bench.publisherId);
    if (bench.marketId) qs.set("mkt", bench.marketId);
    if (bench.costMethod) qs.set("cm", bench.costMethod);
    if (bench.dateFrom) qs.set("from", bench.dateFrom);
    if (bench.dateTo) qs.set("to", bench.dateTo);
    return `/api/benchmarks/export?${qs.toString()}`;
  };

  return (
    <div>
      <PortalBenchmarksFilters
        catalogs={catalogs}
        trailing={
          <>
            <a
              href={exportHref("xlsx")}
              className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white dark:bg-paper-2 px-2.5 py-1.5 text-xs text-ink-2 hover:text-accent hover:border-accent transition-colors h-fit"
            >
              <FileSpreadsheet size={13} />
              Excel
            </a>
            <a
              href={exportHref("pdf")}
              className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white dark:bg-paper-2 px-2.5 py-1.5 text-xs text-ink-2 hover:text-accent hover:border-accent transition-colors h-fit"
            >
              <Download size={13} />
              PDF
            </a>
          </>
        }
      />
      {rows.length === 0 ? (
        <EmptyPortal
          text={
            lang === "es"
              ? "Sin datos de benchmarks para los filtros actuales."
              : "No benchmark data for the current filters."
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-white dark:bg-paper-2">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-muted bg-paper-2/60">
              <tr className="border-b border-line">
                <BTh className="text-left">Publisher</BTh>
                <BTh className="text-left">Mercado</BTh>
                <BTh>Cost method</BTh>
                <BTh title="Cantidad de placements con data">N</BTh>
                <BTh>Spend</BTh>
                <BTh>Delivery</BTh>
                <BTh colSpan={3} className="border-l border-line">CPM (p25·p50·p75)</BTh>
                <BTh colSpan={3} className="border-l border-line">CPC</BTh>
                <BTh colSpan={3} className="border-l border-line">CPV</BTh>
                <BTh colSpan={3} className="border-l border-line">CTR %</BTh>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={`${r.publisherId}|${r.marketId ?? "_"}|${r.costMethod ?? "_"}`}
                  className="border-b border-line/60"
                >
                  <BTd className="text-left font-medium text-ink">
                    {r.publisherName}
                  </BTd>
                  <BTd className="text-left text-ink-2">
                    {r.marketName ?? <span className="text-muted">—</span>}
                  </BTd>
                  <BTd>
                    {r.costMethod ? (
                      <span className="px-1.5 py-0.5 rounded bg-paper-2 border border-line text-[11px]">
                        {r.costMethod}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </BTd>
                  <BTd className="tabular-nums">
                    {r.placements < LOW_SAMPLE ? (
                      <span className="text-amber-600 dark:text-amber-400">
                        {r.placements}
                      </span>
                    ) : (
                      <span className="text-ink-2">{r.placements}</span>
                    )}
                  </BTd>
                  <BTd className="tabular-nums text-ink-2">
                    {formatUsd(r.totalSpendUsd)}
                  </BTd>
                  <BTd className="tabular-nums">
                    {r.deliveryPctMedian == null ? (
                      <span className="text-muted">—</span>
                    ) : (
                      `${r.deliveryPctMedian.toFixed(0)}%`
                    )}
                  </BTd>
                  <PCells bundle={r.cpm} prefix="$" />
                  <PCells bundle={r.cpc} prefix="$" />
                  <PCells bundle={r.cpv} prefix="$" />
                  <PCells bundle={r.ctr} suffix="%" />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-4 text-xs text-muted max-w-2xl">
        {lang === "es"
          ? "Cada fila agrega placements con la misma combinación publisher × mercado × cost method. Los percentiles (p25·p50·p75) se calculan sobre métricas derivadas por placement de campañas históricas cerradas."
          : "Each row aggregates placements with the same publisher × market × cost method. Percentiles (p25·p50·p75) are computed over per-placement derived metrics from closed historical campaigns."}
      </p>
    </div>
  );
}

function BTh({
  children,
  className = "",
  colSpan,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  colSpan?: number;
  title?: string;
}) {
  return (
    <th
      colSpan={colSpan}
      title={title}
      className={`px-3 py-2 font-medium text-center ${className}`}
    >
      {children}
    </th>
  );
}

function BTd({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-3 py-2 text-center ${className}`}>{children}</td>;
}

function PCells({
  bundle,
  prefix = "",
  suffix = "",
}: {
  bundle: { p25: number | null; p50: number | null; p75: number | null };
  prefix?: string;
  suffix?: string;
}) {
  const fmt = (v: number | null) =>
    v == null ? "—" : `${prefix}${v.toFixed(prefix === "$" ? 2 : 1)}${suffix}`;
  return (
    <>
      <td className="px-2 py-2 text-center text-[11px] text-muted tabular-nums border-l border-line/60">
        {fmt(bundle.p25)}
      </td>
      <td className="px-2 py-2 text-center text-xs text-ink tabular-nums font-medium">
        {fmt(bundle.p50)}
      </td>
      <td className="px-2 py-2 text-center text-[11px] text-muted tabular-nums">
        {fmt(bundle.p75)}
      </td>
    </>
  );
}

// ─── Análisis por mercado (mapa) ──────────────────────────────────────────────

export type AnalysisParams = {
  pub: string;
  mkt: string;
  bo: string;
  from: string;
  to: string;
};

export async function AnalysisSection({
  clientId,
  lang,
  analysis,
}: {
  clientId: string;
  lang: Language;
  analysis: AnalysisParams;
}) {
  const list = (v: string) => (v ? v.split(",").filter(Boolean) : null);
  const [data, options] = await Promise.all([
    getMarketActivations({
      clientId,
      publisherIds: list(analysis.pub),
      marketIds: list(analysis.mkt),
      budgetOriginIds: list(analysis.bo),
      fromMonth: analysis.from || null,
      toMonth: analysis.to || null,
    }),
    getAnalysisFilterOptions(clientId),
  ]);
  return (
    <MarketAnalysis
      rows={data.rows}
      markets={data.markets}
      options={options}
      lang={lang}
    />
  );
}

// ─── Shared ───────────────────────────────────────────────────────────────────

function EmptyPortal({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-line border-dashed bg-paper-2 px-5 py-10 text-center text-sm text-muted">
      {text}
    </div>
  );
}
