"use client";

import Link from "next/link";
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
  type ClientAgg,
  deriveClients,
  Eyebrow,
  flattenPendings,
  groupPendings,
  MiniBars,
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

export function DashboardCuentas({
  kpis,
  projects,
  monthly,
  pendings,
  clientSlug,
  lang,
}: Props) {
  const es = lang === "es";
  const setView = useSetDashView();
  const clients = deriveClients(projects);
  const flat = flattenPendings(groupPendings(pendings, lang));
  const realBars = monthly.map((m) => m.real);

  return (
    <div className="animate-sng-rise space-y-5">
      <header className="space-y-3">
        <Eyebrow>{es ? "Vista por cliente" : "By client"}</Eyebrow>
        <h1 className="font-display font-black text-[32px] leading-[1.05] tracking-tight text-ink">
          {es ? "Salud de cuentas" : "Account health"}
        </h1>
        <div className="flex flex-wrap gap-2 pt-1">
          <ClientChip
            href={buildHrefWithClient("/", null)}
            label={es ? "Todos" : "All"}
            active={!clientSlug}
          />
          {clients.map((c) => (
            <ClientChip
              key={c.slug}
              href={buildHrefWithClient("/", c.slug)}
              label={c.name}
              active={clientSlug === c.slug}
            />
          ))}
        </div>
      </header>

      {/* Bento superior */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3.5">
        <div className="lg:col-span-2 relative overflow-hidden rounded-2xl bg-rail text-white p-6">
          <div
            aria-hidden
            className="absolute -right-12 -top-12 w-56 h-56 rounded-full blur-2xl"
            style={{
              background:
                "radial-gradient(circle, rgba(168,52,95,.55), transparent 70%)",
            }}
          />
          <p className="relative text-[11px] font-semibold uppercase tracking-[0.18em] text-white/55">
            {es ? "Portfolio · facturado YTD" : "Portfolio · invoiced YTD"}
          </p>
          <p className="relative font-mono font-semibold text-[46px] leading-none mt-2">
            {formatUsdCompact(kpis.invoicedYtdUsd)}
          </p>
          <p className="relative text-sm text-white/65 mt-2">
            {es
              ? `en ${kpis.activeClients} cuentas activas`
              : `across ${kpis.activeClients} active accounts`}
          </p>
          {realBars.length > 0 && (
            <MiniBars values={realBars} className="relative mt-5 h-12" barClass="bg-white/25" />
          )}
        </div>

        <KpiBox label={es ? "Pipeline total" : "Total pipeline"}>
          {formatUsdCompact(kpis.pipelineActiveUsd)}
        </KpiBox>

        <KpiBox label={es ? "Avance promedio" : "Avg. progress"}>
          {formatPct(kpis.consumptionPct)}
          <Progress pct={kpis.consumptionPct} />
        </KpiBox>
      </div>

      {/* Pendientes */}
      <section className="rounded-2xl border border-line bg-surface p-5">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <h2 className="font-display font-extrabold text-[15px] text-ink">
              {es ? "Pendientes · requiere acción" : "Pending · needs action"}
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
            {flat.slice(0, 6).map((e) => (
              <PendingRow key={e.key} entry={e} lang={lang} />
            ))}
          </div>
        )}
      </section>

      {/* Tarjetas de cliente */}
      {clients.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {clients.map((c) => (
            <ClientCard key={c.slug} c={c} lang={lang} />
          ))}
        </div>
      )}
    </div>
  );
}

function ClientChip({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`px-3.5 py-1.5 rounded-full text-[13px] border transition-colors ${
        active
          ? "bg-ink text-paper border-ink"
          : "border-line text-ink-2 hover:border-accent hover:text-accent"
      }`}
    >
      {label}
    </Link>
  );
}

function KpiBox({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        {label}
      </p>
      <div className="font-mono font-semibold text-[30px] leading-none mt-3 text-ink">
        {children}
      </div>
    </div>
  );
}

function Progress({ pct }: { pct: number }) {
  return (
    <div className="mt-3 h-1.5 rounded-full bg-paper-2 overflow-hidden">
      <div
        className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2 animate-sng-grow"
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  );
}

function ClientCard({ c, lang }: { c: ClientAgg; lang: Language }) {
  const es = lang === "es";
  return (
    <Link
      href={buildHrefWithClient("/proyectos", c.slug)}
      className="group rounded-2xl border border-line bg-surface p-5 transition-all duration-200 hover:-translate-y-1 hover:shadow-[var(--shadow-card-hover)] hover:border-accent/40"
    >
      <div className="flex items-center gap-2.5">
        <span className="inline-flex items-center justify-center w-9 h-9 rounded-[10px] bg-accent-soft font-mono text-xs font-semibold text-accent shrink-0">
          {c.mark}
        </span>
        <div className="min-w-0">
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
      </div>
      <p className="text-[10px] uppercase tracking-[0.12em] text-muted mt-4">
        {es ? "Facturado" : "Invoiced"}
      </p>
      <p className="font-mono font-semibold text-[23px] leading-none mt-1 text-ink">
        {formatUsdCompact(c.billedUsd)}
      </p>
      {c.spark.some((v) => v > 0) && <MiniBars values={c.spark} className="mt-4 h-9" />}
      <Progress pct={c.consumptionPct} />
    </Link>
  );
}
