"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { recordAudit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { normalizeExternalUrl } from "@/lib/external-url";
import {
  adTypes,
  mediaPlanPlacements,
  mediaPlanPublishers,
  mediaPlanTrafficAds,
  mediaPlanTrafficAdsets,
  mediaPlanTrafficBriefs,
  mediaPlans,
  projects,
} from "@/db/schema";

// ════════════════════════════════════════════════════════════════════════════
// Sección TRÁFICO del plan — adsets (media planner) y ads (AM/PM).
//
// Quién edita qué, y cuándo:
//
//   ADSETS — son parte de lo que el planner manda a firmar, así que se editan
//   sobre el BORRADOR, igual que el resto del plan. Un plan firmado se toca
//   con "Editar (nueva versión)". Coherente con que sean requisito para
//   `ready_to_send`: si se pudieran cambiar después de la firma, el gate no
//   significaría nada.
//
//   ADS — material OPERATIVO del AM/PM, que se completa DESPUÉS de aprobar,
//   mientras se arma la campaña. Se editan en cualquier estado vivo del plan;
//   sólo `archived` los congela. Atarlos al borrador obligaría a abrir una
//   versión nueva —y rehacer el QA— sólo para escribir un copy.
//
// Barreras reales: acá el estado del plan; en `transitionPlanStatus` el gate de
// adsets (ready_to_send/approved) y el de Live; en `completePlanQa` el de ads.
// Las reglas de completitud viven en lib/plan-traffic.ts.
// ════════════════════════════════════════════════════════════════════════════

type Result<T = void> =
  | (T extends void ? { ok: true } : { ok: true } & T)
  | { ok: false; error: string };

type PlanCtx = {
  planId: string;
  projectCode: string;
  clientId: string;
  status: string;
};

async function planCtxForPlacement(placementId: string): Promise<PlanCtx | null> {
  const [row] = await db
    .select({
      planId: mediaPlans.id,
      status: mediaPlans.status,
      projectCode: projects.code,
      clientId: projects.clientId,
    })
    .from(mediaPlanPlacements)
    .innerJoin(
      mediaPlanPublishers,
      eq(mediaPlanPlacements.mediaPlanPublisherId, mediaPlanPublishers.id),
    )
    .innerJoin(mediaPlans, eq(mediaPlanPublishers.mediaPlanId, mediaPlans.id))
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
    .where(and(eq(mediaPlanPlacements.id, placementId), isNull(mediaPlans.deletedAt)))
    .limit(1);
  if (!row || row.status === "archived") return null;
  return row;
}

async function planCtxForAdset(adsetId: string): Promise<PlanCtx | null> {
  const [row] = await db
    .select({ placementId: mediaPlanTrafficBriefs.placementId })
    .from(mediaPlanTrafficAdsets)
    .innerJoin(
      mediaPlanTrafficBriefs,
      eq(mediaPlanTrafficAdsets.briefId, mediaPlanTrafficBriefs.id),
    )
    .where(eq(mediaPlanTrafficAdsets.id, adsetId))
    .limit(1);
  if (!row) return null;
  return planCtxForPlacement(row.placementId);
}

async function planCtxForAd(adId: string): Promise<PlanCtx | null> {
  const [row] = await db
    .select({ adsetId: mediaPlanTrafficAds.adsetId })
    .from(mediaPlanTrafficAds)
    .where(eq(mediaPlanTrafficAds.id, adId))
    .limit(1);
  if (!row) return null;
  return planCtxForAdset(row.adsetId);
}

// Los adsets son parte del plan que se manda a firmar: sólo sobre el borrador.
function adsetsEditable(ctx: PlanCtx): boolean {
  return ctx.status === "draft";
}

const ADSET_LOCKED_ERROR =
  'Los adsets son parte del plan que se manda a firmar: sólo se editan sobre el borrador. Usá "Editar (nueva versión)" en el plan (vuelve a draft y, al aprobarlo, hay que rehacer el QA).';

function revalidateTraffic(ctx: PlanCtx) {
  revalidatePath(`/proyectos/${ctx.projectCode}/planes/${ctx.planId}`);
  revalidatePath(`/proyectos/${ctx.projectCode}/planes/${ctx.planId}/trafico`);
}

