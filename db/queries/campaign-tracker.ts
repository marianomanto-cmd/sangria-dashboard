import { and, asc, desc, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  budgetOrigins,
  campaignActualSnapshots,
  campaignPlacementActuals,
  clients,
  markets,
  mediaPlanPlacements,
  mediaPlanPublishers,
  mediaPlans,
  metricsCatalog,
  projects,
  publishers,
} from "@/db/schema";
import {
  buildMetricRows,
  computePacePct,
  computePaceStatus,
  directKeysFromMetricsJson,
  parseLocalDate,
  type DirectGoal,
  type MetricRow,
  type PaceStatus,
} from "@/lib/campaign-metrics";

// ════════════════════════════════════════════════════════════════════════════
// Campaign Tracker — queries.
//
// Cada plan approved con período definido tiene un estado de tracking:
//   - 'vigente':   start <= hoy <= end         (necesita carga diaria)
//   - 'concluido': hoy > end                   (plan cerrado, queda histórico)
//   - 'futuro':    hoy < start                 (todavía no arrancó; excluido)
//
// El hub muestra por default sólo los vigentes, pero el filtro permite ver
// concluidos también — la data del editor (placements + actuals + snapshots)
// queda disponible para consulta histórica. Los clientes archivados se
// excluyen siempre y el scope respeta el filtro global ?client=.
//
// Los goals salen del plan (amount_usd + metrics_json de cada placement); los
// valores reales salen de campaign_placement_actuals.
// ════════════════════════════════════════════════════════════════════════════

export type CampaignHubFilter = "vigente" | "concluido" | "todos";
export type CampaignHubPlanStatus = "vigente" | "concluido";

const STALE_THRESHOLD_MS = 48 * 60 * 60 * 1000;

// ────────────────────────────────────────────────────────────────────────────
// Hub: planes vigentes agrupados por cliente
// ────────────────────────────────────────────────────────────────────────────

export type CampaignHubPlan = {
  planId: string;
  planName: string;
  currentVersion: number;
  projectId: string;
  projectCode: string;
  projectName: string;
  budgetOriginName: string;
  periodStart: string;
  periodEnd: string;
  placementsCount: number;
  publishersCount: number;
  goalInvestmentUsd: number;
  actualInvestmentUsd: number;
  progressPct: number;
  pacePct: number;
  paceStatus: PaceStatus;
  lastUpdateAt: Date | null;
  isStale: boolean;
  status: CampaignHubPlanStatus;
  lag: number; // pacePct - progressPct (rezago); usado para ordenar
};

export type CampaignHubClient = {
  clientId: string;
  clientName: string;
  clientSlug: string;
  plans: CampaignHubPlan[];
  worstLag: number;
};

export type CampaignHubResult = {
  clients: CampaignHubClient[];
  filter: CampaignHubFilter;
  totals: {
    plansCount: number;
    clientsCount: number;
    goalInvestmentUsd: number;
    actualInvestmentUsd: number;
    staleCount: number;
    offPaceCount: number;
  };
  // Conteo total por estado (sin importar el filtro aplicado), para los
  // chips de filtro del hub.
  statusCounts: {
    vigente: number;
    concluido: number;
  };
};

