import { and, asc, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  budgetOrigins,
  clients,
  mediaPlanFees,
  mediaPlanPublishers,
  mediaPlans,
  planBillingFees,
  planBillingPublishers,
  planBillings,
  projects,
  publishers,
} from "@/db/schema";

// ────────────────────────────────────────────────────────────────────────────
// Listado global de billings
// ────────────────────────────────────────────────────────────────────────────

export type BillingListRow = {
  id: string;
  month: string;
  invoiceNumber: string | null;
  status: (typeof planBillings.$inferSelect)["status"];
  totalUsd: number;
  totalNetUsd: number;
  totalFeeUsd: number;
  planId: string;
  planName: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  clientName: string;
  clientSlug: string;
  budgetOriginName: string;
  createdAt: Date;
  sentAt: Date | null;
  paidAt: Date | null;
  dueDate: string | null;
};

export type BillingsListFilters = {
  clientId?: string | null;
  budgetOriginId?: string | null;
  projectId?: string | null;
  status?: (typeof planBillings.$inferSelect)["status"] | null;
  fromMonth?: string | null;  // YYYY-MM inclusive
  toMonth?: string | null;    // YYYY-MM inclusive
};

export async function getBillingsList(
  filters: BillingsListFilters = {},
): Promise<BillingListRow[]> {
  const conds: SQL[] = [];
  if (filters.clientId) conds.push(eq(projects.clientId, filters.clientId));
  if (filters.budgetOriginId)
    conds.push(eq(projects.budgetOriginId, filters.budgetOriginId));
  if (filters.projectId) conds.push(eq(projects.id, filters.projectId));
  if (filters.status) conds.push(eq(planBillings.status, filters.status));
  if (filters.fromMonth) conds.push(gte(planBillings.month, filters.fromMonth));
  if (filters.toMonth) conds.push(lte(planBillings.month, filters.toMonth));

  const base = db
    .select({
      id: planBillings.id,
      month: planBillings.month,
      invoiceNumber: planBillings.invoiceNumber,
      status: planBillings.status,
      totalUsd: planBillings.totalUsd,
      totalNetUsd: planBillings.totalNetUsd,
      totalFeeUsd: planBillings.totalFeeUsd,
      planId: mediaPlans.id,
      planName: mediaPlans.name,
      projectId: projects.id,
      projectCode: projects.code,
      projectName: projects.name,
      clientName: clients.name,
      clientSlug: clients.slug,
      budgetOriginName: budgetOrigins.name,
      createdAt: planBillings.createdAt,
      sentAt: planBillings.sentAt,
      paidAt: planBillings.paidAt,
      dueDate: planBillings.dueDate,
    })
    .from(planBillings)
    .innerJoin(mediaPlans, and(eq(planBillings.mediaPlanId, mediaPlans.id), isNull(mediaPlans.deletedAt)))
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .innerJoin(budgetOrigins, eq(projects.budgetOriginId, budgetOrigins.id))
    .orderBy(desc(planBillings.createdAt));

  const rows =
    conds.length > 0 ? await base.where(and(...conds)) : await base;

  return rows.map((r) => ({
    ...r,
    totalUsd: Number.parseFloat(r.totalUsd),
    totalNetUsd: Number.parseFloat(r.totalNetUsd),
    totalFeeUsd: Number.parseFloat(r.totalFeeUsd),
  }));
}

// ────────────────────────────────────────────────────────────────────────────
// Opciones para los filtros del top de /billing.
//
// Devuelve solo budget origins / proyectos que tienen al menos una factura
// (sino el dropdown muestra opciones irrelevantes). El rango de meses es
// min/max sobre planBillings.month. Todo se scopea por clientId si está.
// ────────────────────────────────────────────────────────────────────────────

export type BillingFilterOptions = {
  budgetOrigins: { id: string; name: string }[];
  projects: { id: string; code: string; name: string; clientId: string }[];
  minMonth: string | null;
  maxMonth: string | null;
};