// Brief del placement, creándolo si todavía no existe. El insert lleva
// `onConflictDoNothing` sobre el unique (placement_id) para que dos escrituras
// simultáneas (típico: tabular rápido entre campos) no revienten.
async function ensureBrief(placementId: string): Promise<string> {
  const [existing] = await db
    .select({ id: mediaPlanTrafficBriefs.id })
    .from(mediaPlanTrafficBriefs)
    .where(eq(mediaPlanTrafficBriefs.placementId, placementId))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(mediaPlanTrafficBriefs)
    .values({ placementId })
    .onConflictDoNothing({ target: mediaPlanTrafficBriefs.placementId })
    .returning({ id: mediaPlanTrafficBriefs.id });
  if (created) return created.id;

  const [raced] = await db
    .select({ id: mediaPlanTrafficBriefs.id })
    .from(mediaPlanTrafficBriefs)
    .where(eq(mediaPlanTrafficBriefs.placementId, placementId))
    .limit(1);
  if (!raced) throw new Error("No se pudo crear la ficha de tráfico del placement");
  return raced.id;
}

// ── Adsets (media planner) ──────────────────────────────────────────────────

// `copyFromPlacement` es el botón "Del placement": muchas veces el adset ES el
// placement, y re-tipear audiencia, budget y fechas es trabajo al pedo. El
// pilar creativo no tiene equivalente en la línea del plan, así que queda para
// escribir.
export async function addTrafficAdset(input: {
  placementId: string;
  copyFromPlacement?: boolean;
}): Promise<Result<{ adsetId: string }>> {
  if (!input.placementId) return { ok: false, error: "Falta placement_id" };
  const ctx = await planCtxForPlacement(input.placementId);
  if (!ctx) {
    return { ok: false, error: "El placement no existe o el plan no es editable" };
  }
  if (!adsetsEditable(ctx)) return { ok: false, error: ADSET_LOCKED_ERROR };

  const [placement] = await db
    .select()
    .from(mediaPlanPlacements)
    .where(eq(mediaPlanPlacements.id, input.placementId))
    .limit(1);
  if (!placement) return { ok: false, error: "Placement no encontrado" };

  const briefId = await ensureBrief(input.placementId);
  const [{ next }] = await db
    .select({
      next: sql<number>`coalesce(max(${mediaPlanTrafficAdsets.sortOrder}), -1) + 1`,
    })
    .from(mediaPlanTrafficAdsets)
    .where(eq(mediaPlanTrafficAdsets.briefId, briefId));

  const seed = input.copyFromPlacement
    ? {
        name: placement.placementName,
        audience: placement.audience,
        budgetUsd: placement.amountUsd,
        startDate: placement.startDate,
        endDate: placement.endDate,
      }
    : {};

  const [adset] = await db
    .insert(mediaPlanTrafficAdsets)
    .values({ briefId, sortOrder: next, ...seed })
    .returning();

  await recordAudit({
    entityType: "plan_traffic_adset",
    entityId: adset.id,
    action: "create",
    afterJson: adset,
  });

  revalidateTraffic(ctx);
  return { ok: true, adsetId: adset.id };
}

