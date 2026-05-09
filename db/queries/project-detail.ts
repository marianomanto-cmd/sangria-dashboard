import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  budgetOrigins,
  clients,
  mediaPlanFees,
  mediaPlanPlacements,
  mediaPlanPublishers,
  mediaPlans,
  mediaPlanSnapshots,
  planBillingPublishers,
  planBillings,
  projects,
  publishers,
} from "@/db/schema";

// ────────────────────────────────────────────────────────────────────────────
// Resumen de un proyecto + lista de planes peer
// ────────────────────────────────────────────────────────────────────────────

export type ProjectPlanSummary = {
  id: string;
  name: string;
  status: (typeof mediaPlans.$inferSelect)["status"];
  periodStart: string | null;
  periodEnd: string | null;
  currentVersion: number;
  publishersCount: number;
  placementsCount: number;
  totalMediaUsd: number;
  totalFeesUsd: number;
  totalUsd: number;
  spentRealUsd: number;
  lastSnapshotAt: Date | null;
  createdAt: Date;
};

export type ProjectWithPlans = {
  project: typeof projects.$inferSelect;
  client: { id: string; name: string; slug: string };
  budgetOrigin: { id: string; name: string; colorHex: string | null };
  plans: ProjectPlanSummary[];
};

export async function getProjectWithPlans(
  code: string,
): Promise<ProjectWithPlans | null> {
  const [row] = await db
    .select({
      project: projects,
      client: { id: clients.id, name: clients.name, slug: clients.slug },
      origin: {
        id: budgetOrigins.id,
        name: budgetOrigins.name,
        colorHex: budgetOrigins.colorHex,
      },
    })
    .from(projects)
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .innerJoin(budgetOrigins, eq(projects.budgetOriginId, budgetOrigins.id))
    .where(eq(projects.code, code))
    .limit(1);

  if (!row) return null;

  // Resumen de planes con totales agregados.
  const planSummaries = await db
    .select({
      id: mediaPlans.id,
      name: mediaPlans.name,
      status: mediaPlans.status,
      periodStart: mediaPlans.periodStart,
      periodEnd: mediaPlans.periodEnd,
      currentVersion: mediaPlans.currentVersion,
      createdAt: mediaPlans.createdAt,
      publishersCount: sql<number>`count(distinct ${mediaPlanPublishers.id})::int`,
      totalMediaUsd: sql<string>`coalesce(sum(${mediaPlanPublishers.totalPlannedUsd}), 0)`,
    })
    .from(mediaPlans)
    .leftJoin(
      mediaPlanPublishers,
      eq(mediaPlanPublishers.mediaPlanId, mediaPlans.id),
    )
    .where(eq(mediaPlans.projectId, row.project.id))
    .groupBy(mediaPlans.id)
    .orderBy(asc(mediaPlans.createdAt));

  if (planSummaries.length === 0) {
    return { project: row.project, client: row.client, budgetOrigin: row.origin, plans: [] };
  }

  const planIds = planSummaries.map((p) => p.id);

  // Counts de placements + total fees + último snapshot — en queries paralelas.
  const [placementCounts, feeTotals, lastSnaps, spentByPlan] = await Promise.all([
    db
      .select({
        planId: mediaPlanPublishers.mediaPlanId,
        count: sql<number>`count(*)::int`,
      })
      .from(mediaPlanPlacements)
      .innerJoin(
        mediaPlanPublishers,
        eq(mediaPlanPlacements.mediaPlanPublisherId, mediaPlanPublishers.id),
      )
      .where(sql`${mediaPlanPublishers.mediaPlanId} = ANY(${planIds})`)
      .groupBy(mediaPlanPublishers.mediaPlanId),
    db
      .select({
        planId: mediaPlanFees.mediaPlanId,
        total: sql<string>`coalesce(sum(${mediaPlanFees.amountUsd}), 0)`,
      })
      .from(mediaPlanFees)
      .where(sql`${mediaPlanFees.mediaPlanId} = ANY(${planIds})`)
      .groupBy(mediaPlanFees.mediaPlanId),
    db
      .select({
        planId: mediaPlanSnapshots.mediaPlanId,
        lastApprovedAt: sql<Date>`max(${mediaPlanSnapshots.approvedAt})`,
      })
      .from(mediaPlanSnapshots)
      .where(sql`${mediaPlanSnapshots.mediaPlanId} = ANY(${planIds})`)
      .groupBy(mediaPlanSnapshots.mediaPlanId),
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
      .where(sql`${planBillings.mediaPlanId} = ANY(${planIds})`)
      .groupBy(planBillings.mediaPlanId),
  ]);

  const placementCountByPlan = new Map(placementCounts.map((r) => [r.planId, r.count]));
  const feeTotalByPlan = new Map(feeTotals.map((r) => [r.planId, Number.parseFloat(r.total)]));
  const lastSnapByPlan = new Map(lastSnaps.map((r) => [r.planId, r.lastApprovedAt]));
  const spentByPlanMap = new Map(spentByPlan.map((r) => [r.planId, Number.parseFloat(r.spent)]));

  const plans: ProjectPlanSummary[] = planSummaries.map((p) => {
    const totalMedia = Number.parseFloat(p.totalMediaUsd);
    const totalFees = feeTotalByPlan.get(p.id) ?? 0;
    return {
      id: p.id,
      name: p.name,
      status: p.status,
      periodStart: p.periodStart,
      periodEnd: p.periodEnd,
      currentVersion: p.currentVersion,
      publishersCount: p.publishersCount,
      placementsCount: placementCountByPlan.get(p.id) ?? 0,
      totalMediaUsd: totalMedia,
      totalFeesUsd: totalFees,
      totalUsd: totalMedia + totalFees,
      spentRealUsd: spentByPlanMap.get(p.id) ?? 0,
      lastSnapshotAt: lastSnapByPlan.get(p.id) ?? null,
      createdAt: p.createdAt,
    };
  });

  return {
    project: row.project,
    client: row.client,
    budgetOrigin: row.origin,
    plans,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Detalle completo de un plan: publishers + placements + fees + snapshots
// ────────────────────────────────────────────────────────────────────────────

export type PlanPlacement = {
  id: string;
  placementName: string;
  market: string | null;
  amountUsd: number;
  costMethod: (typeof mediaPlanPlacements.$inferSelect)["costMethod"];
  startDate: string | null;
  endDate: string | null;
  metricsJson: Record<string, number>;
  notesMd: string | null;
  sortOrder: number;
};

export type PlanPublisherGroup = {
  id: string;                    // mediaPlanPublisher.id
  publisherId: string;
  publisherSlug: string;
  publisherName: string;
  totalPlannedUsd: number;
  agencyPays: boolean;
  sortOrder: number;
  placements: PlanPlacement[];
  placementsTotalUsd: number;
};

export type PlanFee = {
  id: string;
  feeType: (typeof mediaPlanFees.$inferSelect)["feeType"];
  name: string;
  amountUsd: number;
  notes: string | null;
  sortOrder: number;
};

export type PlanSnapshot = {
  id: string;
  versionNumber: number;
  approvedAt: Date;
  notes: string | null;
  pdfUrl: string | null;
  signedPdfUrl: string | null;
};

export type PlanDetail = {
  plan: typeof mediaPlans.$inferSelect;
  project: { id: string; code: string; name: string; totalGrossBudgetUsd: string | null };
  client: { id: string; name: string; slug: string };
  budgetOrigin: { id: string; name: string };
  publishers: PlanPublisherGroup[];
  fees: PlanFee[];
  snapshots: PlanSnapshot[];
  totals: {
    media: number;
    fees: number;
    grand: number;
  };
};

export async function getPlanDetail(planId: string): Promise<PlanDetail | null> {
  const [planRow] = await db
    .select({
      plan: mediaPlans,
      project: {
        id: projects.id,
        code: projects.code,
        name: projects.name,
        totalGrossBudgetUsd: projects.totalGrossBudgetUsd,
      },
      client: { id: clients.id, name: clients.name, slug: clients.slug },
      origin: { id: budgetOrigins.id, name: budgetOrigins.name },
    })
    .from(mediaPlans)
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .innerJoin(budgetOrigins, eq(projects.budgetOriginId, budgetOrigins.id))
    .where(eq(mediaPlans.id, planId))
    .limit(1);

  if (!planRow) return null;

  const pubRows = await db
    .select({
      mpp: mediaPlanPublishers,
      pub: { id: publishers.id, slug: publishers.slug, name: publishers.name, agencyPaysDefault: publishers.agencyPaysDefault },
    })
    .from(mediaPlanPublishers)
    .innerJoin(publishers, eq(mediaPlanPublishers.publisherId, publishers.id))
    .where(eq(mediaPlanPublishers.mediaPlanId, planId))
    .orderBy(asc(mediaPlanPublishers.sortOrder));

  const mppIds = pubRows.map((r) => r.mpp.id);

  const placementRows =
    mppIds.length === 0
      ? []
      : await db
          .select()
          .from(mediaPlanPlacements)
          .where(sql`${mediaPlanPlacements.mediaPlanPublisherId} = ANY(${mppIds})`)
          .orderBy(asc(mediaPlanPlacements.sortOrder));

  const feeRows = await db
    .select()
    .from(mediaPlanFees)
    .where(eq(mediaPlanFees.mediaPlanId, planId))
    .orderBy(asc(mediaPlanFees.sortOrder));

  const snapshotRows = await db
    .select({
      id: mediaPlanSnapshots.id,
      versionNumber: mediaPlanSnapshots.versionNumber,
      approvedAt: mediaPlanSnapshots.approvedAt,
      notes: mediaPlanSnapshots.notes,
      pdfUrl: mediaPlanSnapshots.pdfUrl,
      signedPdfUrl: mediaPlanSnapshots.signedPdfUrl,
    })
    .from(mediaPlanSnapshots)
    .where(eq(mediaPlanSnapshots.mediaPlanId, planId))
    .orderBy(desc(mediaPlanSnapshots.versionNumber));

  const placementsByPub = new Map<string, PlanPlacement[]>();
  for (const p of placementRows) {
    const list = placementsByPub.get(p.mediaPlanPublisherId) ?? [];
    list.push({
      id: p.id,
      placementName: p.placementName,
      market: p.market,
      amountUsd: Number.parseFloat(p.amountUsd),
      costMethod: p.costMethod,
      startDate: p.startDate,
      endDate: p.endDate,
      metricsJson: (p.metricsJson ?? {}) as Record<string, number>,
      notesMd: p.notesMd,
      sortOrder: p.sortOrder,
    });
    placementsByPub.set(p.mediaPlanPublisherId, list);
  }

  const publisherGroups: PlanPublisherGroup[] = pubRows.map((r) => {
    const placements = placementsByPub.get(r.mpp.id) ?? [];
    const placementsTotalUsd = placements.reduce((s, p) => s + p.amountUsd, 0);
    return {
      id: r.mpp.id,
      publisherId: r.pub.id,
      publisherSlug: r.pub.slug,
      publisherName: r.pub.name,
      totalPlannedUsd: Number.parseFloat(r.mpp.totalPlannedUsd),
      agencyPays: r.mpp.agencyPaysOverride ?? r.pub.agencyPaysDefault,
      sortOrder: r.mpp.sortOrder,
      placements,
      placementsTotalUsd,
    };
  });

  const fees: PlanFee[] = feeRows.map((f) => ({
    id: f.id,
    feeType: f.feeType,
    name: f.name,
    amountUsd: Number.parseFloat(f.amountUsd),
    notes: f.notes,
    sortOrder: f.sortOrder,
  }));

  const totalMedia = publisherGroups.reduce((s, g) => s + g.totalPlannedUsd, 0);
  const totalFees = fees.reduce((s, f) => s + f.amountUsd, 0);

  return {
    plan: planRow.plan,
    project: planRow.project,
    client: planRow.client,
    budgetOrigin: planRow.origin,
    publishers: publisherGroups,
    fees,
    snapshots: snapshotRows,
    totals: {
      media: totalMedia,
      fees: totalFees,
      grand: totalMedia + totalFees,
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Lista de proyectos "abiertos" (no closed) para el selector del MM
// al crear un plan nuevo.
// ────────────────────────────────────────────────────────────────────────────

export async function getOpenProjectsForPlanCreation() {
  const rows = await db
    .select({
      id: projects.id,
      code: projects.code,
      name: projects.name,
      clientName: clients.name,
      budgetOriginName: budgetOrigins.name,
      status: projects.status,
      totalGrossBudgetUsd: projects.totalGrossBudgetUsd,
    })
    .from(projects)
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .innerJoin(budgetOrigins, eq(projects.budgetOriginId, budgetOrigins.id))
    .where(and(sql`${projects.status} != 'closed'`))
    .orderBy(asc(projects.code));
  return rows;
}
