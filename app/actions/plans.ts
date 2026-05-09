"use server";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  auditLog,
  clientPublishers,
  markets,
  mediaPlanFees,
  mediaPlanPlacements,
  mediaPlanPublishers,
  mediaPlans,
  mediaPlanSnapshots,
  metricsCatalog,
  projects,
  publishers,
} from "@/db/schema";

type Result<T = void> =
  | (T extends void ? { ok: true } : { ok: true } & T)
  | { ok: false; error: string };

// ════════════════════════════════════════════════════════════════════════════
// Plan CRUD
// ════════════════════════════════════════════════════════════════════════════

export async function createPlan(input: {
  projectId: string;
  name: string;
}): Promise<Result<{ planId: string }>> {
  if (!input.projectId) return { ok: false, error: "Falta project_id" };
  if (!input.name.trim()) return { ok: false, error: "El plan necesita un nombre" };

  // Validar nombre único en el proyecto
  const [existing] = await db
    .select({ id: mediaPlans.id })
    .from(mediaPlans)
    .where(
      and(
        eq(mediaPlans.projectId, input.projectId),
        eq(mediaPlans.name, input.name.trim()),
      ),
    )
    .limit(1);

  if (existing) {
    return {
      ok: false,
      error: `Ya existe un plan llamado "${input.name}" en este proyecto`,
    };
  }

  const [plan] = await db
    .insert(mediaPlans)
    .values({
      projectId: input.projectId,
      name: input.name.trim(),
      status: "draft",
    })
    .returning();

  await db.insert(auditLog).values({
    entityType: "media_plan",
    entityId: plan.id,
    action: "create",
    afterJson: plan,
  });

  // Find project to revalidate path
  const [proj] = await db
    .select({ code: projects.code })
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1);
  if (proj) revalidatePath(`/proyectos/${proj.code}`);

  return { ok: true, planId: plan.id };
}

export async function updatePlanMetadata(input: {
  planId: string;
  name?: string;
  notesMd?: string | null;
}): Promise<Result> {
  if (!input.planId) return { ok: false, error: "Falta plan_id" };

  const [before] = await db
    .select()
    .from(mediaPlans)
    .where(eq(mediaPlans.id, input.planId))
    .limit(1);
  if (!before) return { ok: false, error: "Plan no encontrado" };
  if (before.status === "archived") {
    return { ok: false, error: "Plan archivado, no se puede editar" };
  }

  const update: Record<string, unknown> = {};
  if (input.name !== undefined) update.name = input.name.trim();
  if (input.notesMd !== undefined) update.notesMd = input.notesMd;
  if (Object.keys(update).length === 0) return { ok: true };

  const [after] = await db
    .update(mediaPlans)
    .set(update)
    .where(eq(mediaPlans.id, input.planId))
    .returning();

  await db.insert(auditLog).values({
    entityType: "media_plan",
    entityId: input.planId,
    action: "update",
    beforeJson: before,
    afterJson: after,
  });

  return { ok: true };
}

