import Link from "next/link";
import { Building2, ChevronRight } from "lucide-react";
import { EmptyState, PageShell } from "@/components/page-shell";
import {
  ConsumptionBar,
  FreshnessDots,
  PaceBadge,
  relativeUpdateLabel,
} from "@/components/campaign-tracker-bits";
import {
  getCampaignTrackerHub,
  type CampaignHubClient,
} from "@/db/queries/campaign-tracker";
import { buildHrefWithClient } from "@/lib/client-filter";
import { resolveClientFromSearchParams } from "@/lib/client-filter.server";
import { formatUsd, formatUsdCompact } from "@/lib/format";
import { DEFAULT_LANGUAGE, formatDate } from "@/lib/i18n";

type Props = {
  searchParams: Promise<{ client?: string }>;
};

export default async function CampaignTrackerPage({ searchParams }: Props) {
  const sp = await searchParams;
  const client = await resolveClientFromSearchParams(sp);
  const lang = client?.language ?? DEFAULT_LANGUAGE;

  const { clients, totals } = await getCampaignTrackerHub(client?.id ?? null);

  const title = client
    ? `Campaign Tracker · ${client.name}`
    : "Campaign Tracker";
  const subtitle = `${totals.plansCount} plan${
    totals.plansCount === 1 ? "" : "es"
  } vigente${totals.plansCount === 1 ? "" : "s"} en ${totals.clientsCount} cliente${
    totals.clientsCount === 1 ? "" : "s"
  }. Cargá el consumo real y mirá qué campañas están on-pace, atrasadas o excediendo el goal.`;

  return (
    <PageShell eyebrow="Campaign Tracker" title={title} subtitle={subtitle}>
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <KpiCard
          label="Planes vigentes"
          value={String(totals.plansCount)}
          hint={`${totals.clientsCount} cliente${totals.clientsCount === 1 ? "" : "s"}`}
        />
        <KpiCard
          label="Inversión consumida"
          value={formatUsdCompact(totals.actualInvestmentUsd)}
          hint={`sobre ${formatUsdCompact(totals.goalInvestmentUsd)} planeados`}
        />
        <KpiCard
          label="Sin update ≥48h"
          value={String(totals.staleCount)}
          hint={totals.staleCount === 0 ? "todo al día" : "requieren carga"}
          tone={totals.staleCount > 0 ? "warn" : undefined}
        />
        <KpiCard
          label="Planes off-pace"
          value={
            totals.offPaceCount === 0 ? "Todo on pace" : String(totals.offPaceCount)
          }
          hint={
            totals.offPaceCount === 0
              ? "✓"
              : "atrasados o excediendo el goal"
          }
          ink
        />
      </div>

      {clients.length === 0 ? (
        <EmptyState
          title="Sin planes vigentes para cargar"
          hint="Aparecen acá los planes aprobados cuyo período incluye la fecha de hoy."
        />
      ) : (
        <>
          <section className="rounded-lg border border-line bg-white dark:bg-paper-2 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-paper">
                <tr className="text-[11px] uppercase tracking-[0.06em] text-muted">
                  <th className="text-left font-medium px-5 py-2.5 w-[32%]">
                    Cliente / Proyecto / Plan
                  </th>
                  <th className="text-left font-medium px-5 py-2.5">Período</th>
                  <th className="text-right font-medium px-5 py-2.5">
                    Inversión plan
                  </th>
                  <th className="text-left font-medium px-5 py-2.5 w-[20%]">
                    Progreso consumo
                  </th>
                  <th className="text-left font-medium px-5 py-2.5">Pace</th>
                  <th className="text-left font-medium px-5 py-2.5">
                    Último update
                  </th>
                  <th className="px-2 py-2.5" aria-label="abrir" />
                </tr>
              </thead>
              <tbody>
                {clients.map((group) => (
                  <ClientGroup
                    key={group.clientId}
                    group={group}
                    clientSlug={client?.slug ?? null}
                    lang={lang}
                  />
                ))}
              </tbody>
            </table>
          </section>

          <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-muted">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-warn" />
              fondo amarillo = sin update ≥48h
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-[1.5px] bg-accent" />
              marca vertical en la barra = pace esperado por fecha del plan
            </span>
          </div>
        </>
      )}
    </PageShell>
  );
}

