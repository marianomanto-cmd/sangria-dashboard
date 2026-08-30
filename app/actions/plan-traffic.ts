"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { recordAudit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { normalizeExternalUrl } from "@/lib/external-url";
import { isTrafficAdFormat } from "@/lib/plan-traffic";
import { isPlanTerminal } from "@/lib/plan-status";
import {
  mediaPlanPlacements,
  mediaPlanPublishers,
  mediaPlanTrafficAds,
  mediaPlanTrafficBriefs,
  mediaPlans,
  projects,
} from "@/db/schema";

// ════════════════════════════════════════════════════════════════════════════
// Sección TRÁFICO del plan — el brief con el que el trafficker arma los adsets.
//
// Es material OPERATIVO: se edita en cualquier estado VIVO del plan, no sólo en
// draft. Justamente se llena después de aprobar, mientras se monta la campaña —
// atarlo a `status === "draft"` lo haría inutilizable (y forzaría a abrir una
// versión nueva, que rompería el QA, sólo para escribir un copy).
//
// Barreras reales (server-side):
//   • el placement/brief/anuncio tiene que colgar de un plan VIVO (no borrado)
//     y no archivado;
//   • el brief se crea lazy: la primera escritura sobre un placement lo abre.
//
// Lo que SÍ frena esto es el paso a Live: ver `transitionPlanStatus` en
// app/actions/plans.ts y la regla en lib/plan-traffic.ts.
// ════════════════════════════════════════════════════════════════════════════

type Result<T = void> =
  | (T extends void ? { ok: true } : { ok: true } & T)
  | { ok: false; error: string };

// Contexto del plan dueño de un placement, con el chequeo de "plan vivo y
// editable" hecho. null = no existe o no se puede tocar.
type PlanCtx = { planId: string; projectCode: string };

async function planCtxForPlacement(placementId: string): Promise<PlanCtx | null> {
  const [row] = await db
    .select({
      planId: mediaPlans.id,
      status: mediaPlans.status,
      deletedAt: mediaPlans.deletedAt,
      projectCode: projects.code,
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
  // Un plan terminado o archivado congela el brief (ver PLAN_TERMINAL_STATUSES).
  if (!row || isPlanTerminal(row.status)) return null;
  return { planId: row.planId, projectCode: row.projectCode };
}

async function planCtxForAd(adId: string): Promise<
  (PlanCtx & { placementId: string }) | null
> {
  const [row] = await db
    .select({ placementId: mediaPlanTrafficBriefs.placementId })
    .from(mediaPlanTrafficAds)
    .innerJoin(
      mediaPlanTrafficBriefs,
      eq(mediaPlanTrafficAds.briefId, mediaPlanTrafficBriefs.id),
    )
    .where(eq(mediaPlanTrafficAds.id, adId))
    .limit(1);
  if (!row) return null;
  const ctx = await planCtxForPlacement(row.placementId);
  return ctx ? { ...ctx, placementId: row.placementId } : null;
}

function revalidateTraffic(ctx: PlanCtx) {
  revalidatePath(`/proyectos/${ctx.projectCode}/planes/${ctx.planId}`);
  revalidatePath(`/proyectos/${ctx.projectCode}/planes/${ctx.planId}/trafico`);
}

// Brief del placement, creándolo si todavía no existe. El insert lleva
// `onConflictDoNothing` sobre el unique (placement_id) para que dos escrituras
// simultáneas (típico: el planner tabulando rápido entre campos) no revienten.
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
  if (!raced) throw new Error("No se pudo crear el brief de tráfico");
  return raced.id;
}

// ── Brief del placement (cantidad de adsets + carpeta) ──────────────────────

export async function updateTrafficBrief(input: {
  placementId: string;
  adsetsCount?: number;
  trafficFolderUrl?: string | null;
}): Promise<Result> {
  if (!input.placementId) return { ok: false, error: "Falta placement_id" };
  const ctx = await planCtxForPlacement(input.placementId);
  if (!ctx) {
    return { ok: false, error: "El placement no existe o el plan no es editable" };
  }

  const update: Partial<typeof mediaPlanTrafficBriefs.$inferInsert> = {};
  if (input.adsetsCount !== undefined) {
    const n = Math.trunc(input.adsetsCount);
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, error: "La cantidad de adsets tiene que ser 0 o más" };
    }
    update.adsetsCount = n;
  }
  if (input.trafficFolderUrl !== undefined) {
    const link = normalizeExternalUrl(input.trafficFolderUrl);
    if (!link.ok) return { ok: false, error: link.error };
    update.trafficFolderUrl = link.url;
  }
  if (Object.keys(update).length === 0) return { ok: true };

  const briefId = await ensureBrief(input.placementId);
  const [before] = await db
    .select()
    .from(mediaPlanTrafficBriefs)
    .where(eq(mediaPlanTrafficBriefs.id, briefId))
    .limit(1);

  const [after] = await db
    .update(mediaPlanTrafficBriefs)
    .set({ ...update, updatedAt: sql`now()` })
    .where(eq(mediaPlanTrafficBriefs.id, briefId))
    .returning();

  await recordAudit({
    entityType: "plan_traffic_brief",
    entityId: briefId,
    action: "update",
    beforeJson: before,
    afterJson: after,
  });

  revalidateTraffic(ctx);
  return { ok: true };
}

