import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  budgetOrigins,
  clients,
  mediaPlanPlacements,
  mediaPlanPublishers,
  mediaPlans,
  planBillingPublishers,
  planBillings,
  projects,
} from "@/db/schema";

export type ClientDetailKpis = {
  totalProjects: number;
  activeProjects: number;
  pipelineActiveUsd: number;
  spentUsd: number;
  consumptionPct: number;
};

export type ClientDetailProject = {
  id: string;
  code: string;
  name: string;
  status: (typeof projects.$inferSelect)["status"];
  startDate: string | null;
  endDate: string | null;
  totalBudgetUsd: number;
  spentUsd: number;
  consumptionPct: number;
  planCount: number;
};

export type ClientDetail = {
  client: typeof clients.$inferSelect;
  origins: (typeof budgetOrigins.$inferSelect)[];
  selectedOriginId: string | null;
  projects: ClientDetailProject[];
  kpis: ClientDetailKpis;
};

export async function getClientDetail(
  slug: string,
  originFilter: string | null,
): Promise<ClientDetail | null> {
  const [client] = await db
    .select()
    .from(clients)
    .where(eq(clients.slug, slug))
    .limit(1);

  if (!client) return null;

  const origins = await db
    .select()
    .from(budgetOrigins)
    .where(eq(budgetOrigins.clientId, client.id))
    .orderBy(asc(budgetOrigins.name));

  const selectedOriginId =
    originFilter && origins.some((o) => o.id === originFilter)
      ? originFilter
      : null;

  const filterConds = [eq(projects.clientId, client.id)];
  if (selectedOriginId) {
    filterConds.push(eq(projects.budgetOriginId, selectedOriginId));
  }
  const filterClause = and(...filterConds);

  // El endDate del proyecto se deriva del placement con fecha más lejana
  // de TODOS los planes del proyecto. Lo computamos en una query separada
  // para mantener el SQL simple.
  const totals = await db
    .select({
      id: projects.id,
      code: projects.code,
      name: projects.name,
      status: projects.status,
      startDate: projects.startDate,
      totalBudgetUsd: projects.totalGrossBudgetUsd,
      spentUsd: sql<string>`coalesce(sum(${planBillingPublishers.amountRealUsd}), 0)`,
      planCount: sql<number>`count(distinct ${mediaPlans.id})::int`,
    })
    .from(projects)
    .leftJoin(mediaPlans, eq(mediaPlans.projectId, projects.id))
    .leftJoin(planBillings, eq(planBillings.mediaPlanId, mediaPlans.id))
    .leftJoin(
      planBillingPublishers,
      eq(planBillingPublishers.planBillingId, planBillings.id),
    )
    .where(filterClause)
    .groupBy(projects.id)
    .orderBy(asc(projects.code));

  const projectEndDates = await db
    .select({
      projectId: projects.id,
      endDate: sql<string | null>`max(${mediaPlanPlacements.endDate})::text`,
    })
    .from(projects)
    .innerJoin(mediaPlans, eq(mediaPlans.projectId, projects.id))
    .innerJoin(
      mediaPlanPublishers,
      eq(mediaPlanPublishers.mediaPlanId, mediaPlans.id),
    )
    .innerJoin(
      mediaPlanPlacements,
      eq(mediaPlanPlacements.mediaPlanPublisherId, mediaPlanPublishers.id),
    )
    .where(filterClause)
    .groupBy(projects.id);
  const endDateByProject = new Map(
    projectEndDates.map((r) => [r.projectId, r.endDate]),
  );

  const projectsRows: ClientDetailProject[] = totals.map((t) => {
    const total = Number.parseFloat(t.totalBudgetUsd ?? "0");
    const spent = Number.parseFloat(t.spentUsd);
    return {
      id: t.id,
      code: t.code,
      name: t.name,
      status: t.status,
      startDate: t.startDate,
      endDate: endDateByProject.get(t.id) ?? null,
      totalBudgetUsd: total,
      spentUsd: spent,
      consumptionPct: total > 0 ? (spent / total) * 100 : 0,
      planCount: t.planCount,
    };
  });

  const totalProjects = projectsRows.length;
  const activeProjects = projectsRows.filter((p) => p.status === "active").length;
  const pipelineActiveUsd = projectsRows
    .filter((p) => p.status === "active")
    .reduce((s, p) => s + p.totalBudgetUsd, 0);
  const spentUsd = projectsRows
    .filter((p) => p.status === "active")
    .reduce((s, p) => s + p.spentUsd, 0);


  return {
    client,
    origins,
    selectedOriginId,
    projects: projectsRows,
    kpis: {
      totalProjects,
      activeProjects,
      pipelineActiveUsd,
      spentUsd,
      consumptionPct:
        pipelineActiveUsd > 0 ? (spentUsd / pipelineActiveUsd) * 100 : 0,
    },
  };
}
