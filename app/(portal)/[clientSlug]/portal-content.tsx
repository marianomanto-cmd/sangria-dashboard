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
  // Rango de fechas (Proyectos): pfrom / pto en formato YYYY-MM-DD. Un proyecto
  // entra si alguno de sus planes tiene un período que INTERSECTA el rango.
  dateFrom: string;
  dateTo: string;
  // Pacing expandido: lista de planIds separados por coma (varios a la vez).
  plan: string;
  pstatus: string; // "" (abiertos, default) | "cerrados" | "todos"
  // Filtro multi-select de campañas (planIds separados por coma).
  camp: string;
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
          {/* Desktop: tabla. En mobile usamos tarjetas (abajo). */}
          <div className="hidden lg:block overflow-x-auto">
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

          {/* Mobile: tarjetas (sin scroll horizontal). */}
          <div className="lg:hidden divide-y divide-line-soft">
            {proj.plans.flatMap((plan) =>
              plan.invoices.map((inv) => (
                <div key={inv.id} className="px-5 py-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-ink truncate">{plan.name}</p>
                      <p className="font-mono text-[11px] text-muted mt-0.5">
                        {inv.invoiceNumber} · {formatMonth(inv.month, lang)}
                      </p>
                    </div>
                    <span className="shrink-0">
                      <BillingStatusBadge status={inv.status} lang={lang} size="sm" />
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <PortalCardStat
                      label={lang === "es" ? "Medios" : "Media"}
                      value={formatUsd(inv.mediaSubtotalUsd)}
                    />
                    <PortalCardStat label="Fees" value={formatUsd(inv.feeSubtotalUsd)} />
                    <PortalCardStat label="Total" value={formatUsd(inv.totalUsd)} />
                  </div>
                </div>
              )),
            )}
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

