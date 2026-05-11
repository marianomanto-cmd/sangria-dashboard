import { desc, eq, sql } from "drizzle-orm";
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

export async function getBillingsList(
  options: { clientId?: string | null } = {},
): Promise<BillingListRow[]> {
  const filterClient = options.clientId ?? null;
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
    .innerJoin(mediaPlans, eq(planBillings.mediaPlanId, mediaPlans.id))
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .innerJoin(budgetOrigins, eq(projects.budgetOriginId, budgetOrigins.id))
    .orderBy(desc(planBillings.createdAt));

  const rows = filterClient
    ? await base.where(eq(projects.clientId, filterClient))
    : await base;

  return rows.map((r) => ({
    ...r,
    totalUsd: Number.parseFloat(r.totalUsd),
    totalNetUsd: Number.parseFloat(r.totalNetUsd),
    totalFeeUsd: Number.parseFloat(r.totalFeeUsd),
  }));
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
    .innerJoin(mediaPlans, eq(planBillings.mediaPlanId, mediaPlans.id))
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
      pub: { id: publishers.id, name: publishers.name, slug: publishers.slug, agencyPaysDefault: publishers.agencyPaysDefault, sortOrder: publishers.sortOrder },
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

  const publisherLines: BillingPublisherLine[] = planPubs
    .sort((a, b) => a.pub.sortOrder - b.pub.sortOrder)
    .map((r) => {
      const thisMonth = thisMonthMap.get(r.pub.id);
      const accumTotal = accumMap.get(r.pub.id) ?? 0;
      const thisMonthAmount = thisMonth ? Number.parseFloat(thisMonth.amountRealUsd) : 0;
      // Para mostrar "consumido antes de este mes": accum total - this month.
      const consumedBefore = accumTotal - thisMonthAmount;
      return {
        publisherId: r.pub.id,
        publisherName: r.pub.name,
        publisherSlug: r.pub.slug,
        publisherSortOrder: r.pub.sortOrder,
        agencyPays: r.mpp.agencyPaysOverride ?? r.pub.agencyPaysDefault,
        totalPlannedUsd: Number.parseFloat(r.mpp.totalPlannedUsd),
        consumedAccumulatedUsd: consumedBefore,
        amountThisMonthUsd: thisMonthAmount,
        isBillable: thisMonth?.isBillable ?? (r.mpp.agencyPaysOverride ?? r.pub.agencyPaysDefault),
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
