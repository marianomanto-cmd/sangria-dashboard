import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { EmptyState } from "@/components/page-shell";
import { PlanStatusBadge } from "@/components/plan-status-badge";
import { StatusBadge } from "@/components/status-badge";
import { DashboardTabs } from "@/components/dashboard-v2/tabs";
import { formatUsd, formatUsdCompact, formatPct } from "@/lib/format";
import type { DashboardV2 } from "@/db/queries/dashboard-v2";

// Todo server component salvo el toggle de pestañas: el browser recibe markup
// ya renderizado, sin queries ni helpers de cálculo en el bundle.

// ── Primitivas ──────────────────────────────────────────────────────────────

function Kpi({
  label,
  value,
  hint,
  accent = false,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-5 ${
        accent
          ? "border-transparent bg-ink text-white"
          : "border-line bg-white dark:bg-paper-2"
      }`}
    >
      <p
        className={`text-[11px] uppercase tracking-[0.08em] font-medium ${
          accent ? "text-white/60" : "text-muted"
        }`}
      >
        {label}
      </p>
      <p className="text-3xl font-semibold mt-2 tabular-nums">{value}</p>
      {hint && (
        <p className={`text-xs mt-1 ${accent ? "text-white/60" : "text-muted"}`}>
          {hint}
        </p>
      )}
    </div>
  );
}

function Panel({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count?: number;
  action?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-line overflow-hidden">
      <header className="px-5 py-3.5 border-b border-line bg-paper-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">
          {title}
          {count !== undefined && count > 0 && (
            <span className="ml-2 text-xs font-normal text-muted tabular-nums">
              {count}
            </span>
          )}
        </h2>
        {action && (
          <Link
            href={action.href}
            prefetch={false}
            className="text-xs text-accent hover:underline shrink-0"
          >
            {action.label} →
          </Link>
        )}
      </header>
      {children}
    </section>
  );
}

function Bar({ pct }: { pct: number }) {
  const clamped = Math.min(Math.max(pct, 0), 100);
  const over = pct > 100;
  return (
    <div className="h-1.5 rounded-full bg-paper-2 overflow-hidden mt-2">
      <div
        className={`h-full rounded-full ${over ? "bg-danger" : "bg-accent"}`}
        style={{ width: `${over ? 100 : clamped}%` }}
      />
    </div>
  );
}

// ── Vista 1: Cuentas — salud de la cartera por cliente ──────────────────────

function ViewCuentas({ data }: { data: DashboardV2 }) {
  const { kpis, clients } = data;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi
          accent
          label="Pipeline activo"
          value={formatUsd(kpis.pipelineActiveUsd)}
          hint={`${kpis.activeClients} cliente${kpis.activeClients === 1 ? "" : "s"} con proyectos activos`}
        />
        <Kpi
          label="Consumo del pipeline"
          value={formatPct(kpis.consumptionPct)}
          hint="Gastado real sobre presupuesto activo"
        />
        <Kpi label="Facturado en el año" value={formatUsd(kpis.invoicedYtdUsd)} />
        <Kpi
          label="Clientes en cartera"
          value={String(clients.length)}
          hint={`${data.projects.length} proyectos en total`}
        />
      </div>

      <Panel title="Salud por cliente" count={clients.length}>
        {clients.length === 0 ? (
          <EmptyState title="No hay clientes" hint="Todavía no se cargó ninguno." />
        ) : (
          <ul className="divide-y divide-line">
            {clients.map((c) => (
              <li key={c.slug} className="px-5 py-4 bg-white dark:bg-paper-2">
                <div className="flex items-baseline justify-between gap-4">
                  <Link
                    href={`/clientes/${c.slug}`}
                    prefetch={false}
                    className="font-medium text-ink hover:text-accent"
                  >
                    {c.name}
                  </Link>
                  <span className="text-xs text-muted tabular-nums shrink-0">
                    {formatUsdCompact(c.spentUsd)} / {formatUsdCompact(c.budgetUsd)}
                  </span>
                </div>
                <Bar pct={c.consumptionPct} />
                <div className="flex items-center justify-between mt-1.5 text-xs text-muted">
                  <span>
                    {c.activeProjects} activo{c.activeProjects === 1 ? "" : "s"} de{" "}
                    {c.projectCount}
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

// ── Vista 2: Operaciones — lo que hay que accionar ──────────────────────────

function OpsList({
  items,
  empty,
}: {
  items: { key: string; title: string; sub: string; badge?: string; tone?: "warn" | "danger" }[];
  empty: string;
}) {
  if (items.length === 0) {
    return <p className="px-5 py-8 text-center text-[13px] text-muted">{empty}</p>;
  }
  return (
    <ul className="divide-y divide-line max-h-[22rem] overflow-y-auto">
      {items.map((i) => (
        <li
          key={i.key}
          className="px-5 py-3 flex items-center justify-between gap-3 bg-white dark:bg-paper-2"
        >
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-ink truncate">{i.title}</p>
            <p className="text-xs text-muted truncate">{i.sub}</p>
          </div>
          {i.badge && (
            <span
              className={`text-[11px] tabular-nums shrink-0 ${
                i.tone === "danger"
                  ? "text-danger font-medium"
                  : i.tone === "warn"
                    ? "text-warn font-medium"
                    : "text-muted"
              }`}
            >
              {i.badge}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function ViewOperaciones({ data }: { data: DashboardV2 }) {
  const { pendingBillings, pendingReports, receivables, staleTracking } = data;
  const receivableTotal = receivables.reduce((s, r) => s + r.amountUsd, 0);
  const urgent =
    pendingBillings.length +
    pendingReports.filter((r) => r.daysUntil < 0).length +
    receivables.filter((r) => (r.daysOverdue ?? 0) > 0).length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi accent label="Acciones urgentes" value={String(urgent)} hint="Vencidas o atrasadas" />
        <Kpi label="Billing pendiente" value={String(pendingBillings.length)} hint="Meses cerrados sin facturar" />
        <Kpi label="Reportes pendientes" value={String(pendingReports.length)} />
        <Kpi label="Por cobrar" value={formatUsd(receivableTotal)} hint={`${receivables.length} factura${receivables.length === 1 ? "" : "s"}`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel
          title="Billing pendiente"
          count={pendingBillings.length}
          action={{ href: "/billing", label: "Ir a Billing" }}
        >
          <OpsList
            empty="Nada pendiente de facturar."
            items={pendingBillings.map((b) => ({
              key: `${b.planId}-${b.month}`,
              title: `${b.planName} · ${b.month}`,
              sub: `${b.clientName} · ${b.projectCode}`,
              badge: "sin facturar",
              tone: "warn" as const,
            }))}
          />
        </Panel>

        <Panel
          title="Por cobrar"
          count={receivables.length}
          action={{ href: "/billing-tracker", label: "Billing Tracker" }}
        >
          <OpsList
            empty="No hay facturas impagas."
            items={receivables.map((r) => ({
              key: r.id,
              title: `${r.invoiceNumber ?? "s/n"} · ${formatUsd(r.amountUsd)}`,
              sub: `${r.clientName} · ${r.planName} · ${r.month}`,
              badge:
                r.daysOverdue && r.daysOverdue > 0
                  ? `${r.daysOverdue}d vencida`
                  : "al día",
              tone: r.daysOverdue && r.daysOverdue > 0 ? ("danger" as const) : undefined,
            }))}
          />
        </Panel>

        <Panel
          title="Reportes"
          count={pendingReports.length}
          action={{ href: "/reportes/calendario", label: "Calendario" }}
        >
          <OpsList
            empty="No hay reportes pendientes."
            items={pendingReports.map((r) => ({
              key: r.id,
              title: r.name,
              sub: `${r.clientName} · entrega ${r.deliveryDate}`,
              badge:
                r.daysUntil < 0
                  ? `${Math.abs(r.daysUntil)}d vencido`
                  : `en ${r.daysUntil}d`,
              tone: r.daysUntil < 0 ? ("danger" as const) : r.daysUntil <= 7 ? ("warn" as const) : undefined,
            }))}
          />
        </Panel>

        <Panel
          title="Tracking sin cerrar"
          count={staleTracking.length}
          action={{ href: "/campaign-tracker", label: "Campaign Tracker" }}
        >
          <OpsList
            empty="Todo el tracking al día."
            items={staleTracking.map((t) => ({
              key: t.planId,
              title: t.planName,
              sub: t.clientName,
              badge:
                t.daysSinceClose === null
                  ? "nunca cerrado"
                  : `hace ${t.daysSinceClose}d`,
              tone: t.daysSinceClose === null || t.daysSinceClose > 7 ? ("warn" as const) : undefined,
            }))}
          />
        </Panel>
      </div>
    </div>
  );
}

// ── Vista 3: Ejecutivo — la foto grande ─────────────────────────────────────

function MonthlyChart({ rows }: { rows: DashboardV2["monthly"] }) {
  if (rows.length === 0) {
    return <EmptyState title="Sin facturación" hint="Todavía no hay meses cargados." />;
  }
  const shown = rows.slice(-18);
  const max = Math.max(...shown.map((r) => r.totalUsd), 1);
  return (
    <div className="px-5 py-6">
      <div className="flex items-end gap-1.5 h-44">
        {shown.map((r) => (
          <div
            key={r.month}
            className="flex-1 flex flex-col items-center justify-end gap-1.5 group min-w-0"
          >
            <span className="text-[10px] text-muted tabular-nums opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
              {formatUsdCompact(r.totalUsd)}
            </span>
            <div
              className="w-full rounded-t bg-accent/80 group-hover:bg-accent transition-colors min-h-[2px]"
              style={{ height: `${Math.max((r.totalUsd / max) * 100, 1)}%` }}
              title={`${r.month}: ${formatUsd(r.totalUsd)}`}
            />
            <span className="text-[9px] text-muted tabular-nums whitespace-nowrap">
              {r.month.slice(5)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ViewEjecutivo({ data }: { data: DashboardV2 }) {
  const { kpis, projects, monthly, plansInFlight } = data;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi accent label="Pipeline activo" value={formatUsd(kpis.pipelineActiveUsd)} />
        <Kpi label="Facturado en el año" value={formatUsd(kpis.invoicedYtdUsd)} />
        <Kpi label="Consumo del pipeline" value={formatPct(kpis.consumptionPct)} />
        <Kpi
          label="Planes en curso"
          value={String(plansInFlight.length)}
          hint="Aprobados, en QA o live"
        />
      </div>

      <Panel title="Facturación real por mes">
        <MonthlyChart rows={monthly} />
      </Panel>

      <Panel
        title="Proyectos por consumo"
        count={projects.length}
        action={{ href: "/proyectos", label: "Ver todos" }}
      >
        {projects.length === 0 ? (
          <EmptyState title="No hay proyectos" hint="Todavía no se cargó ninguno." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-[0.08em] text-muted">
                <tr className="border-b border-line">
                  <th className="text-left font-medium px-5 py-2.5">Proyecto</th>
                  <th className="text-left font-medium px-5 py-2.5">Estado</th>
                  <th className="text-right font-medium px-5 py-2.5">Presupuesto</th>
                  <th className="text-right font-medium px-5 py-2.5">Gastado</th>
                  <th className="text-right font-medium px-5 py-2.5">Consumo</th>
                  <th className="text-right font-medium px-5 py-2.5">Planes</th>
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

      <Panel title="Planes en curso" count={plansInFlight.length}>
        {plansInFlight.length === 0 ? (
          <EmptyState title="No hay planes en curso" hint="Ninguno aprobado, en QA o live." />
        ) : (
          <ul className="divide-y divide-line">
            {plansInFlight.slice(0, 15).map((p) => (
              <li
                key={p.id}
                className="px-5 py-3 flex items-center justify-between gap-4 bg-white dark:bg-paper-2"
              >
                <div className="min-w-0">
                  <p className="font-medium text-ink truncate">{p.name}</p>
                  <p className="text-xs text-muted truncate">
                    {p.clientName} · {p.projectName}
                  </p>
                </div>
                <PlanStatusBadge status={p.status} />
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
}: {
  data: DashboardV2;
  failed: string | null;
}) {
  if (failed) {
    return (
      <div className="rounded-lg border border-danger/30 bg-danger-soft/40 px-5 py-6 flex items-start gap-3">
        <AlertTriangle size={18} className="text-danger shrink-0 mt-0.5" />
        <div className="text-[13px] leading-relaxed text-ink-2">
          <p className="font-semibold text-ink">No se pudo leer la base</p>
          <p className="mt-1">
            La vista no muestra nada en vez de mostrar ceros: un dashboard en $0
            se lee como un dato real y no lo es. Recargá en unos segundos.
          </p>
          <p className="mt-2 font-mono text-[11px] text-muted">{failed}</p>
        </div>
      </div>
    );
  }

  return (
    <DashboardTabs
      cuentas={<ViewCuentas data={data} />}
      operaciones={<ViewOperaciones data={data} />}
      ejecutivo={<ViewEjecutivo data={data} />}
    />
  );
}
