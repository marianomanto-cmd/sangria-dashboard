"use client";

import Link from "next/link";
import { FacturacionChart } from "@/components/facturacion-chart";
import { buildHrefWithClient } from "@/lib/client-filter";
import { formatPct, formatUsdCompact } from "@/lib/format";
import type { Language } from "@/lib/i18n";
import type {
  DashboardKpis,
  DashboardProjects,
  MonthlyTotal,
} from "@/db/queries/dashboard";
import type { DashboardPendings } from "@/db/queries/pendings";
import {
  deriveClients,
  Eyebrow,
  flattenPendings,
  groupPendings,
  PendingRow,
} from "@/components/dashboard/shared";
import { useSetDashView } from "@/components/dashboard/view-context";

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

function greeting(lang: Language): string {
  const h = new Date().getHours();
  if (lang === "es") {
    if (h < 12) return "Buenos días";
    if (h < 20) return "Buenas tardes";
    return "Buenas noches";
  }
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export function DashboardEjecutivo({
  kpis,
  projects,
  monthly,
  pendings,
  clientName,
  userName,
  lang,
}: Props) {
  const es = lang === "es";
  const setView = useSetDashView();
  const flat = flattenPendings(groupPendings(pendings, lang));
  const clients = deriveClients(projects);
  const year = new Date().getFullYear();
  const firstName = (userName ?? "").trim().split(/\s+/)[0] || (es ? "equipo" : "team");

  return (
    <div className="animate-sng-rise space-y-6">
      {/* Header editorial */}
      <header className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4 lg:items-end">
        <div className="space-y-3">
          <Eyebrow>
            {es ? "Resumen ejecutivo" : "Executive summary"} ·{" "}
            {clientName ?? (es ? "todos los clientes" : "all clients")}
          </Eyebrow>
          <h1 className="font-display font-black text-[46px] leading-[0.98] tracking-tight text-ink">
            {greeting(lang)}, {firstName}.
          </h1>
        </div>
        <p className="text-sm text-muted leading-relaxed lg:text-right lg:pb-2">
          {es
            ? `Año fiscal ${year} · ${kpis.activeClients} clientes activos · ${projects.rows.length} proyectos en curso. Todo lo que necesita acción, primero.`
            : `Fiscal year ${year} · ${kpis.activeClients} active clients · ${projects.rows.length} projects in flight. Everything that needs action, first.`}
        </p>
      </header>

      {/* Banda de KPIs */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr_1fr] gap-3.5">
        <div className="relative overflow-hidden rounded-2xl bg-rail text-white p-6">
          <div
            aria-hidden
            className="absolute -right-12 -bottom-12 w-60 h-60 rounded-full blur-2xl"
            style={{
              background:
                "radial-gradient(circle, rgba(168,52,95,.55), transparent 70%)",
            }}
          />
          <p className="relative text-[11px] font-semibold uppercase tracking-[0.18em] text-white/55">
            {es ? "Pipeline activo" : "Active pipeline"}
          </p>
          <p className="relative font-mono font-semibold text-[52px] leading-none mt-3">
            {formatUsdCompact(kpis.pipelineActiveUsd)}
          </p>
        </div>

        <ExecKpi label={es ? "Facturado YTD" : "Invoiced YTD"}>
          {formatUsdCompact(kpis.invoicedYtdUsd)}
        </ExecKpi>

        <ExecKpi label={es ? "Avance promedio" : "Avg. progress"}>
          {formatPct(kpis.consumptionPct)}
          <div className="mt-3 h-1.5 rounded-full bg-paper-2 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2 animate-sng-grow"
              style={{ width: `${Math.min(100, Math.max(0, kpis.consumptionPct))}%` }}
            />
          </div>
        </ExecKpi>
      </div>

      {/* Chart de facturación mensual (recharts, reusado) */}
      <FacturacionChart data={monthly} lang={lang} />

      {/* Fila inferior */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-3.5">
        <section className="rounded-2xl border border-line bg-surface p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2.5">
              <h2 className="font-display font-extrabold text-[15px] text-ink">
                {es ? "Requiere atención" : "Needs attention"}
              </h2>
              {flat.length > 0 && (
                <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-danger-soft text-danger text-[11px] font-semibold tabular-nums">
                  {flat.length}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setView("operaciones")}
              className="text-xs font-medium text-accent hover:underline shrink-0"
            >
              {es ? "Ver todos →" : "View all →"}
            </button>
          </div>
          {flat.length === 0 ? (
            <p className="text-sm text-success">{es ? "Todo al día." : "All clear."}</p>
          ) : (
            <div className="space-y-2.5">
              {flat.slice(0, 5).map((e) => (
                <PendingRow key={e.key} entry={e} lang={lang} />
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="font-display font-extrabold text-[15px] text-ink mb-4">
            {es ? "Clientes activos" : "Active clients"}
          </h2>
          {clients.length === 0 ? (
            <p className="text-sm text-muted">{es ? "Sin clientes." : "No clients."}</p>
          ) : (
            <div className="divide-y divide-line-soft">
              {clients.map((c) => (
                <Link
                  key={c.slug}
                  href={buildHrefWithClient("/proyectos", c.slug)}
                  className="flex items-center gap-3 py-2.5 group"
                >
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-accent-soft font-mono text-[11px] font-semibold text-accent shrink-0">
                    {c.mark}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink truncate group-hover:text-accent">
                      {c.name}
                    </p>
                    <p className="text-[11px] text-muted">
                      {c.projectCount}{" "}
                      {es
                        ? c.projectCount === 1
                          ? "proyecto"
                          : "proyectos"
                        : c.projectCount === 1
                          ? "project"
                          : "projects"}
                    </p>
                  </div>
                  <span className="font-mono text-sm text-ink-2 tabular-nums shrink-0">
                    {formatUsdCompact(c.billedUsd)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ExecKpi({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        {label}
      </p>
      <div className="font-mono font-semibold text-[34px] leading-none mt-3 text-ink">
        {children}
      </div>
    </div>
  );
}