export async function getBillingFilterOptions(
  clientId?: string | null,
): Promise<BillingFilterOptions> {
  const conds: SQL[] = [];
  if (clientId) conds.push(eq(projects.clientId, clientId));
  const where = conds.length > 0 ? and(...conds) : undefined;

  const originsQuery = db
    .selectDistinct({
      id: budgetOrigins.id,
      name: budgetOrigins.name,
    })
    .from(planBillings)
    .innerJoin(mediaPlans, and(eq(planBillings.mediaPlanId, mediaPlans.id), isNull(mediaPlans.deletedAt)))
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
    .innerJoin(budgetOrigins, eq(projects.budgetOriginId, budgetOrigins.id));

  const projectsQuery = db
    .selectDistinct({
      id: projects.id,
      code: projects.code,
      name: projects.name,
      clientId: projects.clientId,
    })
    .from(planBillings)
    .innerJoin(mediaPlans, and(eq(planBillings.mediaPlanId, mediaPlans.id), isNull(mediaPlans.deletedAt)))
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id));

  const monthsQuery = db
    .select({
      minMonth: sql<string | null>`min(${planBillings.month})`,
      maxMonth: sql<string | null>`max(${planBillings.month})`,
    })
    .from(planBillings)
    .innerJoin(mediaPlans, and(eq(planBillings.mediaPlanId, mediaPlans.id), isNull(mediaPlans.deletedAt)))
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id));

  const [originsRows, projectsRows, monthsRow] = await Promise.all([
    where ? originsQuery.where(where) : originsQuery,
    where ? projectsQuery.where(where) : projectsQuery,
    where ? monthsQuery.where(where) : monthsQuery,
  ]);

  return {
    budgetOrigins: originsRows.sort((a, b) => a.name.localeCompare(b.name)),
    projects: projectsRows.sort((a, b) => a.code.localeCompare(b.code)),
    minMonth: monthsRow[0]?.minMonth ?? null,
    maxMonth: monthsRow[0]?.maxMonth ?? null,
  };
}


// ────────────────────────────────────────────────────────────────────────────
// Detalle de un plan_billing — para la página de carga del AM.
// Trae publishers del plan, sus consumos del mes (si hay), y fees del plan
// con sus imputaciones del mes.
// ────────────────────────────────────────────────────────────────────────────

export type BillingPublisherLine = {
  publisherId: string;
  publisherName: string;
  publisherSlug: string;
  publisherSortOrder: number;
  agencyPays: boolean;
  totalPlannedUsd: number;
  consumedAccumulatedUsd: number; // a través de meses anteriores
  amountThisMonthUsd: number;
  isBillable: boolean;
  notes: string | null;
};

export type BillingFeeLine = {
  mediaPlanFeeId: string;
  feeType: (typeof mediaPlanFees.$inferSelect)["feeType"];
  feeName: string;
  totalAmountUsd: number;
  imputedAccumulatedUsd: number;
  imputedThisMonthUsd: number;
  notes: string | null;
};

export type BillingDetail = {
  billing: typeof planBillings.$inferSelect;
  plan: { id: string; name: string };
  project: { id: string; name: string; code: string };
  client: { id: string; name: string; slug: string };
  budgetOrigin: { id: string; name: string };
  publisherLines: BillingPublisherLine[];
  feeLines: BillingFeeLine[];
};