export async function transitionPlanStatus(input: {
  planId: string;
  to: "draft" | "ready_to_send" | "approved" | "archived";
  notes?: string;
}): Promise<Result> {
  if (!input.planId) return { ok: false, error: "Falta plan_id" };

  const [before] = await db
    .select()
    .from(mediaPlans)
    .where(eq(mediaPlans.id, input.planId))
    .limit(1);
  if (!before) return { ok: false, error: "Plan no encontrado" };

  // Validar transiciones permitidas
  const valid: Record<string, string[]> = {
    draft: ["ready_to_send", "archived"],
    ready_to_send: ["draft", "approved", "archived"],
    approved: ["draft", "archived"], // editar = volver a draft de v(N+1)
    archived: [], // terminal
  };
  if (!valid[before.status].includes(input.to)) {
    return {
      ok: false,
      error: `Transición ${before.status} → ${input.to} no permitida`,
    };
  }

  // Si pasa a approved: tomar snapshot inmutable.
  if (input.to === "approved") {
    const newVersion = before.currentVersion + 1;

    const fullPlan = await capturePlanSnapshot(input.planId);

    await db.insert(mediaPlanSnapshots).values({
      mediaPlanId: input.planId,
      versionNumber: newVersion,
      snapshotJson: fullPlan,
      notes: input.notes ?? null,
    });

    await db
      .update(mediaPlans)
      .set({ status: "approved", currentVersion: newVersion })
      .where(eq(mediaPlans.id, input.planId));
  } else {
    await db
      .update(mediaPlans)
      .set({ status: input.to })
      .where(eq(mediaPlans.id, input.planId));
  }

  await db.insert(auditLog).values({
    entityType: "media_plan",
    entityId: input.planId,
    action: "update",
    beforeJson: before,
    afterJson: { ...before, status: input.to },
  });

  // revalidate
  const [proj] = await db
    .select({ code: projects.code })
    .from(projects)
    .where(eq(projects.id, before.projectId))
    .limit(1);
  if (proj) {
    revalidatePath(`/proyectos/${proj.code}`);
    revalidatePath(`/proyectos/${proj.code}/planes/${input.planId}`);
  }

  return { ok: true };
}

async function capturePlanSnapshot(planId: string) {
  // Snapshot mínimo viable: plan + publishers + placements + fees.
  const [plan] = await db
    .select()
    .from(mediaPlans)
    .where(eq(mediaPlans.id, planId))
    .limit(1);
  const pubs = await db
    .select()
    .from(mediaPlanPublishers)
    .where(eq(mediaPlanPublishers.mediaPlanId, planId))
    .orderBy(asc(mediaPlanPublishers.sortOrder));
  const mppIds = pubs.map((p) => p.id);
  const placements =
    mppIds.length === 0
      ? []
      : await db
          .select()
          .from(mediaPlanPlacements)
          .where(inArray(mediaPlanPlacements.mediaPlanPublisherId, mppIds));
  const fees = await db
    .select()
    .from(mediaPlanFees)
    .where(eq(mediaPlanFees.mediaPlanId, planId));

  return { plan, publishers: pubs, placements, fees };
}

// ════════════════════════════════════════════════════════════════════════════
// Publisher dentro del plan
// ════════════════════════════════════════════════════════════════════════════

