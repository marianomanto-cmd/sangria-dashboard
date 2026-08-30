// ════════════════════════════════════════════════════════════════════════════
// Lecturas de la sección TRÁFICO del plan.
//
//   • getPlanTraffic → una fila por placement vivo del plan, con su brief, sus
//                      adsets (del planner) y los ads de cada uno (del AM/PM).
//                      Alimenta la ventana /trafico y las dos barreras:
//                      `transitionPlanStatus` y `completePlanQa`.
//
// La lista de placements sale SIEMPRE del plan (no del brief): un placement
// nuevo aparece en Tráfico apenas se crea, con `brief: null`, y eso es
// exactamente lo que la regla de lib/plan-traffic.ts lee como "falta cargarlo".
// ════════════════════════════════════════════════════════════════════════════

import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  adTypes,
  markets,
  mediaPlanPlacements,
  mediaPlanPublishers,
  mediaPlanTrafficAds,
  mediaPlanTrafficAdsets,
  mediaPlanTrafficBriefs,
  publishers,
} from "@/db/schema";
import type { TrafficPlacement } from "@/lib/plan-traffic";

export type PlanTrafficAd = {
  id: string;
  adTypeId: string | null;
  adTypeName: string | null;
  adTypeRequiresDetail: boolean;
  adTypeOther: string | null;
  creativeUrl: string | null;
  copy: string | null;
  headline: string | null;
  subheadline: string | null;
  clickUrl: string | null;
  landingUrl: string | null;
  loadedAt: Date | null;
  loadedByEmail: string | null;
  sortOrder: number;
};

export type PlanTrafficAdset = {
  id: string;
  name: string | null;
  audience: string | null;
  budgetUsd: number | null;
  creativePillar: string | null;
  startDate: string | null;
  endDate: string | null;
  sortOrder: number;
  ads: PlanTrafficAd[];
};

export type PlanTrafficBrief = {
  id: string;
  trafficFolderUrl: string | null;
  adsets: PlanTrafficAdset[];
};

// Un placement del plan con su contexto (para que el planner y el AM/PM sepan
// qué están armando, y para que el botón "Del placement" tenga de dónde
// copiar) + su brief. Satisface `TrafficPlacement` de lib/plan-traffic.
export type PlanTrafficPlacement = {
  placementId: string;
  publisherName: string;
  placementName: string | null;
  marketName: string | null;
  audience: string | null;
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
    })
    .from(mediaPlanPublishers)
    .innerJoin(publishers, eq(mediaPlanPublishers.publisherId, publishers.id))
    .where(eq(mediaPlanPublishers.mediaPlanId, planId))
    .orderBy(asc(mediaPlanPublishers.sortOrder));

  if (pubRows.length === 0) return [];
  const pubName = new Map(pubRows.map((p) => [p.id, p.name]));
  const pubOrder = new Map(pubRows.map((p, i) => [p.id, i]));

  const placementRows = await db
    .select({ placement: mediaPlanPlacements, marketName: markets.name })
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

  const briefRows = await db
    .select()
    .from(mediaPlanTrafficBriefs)
    .where(
      inArray(
        mediaPlanTrafficBriefs.placementId,
        placementRows.map((r) => r.placement.id),
      ),
    );

  const adsetRows =
    briefRows.length === 0
      ? []
      : await db
          .select()
          .from(mediaPlanTrafficAdsets)
          .where(
            inArray(
              mediaPlanTrafficAdsets.briefId,
              briefRows.map((b) => b.id),
            ),
          )
          .orderBy(
            asc(mediaPlanTrafficAdsets.sortOrder),
            asc(mediaPlanTrafficAdsets.createdAt),
          );

  // El tipo de ad se resuelve contra el catálogo del cliente (ad_types): el
  // nombre para mostrar y `requiresDetail`, que decide si el ad además necesita
  // el texto libre para estar completo.
  const adRows =
    adsetRows.length === 0
      ? []
      : await db
          .select({
            ad: mediaPlanTrafficAds,
            adTypeName: adTypes.name,
            adTypeRequiresDetail: adTypes.requiresDetail,
          })
          .from(mediaPlanTrafficAds)
          .leftJoin(adTypes, eq(mediaPlanTrafficAds.adTypeId, adTypes.id))
          .where(
            inArray(
              mediaPlanTrafficAds.adsetId,
              adsetRows.map((a) => a.id),
            ),
          )
          .orderBy(
            asc(mediaPlanTrafficAds.sortOrder),
            asc(mediaPlanTrafficAds.createdAt),
          );

  const adsByAdset = new Map<string, PlanTrafficAd[]>();
  for (const r of adRows) {
    const a = r.ad;
    const list = adsByAdset.get(a.adsetId) ?? [];
    list.push({
      id: a.id,
      adTypeId: a.adTypeId,
      adTypeName: r.adTypeName,
      adTypeRequiresDetail: r.adTypeRequiresDetail ?? false,
      adTypeOther: a.adTypeOther,
      creativeUrl: a.creativeUrl,
      copy: a.copy,
      headline: a.headline,
      subheadline: a.subheadline,
      clickUrl: a.clickUrl,
      landingUrl: a.landingUrl,
      loadedAt: a.loadedAt,
      loadedByEmail: a.loadedByEmail,
      sortOrder: a.sortOrder,
    });
    adsByAdset.set(a.adsetId, list);
  }

  const adsetsByBrief = new Map<string, PlanTrafficAdset[]>();
  for (const a of adsetRows) {
    const list = adsetsByBrief.get(a.briefId) ?? [];
    list.push({
      id: a.id,
      name: a.name,
      audience: a.audience,
      budgetUsd: a.budgetUsd == null ? null : Number.parseFloat(a.budgetUsd),
      creativePillar: a.creativePillar,
      startDate: a.startDate,
      endDate: a.endDate,
      sortOrder: a.sortOrder,
      ads: adsByAdset.get(a.id) ?? [],
    });
    adsetsByBrief.set(a.briefId, list);
  }

  const briefByPlacement = new Map<string, PlanTrafficBrief>();
  for (const b of briefRows) {
    briefByPlacement.set(b.placementId, {
      id: b.id,
      trafficFolderUrl: b.trafficFolderUrl,
      adsets: adsetsByBrief.get(b.id) ?? [],
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
      audience: p.audience,
      amountUsd: Number.parseFloat(p.amountUsd),
      costMethod: p.costMethod,
      startDate: p.startDate,
      endDate: p.endDate,
      brief: briefByPlacement.get(p.id) ?? null,
    };
  });
}

// Vista mínima para las reglas de lib/plan-traffic (las barreras). Se deriva de
// la misma lectura para que la ventana y las barreras nunca discrepen.
export function toTrafficPlacements(
  rows: PlanTrafficPlacement[],
): TrafficPlacement[] {
  return rows.map((r) => ({
    publisherName: r.publisherName,
    placementName: r.placementName,
    brief: r.brief
      ? { trafficFolderUrl: r.brief.trafficFolderUrl, adsets: r.brief.adsets }
      : null,
  }));
}