export async function getBillingDetail(id: string): Promise<BillingDetail | null> {
  const [billingRow] = await db
    .select({
      billing: planBillings,
      plan: { id: mediaPlans.id, name: mediaPlans.name },
      project: { id: projects.id, name: projects.name, code: projects.code },
      client: { id: clients.id, name: clients.name, slug: clients.slug },
      origin: { id: budgetOrigins.id, name: budgetOrigins.name },
    })
    .from(planBillings)
    .innerJoin(mediaPlans, and(eq(planBillings.mediaPlanId, mediaPlans.id), isNull(mediaPlans.deletedAt)))
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .innerJoin(budgetOrigins, eq(projects.budgetOriginId, budgetOrigins.id))
    .where(eq(planBillings.id, id))
    .limit(1);

  if (!billingRow) return null;

  // Publishers del plan + consumos.
  const planPubs = await db
    .select({
      mpp: mediaPlanPublishers,
      pub: { id: publishers.id, name: publishers.name, slug: publishers.slug, agencyPaysDefault: publishers.agencyPays, sortOrder: publishers.sortOrder },
    })
    .from(mediaPlanPublishers)
    .innerJoin(publishers, eq(mediaPlanPublishers.publisherId, publishers.id))
    .where(eq(mediaPlanPublishers.mediaPlanId, billingRow.plan.id));

  // Consumo acumulado por publisher (todos los meses anteriores e iguales).
  const accumByPub = await db
    .select({
      publisherId: planBillingPublishers.publisherId,
      total: sql<string>`coalesce(sum(${planBillingPublishers.amountRealUsd}), 0)`,
    })
    .from(planBillingPublishers)
    .innerJoin(planBillings, eq(planBillingPublishers.planBillingId, planBillings.id))
    .where(eq(planBillings.mediaPlanId, billingRow.plan.id))
    .groupBy(planBillingPublishers.publisherId);

  // Consumo de este mes específico (del billing actual).
  const thisMonthByPub = await db
    .select()
    .from(planBillingPublishers)
    .where(eq(planBillingPublishers.planBillingId, id));

  const accumMap = new Map(accumByPub.map((r) => [r.publisherId, Number.parseFloat(r.total)]));
  const thisMonthMap = new Map(thisMonthByPub.map((r) => [r.publisherId, r]));

  // Un publisher puede aparecer en N bloques (mediaPlanPublishers) dentro de
  // un mismo plan. Para el billing, todo se rolla a UNA línea por publisher:
  // totalPlannedUsd = suma de los bloques, agencyPays = OR de los overrides
  // (si CUALQUIER bloque va por agencia, la línea es facturable). El billing
  // real (planBillingPublishers) ya está keyed por (billing, publisher), así
  // que el consumo del mes es un único valor sin importar los bloques.
  const aggByPub = new Map<
    string,
    {
      pub: (typeof planPubs)[number]["pub"];
      totalPlanned: number;
      anyAgencyPays: boolean;
    }
  >();
  for (const r of planPubs) {
    const acc = aggByPub.get(r.pub.id);
    const agencyPays = r.mpp.agencyPaysOverride ?? r.pub.agencyPaysDefault;
    const planned = Number.parseFloat(r.mpp.totalPlannedUsd);
    if (acc) {
      acc.totalPlanned += planned;
      acc.anyAgencyPays = acc.anyAgencyPays || agencyPays;
    } else {
      aggByPub.set(r.pub.id, {
        pub: r.pub,
        totalPlanned: planned,
        anyAgencyPays: agencyPays,
      });
    }
  }

  const publisherLines: BillingPublisherLine[] = Array.from(aggByPub.values())
    .sort((a, b) => a.pub.sortOrder - b.pub.sortOrder)
    .map((agg) => {
      const thisMonth = thisMonthMap.get(agg.pub.id);
      const accumTotal = accumMap.get(agg.pub.id) ?? 0;
      const thisMonthAmount = thisMonth ? Number.parseFloat(thisMonth.amountRealUsd) : 0;
      // Para mostrar "consumido antes de este mes": accum total - this month.
      const consumedBefore = accumTotal - thisMonthAmount;
      return {
        publisherId: agg.pub.id,
        publisherName: agg.pub.name,
        publisherSlug: agg.pub.slug,
        publisherSortOrder: agg.pub.sortOrder,
        agencyPays: agg.anyAgencyPays,
        totalPlannedUsd: agg.totalPlanned,
        consumedAccumulatedUsd: consumedBefore,
        amountThisMonthUsd: thisMonthAmount,
        isBillable: thisMonth?.isBillable ?? agg.anyAgencyPays,
        notes: thisMonth?.notes ?? null,
      };
    });

  // Fees del plan + imputaciones.
  const planFees = await db
    .select()
    .from(mediaPlanFees)
    .where(eq(mediaPlanFees.mediaPlanId, billingRow.plan.id));

  const accumByFee = await db
    .select({
      mediaPlanFeeId: planBillingFees.mediaPlanFeeId,
      total: sql<string>`coalesce(sum(${planBillingFees.amountImputedUsd}), 0)`,
    })
    .from(planBillingFees)
    .innerJoin(planBillings, eq(planBillingFees.planBillingId, planBillings.id))
    .where(eq(planBillings.mediaPlanId, billingRow.plan.id))
    .groupBy(planBillingFees.mediaPlanFeeId);

  const thisMonthFeeRows = await db
    .select()
    .from(planBillingFees)
    .where(eq(planBillingFees.planBillingId, id));

  const feeAccumMap = new Map(accumByFee.map((r) => [r.mediaPlanFeeId, Number.parseFloat(r.total)]));
  const feeThisMonthMap = new Map(thisMonthFeeRows.map((r) => [r.mediaPlanFeeId, r]));

  const feeLines: BillingFeeLine[] = planFees.map((f) => {
    const thisMonth = feeThisMonthMap.get(f.id);
    const accum = feeAccumMap.get(f.id) ?? 0;
    const thisMonthAmt = thisMonth ? Number.parseFloat(thisMonth.amountImputedUsd) : 0;
    const before = accum - thisMonthAmt;
    return {
      mediaPlanFeeId: f.id,
      feeType: f.feeType,
      feeName: f.name,
      totalAmountUsd: Number.parseFloat(f.amountUsd),
      imputedAccumulatedUsd: before,
      imputedThisMonthUsd: thisMonthAmt,
      notes: thisMonth?.notes ?? null,
    };
  });

  return {
    billing: billingRow.billing,
    plan: billingRow.plan,
    project: billingRow.project,
    client: billingRow.client,
    budgetOrigin: billingRow.origin,
    publisherLines,
    feeLines,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Avance de facturación de UN plan: lo facturado (medios + fee) mes a mes vs el
// total del plan. Alimenta el gráfico de "dónde estoy parado" arriba del billing
// del plan.
//
// Convenciones (para que numerador y denominador reconcilien y el avance llegue
// a 100% cuando está todo facturado):
//   • Total del plan = media FACTURABLE (Σ total_planned_usd de publishers donde
//     la agencia factura — la media que paga el cliente directo no se factura
//     como medio) + total fees. La management fee se cobra sobre la media TOTAL
//     (`media_total × rate/(100−rate)`): aunque parte la pague el cliente directo
//     se le cobra el fee, y la imputación mensual prorratea por consumo TOTAL.
//     Setup/reporting/custom = montos fijos.
//   • Facturado media = Σ plan_billing_publishers.amount_real_usd FILTER
//     (is_billable)  ·  Facturado fee = Σ plan_billing_fees.amount_imputed_usd.
//   • "Emitido" (facturado de verdad) = billing en estado invoiced|paid. Lo que
//     está cargado en un billing draft/ready/sent va como "cargado sin emitir".
// ────────────────────────────────────────────────────────────────────────────

export type PlanBillingProgressMonth = {
  month: string; // YYYY-MM
  status: (typeof planBillings.$inferSelect)["status"];
  emitted: boolean; // invoiced | paid
  mediaUsd: number; // facturable (amount_real_usd filter is_billable) del mes
  feesUsd: number; // fee imputado del mes
};

export type PlanBillingProgress = {
  totalMediaUsd: number;
  totalFeesUsd: number;
  totalUsd: number;
  // Emitido (facturado):
  invoicedMediaUsd: number;
  invoicedFeesUsd: number;
  // Cargado en billings todavía no emitidos (draft/ready/sent):
  pendingMediaUsd: number;
  pendingFeesUsd: number;
  months: PlanBillingProgressMonth[]; // una fila por billing existente, asc por mes
};

const EMITTED_STATUSES = ["invoiced", "paid"] as const;

export async function getPlanBillingProgress(
  planId: string,
): Promise<PlanBillingProgress> {
  // 1. Media del plan. Distinguimos dos:
  //   • FACTURABLE (agencia factura al cliente) → DENOMINADOR de los MEDIOS del
  //     avance (apples-to-apples con el facturado, que filtra is_billable): la
  //     media que paga el cliente directo no se factura como medio.
  //   • TOTAL (todos los publishers) → base de la MANAGEMENT FEE, que se cobra
  //     sobre TODA la media gestionada aunque parte la pague el cliente directo.
  const [mediaRow] = await db
    .select({
      totalAll: sql<string>`coalesce(sum(${mediaPlanPublishers.totalPlannedUsd}), 0)`,
      totalBillable: sql<string>`coalesce(sum(${mediaPlanPublishers.totalPlannedUsd}) filter (where coalesce(${mediaPlanPublishers.agencyPaysOverride}, ${publishers.agencyPays})), 0)`,
    })
    .from(mediaPlanPublishers)
    .innerJoin(publishers, eq(mediaPlanPublishers.publisherId, publishers.id))
    .where(eq(mediaPlanPublishers.mediaPlanId, planId));
  const totalMediaAllUsd = Number.parseFloat(mediaRow?.totalAll ?? "0");
  const totalMediaUsd = Number.parseFloat(mediaRow?.totalBillable ?? "0");

  // 2. Total fees. La management fee se cobra sobre la media TOTAL
  //    (`media_total × rate/(100−rate)`) — aunque parte la pague el cliente
  //    directo se le cobra el fee. La imputación mensual prorratea por el consumo
  //    TOTAL del mes (ver autoRecomputeMgmtFees en app/actions/plan-billing.ts),
  //    así que sumada sobre el plan llega a este total. Setup/reporting/custom =
  //    montos fijos.
  const feeRows = await db
    .select()
    .from(mediaPlanFees)
    .where(eq(mediaPlanFees.mediaPlanId, planId));
  let totalFeesUsd = 0;
  for (const f of feeRows) {
    const ratePct = f.ratePct ? Number.parseFloat(f.ratePct) : null;
    if (
      f.feeType === "management" &&
      ratePct != null &&
      ratePct > 0 &&
      ratePct < 100
    ) {
      totalFeesUsd += (totalMediaAllUsd * ratePct) / (100 - ratePct);
    } else {
      totalFeesUsd += Number.parseFloat(f.amountUsd);
    }
  }

  // 3. Billings del plan + facturado (media facturable + fee) por billing.
  const billings = await db
    .select({
      id: planBillings.id,
      month: planBillings.month,
      status: planBillings.status,
    })
    .from(planBillings)
    .where(eq(planBillings.mediaPlanId, planId))
    .orderBy(asc(planBillings.month));

  const billingIds = billings.map((b) => b.id);
  const mediaByBilling = new Map<string, number>();
  const feesByBilling = new Map<string, number>();
  if (billingIds.length > 0) {
    const [pubSums, feeSums] = await Promise.all([
      db
        .select({
          planBillingId: planBillingPublishers.planBillingId,
          media: sql<string>`coalesce(sum(${planBillingPublishers.amountRealUsd}) filter (where ${planBillingPublishers.isBillable}), 0)`,
        })
        .from(planBillingPublishers)
        .where(inArray(planBillingPublishers.planBillingId, billingIds))
        .groupBy(planBillingPublishers.planBillingId),
      db
        .select({
          planBillingId: planBillingFees.planBillingId,
          fees: sql<string>`coalesce(sum(${planBillingFees.amountImputedUsd}), 0)`,
        })
        .from(planBillingFees)
        .where(inArray(planBillingFees.planBillingId, billingIds))
        .groupBy(planBillingFees.planBillingId),
    ]);
    for (const r of pubSums)
      mediaByBilling.set(r.planBillingId, Number.parseFloat(r.media));
    for (const r of feeSums)
      feesByBilling.set(r.planBillingId, Number.parseFloat(r.fees));
  }

  const emitted = new Set<string>(EMITTED_STATUSES);
  let invoicedMediaUsd = 0;
  let invoicedFeesUsd = 0;
  let pendingMediaUsd = 0;
  let pendingFeesUsd = 0;
  const months: PlanBillingProgressMonth[] = billings.map((b) => {
    const mediaUsd = mediaByBilling.get(b.id) ?? 0;
    const feesUsd = feesByBilling.get(b.id) ?? 0;
    const isEmitted = emitted.has(b.status);
    if (isEmitted) {
      invoicedMediaUsd += mediaUsd;
      invoicedFeesUsd += feesUsd;
    } else {
      pendingMediaUsd += mediaUsd;
      pendingFeesUsd += feesUsd;
    }
    return { month: b.month, status: b.status, emitted: isEmitted, mediaUsd, feesUsd };
  });

  return {
    totalMediaUsd,
    totalFeesUsd,
    totalUsd: totalMediaUsd + totalFeesUsd,
    invoicedMediaUsd,
    invoicedFeesUsd,
    pendingMediaUsd,
    pendingFeesUsd,
    months,
  };
}