export async function addPublisherToPlan(input: {
  planId: string;
  publisherId: string;
  totalPlannedUsd?: number;
}): Promise<Result<{ mppId: string }>> {
  const [plan] = await db
    .select()
    .from(mediaPlans)
    .where(eq(mediaPlans.id, input.planId))
    .limit(1);
  if (!plan) return { ok: false, error: "Plan no encontrado" };
  if (plan.status === "archived") {
    return { ok: false, error: "Plan archivado" };
  }

  // Sort order = max + 1
  const [{ next }] = await db
    .select({
      next: sql<number>`coalesce(max(${mediaPlanPublishers.sortOrder}), -1) + 1`,
    })
    .from(mediaPlanPublishers)
    .where(eq(mediaPlanPublishers.mediaPlanId, input.planId));

  try {
    const [mpp] = await db
      .insert(mediaPlanPublishers)
      .values({
        mediaPlanId: input.planId,
        publisherId: input.publisherId,
        totalPlannedUsd: (input.totalPlannedUsd ?? 0).toFixed(2),
        sortOrder: next,
      })
      .returning();

    await db.insert(auditLog).values({
      entityType: "media_plan_publisher",
      entityId: mpp.id,
      action: "create",
      afterJson: mpp,
    });

    return { ok: true, mppId: mpp.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    return { ok: false, error: `No se pudo agregar el publisher: ${msg}` };
  }
}

export async function updatePlanPublisher(input: {
  mppId: string;
  totalPlannedUsd?: number;
  agencyPaysOverride?: boolean | null;
}): Promise<Result> {
  const [before] = await db
    .select()
    .from(mediaPlanPublishers)
    .where(eq(mediaPlanPublishers.id, input.mppId))
    .limit(1);
  if (!before) return { ok: false, error: "Publisher row no encontrado" };

  const update: Record<string, unknown> = {};
  if (input.totalPlannedUsd !== undefined) {
    if (input.totalPlannedUsd < 0)
      return { ok: false, error: "Total no puede ser negativo" };
    update.totalPlannedUsd = input.totalPlannedUsd.toFixed(2);
  }
  if (input.agencyPaysOverride !== undefined)
    update.agencyPaysOverride = input.agencyPaysOverride;
  if (Object.keys(update).length === 0) return { ok: true };

  const [after] = await db
    .update(mediaPlanPublishers)
    .set(update)
    .where(eq(mediaPlanPublishers.id, input.mppId))
    .returning();

  await db.insert(auditLog).values({
    entityType: "media_plan_publisher",
    entityId: input.mppId,
    action: "update",
    beforeJson: before,
    afterJson: after,
  });

  return { ok: true };
}

export async function removePublisherFromPlan(
  mppId: string,
): Promise<Result> {
  const [before] = await db
    .select()
    .from(mediaPlanPublishers)
    .where(eq(mediaPlanPublishers.id, mppId))
    .limit(1);
  if (!before) return { ok: false, error: "No encontrado" };

  await db.delete(mediaPlanPublishers).where(eq(mediaPlanPublishers.id, mppId));

  await db.insert(auditLog).values({
    entityType: "media_plan_publisher",
    entityId: mppId,
    action: "delete",
    beforeJson: before,
  });

  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
// Placements
// ════════════════════════════════════════════════════════════════════════════

export async function addPlacement(input: {
  mppId: string;
  placementName: string;
  marketId?: string | null;
  amountUsd: number;
}): Promise<Result<{ placementId: string }>> {
  if (!input.placementName.trim())
    return { ok: false, error: "Nombre de placement requerido" };
  if (!Number.isFinite(input.amountUsd) || input.amountUsd < 0)
    return { ok: false, error: "Monto inválido" };

  const [{ next }] = await db
    .select({
      next: sql<number>`coalesce(max(${mediaPlanPlacements.sortOrder}), -1) + 1`,
    })
    .from(mediaPlanPlacements)
    .where(eq(mediaPlanPlacements.mediaPlanPublisherId, input.mppId));

  const [pl] = await db
    .insert(mediaPlanPlacements)
    .values({
      mediaPlanPublisherId: input.mppId,
      placementName: input.placementName.trim(),
      marketId: input.marketId ?? null,
      amountUsd: input.amountUsd.toFixed(2),
      sortOrder: next,
    })
    .returning();

  await db.insert(auditLog).values({
    entityType: "media_plan_placement",
    entityId: pl.id,
    action: "create",
    afterJson: pl,
  });

  return { ok: true, placementId: pl.id };
}

export async function updatePlacement(input: {
  placementId: string;
  placementName?: string;
  marketId?: string | null;
  audience?: string | null;
  amountUsd?: number;
  costMethod?:
    | "dCPV"
    | "dCPC"
    | "dCPM"
    | "CPM"
    | "CPC"
    | "CPV"
    | "CPA"
    | "Flat"
    | "Other"
    | null;
  startDate?: string | null;
  endDate?: string | null;
  metricsJson?: Record<string, number>;
  notesMd?: string | null;
}): Promise<Result> {
  const [before] = await db
    .select()
    .from(mediaPlanPlacements)
    .where(eq(mediaPlanPlacements.id, input.placementId))
    .limit(1);
  if (!before) return { ok: false, error: "Placement no encontrado" };

  const update: Record<string, unknown> = {};
  if (input.placementName !== undefined)
    update.placementName = input.placementName.trim();
  if (input.marketId !== undefined) update.marketId = input.marketId;
  if (input.audience !== undefined) update.audience = input.audience;
  if (input.amountUsd !== undefined) {
    if (!Number.isFinite(input.amountUsd) || input.amountUsd < 0)
      return { ok: false, error: "Monto inválido" };
    update.amountUsd = input.amountUsd.toFixed(2);
  }
  if (input.costMethod !== undefined) update.costMethod = input.costMethod;
  if (input.startDate !== undefined) update.startDate = input.startDate;
  if (input.endDate !== undefined) update.endDate = input.endDate;
  if (input.metricsJson !== undefined) update.metricsJson = input.metricsJson;
  if (input.notesMd !== undefined) update.notesMd = input.notesMd;
  if (Object.keys(update).length === 0) return { ok: true };

  const [after] = await db
    .update(mediaPlanPlacements)
    .set(update)
    .where(eq(mediaPlanPlacements.id, input.placementId))
    .returning();

  await db.insert(auditLog).values({
    entityType: "media_plan_placement",
    entityId: input.placementId,
    action: "update",
    beforeJson: before,
    afterJson: after,
  });

  return { ok: true };
}

export async function removePlacement(placementId: string): Promise<Result> {
  const [before] = await db
    .select()
    .from(mediaPlanPlacements)
    .where(eq(mediaPlanPlacements.id, placementId))
    .limit(1);
  if (!before) return { ok: false, error: "No encontrado" };

  await db.delete(mediaPlanPlacements).where(eq(mediaPlanPlacements.id, placementId));

  await db.insert(auditLog).values({
    entityType: "media_plan_placement",
    entityId: placementId,
    action: "delete",
    beforeJson: before,
  });

  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
// Fees
// ════════════════════════════════════════════════════════════════════════════

export async function addFee(input: {
  planId: string;
  feeType: "management" | "setup" | "reporting" | "custom";
  name: string;
  amountUsd?: number;       // para non-management
  ratePct?: number | null;  // solo para management (0-100)
  notes?: string | null;
}): Promise<Result<{ feeId: string }>> {
  if (!input.name.trim()) return { ok: false, error: "Nombre del fee requerido" };

  const isManagementWithRate =
    input.feeType === "management" && input.ratePct != null && input.ratePct > 0;

  if (isManagementWithRate) {
    if (input.ratePct! >= 100) {
      return { ok: false, error: "Rate debe ser menor a 100%" };
    }
  } else {
    if (!Number.isFinite(input.amountUsd) || (input.amountUsd ?? 0) < 0) {
      return { ok: false, error: "Monto inválido" };
    }
  }

  const [{ next }] = await db
    .select({
      next: sql<number>`coalesce(max(${mediaPlanFees.sortOrder}), -1) + 1`,
    })
    .from(mediaPlanFees)
    .where(eq(mediaPlanFees.mediaPlanId, input.planId));

  // Para management con rate, dejamos amount=0 — se computa al leer.
  const [f] = await db
    .insert(mediaPlanFees)
    .values({
      mediaPlanId: input.planId,
      feeType: input.feeType,
      name: input.name.trim(),
      ratePct: isManagementWithRate ? input.ratePct!.toFixed(2) : null,
      amountUsd: isManagementWithRate ? "0.00" : (input.amountUsd ?? 0).toFixed(2),
      notes: input.notes ?? null,
      sortOrder: next,
    })
    .returning();

  await db.insert(auditLog).values({
    entityType: "media_plan_fee",
    entityId: f.id,
    action: "create",
    afterJson: f,
  });

  return { ok: true, feeId: f.id };
}

export async function updateFee(input: {
  feeId: string;
  name?: string;
  amountUsd?: number;
  ratePct?: number | null;  // solo aplica a management
  notes?: string | null;
}): Promise<Result> {
  const [before] = await db
    .select()
    .from(mediaPlanFees)
    .where(eq(mediaPlanFees.id, input.feeId))
    .limit(1);
  if (!before) return { ok: false, error: "Fee no encontrado" };

  const update: Record<string, unknown> = {};
  if (input.name !== undefined) update.name = input.name.trim();
  if (input.amountUsd !== undefined) {
    if (!Number.isFinite(input.amountUsd) || input.amountUsd < 0)
      return { ok: false, error: "Monto inválido" };
    update.amountUsd = input.amountUsd.toFixed(2);
  }
  if (input.ratePct !== undefined) {
    if (input.ratePct === null) {
      update.ratePct = null;
    } else {
      if (input.ratePct < 0 || input.ratePct >= 100)
        return { ok: false, error: "Rate debe estar entre 0 y 100 (exclusivo)" };
      update.ratePct = input.ratePct.toFixed(2);
      // Si seteamos rate, el amount queda en 0 (se computa al leer)
      if (before.feeType === "management") update.amountUsd = "0.00";
    }
  }
  if (input.notes !== undefined) update.notes = input.notes;
  if (Object.keys(update).length === 0) return { ok: true };

  const [after] = await db
    .update(mediaPlanFees)
    .set(update)
    .where(eq(mediaPlanFees.id, input.feeId))
    .returning();

  await db.insert(auditLog).values({
    entityType: "media_plan_fee",
    entityId: input.feeId,
    action: "update",
    beforeJson: before,
    afterJson: after,
  });

  return { ok: true };
}

export async function removeFee(feeId: string): Promise<Result> {
  const [before] = await db
    .select()
    .from(mediaPlanFees)
    .where(eq(mediaPlanFees.id, feeId))
    .limit(1);
  if (!before) return { ok: false, error: "No encontrado" };

  await db.delete(mediaPlanFees).where(eq(mediaPlanFees.id, feeId));

  await db.insert(auditLog).values({
    entityType: "media_plan_fee",
    entityId: feeId,
    action: "delete",
    beforeJson: before,
  });

  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
// Lookups del catálogo (para los dropdowns del editor)
// ════════════════════════════════════════════════════════════════════════════

export async function listPublishers() {
  return db
    .select()
    .from(publishers)
    .where(eq(publishers.enabled, true))
    .orderBy(asc(publishers.sortOrder), asc(publishers.name));
}

// Publishers habilitados para UN cliente, con su `agencyPays` propio.
// Si el cliente todavía no tiene mapping para algún publisher del catálogo,
// ese publisher no aparece (la mappings es la fuente de verdad por cliente).
export async function listPublishersForClient(clientId: string) {
  const rows = await db
    .select({
      id: publishers.id,
      slug: publishers.slug,
      name: publishers.name,
      enabled: publishers.enabled,
      agencyPays: clientPublishers.agencyPays,
      sortOrder: clientPublishers.sortOrder,
      cpEnabled: clientPublishers.enabled,
    })
    .from(clientPublishers)
    .innerJoin(publishers, eq(clientPublishers.publisherId, publishers.id))
    .where(
      and(
        eq(clientPublishers.clientId, clientId),
        eq(clientPublishers.enabled, true),
        eq(publishers.enabled, true),
      ),
    )
    .orderBy(asc(clientPublishers.sortOrder), asc(publishers.name));
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    enabled: r.enabled,
    agencyPaysDefault: r.agencyPays,
    sortOrder: r.sortOrder,
  }));
}

export async function listMarkets() {
  return db
    .select()
    .from(markets)
    .where(eq(markets.enabled, true))
    .orderBy(asc(markets.sortOrder), asc(markets.name));
}

export async function listMetrics() {
  return db
    .select()
    .from(metricsCatalog)
    .where(eq(metricsCatalog.enabled, true))
    .orderBy(asc(metricsCatalog.sortOrder), asc(metricsCatalog.name));
}