// Opciones del filtro de Mes de la tab Estimación: la estimación apunta a meses
// FUTUROS (mes anterior + próximos), así que no puede reusar los meses históricos
// del billing (elegir un mes pasado caía siempre al estado vacío).
export function estimationMonthOptions(): string[] {
  return [previousMonth(), ...nextMonths(6)];
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
            {/* Desktop: tabla. En mobile usamos tarjetas (abajo). */}
            <div className="hidden lg:block">
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

            {/* Mobile: tarjetas (sin scroll horizontal). */}
            <div className="lg:hidden divide-y divide-line-soft">
              {sent.map((r) => (
                <div key={r.reportId} className="px-5 py-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-ink min-w-0">{r.projectName}</p>
                    {r.reportPptUrl ? (
                      <a
                        href={r.reportPptUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex shrink-0 items-center gap-1 text-accent hover:underline text-xs"
                      >
                        {lang === "es" ? "Ver reporte" : "View report"}
                        <ChevronRight size={12} />
                      </a>
                    ) : (
                      <span className="text-muted text-xs shrink-0">—</span>
                    )}
                  </div>
                  <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                    {lang === "es" ? "Enviado" : "Sent"}
                  </p>
                  <p className="font-mono text-xs text-ink-2 tabular-nums mt-0.5">
                    {formatDate(r.deliveredAt, lang)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Proyectos (planes + export + pacing) ────────────────────────────────────

// ¿El período [start, end] de un plan intersecta el rango [from, to]? El rango
// puede ser abierto de un lado (solo desde, o solo hasta). Un plan sin fechas
// no se puede ubicar → queda fuera cuando hay rango. Fechas comparadas como
// YYYY-MM-DD (orden lexicográfico = cronológico).
function periodIntersectsRange(
  start: string | null,
  end: string | null,
  from: string | null,
  to: string | null,
): boolean {
  if (!from && !to) return true;
  if (!start || !end) return false;
  const s = start.slice(0, 10);
  const e = end.slice(0, 10);
  if (from && e < from) return false; // el plan termina antes del inicio del rango
  if (to && s > to) return false; // el plan empieza después del fin del rango
  return true;
}

function hrefWith(params: PortalParams, changes: Partial<PortalParams>): string {
  const merged = { ...params, ...changes };
  const qs = new URLSearchParams();
  if (merged.tab) qs.set("tab", merged.tab);
  // IMPORTANTE: preservar pstatus, camp y el rango de fechas. Antes faltaba
  // pstatus, así que al expandir el pacing de una campaña cerrada la URL perdía
  // pstatus=cerrados, volvía a "abiertos" (default) y el proyecto cerrado
  // desaparecía → no se veía el pacing. (Bug reportado.) Mismo riesgo con el
  // rango de fechas: si no se preservara, expandir el pacing reabriría el set.
  if (merged.pstatus) qs.set("pstatus", merged.pstatus);
  if (merged.bo) qs.set("bo", merged.bo);
  if (merged.proj) qs.set("proj", merged.proj);
  if (merged.camp) qs.set("camp", merged.camp);
  if (merged.month) qs.set("month", merged.month);
  if (merged.dateFrom) qs.set("pfrom", merged.dateFrom);
  if (merged.dateTo) qs.set("pto", merged.dateTo);
  if (merged.plan) qs.set("plan", merged.plan);
  const s = qs.toString();
  return s ? `?${s}` : "?";
}

export async function ProjectsSection({
  clientId,
  clientSlug,
  lang,
  params,
}: {
  clientId: string;
  clientSlug: string;
  lang: Language;
  params: PortalParams;
}) {
  // Campañas elegidas en el filtro multi-select (planIds). Si hay alguna, el
  // usuario pidió campañas puntuales → la selección MANDA: las mostramos sin
  // importar estado (abierto/cerrado), budget origin ni mes (esos filtros se
  // ignoran mientras haya campañas elegidas, para que no las escondan).
  const selectedCampaigns = params.camp
    ? new Set(params.camp.split(",").filter(Boolean))
    : null;

  const { rows } = await getDashboardProjects({
    clientId,
    budgetOriginId: selectedCampaigns ? null : params.bo || null,
  });

  // Pacing expandido: varios planes a la vez (planIds separados por coma).
  const expandedPlans = new Set(
    params.plan ? params.plan.split(",").filter(Boolean) : [],
  );

  // Filtro de estado: abiertos (default) / cerrados / todos. Con campañas
  // seleccionadas (o estado "todos"), ampliamos a todos los estados.
  const STATUSES =
    selectedCampaigns || params.pstatus === "todos"
      ? new Set(["planning", "active", "paused", "closed", "reportado"])
      : params.pstatus === "cerrados"
        ? new Set(["closed", "reportado"])
        : new Set(["planning", "active", "paused"]);

  // Filtro de rango de fechas: dejamos proyectos con al menos un plan cuyo
  // período INTERSECTA el rango [pfrom, pto]; dentro de cada proyecto mostramos
  // solo esos planes. Se ignora si hay campañas elegidas. Solo planes APROBADOS:
  // el portal es para el cliente, no mostramos borradores ni versiones viejas
  // (draft/ready/archived).
  const dateFrom = selectedCampaigns ? null : params.dateFrom || null;
  const dateTo = selectedCampaigns ? null : params.dateTo || null;
  const visible = rows
    .filter((proj) => STATUSES.has(proj.status))
    .map((proj) => {
      let plans = proj.plans.filter((p) => p.status === "approved");
      if (selectedCampaigns) {
        plans = plans.filter((p) => selectedCampaigns.has(p.id));
      }
      if (dateFrom || dateTo) {
        plans = plans.filter((p) =>
          periodIntersectsRange(p.periodStart, p.periodEnd, dateFrom, dateTo),
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

  // IDs de todas las campañas visibles → export consolidado del pacing
  // (reporte ejecutivo de varias campañas en un solo Excel).
  const visiblePlanIds = visible.flatMap((proj) => proj.plans.map((p) => p.id));
  const exportHref = `/api/portal/pacing.xlsx?client=${encodeURIComponent(
    clientSlug,
  )}&plans=${visiblePlanIds.join(",")}`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-muted">
          {visible.length}{" "}
          {lang === "es"
            ? visible.length === 1
              ? "proyecto"
              : "proyectos"
            : visible.length === 1
              ? "project"
              : "projects"}{" "}
          · {visiblePlanIds.length}{" "}
          {lang === "es"
            ? visiblePlanIds.length === 1
              ? "campaña"
              : "campañas"
            : visiblePlanIds.length === 1
              ? "campaign"
              : "campaigns"}
        </p>
        <a
          href={exportHref}
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-1.5 text-xs font-medium text-ink-2 hover:text-accent hover:border-accent transition-colors"
          title={
            lang === "es"
              ? "Descargar el pacing consolidado de todas las campañas visibles (Excel)"
              : "Download consolidated pacing for all visible campaigns (Excel)"
          }
        >
          <FileSpreadsheet size={14} />
          {lang === "es" ? "Descargar pacing (Excel)" : "Download pacing (Excel)"}
        </a>
      </div>
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
              const expanded = expandedPlans.has(plan.id);
              // Toggle del pacing dentro del set (varios expandidos a la vez).
              const nextPlan = expanded
                ? [...expandedPlans].filter((id) => id !== plan.id)
                : [...expandedPlans, plan.id];
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
                        href={hrefWith(params, { plan: nextPlan.join(",") })}
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
                      <PlanPacing
                        planId={plan.id}
                        clientSlug={clientSlug}
                        lang={lang}
                      />
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
  clientSlug,
  lang,
}: {
  planId: string;
  clientSlug: string;
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
      {/* Última actualización del pacing + descarga del pacing en Excel
          (formato espejo del plan de medios). */}
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="text-[11px] text-info">
          {lang === "es" ? "Pacing actualizado: " : "Pacing updated: "}
          {lastUpdate
            ? formatDate(lastUpdate.toISOString().slice(0, 10), lang)
            : lang === "es"
              ? "sin cargas aún"
              : "no loads yet"}
        </p>
        <a
          href={`/api/portal/pacing.xlsx?client=${encodeURIComponent(clientSlug)}&plans=${planId}`}
          className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent shrink-0"
          title={
            lang === "es"
              ? "Descargar pacing en Excel"
              : "Download pacing as Excel"
          }
        >
          <FileSpreadsheet size={13} />
          Excel
        </a>
      </div>

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
        <>
          {/* Desktop: tabla completa con percentiles p25·p50·p75. En mobile
              usamos tarjetas (abajo) con solo la mediana (p50) de cada métrica. */}
          <div className="hidden lg:block overflow-x-auto rounded-lg border border-line bg-white dark:bg-paper-2">
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
                        <span className="text-warn">
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

          {/* Mobile: tarjetas con lo esencial + mediana (p50) por métrica. */}
          <div className="lg:hidden rounded-lg border border-line bg-white dark:bg-paper-2 divide-y divide-line-soft">
            {rows.map((r) => (
              <div
                key={`${r.publisherId}|${r.marketId ?? "_"}|${r.costMethod ?? "_"}`}
                className="px-5 py-3.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-ink truncate">
                      {r.publisherName}
                    </p>
                    <p className="text-[11px] text-muted mt-0.5">
                      {r.marketName ?? "—"}
                    </p>
                  </div>
                  {r.costMethod ? (
                    <span className="shrink-0 px-1.5 py-0.5 rounded bg-paper-2 border border-line text-[11px]">
                      {r.costMethod}
                    </span>
                  ) : (
                    <span className="text-muted text-xs shrink-0">—</span>
                  )}
                </div>
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                      N
                    </p>
                    <p
                      className={`font-mono text-xs tabular-nums mt-0.5 ${
                        r.placements < LOW_SAMPLE ? "text-warn" : "text-ink-2"
                      }`}
                    >
                      {r.placements}
                    </p>
                  </div>
                  <PortalCardStat label="Spend" value={formatUsd(r.totalSpendUsd)} />
                  <PortalCardStat
                    label="Delivery"
                    value={
                      r.deliveryPctMedian == null
                        ? "—"
                        : `${r.deliveryPctMedian.toFixed(0)}%`
                    }
                  />
                  <PortalCardStat label="CPM p50" value={fmtBench(r.cpm.p50, "$")} />
                  <PortalCardStat label="CPC p50" value={fmtBench(r.cpc.p50, "$")} />
                  <PortalCardStat label="CPV p50" value={fmtBench(r.cpv.p50, "$")} />
                  <PortalCardStat
                    label="CTR p50"
                    value={fmtBench(r.ctr.p50, "", "%")}
                  />
                </div>
              </div>
            ))}
          </div>
        </>
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

// Par label/valor para las tarjetas mobile (mismo patrón que view-operaciones).
function PortalCardStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
        {label}
      </p>
      <p className="font-mono text-xs text-ink-2 tabular-nums mt-0.5">{value}</p>
    </div>
  );
}

// Formato de un percentil de benchmark (mediana) para la tarjeta mobile. Mismo
// criterio que PCells: 2 decimales para $, 1 para el resto.
function fmtBench(v: number | null, prefix = "", suffix = ""): string {
  if (v == null) return "—";
  return `${prefix}${v.toFixed(prefix === "$" ? 2 : 1)}${suffix}`;
}

function EmptyPortal({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-line border-dashed bg-paper-2 px-5 py-10 text-center text-sm text-muted">
      {text}
    </div>
  );
}
