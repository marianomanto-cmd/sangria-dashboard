import Link from "next/link";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  budgetOrigins,
  clients,
  mediaPlanPlacements,
  mediaPlanPublishers,
  mediaPlans,
  projects,
} from "@/db/schema";
import { BillingEstimateCard } from "@/components/billing-estimate-card";
import { BudgetOriginSelector } from "@/components/budget-origin-selector";
import { PageShell } from "@/components/page-shell";
import { PlansTableClient } from "@/components/plans-table-client";
import { listAllBudgetOrigins } from "@/db/queries/budget-origins";
import { getBillingEstimate } from "@/db/queries/dashboard";
import { formatUsdCompact } from "@/lib/format";
import { resolveClientFromSearchParams } from "@/lib/client-filter.server";
import { DEFAULT_LANGUAGE } from "@/lib/i18n";

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

type Props = {
  searchParams: Promise<{ status?: string; origin?: string; client?: string }>;
};

export default async function PlanesPage({ searchParams }: Props) {
  const sp = await searchParams;
  const filter = sp.status;
  const client = await resolveClientFromSearchParams(sp);
  const clientId = client?.id ?? null;
  const lang = client?.language ?? DEFAULT_LANGUAGE;
  const allOrigins = await listAllBudgetOrigins({ clientId });
  const validOrigin =
    sp.origin && allOrigins.some((o) => o.id === sp.origin) ? sp.origin : null;

  const conds = [isNull(mediaPlans.deletedAt)];
  if (filter) conds.push(eq(mediaPlans.status, filter as never));
  if (validOrigin) conds.push(eq(projects.budgetOriginId, validOrigin));
  if (clientId) conds.push(eq(projects.clientId, clientId));
  const where = conds.length === 1 ? conds[0] : and(...conds);

  const baseQuery = db
    .select({
      id: mediaPlans.id,
      name: mediaPlans.name,
      status: mediaPlans.status,
      currentVersion: mediaPlans.currentVersion,
      // periodStart/End derivados de los placements del plan
      periodStart: sql<string | null>`min(${mediaPlanPlacements.startDate})::text`,
      periodEnd: sql<string | null>`max(${mediaPlanPlacements.endDate})::text`,
      createdAt: mediaPlans.createdAt,
      projectId: projects.id,
      projectCode: projects.code,
      projectName: projects.name,
      clientName: clients.name,
      clientSlug: clients.slug,
      budgetOriginName: budgetOrigins.name,
      totalMediaUsd: sql<string>`coalesce(sum(${mediaPlanPublishers.totalPlannedUsd}), 0)`,
    })
    .from(mediaPlans)
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .innerJoin(budgetOrigins, eq(projects.budgetOriginId, budgetOrigins.id))
    .leftJoin(
      mediaPlanPublishers,
      eq(mediaPlanPublishers.mediaPlanId, mediaPlans.id),
    )
    .leftJoin(
      mediaPlanPlacements,
      eq(mediaPlanPlacements.mediaPlanPublisherId, mediaPlanPublishers.id),
    )
    .groupBy(mediaPlans.id, projects.id, clients.id, budgetOrigins.id)
    .orderBy(asc(mediaPlans.name));

  const allPlans = where ? await baseQuery.where(where) : await baseQuery;

  // Estimación cross-planes con los mismos filtros aplicados (origen +
  // cliente). El filtro de status del listado NO afecta la estimación —
  // ésta siempre considera approved + ready_to_send, sin importar lo que
  // el usuario haya elegido en el chip de filtro de la tabla.
  const months = nextMonths(2);
  const prevMonth = previousMonth();
  const allEstimates = await getBillingEstimate({
    months: [prevMonth, ...months],
    budgetOriginId: validOrigin,
    clientId,
  });
  const previousEstimate = allEstimates.find((e) => e.month === prevMonth) ?? null;
  const estimates = allEstimates.filter((e) => e.month !== prevMonth);

  const counts = {
    draft: allPlans.filter((p) => p.status === "draft").length,
    ready_to_send: allPlans.filter((p) => p.status === "ready_to_send").length,
    approved: allPlans.filter((p) => p.status === "approved").length,
    archived: allPlans.filter((p) => p.status === "archived").length,
  };

  const titleLabel =
    lang === "es"
      ? client
        ? `Planes · ${client.name}`
        : "Todos los planes"
      : client
        ? `Plans · ${client.name}`
        : "All plans";
  const subtitleLabel =
    lang === "es"
      ? `Vista cross-proyectos del media planner. ${allPlans.length} plan${allPlans.length === 1 ? "" : "es"}${client ? ` de ${client.name}` : ""}.`
      : `Cross-project view for the media planner. ${allPlans.length} plan${allPlans.length === 1 ? "" : "s"}${client ? ` for ${client.name}` : ""}.`;

  return (
    <PageShell
      eyebrow={lang === "es" ? "Planes de Medios" : "Media Plans"}
      title={titleLabel}
      subtitle={subtitleLabel}
    >
      <BudgetOriginSelector
        origins={allOrigins}
        current={validOrigin}
        basePath="/planes"
        preserveParams={{ status: filter, client: client?.slug }}
      />

      <div className="flex flex-wrap items-center gap-2 mb-4 text-xs">
        <FilterPill label={lang === "es" ? "Estado" : "Status"}>
          <FilterChoice
            current={filter}
            value={undefined}
            label={`${lang === "es" ? "Todos" : "All"} (${allPlans.length})`}
            originId={validOrigin}
            clientSlug={client?.slug ?? null}
          />
          <FilterChoice
            current={filter}
            value="draft"
            label={`Draft (${counts.draft})`}
            originId={validOrigin}
            clientSlug={client?.slug ?? null}
          />
          <FilterChoice
            current={filter}
            value="ready_to_send"
            label={`Ready (${counts.ready_to_send})`}
            originId={validOrigin}
            clientSlug={client?.slug ?? null}
          />
          <FilterChoice
            current={filter}
            value="approved"
            label={`Approved (${counts.approved})`}
            originId={validOrigin}
            clientSlug={client?.slug ?? null}
          />
        </FilterPill>
      </div>

      {allPlans.length === 0 ? (
        <div className="rounded-lg border border-line border-dashed bg-paper-2 px-5 py-12 text-center text-sm text-muted">
          {lang === "es"
            ? "Sin planes que coincidan con el filtro."
            : "No plans match the filter."}
        </div>
      ) : (
        <PlansTableClient plans={allPlans} lang={lang} />
      )}

      <BillingEstimateCard
        estimates={estimates}
        previousMonth={previousEstimate}
        lang={lang}
      />
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

function FilterChoice({
  current,
  value,
  label,
  originId,
  clientSlug,
}: {
  current: string | undefined;
  value: string | undefined;
  label: string;
  originId: string | null;
  clientSlug: string | null;
}) {
  const isActive = (current ?? null) === (value ?? null);
  const params = new URLSearchParams();
  if (value) params.set("status", value);
  if (originId) params.set("origin", originId);
  if (clientSlug) params.set("client", clientSlug);
  const qs = params.toString();
  const href = qs ? `/planes?${qs}` : "/planes";
  return (
    <Link
      href={href}
      data-active={isActive}
      className="px-2 py-0.5 rounded text-muted hover:text-ink data-[active=true]:bg-white dark:data-[active=true]:bg-paper-2 dark:bg-paper-2 data-[active=true]:text-ink data-[active=true]:shadow-sm transition-colors"
    >
      {label}
    </Link>
  );
}

void formatUsdCompact;
