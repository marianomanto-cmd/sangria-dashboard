import Link from "next/link";
import { Building2, ChevronRight } from "lucide-react";
import { BudgetOriginSelector } from "@/components/budget-origin-selector";
import { EmptyState, PageShell } from "@/components/page-shell";
import { PlanStatusBadge } from "@/components/plan-status-badge";
import { YearSelector } from "@/components/year-selector";
import {
  ConsumptionBar,
  FreshnessDots,
  PaceBadge,
  relativeUpdateLabel,
} from "@/components/campaign-tracker-bits";
import {
  CAMPAIGN_HUB_PLAN_STATUSES,
  getCampaignTrackerHub,
  isCampaignHubPlanStatus,
  type CampaignHubClient,
  type CampaignHubFilter,
  type CampaignHubSignedStatus,
} from "@/db/queries/campaign-tracker";
import { listAllBudgetOrigins } from "@/db/queries/budget-origins";
import { buildHrefWithClient } from "@/lib/client-filter";
import { resolveClientFromSearchParams } from "@/lib/client-filter.server";
import { formatUsd, formatUsdCompact } from "@/lib/format";
import { DEFAULT_LANGUAGE, formatDate } from "@/lib/i18n";
import { PLAN_STATUS_LABELS } from "@/lib/plan-status";
import { resolveYearParam } from "@/lib/year-filter";

type Props = {
  searchParams: Promise<{
    client?: string;
    filter?: string;
    origin?: string;
    status?: string;
    year?: string;
  }>;
};

function parseFilter(raw: string | undefined): CampaignHubFilter {
  return raw === "concluido" || raw === "todos" ? raw : "vigente";
}

// Href del hub preservando el resto de los filtros. Los defaults NO se
// escriben en la URL ('vigente' para el estado de tracking, el año corriente
// para el año), así que /campaign-tracker a secas es la vista por default.
function buildTrackerHref(params: {
  filter: CampaignHubFilter;
  planStatus: CampaignHubSignedStatus | null;
  origin: string | null;
  clientSlug: string | null;
  year: string | undefined;
}): string {
  const qs = new URLSearchParams();
  if (params.filter !== "vigente") qs.set("filter", params.filter);
  if (params.planStatus) qs.set("status", params.planStatus);
  if (params.origin) qs.set("origin", params.origin);
  if (params.clientSlug) qs.set("client", params.clientSlug);
  if (params.year) qs.set("year", params.year);
  const q = qs.toString();
  return q ? `/campaign-tracker?${q}` : "/campaign-tracker";
}

