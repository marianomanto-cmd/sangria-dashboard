"use client";

import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { formatPct, formatUsdCompact } from "@/lib/format";
import type { Language } from "@/lib/i18n";
import type {
  DashboardKpis,
  DashboardProjects,
  MonthlyTotal,
} from "@/db/queries/dashboard";
import type { DashboardPendings } from "@/db/queries/pendings";
import {
  Eyebrow,
  groupPendings,
  type PendingEntry,
  StatusDot,
} from "@/components/dashboard/shared";

type Props = {
  kpis: DashboardKpis;
  projects: DashboardProjects;
  monthly: MonthlyTotal[];
  pendings: DashboardPendings;
  clientName: string | null;
  clientSlug: string | null;
  userName: string | null;
  lang: Language;
};

export function DashboardOperaciones({
  projects,
  pendings,
  clientName,
  lang,
}: Props) {
  const es = lang === "es";
  const g = groupPendings(pendings, lang);
  const total = g.billings.length + g.tracking.length + g.reports.length + g.invoices.length;
  const invoicesTotal = pendings.invoices.reduce((s, i) => s + i.totalUsd, 0);

  return (
    <div className="animate-sng-rise space-y-5">
      <header className="space-y-2">
        <Eyebrow>
          {es ? "Centro de operaciones" : "Operations center"} ·{" "}
          {clientName ?? (es ? "todos los clientes" : "all clients")}
        </Eyebrow>
        <h1 className="font-display font-black text-[32px] leading-[1.05] tracking-tight text-ink">
          {es ? "Pendientes & alertas" : "Pending & alerts"}
        </h1>
        <p className="text-sm text-muted">
          {es
            ? "Lo que necesita acción hoy · ordenado por urgencia"
            : "What needs action today · ordered by urgency"}
        </p>
      </header>

      {/* Strip de KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 rounded-2xl border border-line bg-surface divide-x divide-y lg:divide-y-0 divide-line">
        <KpiCell label={es ? "Acciones urgentes" : "Urgent actions"} value={String(total)} />
        <KpiCell label={es ? "Billing pendiente" : "Billing pending"} value={String(g.billings.length)} />
        <KpiCell label={es ? "Reportes pendientes" : "Reports pending"} value={String(g.reports.length)} />
        <KpiCell label={es ? "Por cobrar" : "Receivable"} value={formatUsdCompact(invoicesTotal)} />
      </div>

      {/* Board de pendientes */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3.5">
        <OpsColumn title={es ? "Billing pendiente" : "Billing pending"} entries={g.billings} lang={lang} />
        <OpsColumn title="Tracking" entries={g.tracking} lang={lang} />
        <OpsColumn title={es ? "Reportes" : "Reports"} entries={g.reports} lang={lang} />
        <OpsColumn title={es ? "Por cobrar" : "Receivable"} entries={g.invoices} lang={lang} />
      </div>

      {/* Tabla densa de proyectos */}
      <section className="rounded-2xl border border-line bg-surface overflow-hidden">
        <div className="px-5 py-3 border-b border-line flex items-baseline justify-between">
          <h2 className="font-display font-extrabold text-[15px] text-ink">
            {es ? "Proyectos" : "Projects"}
          </h2>
          <span className="text-[11px] uppercase tracking-[0.08em] text-muted">
            {projects.rows.length} {es ? "totales" : "total"}
          </span>
        </div>
        {/* Desktop: tabla. En mobile usamos tarjetas (abajo) para no forzar
            scroll horizontal. */}
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full text-sm min-w-[840px]">
            <thead className="bg-paper-2/60 text-[11px] uppercase tracking-[0.06em] text-muted">
              <tr>
                <Th>{es ? "Código" : "Code"}</Th>
                <Th>{es ? "Cliente" : "Client"}</Th>
                <Th>{es ? "Proyecto" : "Project"}</Th>
                <Th>{es ? "Estado" : "Status"}</Th>
                <Th>{es ? "Avance" : "Progress"}</Th>
                <Th right>Budget</Th>
                <Th right>{es ? "Facturado" : "Invoiced"}</Th>
                <Th right>{es ? "Planes" : "Plans"}</Th>
              </tr>
            </thead>
            <tbody>
              {projects.rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-line-soft hover:bg-paper-2 transition-colors"
                >
                  <td className="px-4 py-2.5 font-mono text-xs text-muted whitespace-nowrap">
                    {r.code}
                  </td>
                  <td className="px-4 py-2.5 text-ink-2">{r.clientName}</td>
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/proyectos/${r.code}`}
                      className="font-medium text-ink hover:text-accent hover:underline"
                    >
                      {r.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-1.5 rounded-full bg-paper-2 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-accent"
                          style={{ width: `${Math.min(100, Math.max(0, r.consumptionPct))}%` }}
                        />
                      </div>
                      <span className="font-mono text-xs text-muted tabular-nums">
                        {formatPct(r.consumptionPct, 0)}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-ink-2 tabular-nums">
                    {formatUsdCompact(r.totalBudgetUsd)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-ink-2 tabular-nums">
                    {r.spentUsd > 0 ? formatUsdCompact(r.spentUsd) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-muted text-xs tabular-nums">
                    {r.planCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile: tarjetas (sin scroll horizontal). */}
        <div className="lg:hidden divide-y divide-line-soft">
          {projects.rows.map((r) => (
            <Link
              key={r.id}
              href={`/proyectos/${r.code}`}
              className="block px-4 py-3.5 hover:bg-paper-2 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium text-ink">{r.name}</span>
                <span className="shrink-0">
                  <StatusBadge status={r.status} />
                </span>
              </div>
              <p className="font-mono text-[11px] text-muted mt-0.5">
                {r.code} · {r.clientName}
              </p>
              <div className="mt-2.5 flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-paper-2 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${Math.min(100, Math.max(0, r.consumptionPct))}%` }}
                  />
                </div>
                <span className="font-mono text-xs text-muted tabular-nums">
                  {formatPct(r.consumptionPct, 0)}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <CardStat label="Budget" value={formatUsdCompact(r.totalBudgetUsd)} />
                <CardStat
                  label={es ? "Facturado" : "Invoiced"}
                  value={r.spentUsd > 0 ? formatUsdCompact(r.spentUsd) : "—"}
                />
                <CardStat label={es ? "Planes" : "Plans"} value={String(r.planCount)} />
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function CardStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
        {label}
      </p>
      <p className="font-mono text-xs text-ink-2 tabular-nums mt-0.5">{value}</p>
    </div>
  );
}

function KpiCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
        {label}
      </p>
      <p className="font-mono font-semibold text-[25px] leading-none mt-2 text-ink">
        {value}
      </p>
    </div>
  );
}

function OpsColumn({
  title,
  entries,
  lang,
}: {
  title: string;
  entries: PendingEntry[];
  lang: Language;
}) {
  const es = lang === "es";
  return (
    <div className="rounded-2xl border border-line bg-surface p-3.5 flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-paper-2 text-muted text-[11px] font-semibold tabular-nums">
          {entries.length}
        </span>
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-success py-1">{es ? "Al día" : "Clear"}</p>
      ) : (
        entries.slice(0, 6).map((e) => <OpsItem key={e.key} entry={e} lang={lang} />)
      )}
    </div>
  );
}

function OpsItem({ entry, lang }: { entry: PendingEntry; lang: Language }) {
  const es = lang === "es";
  return (
    <div className="rounded-xl border border-line bg-paper-2/40 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <StatusDot tone={entry.tone} />
        <span className="font-mono text-[11px] uppercase tracking-wide text-muted truncate">
          {entry.client}
        </span>
        {entry.amount && (
          <span className="font-mono text-xs text-ink-2 ml-auto">{entry.amount}</span>
        )}
      </div>
      <p className="text-[13px] text-ink truncate mt-1">{entry.title}</p>
      <div className="flex items-center justify-between gap-2 mt-1.5">
        <span className="text-[11px] text-muted truncate">{entry.meta}</span>
        <Link
          href={entry.href}
          className="text-[11px] font-medium text-accent hover:underline shrink-0"
        >
          {es ? "Abrir →" : "Open →"}
        </Link>
      </div>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`px-4 py-2.5 font-medium ${right ? "text-right" : "text-left"}`}>
      {children}
    </th>
  );
}
