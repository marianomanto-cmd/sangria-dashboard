// ════════════════════════════════════════════════════════════════════════════
// Lecturas de la sección TRÁFICO del plan.
//
//   • getPlanTraffic → una fila por placement vivo del plan, con su brief de
//                      tráfico y sus anuncios. Alimenta la ventana /trafico y
//                      la barrera de Live en `transitionPlanStatus`.
//
// La lista de placements sale SIEMPRE del plan (no del brief): un placement
// nuevo aparece en Tráfico apenas se crea, con `brief: null`, y eso es
// exactamente lo que la regla de lib/plan-traffic.ts lee como "falta cargarlo".
// ════════════════════════════════════════════════════════════════════════════

import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  markets,
  mediaPlanPlacements,
  mediaPlanPublishers,
  mediaPlanTrafficAds,
  mediaPlanTrafficBriefs,
  publishers,
} from "@/db/schema";
import type { TrafficPlacement } from "@/lib/plan-traffic";

export type PlanTrafficAd = {
  id: string;
  adFormat: string | null;
  adFormatOther: string | null;
  copy: string | null;
  headline: string | null;
  subheadline: string | null;
  cta: string | null;
  landingUrl: string | null;
  loadedAt: Date | null;
  loadedByEmail: string | null;
  sortOrder: number;
};

export type PlanTrafficBrief = {
  id: string;
  adsetsCount: number;
  trafficFolderUrl: string | null;
  ads: PlanTrafficAd[];
};

// Un placement del plan con su contexto (para que el trafficker sepa qué está
// armando) + su brief. Satisface `TrafficPlacement` de lib/plan-traffic.
export type PlanTrafficPlacement = {
  placementId: string;
  publisherName: string;
  placementName: string | null;
  marketName: string | null;
  amountUsd: number;
  costMethod: string | null;
  startDate: string | null;
  endDate: string | null;
  brief: PlanTrafficBrief | null;
};

export async function getPlanTraffic(
  planId: string,
): Promise<PlanTrafficPlacement[]> {
  const pubRows = await db
    .select({
      id: mediaPlanPublishers.id,
      name: publishers.name,
      sortOrder: mediaPlanPublishers.sortOrder,
    })
    .from(mediaPlanPublishers)
    .innerJoin(publishers, eq(mediaPlanPublishers.publisherId, publishers.id))
    .where(eq(mediaPlanPublishers.mediaPlanId, planId))
    .orderBy(asc(mediaPlanPublishers.sortOrder));

  if (pubRows.length === 0) return [];
  const pubName = new Map(pubRows.map((p) => [p.id, p.name]));
  const pubOrder = new Map(pubRows.map((p, i) => [p.id, i]));

  const placementRows = await db
    .select({
      placement: mediaPlanPlacements,
      marketName: markets.name,
    })
    .from(mediaPlanPlacements)
    .leftJoin(markets, eq(mediaPlanPlacements.marketId, markets.id))
    .where(
      inArray(
        mediaPlanPlacements.mediaPlanPublisherId,
        pubRows.map((p) => p.id),
      ),
    )
    .orderBy(asc(mediaPlanPlacements.sortOrder));

  if (placementRows.length === 0) return [];
  const placementIds = placementRows.map((r) => r.placement.id);

  const briefRows = await db
    .select()
    .from(mediaPlanTrafficBriefs)
    .where(inArray(mediaPlanTrafficBriefs.placementId, placementIds));

  const adRows =
    briefRows.length === 0
      ? []
      : await db
          .select()
          .from(mediaPlanTrafficAds)
          .where(
            inArray(
              mediaPlanTrafficAds.briefId,
              briefRows.map((b) => b.id),
            ),
          )
          .orderBy(asc(mediaPlanTrafficAds.sortOrder), asc(mediaPlanTrafficAds.createdAt));

  const adsByBrief = new Map<string, PlanTrafficAd[]>();
  for (const a of adRows) {
    const list = adsByBrief.get(a.briefId) ?? [];
    list.push({
      id: a.id,
      adFormat: a.adFormat,
      adFormatOther: a.adFormatOther,
      copy: a.copy,
      headline: a.headline,
      subheadline: a.subheadline,
      cta: a.cta,
      landingUrl: a.landingUrl,
      loadedAt: a.loadedAt,
      loadedByEmail: a.loadedByEmail,
      sortOrder: a.sortOrder,
    });
    adsByBrief.set(a.briefId, list);
  }

  const briefByPlacement = new Map<string, PlanTrafficBrief>();
  for (const b of briefRows) {
    briefByPlacement.set(b.placementId, {
      id: b.id,
      adsetsCount: b.adsetsCount,
      trafficFolderUrl: b.trafficFolderUrl,
      ads: adsByBrief.get(b.id) ?? [],
    });
  }

  // Mismo orden que la planilla del plan: publisher por sortOrder y, dentro,
  // el sortOrder del placement (que ya trae la query).
  const ordered = [...placementRows].sort((a, b) => {
    const oa = pubOrder.get(a.placement.mediaPlanPublisherId) ?? 0;
    const ob = pubOrder.get(b.placement.mediaPlanPublisherId) ?? 0;
    return oa - ob || a.placement.sortOrder - b.placement.sortOrder;
  });

  return ordered.map((r) => {
    const p = r.placement;
    return {
      placementId: p.id,
      publisherName: pubName.get(p.mediaPlanPublisherId) ?? "—",
      placementName: p.placementName,
      marketName: r.marketName,
      amountUsd: Number.parseFloat(p.amountUsd),
      costMethod: p.costMethod,
      startDate: p.startDate,
      endDate: p.endDate,
      brief: briefByPlacement.get(p.id) ?? null,
    };
  });
}

// Vista mínima para la regla de lib/plan-traffic (la barrera de Live). Se
// deriva de la misma lectura para que la ventana y la barrera nunca discrepen.
export function toTrafficPlacements(
  rows: PlanTrafficPlacement[],
): TrafficPlacement[] {
  return rows.map((r) => ({
    publisherName: r.publisherName,
    placementName: r.placementName,
    brief: r.brief
      ? {
          adsetsCount: r.brief.adsetsCount,
          trafficFolderUrl: r.brief.trafficFolderUrl,
          ads: r.brief.ads,
        }
      : null,
  }));
}
