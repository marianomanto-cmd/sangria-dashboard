import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { EmptyState } from "@/components/page-shell";
import { PlanStatusBadge } from "@/components/plan-status-badge";
import { StatusBadge } from "@/components/status-badge";
import { DashboardTabs } from "@/components/dashboard-v2/tabs";
import {
  ClientFilter,
  ClientMark,
  EmptyRow,
  Kpi,
  Panel,
  PendingRow,
  Progress,
  Sparkline,
  type Tone,
} from "@/components/dashboard-v2/pieces";
import { formatUsd, formatUsdCompact, formatPct } from "@/lib/format";
import type { Language } from "@/lib/i18n";
import type { DashboardV2 } from "@/db/queries/dashboard-v2";

// Todo server component salvo el toggle de pestañas.

type ViewProps = {
  data: DashboardV2;
  lang: Language;
  userName: string | null;
  currentClientSlug: string | null;
};

// ── Vista 1: Cuentas ────────────────────────────────────────────────────────

function ViewCuentas({ data, lang, currentClientSlug }: ViewProps) {
  const es = lang === "es";
  const { kpis, clients } = data;

  return (
    <div className="space-y-5">
      <ClientFilter
        clients={clients}
        current={currentClientSlug}
        lang={lang}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi
          accent
          label={es ? "Pipeline activo" : "Active pipeline"}
          value={formatUsd(kpis.pipelineActiveUsd)}
          hint={
            es
              ? `${kpis.activeClients} cliente${kpis.activeClients === 1 ? "" : "s"} con proyectos activos`
              : `${kpis.activeClients} client${kpis.activeClients === 1 ? "" : "s"} with active projects`
          }
        />
        <Kpi
          label={es ? "Avance promedio" : "Avg. progress"}
          value={formatPct(kpis.consumptionPct)}
          bar={kpis.consumptionPct}
          hint={es ? "Gastado sobre presupuesto activo" : "Spent over active budget"}
        />
        <Kpi
          label={es ? "Facturado en el año" : "Invoiced YTD"}
          value={formatUsd(kpis.invoicedYtdUsd)}
        />
        <Kpi
          label={es ? "Clientes en cartera" : "Accounts"}
          value={String(clients.length)}
          hint={
            es
              ? `${data.projects.length} proyectos en total`
              : `${data.projects.length} projects total`
          }
        />
      </div>

      <Panel title={es ? "Salud por cliente" : "Account health"} count={clients.length}>
        {clients.length === 0 ? (
          <EmptyState
            title={es ? "No hay clientes" : "No accounts"}
            hint={es ? "Todavía no se cargó ninguno." : "None loaded yet."}
          />
        ) : (
          <ul className="divide-y divide-line">
            {clients.map((c) => (
              <li key={c.slug} className="px-5 py-4 bg-white dark:bg-paper-2">
                <div className="flex items-center gap-3">
                  <ClientMark mark={c.mark} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <Link
                        href={`/clientes/${c.slug}`}
                        prefetch={false}
                        className="font-medium text-ink hover:text-accent truncate"
                      >
                        {c.name}
                      </Link>
                      <span className="text-xs text-muted tabular-nums shrink-0">
                        {formatUsdCompact(c.spentUsd)} / {formatUsdCompact(c.budgetUsd)}
                      </span>
                    </div>
                    <Progress pct={c.consumptionPct} />
                  </div>
                  {/* Sparkline del gasto mensual del cliente. */}
                  <Sparkline values={c.spark} className="w-24 shrink-0 hidden sm:flex" />
                </div>
                <div className="flex items-center justify-between mt-1.5 text-xs text-muted pl-11">
                  <span>
                    {es
                      ? `${c.activeProjects} activo${c.activeProjects === 1 ? "" : "s"} de ${c.projectCount}`
                      : `${c.activeProjects} active of ${c.projectCount}`}
                  </span>
                  <span
                    className={`tabular-nums ${c.consumptionPct > 100 ? "text-danger font-medium" : ""}`}
                  >
                    {formatPct(c.consumptionPct)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

// ── Vista 2: Operaciones ────────────────────────────────────────────────────

function ViewOperaciones({ data, lang }: ViewProps) {
  const es = lang === "es";
  const { pendingBillings, pendingReports, receivables, staleTracking } = data;
  const receivableTotal = receivables.reduce((s, r) => s + r.amountUsd, 0);
  const urgent =
    pendingBillings.length +
    pendingReports.filter((r) => r.daysUntil < 0).length +
    receivables.filter((r) => (r.daysOverdue ?? 0) > 0).length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi
          accent
          label={es ? "Acciones urgentes" : "Urgent actions"}
          value={String(urgent)}
          hint={es ? "Vencidas o atrasadas" : "Overdue or late"}
        />
        <Kpi
          label={es ? "Billing pendiente" : "Billing pending"}
          value={String(pendingBillings.length)}
          hint={es ? "Meses cerrados sin facturar" : "Closed months not billed"}
        />
        <Kpi
          label={es ? "Reportes pendientes" : "Reports pending"}
          value={String(pendingReports.length)}
        />
        <Kpi
          label={es ? "Por cobrar" : "Receivable"}
          value={formatUsd(receivableTotal)}
          hint={
            es
              ? `${receivables.length} factura${receivables.length === 1 ? "" : "s"}`
              : `${receivables.length} invoice${receivables.length === 1 ? "" : "s"}`
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel
          title={es ? "Billing pendiente" : "Billing pending"}
          count={pendingBillings.length}
          action={{ href: "/billing", label: es ? "Ir a Billing" : "Go to Billing" }}
        >
          {pendingBillings.length === 0 ? (
            <EmptyRow text={es ? "Nada pendiente de facturar." : "Nothing pending."} />
          ) : (
            <ul className="divide-y divide-line max-h-[22rem] overflow-y-auto">
              {pendingBillings.map((b) => (
                <PendingRow
                  key={`${b.planId}-${b.month}`}
                  href={b.href}
                  title={`${b.planName} · ${b.month}`}
                  sub={`${b.clientName} · ${b.projectCode}`}
                  badge={es ? "sin facturar" : "not billed"}
                  tone="warn"
                />
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title={es ? "Por cobrar" : "Receivable"}
          count={receivables.length}
          action={{ href: "/billing-tracker", label: "Billing Tracker" }}
        >
          {receivables.length === 0 ? (
            <EmptyRow text={es ? "No hay facturas impagas." : "No unpaid invoices."} />
          ) : (
            <ul className="divide-y divide-line max-h-[22rem] overflow-y-auto">
              {receivables.map((r) => {
                const late = (r.daysOverdue ?? 0) > 0;
                return (
                  <PendingRow
                    key={r.id}
                    href={r.href}
                    title={`${r.invoiceNumber ?? (es ? "s/n" : "no #")} · ${formatUsd(r.amountUsd)}`}
                    sub={`${r.clientName} · ${r.planName} · ${r.month}`}
                    badge={
                      late
                        ? es
                          ? `${r.daysOverdue}d vencida`
                          : `${r.daysOverdue}d overdue`
                        : es
                          ? "al día"
                          : "on time"
                    }
                    tone={late ? "danger" : "ok"}
                  />
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel
          title={es ? "Reportes" : "Reports"}
          count={pendingReports.length}
          action={{
            href: "/reportes/calendario",
            label: es ? "Calendario" : "Calendar",
          }}
        >
          {pendingReports.length === 0 ? (
            <EmptyRow text={es ? "No hay reportes pendientes." : "No pending reports."} />
          ) : (
            <ul className="divide-y divide-line max-h-[22rem] overflow-y-auto">
              {pendingReports.map((r) => {
                const tone: Tone =
                  r.daysUntil < 0 ? "danger" : r.daysUntil <= 7 ? "warn" : "ok";
                return (
                  <PendingRow
                    key={r.id}
                    href={r.href}
                    title={r.name}
                    sub={`${r.clientName} · ${es ? "entrega" : "due"} ${r.deliveryDate}`}
                    badge={
                      r.daysUntil < 0
                        ? es
                          ? `${Math.abs(r.daysUntil)}d vencido`
                          : `${Math.abs(r.daysUntil)}d late`
                        : es
                          ? `en ${r.daysUntil}d`
                          : `in ${r.daysUntil}d`
                    }
                    tone={tone}
                  />
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel
          title={es ? "Tracking sin cerrar" : "Tracking not closed"}
          count={staleTracking.length}
          action={{ href: "/campaign-tracker", label: "Campaign Tracker" }}
        >
          {staleTracking.length === 0 ? (
            <EmptyRow text={es ? "Todo el tracking al día." : "All tracking up to date."} />
          ) : (
            <ul className="divide-y divide-line max-h-[22rem] overflow-y-auto">
              {staleTracking.map((t) => {
                const never = t.daysSinceClose === null;
                return (
                  <PendingRow
                    key={t.planId}
                    href={t.href}
                    title={t.planName}
                    sub={t.clientName}
                    badge={
                      never
                        ? es
                          ? "nunca cerrado"
                          : "never closed"
                        : es
                          ? `hace ${t.daysSinceClose}d`
                          : `${t.daysSinceClose}d ago`
                    }
                    tone={never || (t.daysSinceClose ?? 0) > 7 ? "warn" : "ok"}
                  />
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

// ── Vista 3: Ejecutivo ──────────────────────────────────────────────────────

function greeting(lang: Language): string {
  const h = new Date().getHours();
  if (lang === "es") {
    if (h < 12) return "Buen día";
    if (h < 20) return "Buenas tardes";
    return "Buenas noches";
  }
  if (h < 12) return "Good morning";
  if (h < 20) return "Good afternoon";
  return "Good evening";
}

// Gráfico real vs proyectado. El proyectado sale de prorratear el budget de
// cada placement entre los meses de su período (ver db/queries/dashboard-v2.ts).
function BillingChart({ rows, lang }: { rows: DashboardV2["monthly"]; lang: Language }) {
  const es = lang === "es";
  if (rows.length === 0) {
    return (
      <EmptyState
        title={es ? "Sin facturación" : "No billing"}
        hint={es ? "Todavía no hay meses cargados." : "No months loaded yet."}
      />
    );
  }
  const shown = rows.slice(-18);
  const max = Math.max(...shown.map((r) => Math.max(r.realUsd, r.projectedUsd)), 1);

  return (
    <div className="px-5 py-5">
      <div className="flex items-center gap-4 mb-4 text-[11px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-accent" />
          {es ? "Real" : "Actual"}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-line border border-ink-2/25" />
          {es ? "Proyectado" : "Projected"}
        </span>
      </div>
      <div className="flex items-end gap-2 h-44">
        {shown.map((r) => (
          <div
            key={r.month}
            className="flex-1 flex flex-col items-center justify-end gap-1.5 group min-w-0"
          >
            <span className="text-[10px] text-muted tabular-nums opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
              {formatUsdCompact(r.realUsd)}
            </span>
            {/* Proyectado de fondo, real encima: se lee de un vistazo si el
                mes quedó corto o se pasó. */}
            <div className="w-full flex items-end gap-[2px] h-full">
              <div
                className="flex-1 rounded-t bg-line border-t border-x border-ink-2/20 min-h-[2px]"
                style={{ height: `${Math.max((r.projectedUsd / max) * 100, 1)}%` }}
                title={`${r.month} · ${es ? "proyectado" : "projected"}: ${formatUsd(r.projectedUsd)}`}
              />
              <div
                className="flex-1 rounded-t bg-accent/85 group-hover:bg-accent transition-colors min-h-[2px]"
                style={{ height: `${Math.max((r.realUsd / max) * 100, 1)}%` }}
                title={`${r.month} · ${es ? "real" : "actual"}: ${formatUsd(r.realUsd)}`}
              />
            </div>
            <span className="text-[9px] text-muted tabular-nums whitespace-nowrap">
              {r.month.slice(5)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ViewEjecutivo({ data, lang, userName }: ViewProps) {
  const es = lang === "es";
  const { kpis, projects, monthly, plansInFlight } = data;
  const firstName =
    (userName ?? "").trim().split(/\s+/)[0] || (es ? "equipo" : "team");

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold text-ink">
        {greeting(lang)}, {firstName}.
      </h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi
          accent
          label={es ? "Pipeline activo" : "Active pipeline"}
          value={formatUsd(kpis.pipelineActiveUsd)}
        />
        <Kpi
          label={es ? "Facturado en el año" : "Invoiced YTD"}
          value={formatUsd(kpis.invoicedYtdUsd)}
        />
        <Kpi
          label={es ? "Avance promedio" : "Avg. progress"}
          value={formatPct(kpis.consumptionPct)}
          bar={kpis.consumptionPct}
        />
        <Kpi
          label={es ? "Planes en curso" : "Plans in flight"}
          value={String(plansInFlight.length)}
          hint={es ? "Aprobados, en QA o live" : "Approved, in QA or live"}
        />
      </div>

      <Panel title={es ? "Facturación: real vs proyectado" : "Billing: actual vs projected"}>
        <BillingChart rows={monthly} lang={lang} />
      </Panel>

      <Panel
        title={es ? "Proyectos por consumo" : "Projects by spend"}
        count={projects.length}
        action={{ href: "/proyectos", label: es ? "Ver todos" : "See all" }}
      >
        {projects.length === 0 ? (
          <EmptyState
            title={es ? "No hay proyectos" : "No projects"}
            hint={es ? "Todavía no se cargó ninguno." : "None loaded yet."}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-[0.08em] text-muted">
                <tr className="border-b border-line">
                  <th className="text-left font-medium px-5 py-2.5">
                    {es ? "Proyecto" : "Project"}
                  </th>
                  <th className="text-left font-medium px-5 py-2.5">
                    {es ? "Estado" : "Status"}
                  </th>
                  <th className="text-left font-medium px-5 py-2.5 hidden md:table-cell">
                    {es ? "Gasto mensual" : "Monthly spend"}
                  </th>
                  <th className="text-right font-medium px-5 py-2.5">
                    {es ? "Presupuesto" : "Budget"}
                  </th>
                  <th className="text-right font-medium px-5 py-2.5">
                    {es ? "Gastado" : "Spent"}
                  </th>
                  <th className="text-right font-medium px-5 py-2.5">
                    {es ? "Consumo" : "Progress"}
                  </th>
                  <th className="text-right font-medium px-5 py-2.5">
                    {es ? "Planes" : "Plans"}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {projects.slice(0, 25).map((p) => (
                  <tr key={p.id} className="bg-white dark:bg-paper-2">
                    <td className="px-5 py-2.5">
                      <Link
                        href={`/proyectos/${p.code}`}
                        prefetch={false}
                        className="font-medium text-ink hover:text-accent"
                      >
                        {p.name}
                      </Link>
                      <div className="text-xs text-muted">{p.clientName}</div>
                    </td>
                    <td className="px-5 py-2.5">
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="px-5 py-2.5 hidden md:table-cell">
                      <Sparkline values={p.monthlySpend} className="w-28" />
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-ink-2">
                      {formatUsd(p.budgetUsd)}
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-ink-2">
                      {formatUsd(p.spentUsd)}
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums">
                      <span
                        className={p.consumptionPct > 100 ? "text-danger font-medium" : "text-ink-2"}
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
      </Panel>

      <Panel title={es ? "Planes en curso" : "Plans in flight"} count={plansInFlight.length}>
        {plansInFlight.length === 0 ? (
          <EmptyState
            title={es ? "No hay planes en curso" : "No plans in flight"}
            hint={es ? "Ninguno aprobado, en QA o live." : "None approved, in QA or live."}
          />
        ) : (
          <ul className="divide-y divide-line">
            {plansInFlight.slice(0, 15).map((p) => (
              <li key={p.id} className="bg-white dark:bg-paper-2">
                <Link
                  href={`/proyectos/${p.projectCode}/planes/${p.id}`}
                  prefetch={false}
                  className="px-5 py-3 flex items-center justify-between gap-4 hover:bg-paper-2 transition-colors group"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-ink truncate group-hover:text-accent">
                      {p.name}
                    </p>
                    <p className="text-xs text-muted truncate">
                      {p.clientName} · {p.projectName}
                    </p>
                  </div>
                  <PlanStatusBadge status={p.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

// ── Raíz ────────────────────────────────────────────────────────────────────

export function DashboardV2View({
  data,
  failed,
  lang,
  userName,
  currentClientSlug,
}: ViewProps & { failed: string | null }) {
  const es = lang === "es";
  if (failed) {
    return (
      <div className="rounded-lg border border-danger/30 bg-danger-soft/40 px-5 py-6 flex items-start gap-3">
        <AlertTriangle size={18} className="text-danger shrink-0 mt-0.5" />
        <div className="text-[13px] leading-relaxed text-ink-2">
          <p className="font-semibold text-ink">
            {es ? "No se pudo leer la base" : "Could not read the database"}
          </p>
          <p className="mt-1">
            {es
              ? "La vista no muestra nada en vez de mostrar ceros: un dashboard en $0 se lee como un dato real y no lo es. Recargá en unos segundos."
              : "Showing nothing instead of zeros: a $0 dashboard reads as real data and it isn't. Reload in a few seconds."}
          </p>
          <p className="mt-2 font-mono text-[11px] text-muted">{failed}</p>
        </div>
      </div>
    );
  }

  const props: ViewProps = { data, lang, userName, currentClientSlug };
  return (
    <DashboardTabs
      lang={lang}
      cuentas={<ViewCuentas {...props} />}
      operaciones={<ViewOperaciones {...props} />}
      ejecutivo={<ViewEjecutivo {...props} />}
    />
  );
}