export async function updateTrafficAdset(input: {
  adsetId: string;
  name?: string | null;
  audience?: string | null;
  budgetUsd?: number | null;
  creativePillar?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  // Rellena de una los campos que la línea del plan ya tiene (botón "Del
  // placement" sobre un adset existente).
  copyFromPlacement?: boolean;
}): Promise<Result> {
  if (!input.adsetId) return { ok: false, error: "Falta adset_id" };
  const ctx = await planCtxForAdset(input.adsetId);
  if (!ctx) {
    return { ok: false, error: "El adset no existe o el plan no es editable" };
  }
  if (!adsetsEditable(ctx)) return { ok: false, error: ADSET_LOCKED_ERROR };

  const update: Partial<typeof mediaPlanTrafficAdsets.$inferInsert> = {};

  if (input.copyFromPlacement) {
    const [row] = await db
      .select({ placement: mediaPlanPlacements })
      .from(mediaPlanTrafficAdsets)
      .innerJoin(
        mediaPlanTrafficBriefs,
        eq(mediaPlanTrafficAdsets.briefId, mediaPlanTrafficBriefs.id),
      )
      .innerJoin(
        mediaPlanPlacements,
        eq(mediaPlanTrafficBriefs.placementId, mediaPlanPlacements.id),
      )
      .where(eq(mediaPlanTrafficAdsets.id, input.adsetId))
      .limit(1);
    if (!row) return { ok: false, error: "Placement no encontrado" };
    update.name = row.placement.placementName;
    update.audience = row.placement.audience;
    update.budgetUsd = row.placement.amountUsd;
    update.startDate = row.placement.startDate;
    update.endDate = row.placement.endDate;
  }

  if (input.name !== undefined) update.name = (input.name ?? "").trim() || null;
  if (input.audience !== undefined) {
    update.audience = (input.audience ?? "").trim() || null;
  }
  if (input.budgetUsd !== undefined) {
    if (input.budgetUsd == null) {
      update.budgetUsd = null;
    } else {
      if (!Number.isFinite(input.budgetUsd) || input.budgetUsd < 0) {
        return { ok: false, error: "El budget del adset no puede ser negativo" };
      }
      update.budgetUsd = input.budgetUsd.toFixed(2);
    }
  }
  if (input.creativePillar !== undefined) {
    update.creativePillar = (input.creativePillar ?? "").trim() || null;
  }
  if (input.startDate !== undefined) update.startDate = input.startDate || null;
  if (input.endDate !== undefined) update.endDate = input.endDate || null;
  if (Object.keys(update).length === 0) return { ok: true };

  const [before] = await db
    .select()
    .from(mediaPlanTrafficAdsets)
    .where(eq(mediaPlanTrafficAdsets.id, input.adsetId))
    .limit(1);

  const [after] = await db
    .update(mediaPlanTrafficAdsets)
    .set({ ...update, updatedAt: sql`now()` })
    .where(eq(mediaPlanTrafficAdsets.id, input.adsetId))
    .returning();

  await recordAudit({
    entityType: "plan_traffic_adset",
    entityId: input.adsetId,
    action: "update",
    beforeJson: before,
    afterJson: after,
  });

  revalidateTraffic(ctx);
  return { ok: true };
}

export async function removeTrafficAdset(adsetId: string): Promise<Result> {
  if (!adsetId) return { ok: false, error: "Falta adset_id" };
  const ctx = await planCtxForAdset(adsetId);
  if (!ctx) {
    return { ok: false, error: "El adset no existe o el plan no es editable" };
  }
  if (!adsetsEditable(ctx)) return { ok: false, error: ADSET_LOCKED_ERROR };

  const [before] = await db
    .select()
    .from(mediaPlanTrafficAdsets)
    .where(eq(mediaPlanTrafficAdsets.id, adsetId))
    .limit(1);

  // Los ads del adset se van con él (FK onDelete cascade).
  await db
    .delete(mediaPlanTrafficAdsets)
    .where(eq(mediaPlanTrafficAdsets.id, adsetId));

  await recordAudit({
    entityType: "plan_traffic_adset",
    entityId: adsetId,
    action: "delete",
    beforeJson: before,
  });

  revalidateTraffic(ctx);
  return { ok: true };
}

// ── Ads (AM/PM) ─────────────────────────────────────────────────────────────

export async function addTrafficAd(input: {
  adsetId: string;
}): Promise<Result<{ adId: string }>> {
  if (!input.adsetId) return { ok: false, error: "Falta adset_id" };
  const ctx = await planCtxForAdset(input.adsetId);
  if (!ctx) {
    return { ok: false, error: "El adset no existe o el plan no es editable" };
  }

  const [{ next }] = await db
    .select({
      next: sql<number>`coalesce(max(${mediaPlanTrafficAds.sortOrder}), -1) + 1`,
    })
    .from(mediaPlanTrafficAds)
    .where(eq(mediaPlanTrafficAds.adsetId, input.adsetId));

  const [ad] = await db
    .insert(mediaPlanTrafficAds)
    .values({ adsetId: input.adsetId, sortOrder: next })
    .returning();

  await recordAudit({
    entityType: "plan_traffic_ad",
    entityId: ad.id,
    action: "create",
    afterJson: ad,
  });

  revalidateTraffic(ctx);
  return { ok: true, adId: ad.id };
}

