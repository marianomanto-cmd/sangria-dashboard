import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  clients,
  mediaPlanFees,
  mediaPlanPlacements,
  mediaPlanPublishers,
  mediaPlans,
  planBillingFees,
  planBillingPublishers,
  planBillings,
  projects,
  publishers,
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

export async function getDashboardKpis(
  options: { clientId?: string | null } = {},
): Promise<DashboardKpis> {
  const yearStartMonth = `${new Date().getFullYear()}-01`;
  const filterClient = options.clientId ?? null;

  const projectsActive = filterClient
    ? and(eq(projects.status, "active"), eq(projects.clientId, filterClient))
    : eq(projects.status, "active");

  const [pipelineRow] = await db
    .select({
      value: sql<string>`coalesce(sum(${projects.totalGrossBudgetUsd}), 0)`,
    })
    .from(projects)
    .where(projectsActive);

  const [clientsRow] = await db
    .select({
      value: sql<number>`count(distinct ${projects.clientId})::int`,
    })
    .from(projects)
    .where(projectsActive);

  const [invoicedRow] = await db
    .select({
      value: sql<string>`coalesce(sum(${planBillings.totalUsd}), 0)`,
    })
    .from(planBillings)
    .innerJoin(mediaPlans, eq(planBillings.mediaPlanId, mediaPlans.id))
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
    .where(
      and(
        inArray(planBillings.status, ["sent", "paid"]),
        sql`${planBillings.month} >= ${yearStartMonth}`,
        ...(filterClient ? [eq(projects.clientId, filterClient)] : []),
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
    .where(projectsActive);

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

export type PublisherBreakdownRow = {
  publisherId: string;
  publisherName: string;
  plannedUsd: number;
  billedUsd: number;
  pendingUsd: number;
};

export type FeeBreakdownRow = {
  feeId: string;
  feeType: (typeof mediaPlanFees.$inferSelect)["feeType"];
  feeName: string;
  totalUsd: number;
  billedUsd: number;
  pendingUsd: number;
  isAutoComputed: boolean; // true para management con ratePct
};

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
  // Para drilldown del proyecto: facturado / pendiente por publisher y fee.
  // Solo cuenta facturas con status sent/paid; drafts no son "facturado".
  billedTotalUsd: number;
  pendingTotalUsd: number;
  publisherBreakdown: PublisherBreakdownRow[];
  feeBreakdown: FeeBreakdownRow[];
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
  options: { budgetOriginId?: string | null; clientId?: string | null } = {},
): Promise<DashboardProjects> {
  const filterOrigin = options.budgetOriginId ?? null;
  const filterClient = options.clientId ?? null;
  const conds = [
    ...(filterOrigin ? [eq(projects.budgetOriginId, filterOrigin)] : []),
    ...(filterClient ? [eq(projects.clientId, filterClient)] : []),
  ];
  const totalsWhere =
    conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);

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

  const totals = await (totalsWhere ? totalsBase.where(totalsWhere) : totalsBase);

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

  const [
    feeData,
    spentData,
    publisherRows,
    feeRows,
    billedByPub,
    billedByFee,
  ] = await Promise.all([
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
    // Publishers per plan con planned
    db
      .select({
        planId: mediaPlanPublishers.mediaPlanId,
        publisherId: mediaPlanPublishers.publisherId,
        publisherName: publishers.name,
        plannedUsd: mediaPlanPublishers.totalPlannedUsd,
        sortOrder: publishers.sortOrder,
      })
      .from(mediaPlanPublishers)
      .innerJoin(publishers, eq(mediaPlanPublishers.publisherId, publishers.id))
      .where(inArray(mediaPlanPublishers.mediaPlanId, planIds))
      .orderBy(asc(publishers.sortOrder)),
    // Fees per plan
    db
      .select()
      .from(mediaPlanFees)
      .where(inArray(mediaPlanFees.mediaPlanId, planIds))
      .orderBy(asc(mediaPlanFees.sortOrder)),
    // Facturado por (plan, publisher) en facturas sent/paid
    db
      .select({
        planId: planBillings.mediaPlanId,
        publisherId: planBillingPublishers.publisherId,
        billed: sql<string>`coalesce(sum(${planBillingPublishers.amountRealUsd}) filter (where ${planBillingPublishers.isBillable}), 0)`,
      })
      .from(planBillingPublishers)
      .innerJoin(
        planBillings,
        eq(planBillingPublishers.planBillingId, planBillings.id),
      )
      .where(
        and(
          inArray(planBillings.mediaPlanId, planIds),
          inArray(planBillings.status, ["sent", "paid"]),
        ),
      )
      .groupBy(planBillings.mediaPlanId, planBillingPublishers.publisherId),
    // Facturado por fee
    db
      .select({
        feeId: planBillingFees.mediaPlanFeeId,
        billed: sql<string>`coalesce(sum(${planBillingFees.amountImputedUsd}), 0)`,
      })
      .from(planBillingFees)
      .innerJoin(
        planBillings,
        eq(planBillingFees.planBillingId, planBillings.id),
      )
      .where(
        and(
          inArray(planBillings.mediaPlanId, planIds),
          inArray(planBillings.status, ["sent", "paid"]),
        ),
      )
      .groupBy(planBillingFees.mediaPlanFeeId),
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
  const billedByPubKey = new Map(
    billedByPub.map((b) => [
      `${b.planId}::${b.publisherId}`,
      Number.parseFloat(b.billed),
    ]),
  );
  const billedByFeeKey = new Map(
    billedByFee.map((b) => [b.feeId, Number.parseFloat(b.billed)]),
  );

  // Index publishers and fees by planId
  const publishersByPlan = new Map<string, typeof publisherRows>();
  for (const r of publisherRows) {
    const list = publishersByPlan.get(r.planId) ?? [];
    list.push(r);
    publishersByPlan.set(r.planId, list);
  }
  const feesByPlanRows = new Map<string, typeof feeRows>();
  for (const r of feeRows) {
    const list = feesByPlanRows.get(r.mediaPlanId) ?? [];
    list.push(r);
    feesByPlanRows.set(r.mediaPlanId, list);
  }

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

    // Publishers breakdown
    const pubs = publishersByPlan.get(p.id) ?? [];
    const publisherBreakdown: PublisherBreakdownRow[] = pubs.map((pp) => {
      const planned = Number.parseFloat(pp.plannedUsd);
      const billed = billedByPubKey.get(`${p.id}::${pp.publisherId}`) ?? 0;
      return {
        publisherId: pp.publisherId,
        publisherName: pp.publisherName,
        plannedUsd: planned,
        billedUsd: billed,
        pendingUsd: Math.max(0, planned - billed),
      };
    });

    // Fees breakdown
    const feeRowList = feesByPlanRows.get(p.id) ?? [];
    const feeBreakdown: FeeBreakdownRow[] = feeRowList.map((f) => {
      const ratePct = f.ratePct ? Number.parseFloat(f.ratePct) : null;
      let total: number;
      let isAutoComputed = false;
      if (
        f.feeType === "management" &&
        ratePct != null &&
        ratePct > 0 &&
        ratePct < 100
      ) {
        total = (totalMedia * ratePct) / (100 - ratePct);
        isAutoComputed = true;
      } else {
        total = Number.parseFloat(f.amountUsd);
      }
      const billed = billedByFeeKey.get(f.id) ?? 0;
      return {
        feeId: f.id,
        feeType: f.feeType,
        feeName: f.name,
        totalUsd: total,
        billedUsd: billed,
        pendingUsd: Math.max(0, total - billed),
        isAutoComputed,
      };
    });

    const billedTotal =
      publisherBreakdown.reduce((s, x) => s + x.billedUsd, 0) +
      feeBreakdown.reduce((s, x) => s + x.billedUsd, 0);
    const pendingTotal =
      publisherBreakdown.reduce((s, x) => s + x.pendingUsd, 0) +
      feeBreakdown.reduce((s, x) => s + x.pendingUsd, 0);

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
      billedTotalUsd: billedTotal,
      pendingTotalUsd: pendingTotal,
      publisherBreakdown,
      feeBreakdown,
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

export async function getMonthlyTotals(
  options: { clientId?: string | null } = {},
): Promise<MonthlyTotal[]> {
  const filterClient = options.clientId ?? null;

  // Real por mes: agregamos los amountRealUsd de todos los plan_billings.
  const realRowsBase = db
    .select({
      month: planBillings.month,
      total: sql<string>`coalesce(sum(${planBillingPublishers.amountRealUsd}), 0)`,
    })
    .from(planBillings)
    .innerJoin(mediaPlans, eq(planBillings.mediaPlanId, mediaPlans.id))
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
    .leftJoin(
      planBillingPublishers,
      eq(planBillingPublishers.planBillingId, planBillings.id),
    )
    .groupBy(planBillings.month);
  const realRows = filterClient
    ? await realRowsBase.where(eq(projects.clientId, filterClient))
    : await realRowsBase;

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
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
    .where(
      filterClient
        ? and(eq(mediaPlans.status, "approved"), eq(projects.clientId, filterClient))
        : eq(mediaPlans.status, "approved"),
    );

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

// ────────────────────────────────────────────────────────────────────────────
// Estimación de facturación por mes para una lista de meses.
// Prorratea placements y fees de planes approved/ready_to_send a lo largo
// de los meses [startDate, endDate] del placement (o del período del plan
// para fees). Resta lo ya facturado (sent/paid) en ese mes para devolver
// la estimación neta pendiente.
// ────────────────────────────────────────────────────────────────────────────

export type MonthlyBillingEstimate = {
  month: string; // YYYY-MM
  grossUsd: number; // estimación bruta del mes
  alreadyBilledUsd: number; // ya facturado en ese mes (sent/paid)
  netUsd: number; // gross - alreadyBilled (mínimo 0)
  byProject: {
    projectId: string;
    projectCode: string;
    projectName: string;
    clientName: string;
    grossUsd: number;
    alreadyBilledUsd: number;
    netUsd: number;
  }[];
};

export async function getBillingEstimate(options: {
  months: string[]; // ["YYYY-MM", ...]
  budgetOriginId?: string | null;
  projectId?: string | null;
  clientId?: string | null;
}): Promise<MonthlyBillingEstimate[]> {
  const targetMonths = new Set(options.months);
  const filterOrigin = options.budgetOriginId ?? null;
  const filterProject = options.projectId ?? null;
  const filterClient = options.clientId ?? null;

  const planStatusFilter = inArray(mediaPlans.status, [
    "approved",
    "ready_to_send",
  ]);

  // 1. Placements con info de proyecto (planes approved / ready_to_send).
  const placementsBase = db
    .select({
      planId: mediaPlans.id,
      projectId: projects.id,
      projectCode: projects.code,
      projectName: projects.name,
      clientName: clients.name,
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
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
    .innerJoin(clients, eq(projects.clientId, clients.id));

  const placementWhere = and(
    planStatusFilter,
    ...(filterOrigin ? [eq(projects.budgetOriginId, filterOrigin)] : []),
    ...(filterProject ? [eq(projects.id, filterProject)] : []),
    ...(filterClient ? [eq(projects.clientId, filterClient)] : []),
  );
  const placements = await placementsBase.where(placementWhere);

  if (placements.length === 0) {
    return options.months.map((m) => ({
      month: m,
      grossUsd: 0,
      alreadyBilledUsd: 0,
      netUsd: 0,
      byProject: [],
    }));
  }

  // 2. Períodos por plan (para prorratear fees) + total media por plan
  const planPeriodMap = new Map<
    string,
    { startMonth: string; endMonth: string; totalMedia: number }
  >();
  for (const p of placements) {
    if (!p.startDate || !p.endDate) continue;
    const sm = p.startDate.slice(0, 7);
    const em = p.endDate.slice(0, 7);
    const cur = planPeriodMap.get(p.planId);
    const amt = Number.parseFloat(p.amount);
    if (!cur) {
      planPeriodMap.set(p.planId, {
        startMonth: sm,
        endMonth: em,
        totalMedia: amt,
      });
    } else {
      cur.startMonth = sm < cur.startMonth ? sm : cur.startMonth;
      cur.endMonth = em > cur.endMonth ? em : cur.endMonth;
      cur.totalMedia += amt;
    }
  }
  const planIds = Array.from(planPeriodMap.keys());

  // 3. Fees de esos planes
  const feeRows = planIds.length
    ? await db
        .select()
        .from(mediaPlanFees)
        .where(inArray(mediaPlanFees.mediaPlanId, planIds))
    : [];

  // 4. Mapa proyecto por planId (para asignar fees al proyecto correcto)
  const projectByPlan = new Map<
    string,
    {
      projectId: string;
      projectCode: string;
      projectName: string;
      clientName: string;
    }
  >();
  for (const p of placements) {
    if (!projectByPlan.has(p.planId)) {
      projectByPlan.set(p.planId, {
        projectId: p.projectId,
        projectCode: p.projectCode,
        projectName: p.projectName,
        clientName: p.clientName,
      });
    }
  }

  // 5. Acumular gross por (mes, proyecto) prorrateando placements + fees
  type ProjectAgg = {
    projectId: string;
    projectCode: string;
    projectName: string;
    clientName: string;
    gross: number;
    billed: number;
  };
  const monthBuckets = new Map<string, Map<string, ProjectAgg>>();

  const addToBucket = (
    month: string,
    proj: {
      projectId: string;
      projectCode: string;
      projectName: string;
      clientName: string;
    },
    amount: number,
  ) => {
    if (!targetMonths.has(month)) return;
    let projMap = monthBuckets.get(month);
    if (!projMap) {
      projMap = new Map();
      monthBuckets.set(month, projMap);
    }
    const cur = projMap.get(proj.projectId);
    if (cur) {
      cur.gross += amount;
    } else {
      projMap.set(proj.projectId, {
        projectId: proj.projectId,
        projectCode: proj.projectCode,
        projectName: proj.projectName,
        clientName: proj.clientName,
        gross: amount,
        billed: 0,
      });
    }
  };

  // 5a. Placements
  for (const p of placements) {
    if (!p.startDate || !p.endDate) continue;
    const months = enumerateMonths(
      p.startDate.slice(0, 7),
      p.endDate.slice(0, 7),
    );
    if (months.length === 0) continue;
    const monthly = Number.parseFloat(p.amount) / months.length;
    for (const m of months) {
      addToBucket(m, p, monthly);
    }
  }

  // 5b. Fees prorrateados sobre el período del plan
  for (const f of feeRows) {
    const period = planPeriodMap.get(f.mediaPlanId);
    const proj = projectByPlan.get(f.mediaPlanId);
    if (!period || !proj) continue;
    const months = enumerateMonths(period.startMonth, period.endMonth);
    if (months.length === 0) continue;
    const ratePct = f.ratePct ? Number.parseFloat(f.ratePct) : null;
    let totalFee: number;
    if (
      f.feeType === "management" &&
      ratePct != null &&
      ratePct > 0 &&
      ratePct < 100
    ) {
      totalFee = (period.totalMedia * ratePct) / (100 - ratePct);
    } else {
      totalFee = Number.parseFloat(f.amountUsd);
    }
    if (totalFee <= 0) continue;
    const monthly = totalFee / months.length;
    for (const m of months) {
      addToBucket(m, proj, monthly);
    }
  }

  // 6. Ya facturado por mes y proyecto (sent/paid)
  const billedBase = db
    .select({
      month: planBillings.month,
      projectId: projects.id,
      pubBilled: sql<string>`coalesce(sum(${planBillingPublishers.amountRealUsd}) filter (where ${planBillingPublishers.isBillable}), 0)`,
    })
    .from(planBillings)
    .innerJoin(mediaPlans, eq(planBillings.mediaPlanId, mediaPlans.id))
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
    .leftJoin(
      planBillingPublishers,
      eq(planBillingPublishers.planBillingId, planBillings.id),
    )
    .where(
      and(
        inArray(planBillings.month, options.months),
        inArray(planBillings.status, ["sent", "paid"]),
        ...(filterOrigin
          ? [eq(projects.budgetOriginId, filterOrigin)]
          : []),
        ...(filterProject ? [eq(projects.id, filterProject)] : []),
        ...(filterClient ? [eq(projects.clientId, filterClient)] : []),
      ),
    )
    .groupBy(planBillings.month, projects.id);

  const billedFeesBase = db
    .select({
      month: planBillings.month,
      projectId: projects.id,
      feeBilled: sql<string>`coalesce(sum(${planBillingFees.amountImputedUsd}), 0)`,
    })
    .from(planBillings)
    .innerJoin(mediaPlans, eq(planBillings.mediaPlanId, mediaPlans.id))
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
    .leftJoin(
      planBillingFees,
      eq(planBillingFees.planBillingId, planBillings.id),
    )
    .where(
      and(
        inArray(planBillings.month, options.months),
        inArray(planBillings.status, ["sent", "paid"]),
        ...(filterOrigin
          ? [eq(projects.budgetOriginId, filterOrigin)]
          : []),
        ...(filterProject ? [eq(projects.id, filterProject)] : []),
        ...(filterClient ? [eq(projects.clientId, filterClient)] : []),
      ),
    )
    .groupBy(planBillings.month, projects.id);

  const [billedPubRows, billedFeeRows] = await Promise.all([
    billedBase,
    billedFeesBase,
  ]);

  for (const r of billedPubRows) {
    if (!targetMonths.has(r.month)) continue;
    const projMap = monthBuckets.get(r.month);
    if (!projMap) continue;
    const cur = projMap.get(r.projectId);
    if (cur) cur.billed += Number.parseFloat(r.pubBilled);
  }
  for (const r of billedFeeRows) {
    if (!targetMonths.has(r.month)) continue;
    const projMap = monthBuckets.get(r.month);
    if (!projMap) continue;
    const cur = projMap.get(r.projectId);
    if (cur) cur.billed += Number.parseFloat(r.feeBilled);
  }

  // 7. Construir respuesta ordenada como options.months
  return options.months.map((m) => {
    const projMap = monthBuckets.get(m);
    const byProject = projMap
      ? Array.from(projMap.values())
          .map((p) => ({
            projectId: p.projectId,
            projectCode: p.projectCode,
            projectName: p.projectName,
            clientName: p.clientName,
            grossUsd: p.gross,
            alreadyBilledUsd: p.billed,
            netUsd: Math.max(0, p.gross - p.billed),
          }))
          .sort((a, b) => b.netUsd - a.netUsd)
      : [];
    const grossUsd = byProject.reduce((s, p) => s + p.grossUsd, 0);
    const alreadyBilledUsd = byProject.reduce(
      (s, p) => s + p.alreadyBilledUsd,
      0,
    );
    return {
      month: m,
      grossUsd,
      alreadyBilledUsd,
      netUsd: Math.max(0, grossUsd - alreadyBilledUsd),
      byProject,
    };
  });
}
