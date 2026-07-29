import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { sanitizeMerges, type AuxMerge } from "@/lib/aux-sheet";
import {
  budgetOrigins,
  clients,
  markets,
  mediaPlanAuxSheets,
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
  client: {
    id: string;
    name: string;
    slug: string;
    language: (typeof clients.$inferSelect)["language"];
  };
  budgetOrigin: { id: string; name: string; colorHex: string | null };
  plans: ProjectPlanSummary[];
};

export async function getProjectWithPlans(
  code: string,
): Promise<ProjectWithPlans | null> {
  const [row] = await db
    .select({
      project: projects,
      client: {
        id: clients.id,
        name: clients.name,
        slug: clients.slug,
        language: clients.language,
      },
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

  // Resumen de planes con totales agregados. Las fechas del plan se derivan
  // de min(placement.startDate) / max(placement.endDate) — calculadas en
  // una query separada para mantener el SQL simple.
  const planSummaries = await db
    .select({
      id: mediaPlans.id,
      name: mediaPlans.name,
      status: mediaPlans.status,
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
    .where(and(eq(mediaPlans.projectId, row.project.id), isNull(mediaPlans.deletedAt)))
    .groupBy(mediaPlans.id)
    .orderBy(asc(mediaPlans.createdAt));

  if (planSummaries.length === 0) {
    return { project: row.project, client: row.client, budgetOrigin: row.origin, plans: [] };
  }

  const planIds = planSummaries.map((p) => p.id);

  // Counts de placements + total fees + último snapshot + período derivado
  // — en queries paralelas.
  const [placementCountsAndDates, feeTotals, lastSnaps, spentByPlan] = await Promise.all([
    db
      .select({
        planId: mediaPlanPublishers.mediaPlanId,
        count: sql<number>`count(*)::int`,
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
    db
      .select({
        planId: mediaPlanFees.mediaPlanId,
        // Fees con monto fijo (todos los no-management + management sin rate)
        fixedTotal: sql<string>`coalesce(sum(${mediaPlanFees.amountUsd}) filter (where ${mediaPlanFees.ratePct} is null or ${mediaPlanFees.feeType} != 'management'), 0)`,
        // Rate de management fee (asumimos uno solo por plan)
        mgmtRatePct: sql<string | null>`max(${mediaPlanFees.ratePct}) filter (where ${mediaPlanFees.feeType} = 'management')::text`,
      })
      .from(mediaPlanFees)
      .where(inArray(mediaPlanFees.mediaPlanId, planIds))
      .groupBy(mediaPlanFees.mediaPlanId),
    db
      .select({
        planId: mediaPlanSnapshots.mediaPlanId,
        lastApprovedAt: sql<string>`max(${mediaPlanSnapshots.approvedAt})::text`,
      })
      .from(mediaPlanSnapshots)
      .where(inArray(mediaPlanSnapshots.mediaPlanId, planIds))
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
      .where(inArray(planBillings.mediaPlanId, planIds))
      .groupBy(planBillings.mediaPlanId),
  ]);

  const placementCountByPlan = new Map(
    placementCountsAndDates.map((r) => [r.planId, r.count]),
  );
  const periodByPlan = new Map(
    placementCountsAndDates.map((r) => [
      r.planId,
      { periodStart: r.periodStart, periodEnd: r.periodEnd },
    ]),
  );
  const feeDataByPlan = new Map(
    feeTotals.map((r) => [
      r.planId,
      {
        fixed: Number.parseFloat(r.fixedTotal),
        mgmtRatePct: r.mgmtRatePct ? Number.parseFloat(r.mgmtRatePct) : null,
      },
    ]),
  );
  const lastSnapByPlan = new Map(
    lastSnaps.map((r) => [r.planId, r.lastApprovedAt ? new Date(r.lastApprovedAt) : null]),
  );
  const spentByPlanMap = new Map(spentByPlan.map((r) => [r.planId, Number.parseFloat(r.spent)]));

  const plans: ProjectPlanSummary[] = planSummaries.map((p) => {
    const totalMedia = Number.parseFloat(p.totalMediaUsd);
    const feeData = feeDataByPlan.get(p.id);
    const fixedFees = feeData?.fixed ?? 0;
    const mgmtFee =
      feeData?.mgmtRatePct != null && feeData.mgmtRatePct < 100
        ? (totalMedia * feeData.mgmtRatePct) / (100 - feeData.mgmtRatePct)
        : 0;
    const totalFees = fixedFees + mgmtFee;
    const period = periodByPlan.get(p.id);
    return {
      id: p.id,
      name: p.name,
      status: p.status,
      periodStart: period?.periodStart ?? null,
      periodEnd: period?.periodEnd ?? null,
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
  marketId: string | null;
  marketName: string | null;            // join contra markets para mostrar
  audience: string | null;
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
  amountUsd: number;        // computado dinámicamente para management con ratePct
  ratePct: number | null;   // solo para management; null en otros tipos
  isAutoComputed: boolean;  // true cuando amount viene del rate %
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

// Tabs auxiliares del plan (N, opcionales): grillas libres que se editan en
// el editor y salen como tabs extra del Excel. Ver lib/aux-sheet.ts.
export type PlanAuxSheet = {
  id: string;
  name: string;
  grid: string[][];
  merges: AuxMerge[];
};

export type PlanDetail = {
  plan: typeof mediaPlans.$inferSelect;
  project: { id: string; code: string; name: string; totalGrossBudgetUsd: string | null };
  client: {
    id: string;
    name: string;
    slug: string;
    language: (typeof clients.$inferSelect)["language"];
  };
  budgetOrigin: { id: string; name: string };
  publishers: PlanPublisherGroup[];
  fees: PlanFee[];
  snapshots: PlanSnapshot[];
  auxSheets: PlanAuxSheet[];
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
      client: {
        id: clients.id,
        name: clients.name,
        slug: clients.slug,
        language: clients.language,
      },
      origin: { id: budgetOrigins.id, name: budgetOrigins.name },
    })
    .from(mediaPlans)
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .innerJoin(budgetOrigins, eq(projects.budgetOriginId, budgetOrigins.id))
    .where(and(eq(mediaPlans.id, planId), isNull(mediaPlans.deletedAt)))
    .limit(1);

  if (!planRow) return null;

  // El publisher es per-cliente: su `agencyPays` es el default del cliente,
  // que el bloque del plan puede overridear (agencyPaysOverride).
  const pubRows = await db
    .select({
      mpp: mediaPlanPublishers,
      pub: {
        id: publishers.id,
        slug: publishers.slug,
        name: publishers.name,
        agencyPays: publishers.agencyPays,
      },
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
          .select({
            placement: mediaPlanPlacements,
            marketName: markets.name,
          })
          .from(mediaPlanPlacements)
          .leftJoin(markets, eq(mediaPlanPlacements.marketId, markets.id))
          .where(inArray(mediaPlanPlacements.mediaPlanPublisherId, mppIds))
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

  // Defensivo ante la ventana deploy-antes-de-migración. Dos capas:
  //  1) tabla ausente → sin tabs auxiliares (no rompe el plan).
  //  2) columna merges_json ausente (migración nueva sin correr) → se vuelve a
  //     leer SIN esa columna para no esconder los tabs hasta correr el SQL.
  type AuxRow = {
    id: string;
    name: string;
    gridJson: string[][] | null;
    mergesJson: AuxMerge[] | null;
  };
  let auxSheetRows: AuxRow[] = [];
  try {
    auxSheetRows = await db
      .select({
        id: mediaPlanAuxSheets.id,
        name: mediaPlanAuxSheets.name,
        gridJson: mediaPlanAuxSheets.gridJson,
        mergesJson: mediaPlanAuxSheets.mergesJson,
      })
      .from(mediaPlanAuxSheets)
      .where(eq(mediaPlanAuxSheets.mediaPlanId, planId))
      .orderBy(asc(mediaPlanAuxSheets.sortOrder), asc(mediaPlanAuxSheets.createdAt));
  } catch {
    try {
      const rows = await db
        .select({
          id: mediaPlanAuxSheets.id,
          name: mediaPlanAuxSheets.name,
          gridJson: mediaPlanAuxSheets.gridJson,
        })
        .from(mediaPlanAuxSheets)
        .where(eq(mediaPlanAuxSheets.mediaPlanId, planId))
        .orderBy(asc(mediaPlanAuxSheets.sortOrder), asc(mediaPlanAuxSheets.createdAt));
      auxSheetRows = rows.map((r) => ({ ...r, mergesJson: [] }));
    } catch {
      auxSheetRows = [];
    }
  }

  const placementsByPub = new Map<string, PlanPlacement[]>();
  for (const r of placementRows) {
    const p = r.placement;
    const list = placementsByPub.get(p.mediaPlanPublisherId) ?? [];
    list.push({
      id: p.id,
      placementName: p.placementName,
      marketId: p.marketId,
      marketName: r.marketName,
      audience: p.audience,
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
    // Override del bloque del plan > default del publisher per-cliente.
    return {
      id: r.mpp.id,
      publisherId: r.pub.id,
      publisherSlug: r.pub.slug,
      publisherName: r.pub.name,
      totalPlannedUsd: Number.parseFloat(r.mpp.totalPlannedUsd),
      agencyPays: r.mpp.agencyPaysOverride ?? r.pub.agencyPays,
      sortOrder: r.mpp.sortOrder,
      placements,
      placementsTotalUsd,
    };
  });

  const totalMedia = publisherGroups.reduce((s, g) => s + g.totalPlannedUsd, 0);

  const fees: PlanFee[] = feeRows.map((f) => {
    const ratePct = f.ratePct ? Number.parseFloat(f.ratePct) : null;
    let amount = Number.parseFloat(f.amountUsd);
    let isAutoComputed = false;
    if (
      f.feeType === "management" &&
      ratePct != null &&
      ratePct > 0 &&
      ratePct < 100
    ) {
      // amount = TM × ratePct / (100 - ratePct)
      // Equivalente a la fórmula del usuario: TM/(1 - ratePct/100) - TM.
      amount = (totalMedia * ratePct) / (100 - ratePct);
      isAutoComputed = true;
    }
    return {
      id: f.id,
      feeType: f.feeType,
      name: f.name,
      amountUsd: amount,
      ratePct,
      isAutoComputed,
      notes: f.notes,
      sortOrder: f.sortOrder,
    };
  });

  const totalFees = fees.reduce((s, f) => s + f.amountUsd, 0);

  return {
    plan: planRow.plan,
    project: planRow.project,
    client: planRow.client,
    budgetOrigin: planRow.origin,
    publishers: publisherGroups,
    fees,
    snapshots: snapshotRows,
    auxSheets: auxSheetRows.map((s) => {
      const grid = s.gridJson ?? [];
      return {
        id: s.id,
        name: s.name,
        grid,
        merges: sanitizeMerges(s.mergesJson ?? [], grid),
      };
    }),
    totals: {
      media: totalMedia,
      fees: totalFees,
      grand: totalMedia + totalFees,
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Plan RECONSTRUIDO desde el snapshot de una versión aprobada.
//
// Devuelve la MISMA forma que getPlanDetail, pero con los publishers /
// placements / fees congelados en `media_plan_snapshots.snapshot_json` de la
// versión pedida. Sirve para bajar el Excel/PDF de una versión vieja del plan
// (historial de aprobaciones) sin tocar el plan vigente.
//
// Qué sale del snapshot y qué del presente:
//   • Del SNAPSHOT: plan (nombre de entonces), publishers del plan, placements y
//     fees — o sea los números tal cual se aprobaron.
//   • Del PRESENTE: nombres de publisher y de mercado (son catálogos: el
//     snapshot guarda sus IDs, y el nombre actual es la etiqueta correcta), más
//     el contexto de proyecto / cliente / budget origin.
//
// Ojo: `capturePlanSnapshot` NO captura los tabs auxiliares, así que un export
// de versión vieja sale sin ellos (`auxSheets: []`). Es una limitación conocida
// de los snapshots viejos, no de este export.
// ────────────────────────────────────────────────────────────────────────────

// Forma de lo que guarda capturePlanSnapshot (app/actions/plans.ts). Los
// numéricos y las fechas vuelven del JSONB como string.
type SnapshotJson = {
  plan?: typeof mediaPlans.$inferSelect;
  publishers?: (typeof mediaPlanPublishers.$inferSelect)[];
  placements?: (typeof mediaPlanPlacements.$inferSelect)[];
  fees?: (typeof mediaPlanFees.$inferSelect)[];
};

export async function getPlanDetailAtVersion(
  planId: string,
  version: number,
): Promise<PlanDetail | null> {
  if (!Number.isInteger(version) || version < 1) return null;

  const [planRow] = await db
    .select({
      plan: mediaPlans,
      project: {
        id: projects.id,
        code: projects.code,
        name: projects.name,
        totalGrossBudgetUsd: projects.totalGrossBudgetUsd,
      },
      client: {
        id: clients.id,
        name: clients.name,
        slug: clients.slug,
        language: clients.language,
      },
      origin: { id: budgetOrigins.id, name: budgetOrigins.name },
    })
    .from(mediaPlans)
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .innerJoin(budgetOrigins, eq(projects.budgetOriginId, budgetOrigins.id))
    .where(and(eq(mediaPlans.id, planId), isNull(mediaPlans.deletedAt)))
    .limit(1);

  if (!planRow) return null;

  const [snap] = await db
    .select({
      id: mediaPlanSnapshots.id,
      versionNumber: mediaPlanSnapshots.versionNumber,
      approvedAt: mediaPlanSnapshots.approvedAt,
      notes: mediaPlanSnapshots.notes,
      snapshotJson: mediaPlanSnapshots.snapshotJson,
    })
    .from(mediaPlanSnapshots)
    .where(
      and(
        eq(mediaPlanSnapshots.mediaPlanId, planId),
        eq(mediaPlanSnapshots.versionNumber, version),
      ),
    )
    .limit(1);

  if (!snap) return null;
  const data = (snap.snapshotJson ?? {}) as SnapshotJson;
  if (!data.plan) return null; // snapshot vacío / corrupto

  const snapPubs = data.publishers ?? [];
  const snapPlacements = data.placements ?? [];
  const snapFees = data.fees ?? [];

  // Catálogos del presente para etiquetar los IDs congelados.
  const publisherIds = Array.from(
    new Set(snapPubs.map((p) => p.publisherId).filter(Boolean)),
  );
  const pubCatalog = publisherIds.length
    ? await db
        .select({
          id: publishers.id,
          slug: publishers.slug,
          name: publishers.name,
          agencyPays: publishers.agencyPays,
        })
        .from(publishers)
        .where(inArray(publishers.id, publisherIds))
    : [];
  const pubById = new Map(pubCatalog.map((p) => [p.id, p]));

  const marketIds = Array.from(
    new Set(
      snapPlacements
        .map((p) => p.marketId)
        .filter((id): id is string => !!id),
    ),
  );
  const marketCatalog = marketIds.length
    ? await db
        .select({ id: markets.id, name: markets.name })
        .from(markets)
        .where(inArray(markets.id, marketIds))
    : [];
  const marketNameById = new Map(marketCatalog.map((m) => [m.id, m.name]));

  // Historial completo, para que la forma sea idéntica a getPlanDetail.
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

  const num = (v: unknown) => Number.parseFloat(String(v ?? "0")) || 0;

  const placementsByPub = new Map<string, PlanPlacement[]>();
  for (const p of snapPlacements) {
    const list = placementsByPub.get(p.mediaPlanPublisherId) ?? [];
    list.push({
      id: p.id,
      placementName: p.placementName,
      marketId: p.marketId ?? null,
      marketName: p.marketId ? (marketNameById.get(p.marketId) ?? null) : null,
      audience: p.audience ?? null,
      amountUsd: num(p.amountUsd),
      costMethod: p.costMethod ?? null,
      startDate: p.startDate ?? null,
      endDate: p.endDate ?? null,
      metricsJson: (p.metricsJson ?? {}) as Record<string, number>,
      notesMd: p.notesMd ?? null,
      sortOrder: p.sortOrder ?? 0,
    });
    placementsByPub.set(p.mediaPlanPublisherId, list);
  }
  for (const list of placementsByPub.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  const publisherGroups: PlanPublisherGroup[] = [...snapPubs]
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((mpp) => {
      const cat = pubById.get(mpp.publisherId);
      const placements = placementsByPub.get(mpp.id) ?? [];
      return {
        id: mpp.id,
        publisherId: mpp.publisherId,
        publisherSlug: cat?.slug ?? "",
        // Un publisher borrado del catálogo después de la aprobación no se
        // puede etiquetar: mostramos el fallback en vez de romper el export.
        publisherName: cat?.name ?? "(publisher dado de baja)",
        totalPlannedUsd: num(mpp.totalPlannedUsd),
        agencyPays: mpp.agencyPaysOverride ?? cat?.agencyPays ?? true,
        sortOrder: mpp.sortOrder ?? 0,
        placements,
        placementsTotalUsd: placements.reduce((s, p) => s + p.amountUsd, 0),
      };
    });

  const totalMedia = publisherGroups.reduce((s, g) => s + g.totalPlannedUsd, 0);

  const fees: PlanFee[] = [...snapFees]
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((f) => {
      const ratePct = f.ratePct != null ? num(f.ratePct) : null;
      let amount = num(f.amountUsd);
      let isAutoComputed = false;
      // Mismo criterio que getPlanDetail: el management fee con rate se DERIVA
      // del total media (acá, el del snapshot).
      if (
        f.feeType === "management" &&
        ratePct != null &&
        ratePct > 0 &&
        ratePct < 100
      ) {
        amount = (totalMedia * ratePct) / (100 - ratePct);
        isAutoComputed = true;
      }
      return {
        id: f.id,
        feeType: f.feeType,
        name: f.name,
        amountUsd: amount,
        ratePct,
        isAutoComputed,
        notes: f.notes ?? null,
        sortOrder: f.sortOrder ?? 0,
      };
    });

  const totalFees = fees.reduce((s, f) => s + f.amountUsd, 0);

  return {
    // El snapshot se captura ANTES de bumpear la versión, así que su
    // plan.currentVersion es la anterior: lo forzamos a la versión pedida (y a
    // 'approved') para que headers, labels y nombre de archivo digan V{n}.
    plan: {
      ...data.plan,
      currentVersion: version,
      status: "approved" as const,
    },
    project: planRow.project,
    client: planRow.client,
    budgetOrigin: planRow.origin,
    publishers: publisherGroups,
    fees,
    snapshots: snapshotRows,
    auxSheets: [], // los snapshots no capturan tabs auxiliares
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
    .where(and(sql`${projects.status} not in ('closed', 'reportado')`))
    .orderBy(asc(projects.code));
  return rows;
}
