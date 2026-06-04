import { and, asc, eq, gte, isNull, lte, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  budgetOrigins,
  markets,
  mediaPlanPlacements,
  mediaPlanPublishers,
  mediaPlans,
  projects,
  publishers,
} from "@/db/schema";

// ════════════════════════════════════════════════════════════════════════════
// Análisis por publisher × mercado: "activaciones" = placements de planes
// APROBADOS del cliente. Una fila por placement (detalle) + agregado por
// mercado (para el mapa). Scopeado al cliente; filtrable por publisher,
// mercado, budget origin y período.
// ════════════════════════════════════════════════════════════════════════════

export type ActivationRow = {
  id: string;
  projectName: string;
  projectCode: string;
  planName: string;
  publisherName: string;
  marketId: string | null;
  marketName: string | null;
  marketSlug: string | null;
  costMethod: string | null;
  startDate: string | null;
  endDate: string | null;
  amountUsd: number;
};

export type MarketAgg = {
  marketId: string;
  marketName: string;
  marketSlug: string;
  plannedUsd: number;
  count: number;
};

export type AnalysisFilters = {
  clientId: string;
  publisherId?: string | null;
  marketId?: string | null;
  budgetOriginId?: string | null;
  fromMonth?: string | null; // YYYY-MM
  toMonth?: string | null; // YYYY-MM
};

export async function getMarketActivations(
  filters: AnalysisFilters,
): Promise<{ rows: ActivationRow[]; markets: MarketAgg[] }> {
  const conds: SQL[] = [
    eq(projects.clientId, filters.clientId),
    isNull(mediaPlans.deletedAt),
    eq(mediaPlans.status, "approved"),
  ];
  if (filters.publisherId)
    conds.push(eq(mediaPlanPublishers.publisherId, filters.publisherId));
  if (filters.marketId)
    conds.push(eq(mediaPlanPlacements.marketId, filters.marketId));
  if (filters.budgetOriginId)
    conds.push(eq(projects.budgetOriginId, filters.budgetOriginId));
  if (filters.fromMonth)
    conds.push(gte(mediaPlanPlacements.endDate, `${filters.fromMonth}-01`));
  if (filters.toMonth)
    conds.push(lte(mediaPlanPlacements.startDate, `${filters.toMonth}-31`));

  const raw = await db
    .select({
      id: mediaPlanPlacements.id,
      projectName: projects.name,
      projectCode: projects.code,
      planName: mediaPlans.name,
      publisherName: publishers.name,
      marketId: markets.id,
      marketName: markets.name,
      marketSlug: markets.slug,
      costMethod: mediaPlanPlacements.costMethod,
      startDate: mediaPlanPlacements.startDate,
      endDate: mediaPlanPlacements.endDate,
      amountUsd: mediaPlanPlacements.amountUsd,
    })
    .from(mediaPlanPlacements)
    .innerJoin(
      mediaPlanPublishers,
      eq(mediaPlanPlacements.mediaPlanPublisherId, mediaPlanPublishers.id),
    )
    .innerJoin(publishers, eq(mediaPlanPublishers.publisherId, publishers.id))
    .innerJoin(mediaPlans, eq(mediaPlanPublishers.mediaPlanId, mediaPlans.id))
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
    .leftJoin(markets, eq(mediaPlanPlacements.marketId, markets.id))
    .where(and(...conds))
    .orderBy(asc(projects.code), asc(mediaPlans.name));

  const rows: ActivationRow[] = raw.map((r) => ({
    id: r.id,
    projectName: r.projectName,
    projectCode: r.projectCode,
    planName: r.planName,
    publisherName: r.publisherName,
    marketId: r.marketId,
    marketName: r.marketName,
    marketSlug: r.marketSlug,
    costMethod: r.costMethod,
    startDate: r.startDate,
    endDate: r.endDate,
    amountUsd: Number.parseFloat(r.amountUsd),
  }));

  const byMarket = new Map<string, MarketAgg>();
  for (const r of rows) {
    if (!r.marketId || !r.marketSlug || !r.marketName) continue;
    const e =
      byMarket.get(r.marketId) ?? {
        marketId: r.marketId,
        marketName: r.marketName,
        marketSlug: r.marketSlug,
        plannedUsd: 0,
        count: 0,
      };
    e.plannedUsd += r.amountUsd;
    e.count += 1;
    byMarket.set(r.marketId, e);
  }

  return {
    rows,
    markets: Array.from(byMarket.values()).sort(
      (a, b) => b.plannedUsd - a.plannedUsd,
    ),
  };
}

// Opciones de filtros del análisis (publishers / mercados / budget origins que
// el cliente usa en placements de planes aprobados).
export type AnalysisFilterOptions = {
  publishers: { id: string; name: string }[];
  markets: { id: string; name: string }[];
  budgetOrigins: { id: string; name: string }[];
};

export async function getAnalysisFilterOptions(
  clientId: string,
): Promise<AnalysisFilterOptions> {
  const baseJoins = () =>
    db
      .selectDistinct({ id: publishers.id, name: publishers.name })
      .from(mediaPlanPlacements)
      .innerJoin(
        mediaPlanPublishers,
        eq(mediaPlanPlacements.mediaPlanPublisherId, mediaPlanPublishers.id),
      )
      .innerJoin(publishers, eq(mediaPlanPublishers.publisherId, publishers.id))
      .innerJoin(mediaPlans, eq(mediaPlanPublishers.mediaPlanId, mediaPlans.id))
      .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
      .where(
        and(
          eq(projects.clientId, clientId),
          isNull(mediaPlans.deletedAt),
          eq(mediaPlans.status, "approved"),
        ),
      )
      .orderBy(asc(publishers.name));

  const pubs = await baseJoins();

  const mkts = await db
    .selectDistinct({ id: markets.id, name: markets.name })
    .from(mediaPlanPlacements)
    .innerJoin(
      mediaPlanPublishers,
      eq(mediaPlanPlacements.mediaPlanPublisherId, mediaPlanPublishers.id),
    )
    .innerJoin(markets, eq(mediaPlanPlacements.marketId, markets.id))
    .innerJoin(mediaPlans, eq(mediaPlanPublishers.mediaPlanId, mediaPlans.id))
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
    .where(
      and(
        eq(projects.clientId, clientId),
        isNull(mediaPlans.deletedAt),
        eq(mediaPlans.status, "approved"),
      ),
    )
    .orderBy(asc(markets.name));

  const origins = await db
    .selectDistinct({ id: budgetOrigins.id, name: budgetOrigins.name })
    .from(projects)
    .innerJoin(budgetOrigins, eq(projects.budgetOriginId, budgetOrigins.id))
    .where(eq(projects.clientId, clientId))
    .orderBy(asc(budgetOrigins.name));

  return { publishers: pubs, markets: mkts, budgetOrigins: origins };
}