function ClientGroup({
  group,
  clientSlug,
  lang,
}: {
  group: CampaignHubClient;
  clientSlug: string | null;
  lang: "en" | "es";
}) {
  return (
    <>
      <tr className="bg-paper-2">
        <td colSpan={7} className="px-5 py-2">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full bg-white dark:bg-paper-2 border border-line flex items-center justify-center shrink-0">
              <Building2 size={12} strokeWidth={2} className="text-ink-2" />
            </div>
            <span className="font-semibold text-ink">{group.clientName}</span>
            <span className="text-xs text-muted">
              · {group.plans.length} plan
              {group.plans.length === 1 ? "" : "es"} activo
              {group.plans.length === 1 ? "" : "s"}
            </span>
          </div>
        </td>
      </tr>
      {group.plans.map((plan) => {
        const href = buildHrefWithClient(
          `/campaign-tracker/${plan.planId}`,
          clientSlug,
        );
        return (
          <tr
            key={plan.planId}
            data-stale={plan.isStale}
            className="border-t border-line-soft group hover:bg-paper-2 transition-colors data-[stale=true]:bg-warn-soft/40"
          >
            <td className="px-5 py-2.5">
              <Link href={href} className="block pl-7">
                <span className="font-medium text-ink group-hover:text-accent transition-colors">
                  {plan.planName}
                </span>
                {plan.currentVersion > 0 && (
                  <span className="ml-2 font-mono text-[10px] text-muted">
                    v{plan.currentVersion}
                  </span>
                )}
                <div className="text-xs text-muted mt-0.5">
                  {plan.projectName} · {plan.budgetOriginName} ·{" "}
                  {plan.placementsCount} placement
                  {plan.placementsCount === 1 ? "" : "s"}
                </div>
              </Link>
            </td>
            <td className="px-5 py-2.5">
              <Link
                href={href}
                className="block font-mono text-[11px] text-ink-2"
              >
                {formatDate(plan.periodStart, lang)}
                <span className="text-line"> → </span>
                {formatDate(plan.periodEnd, lang)}
              </Link>
            </td>
            <td className="px-5 py-2.5 text-right">
              <Link href={href} className="block font-mono text-ink-2">
                {plan.goalInvestmentUsd > 0
                  ? formatUsd(plan.goalInvestmentUsd)
                  : "—"}
              </Link>
            </td>
            <td className="px-5 py-2.5">
              <Link href={href} className="flex items-center gap-2">
                <div className="flex-1">
                  <ConsumptionBar
                    progressPct={plan.progressPct}
                    pacePct={plan.pacePct}
                    status={plan.paceStatus}
                  />
                </div>
                <span className="font-mono text-[11px] text-ink-2 tabular-nums w-9 text-right">
                  {plan.progressPct.toFixed(0)}%
                </span>
              </Link>
            </td>
            <td className="px-5 py-2.5">
              <Link href={href} className="block">
                <PaceBadge status={plan.paceStatus} />
              </Link>
            </td>
            <td className="px-5 py-2.5">
              <Link href={href} className="flex items-center gap-1.5">
                <FreshnessDots lastUpdateAt={plan.lastUpdateAt} />
                <span className="text-[11px] text-muted">
                  {relativeUpdateLabel(plan.lastUpdateAt)}
                </span>
              </Link>
            </td>
            <td className="px-2 py-2.5">
              <Link
                href={href}
                aria-label="Abrir plan"
                className="inline-flex items-center justify-center w-7 h-7 rounded-md text-muted group-hover:text-ink group-hover:bg-paper transition-colors"
              >
                <ChevronRight size={16} />
              </Link>
            </td>
          </tr>
        );
      })}
    </>
  );
}

function KpiCard({
  label,
  value,
  hint,
  ink,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  ink?: boolean;
  tone?: "warn";
}) {
  return (
    <div
      className={`rounded-lg border px-4 py-3 ${
        ink ? "border-ink bg-ink text-white" : "border-line bg-white dark:bg-paper-2"
      }`}
    >
      <p
        className={`text-[11px] font-medium uppercase tracking-[0.08em] ${
          ink ? "text-muted" : "text-muted"
        }`}
      >
        {label}
      </p>
      <p className="font-mono text-2xl font-semibold mt-0.5 tabular-nums">
        {value}
      </p>
      {hint && (
        <p
          className={`text-xs mt-0.5 ${
            ink
              ? "text-muted"
              : tone === "warn"
                ? "text-warn"
                : "text-muted"
          }`}
        >
          {hint}
        </p>
      )}
    </div>
  );
}
