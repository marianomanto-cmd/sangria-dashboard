import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  clients,
  mediaPlanFees,
  mediaPlanPlacements,
  mediaPlanPublishers,
  mediaPlans,
  planBillingPublishers,
  planBillings,
  projects,
} from "@/db/schema";

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function enumerateMonths(start: string, end: string): string[] {
  const out: string[] = [];
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// KPIs del dashboard
// ────────────────────────────────────────────────────────────────────────────

export type DashboardKpis = {
  pipelineActiveUsd: number;
  activeClients: number;
  invoicedYtdUsd: number;
  consumptionPct: number;
};

export async function getDashboardKpis(): Promise<DashboardKpis> {
  const yearStartMonth = `${new Date().getFullYear()}-01`;

  const [pipelineRow] = await db
    .select({
      value: sql<string>`coalesce(sum(${projects.totalGrossBudgetUsd}), 0)`,
    })
    .from(projects)
    .where(eq(projects.status, "active"));

  const [clientsRow] = await db
    .select({
      value: sql<number>`count(distinct ${projects.clientId})::int`,
    })
    .from(projects)
    .where(eq(projects.status, "active"));

  const [invoicedRow] = await db
    .select({
      value: sql<string>`coalesce(sum(${planBillings.totalUsd}), 0)`,
    })
    .from(planBillings)
    .where(
      and(
        inArray(planBillings.status, ["sent", "paid"]),
        sql`${planBillings.month} >= ${yearStartMonth}`,
      ),
    );

  const [consumptionRow] = await db
    .select({
      spent: sql<string>`coalesce(sum(${planBillingPublishers.amountRealUsd}), 0)`,
    })
    .from(planBillingPublishers)
    .innerJoin(planBillings, eq(planBillingPublishers.planBillingId, planBillings.id))
    .innerJoin(mediaPlans, eq(planBillings.mediaPlanId, mediaPlans.id))
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
    .where(eq(projects.status, "active"));

  const pipeline = Number.parseFloat(pipelineRow.value);
  const spent = Number.parseFloat(consumptionRow.spent);
  const consumptionPct = pipeline > 0 ? (spent / pipeline) * 100 : 0;

  return {
    pipelineActiveUsd: pipeline,
    activeClients: clientsRow.value,
    invoicedYtdUsd: Number.parseFloat(invoicedRow.value),
    consumptionPct,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Tabla de proyectos del dashboard. Cada proyecto agrega su gasto a través
// de TODOS sus planes (peers).
// ────────────────────────────────────────────────────────────────────────────

export type DashboardPlanSummary = {
  id: string;
  name: string;
  status: (typeof mediaPlans.$inferSelect)["status"];
  currentVersion: number;
  periodStart: string | null;
  periodEnd: string | null;
  totalMediaUsd: number;
  totalFeesUsd: number;
  totalUsd: number;
  spentRealUsd: number;
};

export type DashboardProjectRow = {
  id: string;
  code: string;
  name: string;
  clientName: string;
  clientSlug: string;
  status: (typeof projects.$inferSelect)["status"];
  totalBudgetUsd: number;
  spentUsd: number;
  consumptionPct: number;
  planCount: number;
  monthlySpend: number[];
  plans: DashboardPlanSummary[];
};

export type DashboardProjects = {
  rows: DashboardProjectRow[];
  monthLabels: string[];
};

export async function getDashboardProjects(
  options: { budgetOriginId?: string | null } = {},
): Promise<DashboardProjects> {
  const filterOrigin = options.budgetOriginId ?? null;

  // Totales por proyecto: pipeline + spent agregado.
  const totalsBase = db
    .select({
      id: projects.id,
      code: projects.code,
      name: projects.name,
      clientName: clients.name,
      clientSlug: clients.slug,
      status: projects.status,
      totalBudgetUsd: projects.totalGrossBudgetUsd,
      spentUsd: sql<string>`coalesce(sum(${planBillingPublishers.amountRealUsd}), 0)`,
      planCount: sql<number>`count(distinct ${mediaPlans.id})::int`,
    })
    .from(projects)
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .leftJoin(mediaPlans, eq(mediaPlans.projectId, projects.id))
    .leftJoin(planBillings, eq(planBillings.mediaPlanId, mediaPlans.id))
    .leftJoin(
      planBillingPublishers,
      eq(planBillingPublishers.planBillingId, planBillings.id),
    )
    .groupBy(projects.id, clients.name, clients.slug)
    .orderBy(asc(projects.code));

  const totals = await (filterOrigin
    ? totalsBase.where(eq(projects.budgetOriginId, filterOrigin))
    : totalsBase);

  // Spend mensual por proyecto.
  const monthly = await db
    .select({
      projectId: projects.id,
      month: planBillings.month,
      total: sql<string>`coalesce(sum(${planBillingPublishers.amountRealUsd}), 0)`,
    })
    .from(projects)
    .innerJoin(mediaPlans, eq(mediaPlans.projectId, projects.id))
    .innerJoin(planBillings, eq(planBillings.mediaPlanId, mediaPlans.id))
    .innerJoin(
      planBillingPublishers,
      eq(planBillingPublishers.planBillingId, planBillings.id),
    )
    .groupBy(projects.id, planBillings.month);

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

  // Plans summary per project (3 queries en batch para todos los planes).
  const projectIds = totals.map((t) => t.id);
  const plansByProject = await getPlansSummaryForProjects(projectIds);

  const rows: DashboardProjectRow[] = totals.map((t) => {
    const total = Number.parseFloat(t.totalBudgetUsd ?? "0");
    const spent = Number.parseFloat(t.spentUsd);
    const monthMap = byProject.get(t.id);
    const monthlySpend = monthLabels.map((m) => monthMap?.get(m) ?? 0);
    return {
      id: t.id,
      code: t.code,
      name: t.name,
      clientName: t.clientName,
      clientSlug: t.clientSlug,
      status: t.status,
      totalBudgetUsd: total,
      spentUsd: spent,
      consumptionPct: total > 0 ? (spent / total) * 100 : 0,
      planCount: t.planCount,
      monthlySpend,
      plans: plansByProject.get(t.id) ?? [],
    };
  });

  return { rows, monthLabels };
}

// ────────────────────────────────────────────────────────────────────────────
// Plans summary in batch — 3 queries para sumar info de N planes a la vez.
// Usado por /proyectos y por el Dashboard para mostrar planes en cada fila.
// ────────────────────────────────────────────────────────────────────────────

async function getPlansSummaryForProjects(
  projectIds: string[],
): Promise<Map<string, DashboardPlanSummary[]>> {
  if (projectIds.length === 0) return new Map();

  const planRows = await db
    .select({
      id: mediaPlans.id,
      projectId: mediaPlans.projectId,
      name: mediaPlans.name,
      status: mediaPlans.status,
      currentVersion: mediaPlans.currentVersion,
      createdAt: mediaPlans.createdAt,
      totalMediaUsd: sql<string>`coalesce(sum(${mediaPlanPublishers.totalPlannedUsd}), 0)`,
      periodStart: sql<string | null>`min(${mediaPlanPlacements.startDate})::text`,
      periodEnd: sql<string | null>`max(${mediaPlanPlacements.endDate})::text`,
    })
    .from(mediaPlans)
    .leftJoin(
      mediaPlanPublishers,
      eq(mediaPlanPublishers.mediaPlanId, mediaPlans.id),
    )
    .leftJoin(
      mediaPlanPlacements,
      eq(mediaPlanPlacements.mediaPlanPublisherId, mediaPlanPublishers.id),
    )
    .where(inArray(mediaPlans.projectId, projectIds))
    .groupBy(mediaPlans.id)
    .orderBy(asc(mediaPlans.createdAt));

  if (planRows.length === 0) return new Map();
  const planIds = planRows.map((p) => p.id);

  const [feeData, spentData] = await Promise.all([
    db
      .select({
        planId: mediaPlanFees.mediaPlanId,
        fixedTotal: sql<string>`coalesce(sum(${mediaPlanFees.amountUsd}) filter (where ${mediaPlanFees.ratePct} is null or ${mediaPlanFees.feeType} != 'management'), 0)`,
        mgmtRatePct: sql<string | null>`max(${mediaPlanFees.ratePct}) filter (where ${mediaPlanFees.feeType} = 'management')::text`,
      })
      .from(mediaPlanFees)
      .where(inArray(mediaPlanFees.mediaPlanId, planIds))
      .groupBy(mediaPlanFees.mediaPlanId),
    db
      .select({
        planId: planBillings.mediaPlanId,
        spent: sql<string>`coalesce(sum(${planBillingPublishers.amountRealUsd}), 0)`,
      })
      .from(planBillings)
      .leftJoin(
        planBillingPublishers,
        eq(planBillingPublishers.planBillingId, planBillings.id),
      )
      .where(inArray(planBillings.mediaPlanId, planIds))
      .groupBy(planBillings.mediaPlanId),
  ]);

  const feesByPlan = new Map(
    feeData.map((f) => [
      f.planId,
      {
        fixed: Number.parseFloat(f.fixedTotal),
        mgmtRatePct: f.mgmtRatePct ? Number.parseFloat(f.mgmtRatePct) : null,
      },
    ]),
  );
  const spentByPlan = new Map(
    spentData.map((s) => [s.planId, Number.parseFloat(s.spent)]),
  );

  const result = new Map<string, DashboardPlanSummary[]>();
  for (const p of planRows) {
    const totalMedia = Number.parseFloat(p.totalMediaUsd);
    const fee = feesByPlan.get(p.id);
    const fixedFees = fee?.fixed ?? 0;
    const mgmtFee =
      fee?.mgmtRatePct != null && fee.mgmtRatePct < 100
        ? (totalMedia * fee.mgmtRatePct) / (100 - fee.mgmtRatePct)
        : 0;
    const totalFees = fixedFees + mgmtFee;
    const summary: DashboardPlanSummary = {
      id: p.id,
      name: p.name,
      status: p.status,
      currentVersion: p.currentVersion,
      periodStart: p.periodStart,
      periodEnd: p.periodEnd,
      totalMediaUsd: totalMedia,
      totalFeesUsd: totalFees,
      totalUsd: totalMedia + totalFees,
      spentRealUsd: spentByPlan.get(p.id) ?? 0,
    };
    const list = result.get(p.projectId) ?? [];
    list.push(summary);
    result.set(p.projectId, list);
  }

  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// Totales mensuales para el chart: real (de plan_billing_publishers) vs
// proyectado (prorrata de planes approved a sus meses activos).
// ────────────────────────────────────────────────────────────────────────────

export type MonthlyTotal = {
  month: string;
  real: number;
  projected: number;
};

export async function getMonthlyTotals(): Promise<MonthlyTotal[]> {
  // Real por mes: agregamos los amountRealUsd de todos los plan_billings.
  const realRows = await db
    .select({
      month: planBillings.month,
      total: sql<string>`coalesce(sum(${planBillingPublishers.amountRealUsd}), 0)`,
    })
    .from(planBillings)
    .leftJoin(
      planBillingPublishers,
      eq(planBillingPublishers.planBillingId, planBillings.id),
    )
    .groupBy(planBillings.month);

  // Proyectado: para cada plan approved, prorrateamos el budget de cada
  // PLACEMENT entre los meses de su [start, end] (el período del plan ya
  // no se almacena, se deriva). Si dos placements del mismo mes contribuyen,
  // se suman.
  const placementSpans = await db
    .select({
      planId: mediaPlans.id,
      startDate: mediaPlanPlacements.startDate,
      endDate: mediaPlanPlacements.endDate,
      amount: mediaPlanPlacements.amountUsd,
    })
    .from(mediaPlanPlacements)
    .innerJoin(
      mediaPlanPublishers,
      eq(mediaPlanPlacements.mediaPlanPublisherId, mediaPlanPublishers.id),
    )
    .innerJoin(mediaPlans, eq(mediaPlanPublishers.mediaPlanId, mediaPlans.id))
    .where(eq(mediaPlans.status, "approved"));

  const projectedByMonth: Record<string, number> = {};
  for (const p of placementSpans) {
    if (!p.startDate || !p.endDate) continue;
    const months = enumerateMonths(
      p.startDate.slice(0, 7),
      p.endDate.slice(0, 7),
    );
    if (months.length === 0) continue;
    const monthly = Number.parseFloat(p.amount) / months.length;
    for (const m of months) {
      projectedByMonth[m] = (projectedByMonth[m] ?? 0) + monthly;
    }
  }

  const allMonths = Array.from(
    new Set([...realRows.map((r) => r.month), ...Object.keys(projectedByMonth)]),
  ).sort();

  const realByMonth = Object.fromEntries(
    realRows.map((r) => [r.month, Number.parseFloat(r.total)]),
  );

  return allMonths.map((month) => ({
    month,
    real: realByMonth[month] ?? 0,
    projected: projectedByMonth[month] ?? 0,
  }));
}