export async function getCampaignTrackerHub(
  clientId?: string | null,
  filter: CampaignHubFilter = "vigente",
): Promise<CampaignHubResult> {
  const today = new Date();

  const conds: SQL[] = [
    eq(mediaPlans.status, "approved"),
    ne(clients.status, "archived"),
  ];
  if (clientId) conds.push(eq(projects.clientId, clientId));

  const planRows = await db
    .select({
      planId: mediaPlans.id,
      planName: mediaPlans.name,
      currentVersion: mediaPlans.currentVersion,
      projectId: projects.id,
      projectCode: projects.code,
      projectName: projects.name,
      clientId: clients.id,
      clientName: clients.name,
      clientSlug: clients.slug,
      budgetOriginName: budgetOrigins.name,
      periodStart: sql<string | null>`min(${mediaPlanPlacements.startDate})::text`,
      periodEnd: sql<string | null>`max(${mediaPlanPlacements.endDate})::text`,
      placementsCount: sql<number>`count(distinct ${mediaPlanPlacements.id})::int`,
      publishersCount: sql<number>`count(distinct ${mediaPlanPublishers.id})::int`,
      goalInvestmentUsd: sql<string>`coalesce(sum(${mediaPlanPlacements.amountUsd}), 0)`,
    })
    .from(mediaPlans)
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .innerJoin(budgetOrigins, eq(projects.budgetOriginId, budgetOrigins.id))
    .leftJoin(
      mediaPlanPublishers,
      eq(mediaPlanPublishers.mediaPlanId, mediaPlans.id),
    )
    .leftJoin(
      mediaPlanPlacements,
      eq(mediaPlanPlacements.mediaPlanPublisherId, mediaPlanPublishers.id),
    )
    .where(and(...conds))
    .groupBy(mediaPlans.id, projects.id, clients.id, budgetOrigins.id);

  // Clasificamos cada plan en vigente / concluido / futuro. Excluimos los
  // futuros y los que no tienen período definido (placements sin fechas).
  const todayMs = today.getTime();
  const classified = planRows.flatMap((r) => {
    if (!r.periodStart || !r.periodEnd) return [];
    const start = parseLocalDate(r.periodStart);
    const end = parseLocalDate(r.periodEnd);
    if (!start || !end) return [];
    const endOfDay = end.getTime() + 24 * 60 * 60 * 1000 - 1;
    if (todayMs < start.getTime()) return []; // futuro: fuera del hub
    const status: CampaignHubPlanStatus = todayMs > endOfDay ? "concluido" : "vigente";
    return [{ row: r, status }];
  });

  const statusCounts = {
    vigente: classified.filter((c) => c.status === "vigente").length,
    concluido: classified.filter((c) => c.status === "concluido").length,
  };

  const filtered =
    filter === "todos"
      ? classified
      : classified.filter((c) => c.status === filter);

  if (filtered.length === 0) {
    return {
      clients: [],
      filter,
      totals: {
        plansCount: 0,
        clientsCount: 0,
        goalInvestmentUsd: 0,
        actualInvestmentUsd: 0,
        staleCount: 0,
        offPaceCount: 0,
      },
      statusCounts,
    };
  }

  const planIds = filtered.map((c) => c.row.planId);

  // Inversión real acumulada (metric_key='amount') + última edición de
  // cualquier métrica, por plan.
  const actualRows = await db
    .select({
      planId: mediaPlanPublishers.mediaPlanId,
      actualInvestment: sql<string>`coalesce(sum(${campaignPlacementActuals.valueActual}) filter (where ${campaignPlacementActuals.metricKey} = 'amount'), 0)`,
      lastUpdateAt: sql<string | null>`max(${campaignPlacementActuals.updatedAt})::text`,
    })
    .from(campaignPlacementActuals)
    .innerJoin(
      mediaPlanPlacements,
      eq(campaignPlacementActuals.placementId, mediaPlanPlacements.id),
    )
    .innerJoin(
      mediaPlanPublishers,
      eq(mediaPlanPlacements.mediaPlanPublisherId, mediaPlanPublishers.id),
    )
    .where(inArray(mediaPlanPublishers.mediaPlanId, planIds))
    .groupBy(mediaPlanPublishers.mediaPlanId);

  const actualByPlan = new Map(
    actualRows.map((r) => [
      r.planId,
      {
        actualInvestment: Number.parseFloat(r.actualInvestment),
        lastUpdateAt: r.lastUpdateAt ? new Date(r.lastUpdateAt) : null,
      },
    ]),
  );

  const byClient = new Map<string, CampaignHubClient>();
  let goalSum = 0;
  let actualSum = 0;
  let staleCount = 0;
  let offPaceCount = 0;

  for (const { row: r, status } of filtered) {
    const goalInvestmentUsd = Number.parseFloat(r.goalInvestmentUsd);
    const actuals = actualByPlan.get(r.planId);
    const actualInvestmentUsd = actuals?.actualInvestment ?? 0;
    const lastUpdateAt = actuals?.lastUpdateAt ?? null;
    const progressPct =
      goalInvestmentUsd > 0
        ? (actualInvestmentUsd / goalInvestmentUsd) * 100
        : 0;
    const pacePct = computePacePct(r.periodStart, r.periodEnd, today);
    const paceStatus = computePaceStatus(progressPct, pacePct);
    // Para concluidos no aplica el aviso de "sin update": el plan ya terminó.
    const isStale =
      status === "vigente" &&
      (lastUpdateAt == null ||
        todayMs - lastUpdateAt.getTime() >= STALE_THRESHOLD_MS);

    goalSum += goalInvestmentUsd;
    actualSum += actualInvestmentUsd;
    if (isStale) staleCount += 1;
    if (paceStatus !== "on_pace") offPaceCount += 1;

    const plan: CampaignHubPlan = {
      planId: r.planId,
      planName: r.planName,
      currentVersion: r.currentVersion,
      projectId: r.projectId,
      projectCode: r.projectCode,
      projectName: r.projectName,
      budgetOriginName: r.budgetOriginName,
      periodStart: r.periodStart!,
      periodEnd: r.periodEnd!,
      placementsCount: r.placementsCount,
      publishersCount: r.publishersCount,
      goalInvestmentUsd,
      actualInvestmentUsd,
      progressPct,
      pacePct,
      paceStatus,
      lastUpdateAt,
      isStale,
      status,
      lag: pacePct - progressPct,
    };

    let group = byClient.get(r.clientId);
    if (!group) {
      group = {
        clientId: r.clientId,
        clientName: r.clientName,
        clientSlug: r.clientSlug,
        plans: [],
        worstLag: Number.NEGATIVE_INFINITY,
      };
      byClient.set(r.clientId, group);
    }
    group.plans.push(plan);
    group.worstLag = Math.max(group.worstLag, plan.lag);
  }

  // Más rezagado primero: dentro de cada cliente y entre clientes. Para
  // concluidos, "lag" deja de ser accionable pero igual da un orden
  // determinístico (los más cortos vs goal primero).
  const clientGroups = Array.from(byClient.values());
  for (const g of clientGroups) {
    g.plans.sort((a, b) => b.lag - a.lag);
  }
  clientGroups.sort((a, b) => b.worstLag - a.worstLag);

  return {
    clients: clientGroups,
    filter,
    totals: {
      plansCount: filtered.length,
      clientsCount: clientGroups.length,
      goalInvestmentUsd: goalSum,
      actualInvestmentUsd: actualSum,
      staleCount,
      offPaceCount,
    },
    statusCounts,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Vista de carga: detalle de un plan con goals + valores reales por placement
// ────────────────────────────────────────────────────────────────────────────

export type TrackerMetricRow = MetricRow;

export type TrackerPlacement = {
  id: string;
  name: string;
  audience: string | null;
  marketName: string | null;
  costMethod: string | null;
  startDate: string | null;
  endDate: string | null;
  pacePct: number;
  metrics: TrackerMetricRow[];
  // Valores direct de la última carga cerrada (para "Comparar con última
  // carga"). Vacío si el plan nunca se cerró.
  previousActuals: Record<string, number>;
  goalInvestmentUsd: number;
  actualInvestmentUsd: number;
  progressPct: number;
  paceStatus: PaceStatus;
};

export type TrackerPublisherGroup = {
  id: string;
  publisherName: string;
  publisherSlug: string;
  totalPlannedUsd: number;
  placements: TrackerPlacement[];
  goalInvestmentUsd: number;
  actualInvestmentUsd: number;
  progressPct: number;
  paceStatus: PaceStatus;
};

export type CampaignTrackerPlan = {
  plan: {
    id: string;
    name: string;
    currentVersion: number;
    status: string;
  };
  project: { code: string; name: string };
  client: { id: string; name: string; slug: string; language: "en" | "es" };
  budgetOriginName: string;
  periodStart: string | null;
  periodEnd: string | null;
  pacePct: number;
  publishers: TrackerPublisherGroup[];
  goalInvestmentUsd: number;
  actualInvestmentUsd: number;
  lastUpdateAt: Date | null;
  // Fecha (YYYY-MM-DD) de la última vez que se cerró la carga del plan, o
  // null si nunca se cerró.
  lastCloseDate: string | null;
  hasGoals: boolean;
};

export async function getCampaignTrackerPlan(
  planId: string,
): Promise<CampaignTrackerPlan | null> {
  const [planRow] = await db
    .select({
      planId: mediaPlans.id,
      planName: mediaPlans.name,
      currentVersion: mediaPlans.currentVersion,
      status: mediaPlans.status,
      projectCode: projects.code,
      projectName: projects.name,
      clientId: clients.id,
      clientName: clients.name,
      clientSlug: clients.slug,
      clientLanguage: clients.language,
      budgetOriginName: budgetOrigins.name,
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
      id: mediaPlanPublishers.id,
      publisherName: publishers.name,
      publisherSlug: publishers.slug,
      totalPlannedUsd: mediaPlanPublishers.totalPlannedUsd,
      sortOrder: mediaPlanPublishers.sortOrder,
    })
    .from(mediaPlanPublishers)
    .innerJoin(publishers, eq(mediaPlanPublishers.publisherId, publishers.id))
    .where(eq(mediaPlanPublishers.mediaPlanId, planId))
    .orderBy(asc(mediaPlanPublishers.sortOrder));

  const mppIds = pubRows.map((r) => r.id);

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

  const placementIds = placementRows.map((r) => r.placement.id);

  const actualRows =
    placementIds.length === 0
      ? []
      : await db
          .select()
          .from(campaignPlacementActuals)
          .where(inArray(campaignPlacementActuals.placementId, placementIds));

  // actuals[placementId][metricKey] = value
  const actualsByPlacement = new Map<string, Map<string, number>>();
  let lastUpdateAt: Date | null = null;
  for (const a of actualRows) {
    let m = actualsByPlacement.get(a.placementId);
    if (!m) {
      m = new Map();
      actualsByPlacement.set(a.placementId, m);
    }
    m.set(a.metricKey, Number.parseFloat(a.valueActual));
    if (!lastUpdateAt || a.updatedAt > lastUpdateAt) lastUpdateAt = a.updatedAt;
  }

  // Histórico: valores de la última carga cerrada, para "Comparar con última
  // carga". lastCloseDate = snapshot_date más reciente del plan.
  const snapshotRows =
    placementIds.length === 0
      ? []
      : await db
          .select({
            placementId: campaignActualSnapshots.placementId,
            metricKey: campaignActualSnapshots.metricKey,
            valueAccumulated: campaignActualSnapshots.valueAccumulated,
            snapshotDate: campaignActualSnapshots.snapshotDate,
          })
          .from(campaignActualSnapshots)
          .where(inArray(campaignActualSnapshots.placementId, placementIds))
          .orderBy(desc(campaignActualSnapshots.snapshotDate));

  let lastCloseDate: string | null = null;
  for (const s of snapshotRows) {
    if (!lastCloseDate || s.snapshotDate > lastCloseDate)
      lastCloseDate = s.snapshotDate;
  }
  const previousByPlacement = new Map<string, Record<string, number>>();
  if (lastCloseDate) {
    for (const s of snapshotRows) {
      if (s.snapshotDate !== lastCloseDate) continue;
      const rec = previousByPlacement.get(s.placementId) ?? {};
      rec[s.metricKey] = Number.parseFloat(s.valueAccumulated);
      previousByPlacement.set(s.placementId, rec);
    }
  }

  // Catálogo de métricas del cliente para los labels.
  const catalogRows = await db
    .select({
      slug: metricsCatalog.slug,
      name: metricsCatalog.name,
    })
    .from(metricsCatalog)
    .where(eq(metricsCatalog.clientId, planRow.clientId));
  const labelBySlug = new Map(catalogRows.map((r) => [r.slug, r.name]));

  // Período derivado del plan (min/max de fechas de placements).
  let periodStart: string | null = null;
  let periodEnd: string | null = null;
  for (const r of placementRows) {
    const { startDate, endDate } = r.placement;
    if (startDate && (!periodStart || startDate < periodStart))
      periodStart = startDate;
    if (endDate && (!periodEnd || endDate > periodEnd)) periodEnd = endDate;
  }
  const today = new Date();
  const planPacePct = computePacePct(periodStart, periodEnd, today);

  const placementsByPub = new Map<string, TrackerPlacement[]>();
  let hasGoals = false;

  for (const r of placementRows) {
    const p = r.placement;
    const metricsJson = (p.metricsJson ?? {}) as Record<string, number>;
    const goalAmount = Number.parseFloat(p.amountUsd);
    const directKeys = ["amount", ...directKeysFromMetricsJson(metricsJson)];
    const actuals = actualsByPlacement.get(p.id) ?? new Map<string, number>();

    const directGoals: DirectGoal[] = directKeys.map((k) => ({
      key: k,
      goal: k === "amount" ? goalAmount : (metricsJson[k] ?? 0),
    }));
    const actualsRecord: Record<string, number> = {};
    for (const k of directKeys) actualsRecord[k] = actuals.get(k) ?? 0;

    if (goalAmount > 0 || directKeys.length > 1) hasGoals = true;

    const metrics = buildMetricRows(
      directGoals,
      actualsRecord,
      (key, fallback) => labelBySlug.get(key) ?? fallback,
    );

    const actualInvestmentUsd = actuals.get("amount") ?? 0;
    const progressPct =
      goalAmount > 0 ? (actualInvestmentUsd / goalAmount) * 100 : 0;
    const pacePct =
      p.startDate && p.endDate
        ? computePacePct(p.startDate, p.endDate, today)
        : planPacePct;

    const placement: TrackerPlacement = {
      id: p.id,
      name: p.placementName,
      audience: p.audience,
      marketName: r.marketName,
      costMethod: p.costMethod,
      startDate: p.startDate,
      endDate: p.endDate,
      pacePct,
      metrics,
      previousActuals: previousByPlacement.get(p.id) ?? {},
      goalInvestmentUsd: goalAmount,
      actualInvestmentUsd,
      progressPct,
      paceStatus: computePaceStatus(progressPct, pacePct),
    };

    const list = placementsByPub.get(p.mediaPlanPublisherId) ?? [];
    list.push(placement);
    placementsByPub.set(p.mediaPlanPublisherId, list);
  }

  const publisherGroups: TrackerPublisherGroup[] = pubRows.map((r) => {
    const placements = placementsByPub.get(r.id) ?? [];
    const goalInvestmentUsd = placements.reduce(
      (s, pl) => s + pl.goalInvestmentUsd,
      0,
    );
    const actualInvestmentUsd = placements.reduce(
      (s, pl) => s + pl.actualInvestmentUsd,
      0,
    );
    const progressPct =
      goalInvestmentUsd > 0
        ? (actualInvestmentUsd / goalInvestmentUsd) * 100
        : 0;
    return {
      id: r.id,
      publisherName: r.publisherName,
      publisherSlug: r.publisherSlug,
      totalPlannedUsd: Number.parseFloat(r.totalPlannedUsd),
      placements,
      goalInvestmentUsd,
      actualInvestmentUsd,
      progressPct,
      paceStatus: computePaceStatus(progressPct, planPacePct),
    };
  });

  const goalInvestmentUsd = publisherGroups.reduce(
    (s, g) => s + g.goalInvestmentUsd,
    0,
  );
  const actualInvestmentUsd = publisherGroups.reduce(
    (s, g) => s + g.actualInvestmentUsd,
    0,
  );

  return {
    plan: {
      id: planRow.planId,
      name: planRow.planName,
      currentVersion: planRow.currentVersion,
      status: planRow.status,
    },
    project: { code: planRow.projectCode, name: planRow.projectName },
    client: {
      id: planRow.clientId,
      name: planRow.clientName,
      slug: planRow.clientSlug,
      language: planRow.clientLanguage,
    },
    budgetOriginName: planRow.budgetOriginName,
    periodStart,
    periodEnd,
    pacePct: planPacePct,
    publishers: publisherGroups,
    goalInvestmentUsd,
    actualInvestmentUsd,
    lastUpdateAt,
    lastCloseDate,
    hasGoals,
  };
}
