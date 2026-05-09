import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  actualSpend,
  budgetOrigins,
  clients,
  mediaPlanLines,
  mediaPlans,
  projects,
} from "@/db/schema";

// ────────────────────────────────────────────────────────────────────────────
// Client detail — todo lo que necesita /clientes/[slug]:
//   · client
//   · budget origins del cliente (para los tabs)
//   · proyectos filtrados por (clientId, opcionalmente originId) + sus
//     totales de gasto + serie mensual (sparkline)
//   · KPIs derivados
// ────────────────────────────────────────────────────────────────────────────

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
  monthlySpend: number[];
};

export type ClientDetail = {
  client: typeof clients.$inferSelect;
  origins: (typeof budgetOrigins.$inferSelect)[];
  selectedOriginId: string | null;
  projects: ClientDetailProject[];
  monthLabels: string[];
  kpis: ClientDetailKpis;
};

export async function getClientDetail(
  slug: string,
  originFilter: string | null,
): Promise<ClientDetail | null> {
  // 1. Client por slug.
  const [client] = await db
    .select()
    .from(clients)
    .where(eq(clients.slug, slug))
    .limit(1);

  if (!client) return null;

  // 2. Budget origins del cliente.
  const origins = await db
    .select()
    .from(budgetOrigins)
    .where(eq(budgetOrigins.clientId, client.id))
    .orderBy(asc(budgetOrigins.name));

  const selectedOriginId =
    originFilter && origins.some((o) => o.id === originFilter)
      ? originFilter
      : null;

  // 3. Proyectos del cliente, opcionalmente filtrados por origin.
  const filterConds = [eq(projects.clientId, client.id)];
  if (selectedOriginId) {
    filterConds.push(eq(projects.budgetOriginId, selectedOriginId));
  }
  const filterClause = and(...filterConds);

  const totals = await db
    .select({
      id: projects.id,
      code: projects.code,
      name: projects.name,
      status: projects.status,
      startDate: projects.startDate,
      endDate: projects.endDate,
      totalBudgetUsd: projects.totalBudgetUsd,
      spentUsd: sql<string>`coalesce(sum(${actualSpend.amountUsd}), 0)`,
    })
    .from(projects)
    .leftJoin(mediaPlans, eq(mediaPlans.projectId, projects.id))
    .leftJoin(mediaPlanLines, eq(mediaPlanLines.mediaPlanId, mediaPlans.id))
    .leftJoin(actualSpend, eq(actualSpend.mediaPlanLineId, mediaPlanLines.id))
    .where(filterClause)
    .groupBy(projects.id)
    .orderBy(asc(projects.code));

  const monthly = await db
    .select({
      projectId: projects.id,
      month: actualSpend.month,
      total: sql<string>`coalesce(sum(${actualSpend.amountUsd}), 0)`,
    })
    .from(projects)
    .innerJoin(mediaPlans, eq(mediaPlans.projectId, projects.id))
    .innerJoin(
      mediaPlanLines,
      eq(mediaPlanLines.mediaPlanId, mediaPlans.id),
    )
    .innerJoin(
      actualSpend,
      eq(actualSpend.mediaPlanLineId, mediaPlanLines.id),
    )
    .where(filterClause)
    .groupBy(projects.id, actualSpend.month);

  const monthLabels = Array.from(new Set(monthly.map((r) => r.month))).sort();

  const byProject = new Map<string, Map<string, number>>();
  for (const r of monthly) {
    let m = byProject.get(r.projectId);
    if (!m) {
      m = new Map();
      byProject.set(r.projectId, m);
    }
    m.set(r.month, Number.parseFloat(r.total));
  }

  const projectsRows: ClientDetailProject[] = totals.map((t) => {
    const total = Number.parseFloat(t.totalBudgetUsd ?? "0");
    const spent = Number.parseFloat(t.spentUsd);
    const monthMap = byProject.get(t.id);
    const monthlySpend = monthLabels.map((m) => monthMap?.get(m) ?? 0);
    return {
      id: t.id,
      code: t.code,
      name: t.name,
      status: t.status,
      startDate: t.startDate,
      endDate: t.endDate,
      totalBudgetUsd: total,
      spentUsd: spent,
      consumptionPct: total > 0 ? (spent / total) * 100 : 0,
      monthlySpend,
    };
  });

  // 4. KPIs derivados de la selección.
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
    monthLabels,
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
