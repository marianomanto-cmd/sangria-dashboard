import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
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
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  // Defensa dura contra fechas malformadas (NaN / Infinity / fuera de rango),
  // p.ej. un placement con start_date '-infinity': al parsear, el mes queda NaN
  // y `NaN > 12` es false, por lo que el año nunca incrementa → loop infinito.
  if (
    !Number.isInteger(sy) ||
    !Number.isInteger(sm) ||
    !Number.isInteger(ey) ||
    !Number.isInteger(em) ||
    sm < 1 ||
    sm > 12 ||
    em < 1 ||
    em > 12
  ) {
    return [];
  }
  if (sy > ey || (sy === ey && sm > em)) return [];
  const out: string[] = [];
  let y = sy;
  let m = sm;
  // Tope de seguridad (100 años) para que NUNCA pueda colgar.
  for (let guard = 0; guard < 1200 && (y < ey || (y === ey && m <= em)); guard++) {
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
    .innerJoin(mediaPlans, and(eq(planBillings.mediaPlanId, mediaPlans.id), isNull(mediaPlans.deletedAt)))
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
    .where(
      and(
        inArray(planBillings.status, ["invoiced", "paid"]),
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
    .innerJoin(mediaPlans, and(eq(planBillings.mediaPlanId, mediaPlans.id), isNull(mediaPlans.deletedAt)))
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
  // Solo cuenta facturas con status invoiced/paid; draft/ready/sent (reportado)
  // todavía no son "facturado" en el sentido contable.
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
  options: {
    budgetOriginId?: string | null;
    clientId?: string | null;
    budgetOriginIds?: string[] | null; // multi (portal): prioridad sobre single
  } = {},
): Promise<DashboardProjects> {
  const filterOrigin = options.budgetOriginId ?? null;
  const filterClient = options.clientId ?? null;
  const filterOriginIds = (options.budgetOriginIds ?? []).filter(Boolean);
  const conds = [
    ...(filterOriginIds.length
      ? [inArray(projects.budgetOriginId, filterOriginIds)]
      : filterOrigin
        ? [eq(projects.budgetOriginId, filterOrigin)]
        : []),
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
    .leftJoin(mediaPlans, and(eq(mediaPlans.projectId, projects.id), isNull(mediaPlans.deletedAt)))
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
    .innerJoin(mediaPlans, and(eq(mediaPlans.projectId, projects.id), isNull(mediaPlans.deletedAt)))
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

  // Importante: el total media y el período se calculan en queries SEPARADAS
  // porque `media_plan_placements` cuelga 1:N de `media_plan_publishers`.
  // Joinear ambos y sumar publisher.totalPlannedUsd en la misma query infla
  // el total por el factor "placements promedio por publisher" (cartesian).
  // Mismo patrón que `db/queries/project-detail.ts` y `plans.ts:1147`.
  const baseRows = await db
    .select({
      id: mediaPlans.id,
      projectId: mediaPlans.projectId,
      name: mediaPlans.name,
      status: mediaPlans.status,
      currentVersion: mediaPlans.currentVersion,
      createdAt: mediaPlans.createdAt,
    })
    .from(mediaPlans)
    .where(and(inArray(mediaPlans.projectId, projectIds), isNull(mediaPlans.deletedAt)))
    .orderBy(asc(mediaPlans.createdAt));

  if (baseRows.length === 0) return new Map();
  const planIds = baseRows.map((p) => p.id);

  const [totals, periods] = await Promise.all([
    db
      .select({
        planId: mediaPlanPublishers.mediaPlanId,
        total: sql<string>`coalesce(sum(${mediaPlanPublishers.totalPlannedUsd}), 0)`,
      })
      .from(mediaPlanPublishers)
      .where(inArray(mediaPlanPublishers.mediaPlanId, planIds))
      .groupBy(mediaPlanPublishers.mediaPlanId),
    db
      .select({
        planId: mediaPlanPublishers.mediaPlanId,
        periodStart: sql<string | null>`min(${mediaPlanPlacements.startDate})::text`,
        periodEnd: sql<string | null>`max(${mediaPlanPlacements.endDate})::text`,
      })
      .from(mediaPlanPlacements)
      .innerJoin(
        mediaPlanPublishers,
        eq(mediaPlanPlacements.mediaPlanPublisherId, mediaPlanPublishers.id),
      )
      .where(inArray(mediaPlanPublishers.mediaPlanId, planIds))
      .groupBy(mediaPlanPublishers.mediaPlanId),
  ]);
  const totalByPlan = new Map(totals.map((t) => [t.planId, t.total]));
  const periodByPlan = new Map(
    periods.map((p) => [p.planId, { start: p.periodStart, end: p.periodEnd }]),
  );

  const planRows = baseRows.map((p) => ({
    ...p,
    totalMediaUsd: totalByPlan.get(p.id) ?? "0",
    periodStart: periodByPlan.get(p.id)?.start ?? null,
    periodEnd: periodByPlan.get(p.id)?.end ?? null,
  }));

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
          inArray(planBillings.status, ["invoiced", "paid"]),
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
          inArray(planBillings.status, ["invoiced", "paid"]),
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

    // Publishers breakdown. Un publisher puede tener N bloques en el plan;
    // agregamos por publisherId sumando totalPlannedUsd (el billed ya es
    // único por publisher).
    const pubs = publishersByPlan.get(p.id) ?? [];
    const breakdownByPub = new Map<string, PublisherBreakdownRow>();
    for (const pp of pubs) {
      const planned = Number.parseFloat(pp.plannedUsd);
      const existing = breakdownByPub.get(pp.publisherId);
      if (existing) {
        existing.plannedUsd += planned;
        existing.pendingUsd = Math.max(0, existing.plannedUsd - existing.billedUsd);
      } else {
        const billed = billedByPubKey.get(`${p.id}::${pp.publisherId}`) ?? 0;
        breakdownByPub.set(pp.publisherId, {
          publisherId: pp.publisherId,
          publisherName: pp.publisherName,
          plannedUsd: planned,
          billedUsd: billed,
          pendingUsd: Math.max(0, planned - billed),
        });
      }
    }
    const publisherBreakdown: PublisherBreakdownRow[] = Array.from(
      breakdownByPub.values(),
    );

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
    .innerJoin(mediaPlans, and(eq(planBillings.mediaPlanId, mediaPlans.id), isNull(mediaPlans.deletedAt)))
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
  grossUsd: number; // estimación bruta del mes (media + fees)
  grossMediaUsd: number; // bruto de placements (consumo de medios)
  grossFeesUsd: number; // bruto de management/setup/reporting/custom
  alreadyBilledUsd: number; // ya facturado en ese mes (sent/paid, media + fees)
  alreadyBilledMediaUsd: number; // facturado de consumo (plan_billing_publishers)
  alreadyBilledFeesUsd: number; // facturado de fees (plan_billing_fees)
  netUsd: number; // gross - alreadyBilled (mínimo 0)
  byProject: {
    projectId: string;
    projectCode: string;
    projectName: string;
    clientName: string;
    grossUsd: number;
    grossMediaUsd: number;
    grossFeesUsd: number;
    alreadyBilledUsd: number;
    alreadyBilledMediaUsd: number;
    alreadyBilledFeesUsd: number;
    netUsd: number;
  }[];
};

export async function getBillingEstimate(options: {
  months: string[]; // ["YYYY-MM", ...]
  budgetOriginId?: string | null;
  projectId?: string | null;
  clientId?: string | null;
  // Filtros multi (portal): tienen prioridad sobre los single homónimos.
  budgetOriginIds?: string[] | null;
  projectIds?: string[] | null;
}): Promise<MonthlyBillingEstimate[]> {
  const targetMonths = new Set(options.months);
  const filterOrigin = options.budgetOriginId ?? null;
  const filterProject = options.projectId ?? null;
  const filterClient = options.clientId ?? null;
  const filterOriginIds = (options.budgetOriginIds ?? []).filter(Boolean);
  const filterProjectIds = (options.projectIds ?? []).filter(Boolean);
  // Condiciones de scope reutilizadas en las 3 subqueries (placements + ya
  // facturado media/fees). Multi (inArray) tiene prioridad sobre single (eq).
  const scopeConds = [
    ...(filterOriginIds.length
      ? [inArray(projects.budgetOriginId, filterOriginIds)]
      : filterOrigin
        ? [eq(projects.budgetOriginId, filterOrigin)]
        : []),
    ...(filterProjectIds.length
      ? [inArray(projects.id, filterProjectIds)]
      : filterProject
        ? [eq(projects.id, filterProject)]
        : []),
    ...(filterClient ? [eq(projects.clientId, filterClient)] : []),
  ];

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
      // Facturable = la agencia factura ese publisher (override del bloque o
      // default per-cliente). La media que paga el cliente directo no se
      // factura como medio (#182); el fee igual va sobre TODA la media.
      agencyPays: sql<boolean>`coalesce(${mediaPlanPublishers.agencyPaysOverride}, ${publishers.agencyPays})`,
    })
    .from(mediaPlanPlacements)
    .innerJoin(
      mediaPlanPublishers,
      eq(mediaPlanPlacements.mediaPlanPublisherId, mediaPlanPublishers.id),
    )
    .innerJoin(publishers, eq(mediaPlanPublishers.publisherId, publishers.id))
    .innerJoin(mediaPlans, eq(mediaPlanPublishers.mediaPlanId, mediaPlans.id))
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
    .innerJoin(clients, eq(projects.clientId, clients.id));

  const placementWhere = and(
    planStatusFilter,
    ...scopeConds,
  );
  const placements = await placementsBase.where(placementWhere);

  // Ojo: NO cortamos si placements está vacío. Aunque no haya planes
  // approved/ready (p. ej. un cliente con todo archivado), igual queremos
  // devolver el FACTURADO REAL de cada mes pedido — clave para ver meses
  // pasados ya cerrados. El facturado sale de las subqueries de más abajo.

  // 2. Períodos por plan (para prorratear fees) + total media por plan.
  // OJO: totalMedia acumula TODA la media (facturable + no facturable) a
  // propósito — es la base del management fee, que se cobra sobre toda la media
  // gestionada aunque el cliente pague el publisher directo (#182).
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

  // 5. Acumular gross por (mes, proyecto) prorrateando placements + fees.
  // Se trackean media y fees por separado para poder mostrarlos en la UI;
  // el total bruto del mes/proyecto es media + fees.
  type ProjectAgg = {
    projectId: string;
    projectCode: string;
    projectName: string;
    clientName: string;
    media: number;
    fees: number;
    billedMedia: number;
    billedFees: number;
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
    kind: "media" | "fee",
  ) => {
    if (!targetMonths.has(month)) return;
    let projMap = monthBuckets.get(month);
    if (!projMap) {
      projMap = new Map();
      monthBuckets.set(month, projMap);
    }
    const cur = projMap.get(proj.projectId);
    if (cur) {
      if (kind === "media") cur.media += amount;
      else cur.fees += amount;
    } else {
      projMap.set(proj.projectId, {
        projectId: proj.projectId,
        projectCode: proj.projectCode,
        projectName: proj.projectName,
        clientName: proj.clientName,
        media: kind === "media" ? amount : 0,
        fees: kind === "fee" ? amount : 0,
        billedMedia: 0,
        billedFees: 0,
      });
    }
  };

  // 5a. Placements (media) — SOLO la media facturable. La media que paga el
  // cliente directo (publisher no facturable) no se factura como medio, así que
  // no debe aparecer como pendiente (#182). El fee sí va sobre toda la media:
  // por eso planPeriodMap.totalMedia (arriba) NO filtra por facturable.
  for (const p of placements) {
    if (!p.agencyPays) continue;
    if (!p.startDate || !p.endDate) continue;
    const months = enumerateMonths(
      p.startDate.slice(0, 7),
      p.endDate.slice(0, 7),
    );
    if (months.length === 0) continue;
    const monthly = Number.parseFloat(p.amount) / months.length;
    for (const m of months) {
      addToBucket(m, p, monthly, "media");
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
      addToBucket(m, proj, monthly, "fee");
    }
  }

  // 6. Ya facturado por mes y proyecto (invoiced/paid). Leemos los totales de
  // la PROPIA factura: `total_net_usd` (media facturable) y `total_fee_usd`
  // (fees). Son la fuente de verdad de lo emitido — evita descuadres cuando la
  // itemización por publisher/fee no está completa (p. ej. facturas con el fee
  // en `total_fee_usd` pero sin filas en `plan_billing_fees`, que hacían que el
  // fee ya cobrado apareciera como pendiente). `recalcBillingTotals` garantiza
  // total_net = media facturable y total_fee = suma de fees, así que para data
  // creada por la app da idéntico a sumar las sublíneas.
  const billedRows = await db
    .select({
      month: planBillings.month,
      projectId: projects.id,
      projectCode: projects.code,
      projectName: projects.name,
      clientName: clients.name,
      mediaBilled: sql<string>`coalesce(sum(${planBillings.totalNetUsd}), 0)`,
      feeBilled: sql<string>`coalesce(sum(${planBillings.totalFeeUsd}), 0)`,
    })
    .from(planBillings)
    .innerJoin(mediaPlans, and(eq(planBillings.mediaPlanId, mediaPlans.id), isNull(mediaPlans.deletedAt)))
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(
      and(
        inArray(planBillings.month, options.months),
        inArray(planBillings.status, ["invoiced", "paid"]),
        ...scopeConds,
      ),
    )
    .groupBy(planBillings.month, projects.id, projects.code, projects.name, clients.name);

  // Para que aparezcan proyectos que SOLO tienen facturas (sin placements
  // activos en el mes), creamos el bucket si no existe — así un mes ya cerrado
  // muestra su FACTURADO REAL aunque su plan ya esté archivado o su placement
  // haya terminado. Las subqueries de facturado ya traen la metadata del
  // proyecto (code/name/cliente) justamente para poder crear el bucket acá.
  const ensureBucket = (month: string, r: {
    projectId: string;
    projectCode: string;
    projectName: string;
    clientName: string;
  }): ProjectAgg | null => {
    if (!targetMonths.has(month)) return null;
    let projMap = monthBuckets.get(month);
    if (!projMap) {
      projMap = new Map();
      monthBuckets.set(month, projMap);
    }
    let cur = projMap.get(r.projectId);
    if (!cur) {
      cur = {
        projectId: r.projectId,
        projectCode: r.projectCode,
        projectName: r.projectName,
        clientName: r.clientName,
        media: 0,
        fees: 0,
        billedMedia: 0,
        billedFees: 0,
      };
      projMap.set(r.projectId, cur);
    }
    return cur;
  };
  for (const r of billedRows) {
    const cur = ensureBucket(r.month, r);
    if (cur) {
      cur.billedMedia += Number.parseFloat(r.mediaBilled);
      cur.billedFees += Number.parseFloat(r.feeBilled);
    }
  }

  // 7. Construir respuesta ordenada como options.months.
  // "Falta facturar" es forward-looking: un mes CERRADO (anterior al actual) ya
  // no se factura, así que su neto va a 0. Esto evita el "fantasma" de un plan
  // que quedó 100% facturado pero de forma despareja entre meses (el prorrateo
  // lineal esperaba X/mes, se facturó despar, y el piso por mes no dejaba que un
  // mes compensara al otro). El saldo REAL pendiente de un plan vive en el mes
  // actual/futuro y en getClientBillingProjections (que reconcilia al nivel plan).
  const nowMonth = currentYearMonth();
  return options.months.map((m) => {
    const isPastMonth = m < nowMonth;
    const projMap = monthBuckets.get(m);
    const byProject = projMap
      ? Array.from(projMap.values())
          .map((p) => {
            const grossMediaUsd = p.media;
            const grossFeesUsd = p.fees;
            const grossUsd = grossMediaUsd + grossFeesUsd;
            const alreadyBilledMediaUsd = p.billedMedia;
            const alreadyBilledFeesUsd = p.billedFees;
            const alreadyBilledUsd = alreadyBilledMediaUsd + alreadyBilledFeesUsd;
            return {
              projectId: p.projectId,
              projectCode: p.projectCode,
              projectName: p.projectName,
              clientName: p.clientName,
              grossUsd,
              grossMediaUsd,
              grossFeesUsd,
              alreadyBilledUsd,
              alreadyBilledMediaUsd,
              alreadyBilledFeesUsd,
              netUsd: isPastMonth ? 0 : Math.max(0, grossUsd - alreadyBilledUsd),
            };
          })
          .sort(
            (a, b) =>
              b.netUsd - a.netUsd || b.alreadyBilledUsd - a.alreadyBilledUsd,
          )
      : [];
    const grossMediaUsd = byProject.reduce((s, p) => s + p.grossMediaUsd, 0);
    const grossFeesUsd = byProject.reduce((s, p) => s + p.grossFeesUsd, 0);
    const grossUsd = grossMediaUsd + grossFeesUsd;
    const alreadyBilledMediaUsd = byProject.reduce(
      (s, p) => s + p.alreadyBilledMediaUsd,
      0,
    );
    const alreadyBilledFeesUsd = byProject.reduce(
      (s, p) => s + p.alreadyBilledFeesUsd,
      0,
    );
    const alreadyBilledUsd = alreadyBilledMediaUsd + alreadyBilledFeesUsd;
    return {
      month: m,
      grossUsd,
      grossMediaUsd,
      grossFeesUsd,
      alreadyBilledUsd,
      alreadyBilledMediaUsd,
      alreadyBilledFeesUsd,
      netUsd: isPastMonth ? 0 : Math.max(0, grossUsd - alreadyBilledUsd),
      byProject,
    };
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Proyección de facturación por proyecto → plan, para el portal del cliente.
//
// A diferencia de getBillingEstimate (que agrega al nivel proyecto y solo para
// una lista de meses puntuales), esta query baja hasta el PLAN y arma, para cada
// uno, "lo que falta facturar" (bruto − ya facturado) prorrateado a lo largo de
// TODOS los meses que le quedan al plan (desde el mes actual hasta su fin).
//
// Reusa exactamente el mismo prorrateo que getBillingEstimate:
//   - media: el monto de cada placement repartido en partes iguales sobre los
//     meses de su [start, end];
//   - fees: el total del fee repartido sobre el período del plan (min start /
//     max end de sus placements). El management fee con ratePct se deriva con
//     TM × rate/(100 − rate).
// Lo ya facturado sale de facturas en estado invoiced/paid (media de
// plan_billing_publishers billable + fees de plan_billing_fees), como el resto
// de la estimación, para que los números reconcilien con las cards mensuales.
// ────────────────────────────────────────────────────────────────────────────

export type PlanProjectionMonth = {
  month: string; // YYYY-MM
  projectedUsd: number; // parte de "lo que falta facturar" asignada a este mes
};

// Factura emitida del plan (histórico): número + mes + valor.
export type PlanInvoice = {
  invoiceNumber: string;
  month: string; // YYYY-MM
  status: "invoiced" | "paid";
  totalUsd: number;
};

export type PlanBillingProjection = {
  planId: string;
  planName: string;
  status: (typeof mediaPlans.$inferSelect)["status"];
  periodStart: string | null; // YYYY-MM-DD (min start de los placements)
  periodEnd: string | null; // YYYY-MM-DD (max end de los placements)
  grossUsd: number; // total a facturar del plan (media + fees prorrateados)
  grossMediaUsd: number;
  grossFeesUsd: number;
  billedUsd: number; // ya facturado = suma de las facturas emitidas (invoiced/paid)
  remainingUsd: number; // falta facturar = max(0, gross − billed)
  months: PlanProjectionMonth[]; // solo los meses que le quedan al plan
  invoices: PlanInvoice[]; // histórico de facturas emitidas (número + mes + valor)
};

export type ProjectBillingProjection = {
  projectId: string;
  projectCode: string;
  projectName: string;
  status: (typeof projects.$inferSelect)["status"];
  periodStart: string | null;
  periodEnd: string | null;
  grossUsd: number;
  billedUsd: number;
  remainingUsd: number;
  plans: PlanBillingProjection[];
};

function currentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function getClientBillingProjections(options: {
  clientId: string;
  budgetOriginIds?: string[] | null;
  projectIds?: string[] | null;
}): Promise<ProjectBillingProjection[]> {
  const filterOriginIds = (options.budgetOriginIds ?? []).filter(Boolean);
  const filterProjectIds = (options.projectIds ?? []).filter(Boolean);
  const scopeConds = [
    eq(projects.clientId, options.clientId),
    ...(filterOriginIds.length
      ? [inArray(projects.budgetOriginId, filterOriginIds)]
      : []),
    ...(filterProjectIds.length ? [inArray(projects.id, filterProjectIds)] : []),
  ];

  // 1. Placements de planes approved / ready_to_send del cliente.
  const placements = await db
    .select({
      planId: mediaPlans.id,
      planName: mediaPlans.name,
      planStatus: mediaPlans.status,
      projectId: projects.id,
      projectCode: projects.code,
      projectName: projects.name,
      projectStatus: projects.status,
      startDate: mediaPlanPlacements.startDate,
      endDate: mediaPlanPlacements.endDate,
      amount: mediaPlanPlacements.amountUsd,
      // Facturable = la agencia factura ese publisher (override del bloque o
      // default per-cliente). Solo la media facturable alimenta el "falta
      // facturar" de medios; el fee va sobre toda la media (#182).
      agencyPays: sql<boolean>`coalesce(${mediaPlanPublishers.agencyPaysOverride}, ${publishers.agencyPays})`,
    })
    .from(mediaPlanPlacements)
    .innerJoin(
      mediaPlanPublishers,
      eq(mediaPlanPlacements.mediaPlanPublisherId, mediaPlanPublishers.id),
    )
    .innerJoin(publishers, eq(mediaPlanPublishers.publisherId, publishers.id))
    .innerJoin(
      mediaPlans,
      and(
        eq(mediaPlanPublishers.mediaPlanId, mediaPlans.id),
        isNull(mediaPlans.deletedAt),
      ),
    )
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
    .where(
      and(
        inArray(mediaPlans.status, ["approved", "ready_to_send"]),
        ...scopeConds,
      ),
    );

  if (placements.length === 0) return [];

  // 2. Acumular por plan: período (min start / max end), total media y media
  // prorrateada por mes.
  type PlanAgg = {
    planId: string;
    planName: string;
    planStatus: (typeof mediaPlans.$inferSelect)["status"];
    projectId: string;
    projectCode: string;
    projectName: string;
    projectStatus: (typeof projects.$inferSelect)["status"];
    startMonth: string;
    endMonth: string;
    startDate: string;
    endDate: string;
    totalMedia: number;
    scheduledMedia: Map<string, number>;
  };
  const planMap = new Map<string, PlanAgg>();
  for (const p of placements) {
    if (!p.startDate || !p.endDate) continue;
    const sd = p.startDate.slice(0, 10);
    const ed = p.endDate.slice(0, 10);
    const sm = sd.slice(0, 7);
    const em = ed.slice(0, 7);
    let agg = planMap.get(p.planId);
    if (!agg) {
      agg = {
        planId: p.planId,
        planName: p.planName,
        planStatus: p.planStatus,
        projectId: p.projectId,
        projectCode: p.projectCode,
        projectName: p.projectName,
        projectStatus: p.projectStatus,
        startMonth: sm,
        endMonth: em,
        startDate: sd,
        endDate: ed,
        totalMedia: 0,
        scheduledMedia: new Map(),
      };
      planMap.set(p.planId, agg);
    } else {
      if (sm < agg.startMonth) agg.startMonth = sm;
      if (em > agg.endMonth) agg.endMonth = em;
      if (sd < agg.startDate) agg.startDate = sd;
      if (ed > agg.endDate) agg.endDate = ed;
    }
    const amt = Number.parseFloat(p.amount);
    // totalMedia = TODA la media (base del fee, #182); el período ya se
    // actualizó arriba con este placement (facturable o no).
    agg.totalMedia += amt;
    // scheduledMedia (lo que alimenta el "falta facturar" de medios) SOLO
    // suma media facturable: la que paga el cliente directo no se factura como
    // medio, así que no debe figurar como pendiente.
    if (!p.agencyPays) continue;
    const months = enumerateMonths(sm, em);
    if (months.length === 0) continue;
    const monthly = amt / months.length;
    for (const m of months) {
      agg.scheduledMedia.set(m, (agg.scheduledMedia.get(m) ?? 0) + monthly);
    }
  }

  const planIds = Array.from(planMap.keys());
  if (planIds.length === 0) return [];

  // 3. Fees de esos planes → prorrateados sobre el período del plan.
  const feeRows = await db
    .select()
    .from(mediaPlanFees)
    .where(inArray(mediaPlanFees.mediaPlanId, planIds));

  const scheduledFeesByPlan = new Map<string, Map<string, number>>();
  for (const f of feeRows) {
    const agg = planMap.get(f.mediaPlanId);
    if (!agg) continue;
    const months = enumerateMonths(agg.startMonth, agg.endMonth);
    if (months.length === 0) continue;
    const ratePct = f.ratePct ? Number.parseFloat(f.ratePct) : null;
    let totalFee: number;
    if (
      f.feeType === "management" &&
      ratePct != null &&
      ratePct > 0 &&
      ratePct < 100
    ) {
      totalFee = (agg.totalMedia * ratePct) / (100 - ratePct);
    } else {
      totalFee = Number.parseFloat(f.amountUsd);
    }
    if (totalFee <= 0) continue;
    const monthly = totalFee / months.length;
    let m2 = scheduledFeesByPlan.get(f.mediaPlanId);
    if (!m2) {
      m2 = new Map();
      scheduledFeesByPlan.set(f.mediaPlanId, m2);
    }
    for (const m of months) m2.set(m, (m2.get(m) ?? 0) + monthly);
  }

  // 4. Facturas emitidas por plan (histórico): facturas en estado invoiced/paid
  // con número de factura cargado — mismo criterio que el Billing Tracker. El
  // "ya facturado" del plan es la suma de sus totales (así reconcilia exacto con
  // la lista que se muestra), y se exponen número + mes + valor de cada una.
  const invoiceRows = await db
    .select({
      planId: planBillings.mediaPlanId,
      invoiceNumber: planBillings.invoiceNumber,
      month: planBillings.month,
      status: planBillings.status,
      totalUsd: planBillings.totalUsd,
    })
    .from(planBillings)
    .where(
      and(
        inArray(planBillings.mediaPlanId, planIds),
        inArray(planBillings.status, ["invoiced", "paid"]),
        sql`${planBillings.invoiceNumber} is not null`,
      ),
    )
    .orderBy(asc(planBillings.month));

  const invoicesByPlan = new Map<string, PlanInvoice[]>();
  const billedByPlan = new Map<string, number>();
  for (const r of invoiceRows) {
    const total = Number.parseFloat(r.totalUsd);
    const list = invoicesByPlan.get(r.planId) ?? [];
    list.push({
      invoiceNumber: r.invoiceNumber!,
      month: r.month,
      status: r.status as "invoiced" | "paid",
      totalUsd: total,
    });
    invoicesByPlan.set(r.planId, list);
    billedByPlan.set(r.planId, (billedByPlan.get(r.planId) ?? 0) + total);
  }

  // 5. Armar la proyección por plan y agrupar por proyecto. Solo se incluyen
  // planes con meses por venir (período que llega al mes actual o más allá): la
  // proyección es de "lo que falta facturar prorrateado por cada mes que le
  // queda al plan".
  const nowMonth = currentYearMonth();
  const projectMap = new Map<string, ProjectBillingProjection>();

  for (const agg of planMap.values()) {
    const schedFees = scheduledFeesByPlan.get(agg.planId);
    const grossMediaUsd = [...agg.scheduledMedia.values()].reduce(
      (s, v) => s + v,
      0,
    );
    const grossFeesUsd = schedFees
      ? [...schedFees.values()].reduce((s, v) => s + v, 0)
      : 0;
    const grossUsd = grossMediaUsd + grossFeesUsd;
    const billedUsd = billedByPlan.get(agg.planId) ?? 0;
    const remainingUsd = Math.max(0, grossUsd - billedUsd);
    // Sin saldo pendiente → el plan no aporta a la proyección (evita filas en
    // $0 y planes ya facturados por completo).
    if (remainingUsd <= 0.005) continue;

    // Meses que le quedan al plan (>= mes actual) dentro de su período.
    const remainingMonths = enumerateMonths(
      agg.startMonth,
      agg.endMonth,
    ).filter((m) => m >= nowMonth);

    let months: PlanProjectionMonth[];
    if (remainingMonths.length === 0) {
      // El plan ya terminó pero quedó saldo sin facturar: no hay meses por venir
      // para prorratear, así que imputamos el remanente al mes ACTUAL como "a
      // facturar ahora". Si lo descartáramos, ese dinero real pendiente
      // desaparecería de la vista (y de la card mensual hermana, que sí lo
      // muestra en el mes anterior).
      months = [{ month: nowMonth, projectedUsd: remainingUsd }];
    } else {
      // Prorrateo de lo que falta facturar, ponderado por el bruto programado de
      // cada mes restante (sigue la forma del cronograma). Si todos los meses
      // restantes tienen bruto 0 (caso degenerado), reparte en partes iguales.
      const remScheduled = remainingMonths.map(
        (m) =>
          (agg.scheduledMedia.get(m) ?? 0) +
          (schedFees ? (schedFees.get(m) ?? 0) : 0),
      );
      const remScheduledTotal = remScheduled.reduce((s, v) => s + v, 0);
      months = remainingMonths.map((m, i) => {
        const weight =
          remScheduledTotal > 0
            ? remScheduled[i] / remScheduledTotal
            : 1 / remainingMonths.length;
        return { month: m, projectedUsd: remainingUsd * weight };
      });
    }

    const planProjection: PlanBillingProjection = {
      planId: agg.planId,
      planName: agg.planName,
      status: agg.planStatus,
      periodStart: agg.startDate,
      periodEnd: agg.endDate,
      grossUsd,
      grossMediaUsd,
      grossFeesUsd,
      billedUsd,
      remainingUsd,
      months,
      invoices: invoicesByPlan.get(agg.planId) ?? [],
    };

    let proj = projectMap.get(agg.projectId);
    if (!proj) {
      proj = {
        projectId: agg.projectId,
        projectCode: agg.projectCode,
        projectName: agg.projectName,
        status: agg.projectStatus,
        periodStart: agg.startDate,
        periodEnd: agg.endDate,
        grossUsd: 0,
        billedUsd: 0,
        remainingUsd: 0,
        plans: [],
      };
      projectMap.set(agg.projectId, proj);
    }
    proj.plans.push(planProjection);
    proj.grossUsd += grossUsd;
    proj.billedUsd += billedUsd;
    proj.remainingUsd += remainingUsd;
    if (agg.startDate < (proj.periodStart ?? agg.startDate))
      proj.periodStart = agg.startDate;
    if (agg.endDate > (proj.periodEnd ?? agg.endDate)) proj.periodEnd = agg.endDate;
  }

  // 6. Solo proyectos con algo por facturar; planes ordenados por inicio y
  // proyectos por monto pendiente (lo más urgente primero).
  const result = Array.from(projectMap.values()).filter(
    (p) => p.remainingUsd > 0.005,
  );
  for (const p of result) {
    p.plans.sort((a, b) => {
      const as = a.periodStart ?? "";
      const bs = b.periodStart ?? "";
      if (as !== bs) return as < bs ? -1 : 1;
      return a.planName.localeCompare(b.planName);
    });
  }
  result.sort((a, b) => b.remainingUsd - a.remainingUsd);
  return result;
}
