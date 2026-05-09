import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  clients,
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

export type DashboardProjectRow = {
  id: string;
  code: string;
  name: string;
  clientName: string;
  status: (typeof projects.$inferSelect)["status"];
  totalBudgetUsd: number;
  spentUsd: number;
  consumptionPct: number;
  planCount: number;
  monthlySpend: number[];
};

export type DashboardProjects = {
  rows: DashboardProjectRow[];
  monthLabels: string[];
};

export async function getDashboardProjects(): Promise<DashboardProjects> {
  // Totales por proyecto: pipeline + spent agregado.
  const totals = await db
    .select({
      id: projects.id,
      code: projects.code,
      name: projects.name,
      clientName: clients.name,
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
    .groupBy(projects.id, clients.name)
    .orderBy(asc(projects.code));

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
      status: t.status,
      totalBudgetUsd: total,
      spentUsd: spent,
      consumptionPct: total > 0 ? (spent / total) * 100 : 0,
      planCount: t.planCount,
      monthlySpend,
    };
  });

  return { rows, monthLabels };
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

  // Proyectado: para cada plan approved con períodos, prorratear el
  // total_planned_usd (sumado de mediaPlanPublishers) entre los meses
  // del período del plan.
  const planTotals = await db
    .select({
      planId: mediaPlans.id,
      periodStart: mediaPlans.periodStart,
      periodEnd: mediaPlans.periodEnd,
      total: sql<string>`coalesce(sum(${mediaPlanPublishers.totalPlannedUsd}), 0)`,
    })
    .from(mediaPlans)
    .innerJoin(
      mediaPlanPublishers,
      eq(mediaPlanPublishers.mediaPlanId, mediaPlans.id),
    )
    .where(eq(mediaPlans.status, "approved"))
    .groupBy(mediaPlans.id);

  const projectedByMonth: Record<string, number> = {};
  for (const p of planTotals) {
    if (!p.periodStart || !p.periodEnd) continue;
    const months = enumerateMonths(
      p.periodStart.slice(0, 7),
      p.periodEnd.slice(0, 7),
    );
    if (months.length === 0) continue;
    const monthly = Number.parseFloat(p.total) / months.length;
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

// Mantener export para no romper imports en pages.
export { mediaPlanPlacements as _placements };