// ── Anuncios del brief ──────────────────────────────────────────────────────

export async function addTrafficAd(input: {
  placementId: string;
}): Promise<Result<{ adId: string }>> {
  if (!input.placementId) return { ok: false, error: "Falta placement_id" };
  const ctx = await planCtxForPlacement(input.placementId);
  if (!ctx) {
    return { ok: false, error: "El placement no existe o el plan no es editable" };
  }

  const briefId = await ensureBrief(input.placementId);
  const [{ next }] = await db
    .select({
      next: sql<number>`coalesce(max(${mediaPlanTrafficAds.sortOrder}), -1) + 1`,
    })
    .from(mediaPlanTrafficAds)
    .where(eq(mediaPlanTrafficAds.briefId, briefId));

  const [ad] = await db
    .insert(mediaPlanTrafficAds)
    .values({ briefId, sortOrder: next })
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
  adFormat?: string | null;
  adFormatOther?: string | null;
  copy?: string | null;
  headline?: string | null;
  subheadline?: string | null;
  cta?: string | null;
  landingUrl?: string | null;
}): Promise<Result> {
  if (!input.adId) return { ok: false, error: "Falta ad_id" };
  const ctx = await planCtxForAd(input.adId);
  if (!ctx) {
    return { ok: false, error: "El anuncio no existe o el plan no es editable" };
  }

  const update: Partial<typeof mediaPlanTrafficAds.$inferInsert> = {};

  if (input.adFormat !== undefined) {
    const f = (input.adFormat ?? "").trim();
    if (f && !isTrafficAdFormat(f)) {
      return { ok: false, error: `Tipo de anuncio desconocido: "${f}"` };
    }
    update.adFormat = f ? (f as typeof update.adFormat) : null;
    // Salir de "Otro" limpia el texto libre: si no, quedaría un formato
    // fantasma que la vista ya no muestra pero el Excel sí exportaría.
    if (f !== "other") update.adFormatOther = null;
  }
  if (input.adFormatOther !== undefined) {
    update.adFormatOther = (input.adFormatOther ?? "").trim() || null;
  }
  if (input.copy !== undefined) update.copy = (input.copy ?? "").trim() || null;
  if (input.headline !== undefined) {
    update.headline = (input.headline ?? "").trim() || null;
  }
  if (input.subheadline !== undefined) {
    update.subheadline = (input.subheadline ?? "").trim() || null;
  }
  if (input.cta !== undefined) update.cta = (input.cta ?? "").trim() || null;
  if (input.landingUrl !== undefined) {
    const link = normalizeExternalUrl(input.landingUrl);
    if (!link.ok) return { ok: false, error: link.error };
    update.landingUrl = link.url;
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
    return { ok: false, error: "El anuncio no existe o el plan no es editable" };
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
    return { ok: false, error: "El anuncio no existe o el plan no es editable" };
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