export default async function CampaignTrackerPage({ searchParams }: Props) {
  const sp = await searchParams;
  const client = await resolveClientFromSearchParams(sp);
  const lang = client?.language ?? DEFAULT_LANGUAGE;
  const filter = parseFilter(sp.filter);

  // Los tres filtros se validan contra su fuente de verdad antes de tocar la
  // query: un link viejo con un origin borrado o un status que ya no existe cae
  // en "todos" en vez de devolver 0 filas sin explicación.
  const allOrigins = await listAllBudgetOrigins({ clientId: client?.id ?? null });
  const validOrigin =
    sp.origin && allOrigins.some((o) => o.id === sp.origin) ? sp.origin : null;
  const planStatus =
    sp.status && isCampaignHubPlanStatus(sp.status) ? sp.status : null;
  const currentYear = new Date().getFullYear();
  const selectedYear = resolveYearParam(sp.year, currentYear);

  const { clients, totals, statusCounts, planStatusCounts, years } =
    await getCampaignTrackerHub({
      clientId: client?.id ?? null,
      filter,
      budgetOriginId: validOrigin,
      planStatus,
      year: selectedYear,
      currentYear,
    });

  const filterLabels: Record<CampaignHubFilter, { word: string; words: string }> = {
    vigente: { word: "vigente", words: "vigentes" },
    concluido: { word: "concluido", words: "concluidos" },
    todos: { word: "", words: "" },
  };
  const fl = filterLabels[filter];
  // Para el empty state. `sp.year` (y no `selectedYear`) porque el año tiene
  // default: sin tocar nada estás viendo el año corriente, y eso no es "filtro
  // puesto por el usuario". El aviso del año va aparte, y sólo si hay planes en
  // otros años que el filtro esté escondiendo.
  const hasNarrowingFilters =
    validOrigin !== null || planStatus !== null || sp.year !== undefined;
  const yearHidesPlans = selectedYear !== null && years.length > 1;

  const title = client
    ? `Campaign Tracker · ${client.name}`
    : "Campaign Tracker";
  const subtitle =
    filter === "concluido"
      ? `${totals.plansCount} plan${totals.plansCount === 1 ? "" : "es"} concluido${totals.plansCount === 1 ? "" : "s"} en ${totals.clientsCount} cliente${totals.clientsCount === 1 ? "" : "s"}. Histórico de campañas finalizadas — datos reales vs lo planeado.`
      : filter === "todos"
        ? `${totals.plansCount} plan${totals.plansCount === 1 ? "" : "es"} (vigentes + concluidos) en ${totals.clientsCount} cliente${totals.clientsCount === 1 ? "" : "s"}.`
        : `${totals.plansCount} plan${totals.plansCount === 1 ? "" : "es"} ${fl.words} en ${totals.clientsCount} cliente${totals.clientsCount === 1 ? "" : "s"}. Cargá el consumo real y mirá qué campañas están on-pace, atrasadas o excediendo el goal.`;

  return (
    <PageShell eyebrow="Campaign Tracker" title={title} subtitle={subtitle}>
      <BudgetOriginSelector
        origins={allOrigins}
        current={validOrigin}
        basePath="/campaign-tracker"
        preserveParams={{
          filter: filter === "vigente" ? undefined : filter,
          status: planStatus ?? undefined,
          client: client?.slug,
          year: sp.year,
        }}
      />

      <div className="mb-4">
        <YearSelector
          years={years}
          current={selectedYear}
          currentYear={currentYear}
          basePath="/campaign-tracker"
          preserveParams={{
            filter: filter === "vigente" ? undefined : filter,
            status: planStatus ?? undefined,
            origin: validOrigin ?? undefined,
            client: client?.slug,
          }}
          lang={lang}
        />
      </div>

      {/* Estado de tracking (derivado de fechas) + status del plan (el de la
          DB). Son cosas distintas y por eso van en dos grupos: un plan puede
          estar 'concluido' por fecha y seguir marcado `live`. */}
      <div className="flex flex-wrap items-center gap-2 mb-4 text-xs">
        <FilterPill label="Estado">
          <FilterChoice
            isActive={filter === "vigente"}
            href={buildTrackerHref({
              filter: "vigente",
              planStatus,
              origin: validOrigin,
              clientSlug: client?.slug ?? null,
              year: sp.year,
            })}
            label={`Vigentes (${statusCounts.vigente})`}
          />
          <FilterChoice
            isActive={filter === "concluido"}
            href={buildTrackerHref({
              filter: "concluido",
              planStatus,
              origin: validOrigin,
              clientSlug: client?.slug ?? null,
              year: sp.year,
            })}
            label={`Concluidos (${statusCounts.concluido})`}
          />
          <FilterChoice
            isActive={filter === "todos"}
            href={buildTrackerHref({
              filter: "todos",
              planStatus,
              origin: validOrigin,
              clientSlug: client?.slug ?? null,
              year: sp.year,
            })}
            label={`Todos (${statusCounts.vigente + statusCounts.concluido})`}
          />
        </FilterPill>

        <FilterPill label="Status del plan">
          <FilterChoice
            isActive={planStatus === null}
            href={buildTrackerHref({
              filter,
              planStatus: null,
              origin: validOrigin,
              clientSlug: client?.slug ?? null,
              year: sp.year,
            })}
            label={`Todos (${CAMPAIGN_HUB_PLAN_STATUSES.reduce(
              (sum, st) => sum + planStatusCounts[st],
              0,
            )})`}
          />
          {CAMPAIGN_HUB_PLAN_STATUSES.map((st) => (
            <FilterChoice
              key={st}
              isActive={planStatus === st}
              href={buildTrackerHref({
                filter,
                planStatus: st,
                origin: validOrigin,
                clientSlug: client?.slug ?? null,
                year: sp.year,
              })}
              label={`${PLAN_STATUS_LABELS[st]} (${planStatusCounts[st]})`}
            />
          ))}
        </FilterPill>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <KpiCard
          label={
            filter === "concluido"
              ? "Planes concluidos"
              : filter === "todos"
                ? "Planes (todos)"
                : "Planes vigentes"
          }
          value={String(totals.plansCount)}
          hint={`${totals.clientsCount} cliente${totals.clientsCount === 1 ? "" : "s"}`}
        />
        <KpiCard
          label="Inversión consumida"
          value={formatUsdCompact(totals.actualInvestmentUsd)}
          hint={`sobre ${formatUsdCompact(totals.goalInvestmentUsd)} planeados`}
        />
        {filter === "concluido" ? (
          <KpiCard
            label="Cumplimiento promedio"
            value={
              totals.goalInvestmentUsd > 0
                ? `${((totals.actualInvestmentUsd / totals.goalInvestmentUsd) * 100).toFixed(0)}%`
                : "—"
            }
            hint="real / planeado"
          />
        ) : (
          <KpiCard
            label="Sin update ≥48h"
            value={String(totals.staleCount)}
            hint={totals.staleCount === 0 ? "todo al día" : "requieren carga"}
            tone={totals.staleCount > 0 ? "warn" : undefined}
          />
        )}
        <KpiCard
          label={filter === "concluido" ? "Cerraron off-pace" : "Planes off-pace"}
          value={
            totals.offPaceCount === 0
              ? filter === "concluido"
                ? "Todo en goal"
                : "Todo on pace"
              : String(totals.offPaceCount)
          }
          hint={
            totals.offPaceCount === 0
              ? "✓"
              : filter === "concluido"
                ? "no llegaron al goal o lo excedieron"
                : "atrasados o excediendo el goal"
          }
          ink
        />
      </div>

      {clients.length === 0 ? (
        <EmptyState
          title={
            filter === "concluido"
              ? "Sin planes concluidos para mostrar"
              : filter === "todos"
                ? "Sin planes con período definido"
                : "Sin planes vigentes para cargar"
          }
          hint={
            (hasNarrowingFilters
              ? "Ningún plan coincide con los filtros aplicados."
              : filter === "concluido"
                ? "Acá quedan los planes aprobados cuyo período ya terminó. Aparecen una vez que pasa la fecha de fin del último placement."
                : filter === "todos"
                  ? "Aparecen los planes aprobados con período definido (vigentes y concluidos)."
                  : "Aparecen acá los planes aprobados cuyo período incluye la fecha de hoy.") +
            (yearHidesPlans
              ? ` El año está en ${selectedYear}: hay planes en otros años, probá con “Todos”.`
              : "")
          }
        />
      ) : (
        <>
          <section className="rounded-lg border border-line bg-white dark:bg-paper-2 overflow-hidden">
            {/* Desktop: tabla. En mobile usamos tarjetas (abajo). */}
            <div className="hidden lg:block overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
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
                    filter={filter}
                  />
                ))}
              </tbody>
            </table>
            </div>

            {/* Mobile: tarjetas (sin scroll horizontal). */}
            <div className="lg:hidden">
              {clients.map((group) => (
                <ClientGroupCards
                  key={group.clientId}
                  group={group}
                  clientSlug={client?.slug ?? null}
                  lang={lang}
                  filter={filter}
                />
              ))}
            </div>
          </section>

          <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-muted">
            {filter !== "concluido" && (
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-warn" />
                fondo amarillo = sin update ≥48h
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-[1.5px] bg-accent" />
              marca vertical en la barra = pace esperado por fecha del plan
            </span>
            {filter !== "vigente" && (
              <span className="flex items-center gap-1.5">
                <span className="inline-flex items-center rounded-sm border border-line bg-paper-2 px-1.5 py-0.5 text-[10px] font-medium text-muted">
                  concluido
                </span>
                = el período del plan ya terminó (queda como histórico)
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <PlanStatusBadge status="live" size="sm" />
              = status del plan en la app. Un plan{" "}
              <span className="font-medium">concluido</span> que sigue{" "}
              <span className="font-medium">live</span> quedó sin cerrar:
              cerralo desde el plan o marcá el reporte final del proyecto.
            </span>
          </div>
        </>
      )}
    </PageShell>
  );
}

function FilterPill({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-paper-2 border border-line">
      <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted mr-1">
        {label}
      </span>
      <div className="flex items-center gap-0.5">{children}</div>
    </div>
  );
}

// Chip de filtro. El href lo arma `buildTrackerHref` en el cuerpo de la página
// (que es quien conoce TODOS los filtros activos), así que acá sólo se pinta.
function FilterChoice({
  href,
  label,
  isActive,
}: {
  href: string;
  label: string;
  isActive: boolean;
}) {
  return (
    <Link
      href={href}
      data-active={isActive}
      className="px-2 py-0.5 rounded text-muted hover:text-ink data-[active=true]:bg-white dark:data-[active=true]:bg-paper data-[active=true]:text-ink data-[active=true]:shadow-sm transition-colors"
    >
      {label}
    </Link>
  );
}

function ClientGroup({
  group,
  clientSlug,
  lang,
  filter,
}: {
  group: CampaignHubClient;
  clientSlug: string | null;
  lang: "en" | "es";
  filter: CampaignHubFilter;
}) {
  // Label del header del cliente: para 'vigente' mantenemos "activos"
  // (refuerza que son los que necesitan carga hoy); para concluidos /
  // todos cambiamos a "concluidos" / "en total".
  const headerNote =
    filter === "concluido"
      ? `${group.plans.length} plan${group.plans.length === 1 ? "" : "es"} concluido${group.plans.length === 1 ? "" : "s"}`
      : filter === "todos"
        ? `${group.plans.length} plan${group.plans.length === 1 ? "" : "es"} en total`
        : `${group.plans.length} plan${group.plans.length === 1 ? "" : "es"} activo${group.plans.length === 1 ? "" : "s"}`;

  return (
    <>
      <tr className="bg-paper-2">
        <td colSpan={7} className="px-5 py-2">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full bg-white dark:bg-paper-2 border border-line flex items-center justify-center shrink-0">
              <Building2 size={12} strokeWidth={2} className="text-ink-2" />
            </div>
            <span className="font-semibold text-ink">{group.clientName}</span>
            <span className="text-xs text-muted">· {headerNote}</span>
          </div>
        </td>
      </tr>
      {group.plans.map((plan) => {
        const href = buildHrefWithClient(
          `/campaign-tracker/${plan.planId}`,
          clientSlug,
        );
        const showConcluidoBadge =
          plan.status === "concluido" && filter !== "concluido";
        // El desfasaje que motivó el filtro de status: el período del plan
        // terminó pero el plan sigue marcado Live.
        const staleLive =
          plan.status === "concluido" && plan.planStatus === "live";
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
                {showConcluidoBadge && (
                  <span className="ml-2 inline-flex items-center rounded-sm border border-line bg-paper-2 px-1.5 py-0.5 text-[10px] font-medium text-muted">
                    concluido
                  </span>
                )}
                <span
                  className="ml-2 inline-flex align-middle"
                  title={
                    staleLive
                      ? "El período del plan ya terminó pero sigue marcado Live. Cerralo desde el plan (\u201cMarcar terminado\u201d) o marcá el reporte final del proyecto como entregado."
                      : undefined
                  }
                >
                  <PlanStatusBadge status={plan.planStatus} size="sm" />
                </span>
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

// Versión mobile de ClientGroup: header del cliente + tarjetas por plan.
// Mismos datos/labels que la tabla; preserva el fondo amarillo si está stale.
function ClientGroupCards({
  group,
  clientSlug,
  lang,
  filter,
}: {
  group: CampaignHubClient;
  clientSlug: string | null;
  lang: "en" | "es";
  filter: CampaignHubFilter;
}) {
  const headerNote =
    filter === "concluido"
      ? `${group.plans.length} plan${group.plans.length === 1 ? "" : "es"} concluido${group.plans.length === 1 ? "" : "s"}`
      : filter === "todos"
        ? `${group.plans.length} plan${group.plans.length === 1 ? "" : "es"} en total`
        : `${group.plans.length} plan${group.plans.length === 1 ? "" : "es"} activo${group.plans.length === 1 ? "" : "s"}`;

  return (
    <div className="border-t border-line-soft first:border-t-0">
      <div className="flex items-center gap-2 px-4 py-2 bg-paper-2">
        <div className="w-5 h-5 rounded-full bg-white dark:bg-paper-2 border border-line flex items-center justify-center shrink-0">
          <Building2 size={12} strokeWidth={2} className="text-ink-2" />
        </div>
        <span className="font-semibold text-ink">{group.clientName}</span>
        <span className="text-xs text-muted">· {headerNote}</span>
      </div>
      <div className="divide-y divide-line-soft">
        {group.plans.map((plan) => {
          const href = buildHrefWithClient(
            `/campaign-tracker/${plan.planId}`,
            clientSlug,
          );
          const showConcluidoBadge =
            plan.status === "concluido" && filter !== "concluido";
          // El desfasaje que motivó el filtro de status: el período del plan
          // terminó pero el plan sigue marcado Live.
          const staleLive =
            plan.status === "concluido" && plan.planStatus === "live";
          return (
            <Link
              key={plan.planId}
              href={href}
              data-stale={plan.isStale}
              className="block px-4 py-3.5 hover:bg-paper-2 transition-colors data-[stale=true]:bg-warn-soft/40"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-medium text-ink">{plan.planName}</span>
                  {plan.currentVersion > 0 && (
                    <span className="ml-2 font-mono text-[10px] text-muted">
                      v{plan.currentVersion}
                    </span>
                  )}
                  {showConcluidoBadge && (
                    <span className="ml-2 inline-flex items-center rounded-sm border border-line bg-paper-2 px-1.5 py-0.5 text-[10px] font-medium text-muted">
                      concluido
                    </span>
                  )}
                  <span
                    className="ml-2 inline-flex align-middle"
                    title={
                      staleLive
                        ? "El período del plan ya terminó pero sigue marcado Live. Cerralo desde el plan (\u201cMarcar terminado\u201d) o marcá el reporte final del proyecto como entregado."
                        : undefined
                    }
                  >
                    <PlanStatusBadge status={plan.planStatus} size="sm" />
                  </span>
                  <div className="text-xs text-muted mt-0.5">
                    {plan.projectName} · {plan.budgetOriginName} ·{" "}
                    {plan.placementsCount} placement
                    {plan.placementsCount === 1 ? "" : "s"}
                  </div>
                </div>
                <span className="shrink-0">
                  <PaceBadge status={plan.paceStatus} />
                </span>
              </div>

              <div className="mt-2.5 flex items-center gap-2">
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
              </div>

              <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                    Inversión plan
                  </p>
                  <p className="font-mono text-xs text-ink-2 tabular-nums mt-0.5">
                    {plan.goalInvestmentUsd > 0
                      ? formatUsd(plan.goalInvestmentUsd)
                      : "—"}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                    Período
                  </p>
                  <p className="font-mono text-[11px] text-ink-2 mt-0.5">
                    {formatDate(plan.periodStart, lang)}
                    <span className="text-line"> → </span>
                    {formatDate(plan.periodEnd, lang)}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                    Último update
                  </p>
                  <span className="mt-0.5 flex items-center gap-1.5">
                    <FreshnessDots lastUpdateAt={plan.lastUpdateAt} />
                    <span className="text-[11px] text-muted">
                      {relativeUpdateLabel(plan.lastUpdateAt)}
                    </span>
                  </span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
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
          ink ? "text-white/70" : "text-muted"
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
              ? "text-white/60"
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