export async function updateTrafficAd(input: {
  adId: string;
  adTypeId?: string | null;
  adTypeOther?: string | null;
  creativeUrl?: string | null;
  copy?: string | null;
  headline?: string | null;
  subheadline?: string | null;
  clickUrl?: string | null;
  landingUrl?: string | null;
}): Promise<Result> {
  if (!input.adId) return { ok: false, error: "Falta ad_id" };
  const ctx = await planCtxForAd(input.adId);
  if (!ctx) {
    return { ok: false, error: "El ad no existe o el plan no es editable" };
  }

  const update: Partial<typeof mediaPlanTrafficAds.$inferInsert> = {};

  if (input.adTypeId !== undefined) {
    const id = (input.adTypeId ?? "").trim();
    if (id) {
      // El tipo tiene que ser del catálogo DEL CLIENTE del plan: si no, un id
      // de otro cliente entraría por la puerta de atrás.
      const [type] = await db
        .select({ id: adTypes.id, requiresDetail: adTypes.requiresDetail })
        .from(adTypes)
        .where(and(eq(adTypes.id, id), eq(adTypes.clientId, ctx.clientId)))
        .limit(1);
      if (!type) {
        return {
          ok: false,
          error: "El tipo de ad no existe en el catálogo de este cliente",
        };
      }
      update.adTypeId = type.id;
      // Salir de un tipo "Otro" limpia el texto libre: si no, quedaría un
      // detalle fantasma que la vista ya no muestra pero el Excel sí exporta.
      if (!type.requiresDetail) update.adTypeOther = null;
    } else {
      update.adTypeId = null;
      update.adTypeOther = null;
    }
  }
  if (input.adTypeOther !== undefined) {
    update.adTypeOther = (input.adTypeOther ?? "").trim() || null;
  }
  if (input.copy !== undefined) update.copy = (input.copy ?? "").trim() || null;
  if (input.headline !== undefined) {
    update.headline = (input.headline ?? "").trim() || null;
  }
  if (input.subheadline !== undefined) {
    update.subheadline = (input.subheadline ?? "").trim() || null;
  }
  for (const field of ["creativeUrl", "clickUrl", "landingUrl"] as const) {
    if (input[field] === undefined) continue;
    const link = normalizeExternalUrl(input[field]);
    if (!link.ok) return { ok: false, error: link.error };
    update[field] = link.url;
  }
  if (Object.keys(update).length === 0) return { ok: true };

  const [before] = await db
    .select()
    .from(mediaPlanTrafficAds)
    .where(eq(mediaPlanTrafficAds.id, input.adId))
    .limit(1);

  const [after] = await db
    .update(mediaPlanTrafficAds)
    .set({ ...update, updatedAt: sql`now()` })
    .where(eq(mediaPlanTrafficAds.id, input.adId))
    .returning();

  await recordAudit({
    entityType: "plan_traffic_ad",
    entityId: input.adId,
    action: "update",
    beforeJson: before,
    afterJson: after,
  });

  revalidateTraffic(ctx);
  return { ok: true };
}

export async function removeTrafficAd(adId: string): Promise<Result> {
  if (!adId) return { ok: false, error: "Falta ad_id" };
  const ctx = await planCtxForAd(adId);
  if (!ctx) {
    return { ok: false, error: "El ad no existe o el plan no es editable" };
  }

  const [before] = await db
    .select()
    .from(mediaPlanTrafficAds)
    .where(eq(mediaPlanTrafficAds.id, adId))
    .limit(1);

  await db.delete(mediaPlanTrafficAds).where(eq(mediaPlanTrafficAds.id, adId));

  await recordAudit({
    entityType: "plan_traffic_ad",
    entityId: adId,
    action: "delete",
    beforeJson: before,
  });

  revalidateTraffic(ctx);
  return { ok: true };
}

// El registro del trafficker: "esto ya lo cargué en la plataforma". Queda con
// fecha y con quién lo marcó — es la evidencia que respalda el paso a Live.
export async function setTrafficAdLoaded(input: {
  adId: string;
  loaded: boolean;
}): Promise<Result> {
  if (!input.adId) return { ok: false, error: "Falta ad_id" };
  const ctx = await planCtxForAd(input.adId);
  if (!ctx) {
    return { ok: false, error: "El ad no existe o el plan no es editable" };
  }

  const user = await getCurrentUser();

  const [after] = await db
    .update(mediaPlanTrafficAds)
    .set(
      input.loaded
        ? {
            loadedAt: sql`now()`,
            loadedByUserId: user?.id ?? null,
            loadedByEmail: user?.email ?? null,
            updatedAt: sql`now()`,
          }
        : {
            loadedAt: null,
            loadedByUserId: null,
            loadedByEmail: null,
            updatedAt: sql`now()`,
          },
    )
    .where(eq(mediaPlanTrafficAds.id, input.adId))
    .returning();

  await recordAudit({
    entityType: "plan_traffic_ad",
    entityId: input.adId,
    action: input.loaded ? "mark_loaded" : "unmark_loaded",
    afterJson: after,
  });

  revalidateTraffic(ctx);
  return { ok: true };
}
