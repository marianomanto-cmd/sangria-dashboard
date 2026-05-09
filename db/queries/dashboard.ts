import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  actualSpend,
  billings,
  clients,
  mediaPlanLines,
  mediaPlans,
  projects,
} from "@/db/schema";

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function enumerateMonths(start: string, end: string): string[] {
  // start, end en formato 'YYYY-MM'. Devuelve array de meses inclusivo.
  const result: string[] = [];
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    result.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return result;
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
      value: sql<string>`coalesce(sum(${projects.totalBudgetUsd}), 0)`,
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
      value: sql<string>`coalesce(sum(${billings.totalUsd}), 0)`,
    })
    .from(billings)
    .where(
      and(
        inArray(billings.status, ["sent", "paid"]),
        sql`${billings.month} >= ${yearStartMonth}`,
      ),
    );

  const [consumptionRow] = await db
    .select({
      spent: sql<string>`coalesce(sum(${actualSpend.amountUsd}), 0)`,
    })
    .from(actualSpend)
    .innerJoin(
      mediaPlanLines,
      eq(actualSpend.mediaPlanLineId, mediaPlanLines.id),
    )
    .innerJoin(mediaPlans, eq(mediaPlanLines.mediaPlanId, mediaPlans.id))
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
// Tabla de proyectos + sparklines (un mes por dato)
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
  monthlySpend: number[]; // alineado con monthLabels (ver getDashboardProjects)
};

export type DashboardProjects = {
  rows: DashboardProjectRow[];
  monthLabels: string[];
};

export async function getDashboardProjects(): Promise<DashboardProjects> {
  // Totales por proyecto.
  const totals = await db
    .select({
      id: projects.id,
      code: projects.code,
      name: projects.name,
      clientName: clients.name,
      status: projects.status,
      totalBudgetUsd: projects.totalBudgetUsd,
      spentUsd: sql<string>`coalesce(sum(${actualSpend.amountUsd}), 0)`,
    })
    .from(projects)
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .leftJoin(mediaPlans, eq(mediaPlans.projectId, projects.id))
    .leftJoin(mediaPlanLines, eq(mediaPlanLines.mediaPlanId, mediaPlans.id))
    .leftJoin(actualSpend, eq(actualSpend.mediaPlanLineId, mediaPlanLines.id))
    .groupBy(projects.id, clients.name)
    .orderBy(asc(projects.code));

  // Spend mensual por proyecto.
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
    .groupBy(projects.id, actualSpend.month);

  const monthLabels = Array.from(
    new Set(monthly.map((r) => r.month)),
  ).sort();

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
      monthlySpend,
    };
  });

  return { rows, monthLabels };
}

// ────────────────────────────────────────────────────────────────────────────
// Totales mensuales: real (de actualSpend) vs proyectado (prorrata del plan)
// ────────────────────────────────────────────────────────────────────────────

export type MonthlyTotal = {
  month: string; // 'YYYY-MM'
  real: number;
  projected: number;
};

export async function getMonthlyTotals(): Promise<MonthlyTotal[]> {
  // Real por mes.
  const realRows = await db
    .select({
      month: actualSpend.month,
      total: sql<string>`coalesce(sum(${actualSpend.amountUsd}), 0)`,
    })
    .from(actualSpend)
    .groupBy(actualSpend.month);

  // Proyectado: para cada línea de un plan approved, prorrata el budget
  // entre los meses [start, end] del placement.
  const lines = await db
    .select({
      startDate: mediaPlanLines.startDate,
      endDate: mediaPlanLines.endDate,
      budget: mediaPlanLines.budgetNetUsd,
    })
    .from(mediaPlanLines)
    .innerJoin(mediaPlans, eq(mediaPlanLines.mediaPlanId, mediaPlans.id))
    .where(eq(mediaPlans.status, "approved"));

  const projectedByMonth: Record<string, number> = {};
  for (const line of lines) {
    if (!line.startDate || !line.endDate) continue;
    const months = enumerateMonths(
      line.startDate.slice(0, 7),
      line.endDate.slice(0, 7),
    );
    if (months.length === 0) continue;
    const monthly = Number.parseFloat(line.budget) / months.length;
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
