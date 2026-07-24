"use server";

import { and, asc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { recordAudit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { canApprovePlans } from "@/lib/permissions";
import {
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

  // Validar nombre único entre los planes VIVOS del proyecto (los borrados en
  // la papelera no cuentan — su nombre se puede reusar).
  const [existing] = await db
    .select({ id: mediaPlans.id })
    .from(mediaPlans)
    .where(
      and(
        eq(mediaPlans.projectId, input.projectId),
        eq(mediaPlans.name, input.name.trim()),
        isNull(mediaPlans.deletedAt),
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

  await recordAudit({
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

// Borra un plan (soft delete): lo manda a la papelera (deletedAt = now) en vez
// de eliminarlo físicamente. Se conserva ad eternum con todos sus publishers /
// placements / fees / billings, que dejan de aparecer porque las queries de
// listado filtran por deletedAt IS NULL. Se puede restaurar desde la papelera.
export async function deletePlan(input: { planId: string }): Promise<Result> {
  if (!input.planId) return { ok: false, error: "Falta plan_id" };

  const [before] = await db
    .select()
    .from(mediaPlans)
    .where(eq(mediaPlans.id, input.planId))
    .limit(1);
  if (!before) return { ok: false, error: "Plan no encontrado" };
  if (before.deletedAt) return { ok: true }; // ya está en la papelera

  const [after] = await db
    .update(mediaPlans)
    .set({ deletedAt: new Date() })
    .where(eq(mediaPlans.id, input.planId))
    .returning();

  await recordAudit({
    entityType: "media_plan",
    entityId: input.planId,
    action: "delete",
    beforeJson: before,
    afterJson: after,
  });

  const [proj] = await db
    .select({ code: projects.code })
    .from(projects)
    .where(eq(projects.id, before.projectId))
    .limit(1);
  if (proj) revalidatePath(`/proyectos/${proj.code}`);
  revalidatePath("/configuracion/papelera-planes");

  return { ok: true };
}

// Restaura un plan desde la papelera (deletedAt = null). Si en el proyecto ya
// hay un plan VIVO con el mismo nombre, el partial unique index lo rechazaría,
// así que pre-chequeamos y devolvemos un error legible.
export async function restorePlan(input: { planId: string }): Promise<Result> {
  if (!input.planId) return { ok: false, error: "Falta plan_id" };

  const [before] = await db
    .select()
    .from(mediaPlans)
    .where(eq(mediaPlans.id, input.planId))
    .limit(1);
  if (!before) return { ok: false, error: "Plan no encontrado" };
  if (!before.deletedAt) return { ok: true }; // ya está vivo

  const [clash] = await db
    .select({ id: mediaPlans.id })
    .from(mediaPlans)
    .where(
      and(
        eq(mediaPlans.projectId, before.projectId),
        eq(mediaPlans.name, before.name),
        isNull(mediaPlans.deletedAt),
      ),
    )
    .limit(1);
  if (clash) {
    return {
      ok: false,
      error: `Ya existe un plan activo llamado "${before.name}" en el proyecto. Renombralo o borralo antes de restaurar este.`,
    };
  }

  const [after] = await db
    .update(mediaPlans)
    .set({ deletedAt: null })
    .where(eq(mediaPlans.id, input.planId))
    .returning();

  await recordAudit({
    entityType: "media_plan",
    entityId: input.planId,
    action: "update",
    beforeJson: before,
    afterJson: after,
  });

  const [proj] = await db
    .select({ code: projects.code })
    .from(projects)
    .where(eq(projects.id, before.projectId))
    .limit(1);
  if (proj) revalidatePath(`/proyectos/${proj.code}`);
  revalidatePath("/configuracion/papelera-planes");

  return { ok: true };
}

// Borra DEFINITIVAMENTE un plan desde la papelera (hard delete). Sólo se
// permite si el plan ya está en la papelera (deletedAt != null). El delete
// físico cascadea a publishers / placements / fees / snapshots / billings
// (FKs onDelete: cascade). Es irreversible.
export async function hardDeletePlan(input: { planId: string }): Promise<Result> {
  if (!input.planId) return { ok: false, error: "Falta plan_id" };

  const [before] = await db
    .select()
    .from(mediaPlans)
    .where(eq(mediaPlans.id, input.planId))
    .limit(1);
  if (!before) return { ok: false, error: "Plan no encontrado" };
  if (!before.deletedAt) {
    return {
      ok: false,
      error: "El plan no está en la papelera. Borralo primero para poder eliminarlo definitivamente.",
    };
  }

  await db.delete(mediaPlans).where(eq(mediaPlans.id, input.planId));

  await recordAudit({
    entityType: "media_plan",
    entityId: input.planId,
    action: "delete",
    beforeJson: before,
  });

  revalidatePath("/configuracion/papelera-planes");

  return { ok: true };
}

// Duplica un plan existente dentro de un proyecto (puede ser el mismo del
// plan fuente o uno distinto del mismo cliente). Clona el plan + todos sus
// publishers + placements + fees. El plan nuevo arranca en estado 'draft',
// con currentVersion=0 y SIN snapshots (los aprobados se quedan en el
// original). Si el targetProject es del mismo cliente que el fuente,
// dejamos pasar; si es de otro cliente, fallamos (los publishers /
// markets / metrics son per-cliente y no se pueden mezclar).
export async function duplicatePlan(input: {
  sourcePlanId: string;
  targetProjectId: string;
  newName: string;
}): Promise<Result<{ planId: string }>> {
  if (!input.newName.trim())
    return { ok: false, error: "El plan necesita un nombre" };

  const [src] = await db
    .select({
      plan: mediaPlans,
      sourceClientId: projects.clientId,
    })
    .from(mediaPlans)
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
    .where(eq(mediaPlans.id, input.sourcePlanId))
    .limit(1);
  if (!src) return { ok: false, error: "Plan fuente no encontrado" };

  const [target] = await db
    .select({ id: projects.id, clientId: projects.clientId, code: projects.code })
    .from(projects)
    .where(eq(projects.id, input.targetProjectId))
    .limit(1);
  if (!target) return { ok: false, error: "Proyecto destino no encontrado" };

  if (target.clientId !== src.sourceClientId) {
    return {
      ok: false,
      error:
        "El proyecto destino es de otro cliente — los publishers, markets y métricas no se comparten entre clientes.",
    };
  }

  const [collision] = await db
    .select({ id: mediaPlans.id })
    .from(mediaPlans)
    .where(
      and(
        eq(mediaPlans.projectId, input.targetProjectId),
        eq(mediaPlans.name, input.newName.trim()),
        isNull(mediaPlans.deletedAt),
      ),
    )
    .limit(1);
  if (collision) {
    return {
      ok: false,
      error: `Ya existe un plan llamado "${input.newName}" en el proyecto destino`,
    };
  }

  // Snapshot completo del plan fuente.
  const srcPubs = await db
    .select()
    .from(mediaPlanPublishers)
    .where(eq(mediaPlanPublishers.mediaPlanId, input.sourcePlanId))
    .orderBy(asc(mediaPlanPublishers.sortOrder));

  const srcPubIds = srcPubs.map((p) => p.id);
  const srcPlacements =
    srcPubIds.length === 0
      ? []
      : await db
          .select()
          .from(mediaPlanPlacements)
          .where(inArray(mediaPlanPlacements.mediaPlanPublisherId, srcPubIds))
          .orderBy(asc(mediaPlanPlacements.sortOrder));

  const srcFees = await db
    .select()
    .from(mediaPlanFees)
    .where(eq(mediaPlanFees.mediaPlanId, input.sourcePlanId))
    .orderBy(asc(mediaPlanFees.sortOrder));

  // Insertar plan nuevo en draft.
  const [newPlan] = await db
    .insert(mediaPlans)
    .values({
      projectId: input.targetProjectId,
      name: input.newName.trim(),
      status: "draft",
      notesMd: src.plan.notesMd,
    })
    .returning();

  // Insertar publishers (mapeando oldMppId → newMppId para los placements).
  const idMap = new Map<string, string>();
  for (const pub of srcPubs) {
    const [newPub] = await db
      .insert(mediaPlanPublishers)
      .values({
        mediaPlanId: newPlan.id,
        publisherId: pub.publisherId,
        totalPlannedUsd: pub.totalPlannedUsd,
        agencyPaysOverride: pub.agencyPaysOverride,
        sortOrder: pub.sortOrder,
      })
      .returning();
    idMap.set(pub.id, newPub.id);
  }

  if (srcPlacements.length > 0) {
    await db.insert(mediaPlanPlacements).values(
      srcPlacements.map((p) => ({
        mediaPlanPublisherId: idMap.get(p.mediaPlanPublisherId)!,
        placementName: p.placementName,
        marketId: p.marketId,
        audience: p.audience,
        amountUsd: p.amountUsd,
        costMethod: p.costMethod,
        startDate: p.startDate,
        endDate: p.endDate,
        metricsJson: p.metricsJson ?? {},
        notesMd: p.notesMd,
        sortOrder: p.sortOrder,
      })),
    );
  }

  if (srcFees.length > 0) {
    await db.insert(mediaPlanFees).values(
      srcFees.map((f) => ({
        mediaPlanId: newPlan.id,
        feeType: f.feeType,
        name: f.name,
        ratePct: f.ratePct,
        amountUsd: f.amountUsd,
        notes: f.notes,
        sortOrder: f.sortOrder,
      })),
    );
  }

  await recordAudit({
    entityType: "media_plan",
    entityId: newPlan.id,
    action: "create",
    afterJson: {
      ...newPlan,
      duplicatedFromPlanId: input.sourcePlanId,
      publishersCopied: srcPubs.length,
      placementsCopied: srcPlacements.length,
      feesCopied: srcFees.length,
    },
  });

  revalidatePath(`/proyectos/${target.code}`);

  return { ok: true, planId: newPlan.id };
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

  await recordAudit({
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

  // Aprobar un plan está restringido a una allowlist de usuarios (aprobar
  // congela un snapshot inmutable). Barrera real server-side; la UI esconde el
  // botón como conveniencia.
  if (input.to === "approved") {
    const user = await getCurrentUser();
    if (!canApprovePlans(user?.email)) {
      return {
        ok: false,
        error:
          "No tenés permiso para aprobar planes. Solo mariano.mantovani@sangria.agency y herman.grabosky@sangria.agency pueden marcar un plan como Aprobado.",
      };
    }
  }

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

  // Regla dura: un plan NO puede pasar a "listo" ni "aprobado" con placements
  // sin fecha de inicio/fin. Un placement sin fechas no entra al prorrateo de la
  // facturación ni de la estimación (getBillingEstimate lo saltea con
  // `if (!startDate || !endDate) continue`), así que su media —y el management
  // fee sobre esa media— desaparecen silenciosamente del estimado. Exigimos las
  // fechas justo antes de que el plan se vuelva facturable (ready_to_send/approved).
  if (input.to === "ready_to_send" || input.to === "approved") {
    const undated = await db
      .select({ name: mediaPlanPlacements.placementName })
      .from(mediaPlanPlacements)
      .innerJoin(
        mediaPlanPublishers,
        eq(mediaPlanPlacements.mediaPlanPublisherId, mediaPlanPublishers.id),
      )
      .where(
        and(
          eq(mediaPlanPublishers.mediaPlanId, input.planId),
          or(
            isNull(mediaPlanPlacements.startDate),
            isNull(mediaPlanPlacements.endDate),
          ),
        ),
      );
    if (undated.length > 0) {
      const names = undated
        .map((p) => p.name?.trim() || "(placement sin nombre)")
        .join(", ");
      const target = input.to === "approved" ? "Aprobado" : "Listo";
      return {
        ok: false,
        error: `No se puede marcar el plan como ${target}: estos placements no tienen fecha de inicio y/o fin — ${names}. Cargá las fechas: un placement sin fechas no entra en la facturación ni en la estimación.`,
      };
    }
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

  await recordAudit({
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

// Forma del JSON que guarda capturePlanSnapshot (lo que persistimos en
// media_plan_snapshots.snapshot_json). Numéricos / fechas vienen como string
// desde el JSONB — los reinsertamos tal cual, igual que duplicatePlan.
type CapturedSnapshot = {
  plan: typeof mediaPlans.$inferSelect;
  publishers: (typeof mediaPlanPublishers.$inferSelect)[];
  placements: (typeof mediaPlanPlacements.$inferSelect)[];
  fees: (typeof mediaPlanFees.$inferSelect)[];
};

// Descarta el borrador (draft) de la versión siguiente y vuelve al plan
// aprobado vigente. Es la contraparte de "Editar (nueva versión)" (que pasa
// approved → draft de v(N+1)): si el planner abrió un draft sobre un MP ya
// firmado y se arrepiente, esto tira TODOS los cambios del draft y restaura el
// plan al snapshot de la última versión aprobada (version = currentVersion),
// dejándolo de nuevo en 'approved'. Sólo aplica a un draft con
// currentVersion > 0 (tiene un snapshot al cual volver). Irreversible.
export async function revertPlanToApprovedSnapshot(input: {
  planId: string;
}): Promise<Result> {
  if (!input.planId) return { ok: false, error: "Falta plan_id" };

  const [plan] = await db
    .select()
    .from(mediaPlans)
    .where(eq(mediaPlans.id, input.planId))
    .limit(1);
  if (!plan) return { ok: false, error: "Plan no encontrado" };
  if (plan.deletedAt) return { ok: false, error: "El plan está en la papelera" };
  if (plan.status !== "draft" || plan.currentVersion < 1) {
    return {
      ok: false,
      error:
        "Solo se puede descartar un borrador que viene de una versión aprobada. Este plan no tiene una versión aprobada a la cual volver.",
    };
  }

  // Snapshot de la versión aprobada vigente (= currentVersion).
  const [snap] = await db
    .select()
    .from(mediaPlanSnapshots)
    .where(
      and(
        eq(mediaPlanSnapshots.mediaPlanId, input.planId),
        eq(mediaPlanSnapshots.versionNumber, plan.currentVersion),
      ),
    )
    .limit(1);
  if (!snap) {
    return {
      ok: false,
      error: `No se encontró el snapshot de la versión aprobada (v${plan.currentVersion}).`,
    };
  }

  const data = snap.snapshotJson as CapturedSnapshot;
  if (!data || !data.plan) {
    return {
      ok: false,
      error: "El snapshot de la versión aprobada está vacío o corrupto.",
    };
  }

  // Si el draft renombró el plan y otro plan VIVO del proyecto ya tomó el
  // nombre aprobado, restaurarlo violaría el partial unique index
  // (project_id, name) WHERE deleted_at IS NULL. Pre-chequeamos para devolver
  // un error legible en vez de reventar la transacción.
  if (data.plan.name !== plan.name) {
    const [clash] = await db
      .select({ id: mediaPlans.id })
      .from(mediaPlans)
      .where(
        and(
          eq(mediaPlans.projectId, plan.projectId),
          eq(mediaPlans.name, data.plan.name),
          isNull(mediaPlans.deletedAt),
          ne(mediaPlans.id, input.planId),
        ),
      )
      .limit(1);
    if (clash) {
      return {
        ok: false,
        error: `No se puede volver al plan aprobado: ya hay otro plan activo llamado "${data.plan.name}" en el proyecto. Renombralo e intentá de nuevo.`,
      };
    }
  }

  // Restaurar es destructivo (borra el contenido del draft y reescribe el del
  // snapshot): lo hacemos en una transacción para no dejar el plan a medias si
  // algo falla. Cualquier error inesperado se captura y se devuelve como
  // Result (toast) en vez de propagar y romper la vista con el error boundary.
  //
  // Un placement del snapshot puede referenciar un market_id que YA NO existe
  // (los markets se borran/editan desde config; la FK live es onDelete:set null,
  // pero el JSONB del snapshot congeló el id viejo). Reinsertarlo violaría la FK
  // a markets y reventaría la transacción → sanitizamos: si el market ya no
  // existe, lo dejamos en null (lo mismo que hizo la FK al borrarse). El
  // publisher_id es seguro (FK onDelete:restrict → no se puede borrar en uso).
  const snapshotMarketIds = Array.from(
    new Set(
      (data.placements ?? [])
        .map((p) => p.marketId)
        .filter((m): m is string => !!m),
    ),
  );
  const liveMarketIds = new Set<string>();
  if (snapshotMarketIds.length > 0) {
    const existingMarkets = await db
      .select({ id: markets.id })
      .from(markets)
      .where(inArray(markets.id, snapshotMarketIds));
    for (const m of existingMarkets) liveMarketIds.add(m.id);
  }

  try {
    await db.transaction(async (tx) => {
      // El delete de publishers cascadea a sus placements (FK onDelete cascade).
      await tx
        .delete(mediaPlanPublishers)
        .where(eq(mediaPlanPublishers.mediaPlanId, input.planId));
      await tx
        .delete(mediaPlanFees)
        .where(eq(mediaPlanFees.mediaPlanId, input.planId));

      // Reinsertar publishers del snapshot (old id → new id para los placements).
      const idMap = new Map<string, string>();
      for (const pub of data.publishers ?? []) {
        const [newPub] = await tx
          .insert(mediaPlanPublishers)
          .values({
            mediaPlanId: input.planId,
            publisherId: pub.publisherId,
            totalPlannedUsd: pub.totalPlannedUsd,
            agencyPaysOverride: pub.agencyPaysOverride,
            sortOrder: pub.sortOrder,
          })
          .returning();
        idMap.set(pub.id, newPub.id);
      }

      // Solo reinsertamos placements cuyo publisher del snapshot fue reinsertado
      // (idMap tiene su id). Si por algún motivo falta el parent, lo salteamos en
      // vez de insertar un FK nulo que reventaría.
      const placements = (data.placements ?? []).filter((p) =>
        idMap.has(p.mediaPlanPublisherId),
      );
      if (placements.length > 0) {
        await tx.insert(mediaPlanPlacements).values(
          placements.map((p) => ({
            mediaPlanPublisherId: idMap.get(p.mediaPlanPublisherId)!,
            placementName: p.placementName,
            marketId: p.marketId && liveMarketIds.has(p.marketId) ? p.marketId : null,
            audience: p.audience,
            amountUsd: p.amountUsd,
            costMethod: p.costMethod,
            startDate: p.startDate,
            endDate: p.endDate,
            metricsJson: p.metricsJson ?? {},
            notesMd: p.notesMd,
            sortOrder: p.sortOrder,
          })),
        );
      }

      const fees = data.fees ?? [];
      if (fees.length > 0) {
        await tx.insert(mediaPlanFees).values(
          fees.map((f) => ({
            mediaPlanId: input.planId,
            feeType: f.feeType,
            name: f.name,
            ratePct: f.ratePct,
            amountUsd: f.amountUsd,
            notes: f.notes,
            sortOrder: f.sortOrder,
          })),
        );
      }

      // Restaurar metadata (nombre + notas) y volver a 'approved'. currentVersion
      // no cambia: seguimos en la versión aprobada vigente.
      await tx
        .update(mediaPlans)
        .set({
          name: data.plan.name,
          notesMd: data.plan.notesMd,
          status: "approved",
        })
        .where(eq(mediaPlans.id, input.planId));
    });
  } catch (e) {
    console.error("revertPlanToApprovedSnapshot failed", e);
    return {
      ok: false,
      error:
        "No se pudo restaurar el plan aprobado. Es posible que el snapshot referencie datos que ya no existen. Avisá al equipo si persiste.",
    };
  }

  await recordAudit({
    entityType: "media_plan",
    entityId: input.planId,
    action: "update",
    beforeJson: plan,
    afterJson: {
      ...plan,
      name: data.plan.name,
      notesMd: data.plan.notesMd,
      status: "approved",
      revertedToVersion: plan.currentVersion,
    },
  });

  const [proj] = await db
    .select({ code: projects.code })
    .from(projects)
    .where(eq(projects.id, plan.projectId))
    .limit(1);
  if (proj) {
    revalidatePath(`/proyectos/${proj.code}`);
    revalidatePath(`/proyectos/${proj.code}/planes/${input.planId}`);
  }

  return { ok: true };
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

    await recordAudit({
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

  await recordAudit({
    entityType: "media_plan_publisher",
    entityId: input.mppId,
    action: "update",
    beforeJson: before,
    afterJson: after,
  });

  return { ok: true };
}

// Duplica un publisher del plan: clona el row + todos sus placements.
// El bloque resultante apunta al mismo publisher (puede haber N bloques del
// mismo publisher en un plan) y queda inmediatamente después del original.
export async function duplicatePlanPublisher(
  mppId: string,
): Promise<Result<{ mppId: string }>> {
  const [src] = await db
    .select()
    .from(mediaPlanPublishers)
    .where(eq(mediaPlanPublishers.id, mppId))
    .limit(1);
  if (!src) return { ok: false, error: "Publisher row no encontrado" };

  const [plan] = await db
    .select()
    .from(mediaPlans)
    .where(eq(mediaPlans.id, src.mediaPlanId))
    .limit(1);
  if (!plan) return { ok: false, error: "Plan no encontrado" };
  if (plan.status === "archived") {
    return { ok: false, error: "Plan archivado" };
  }

  const srcPlacements = await db
    .select()
    .from(mediaPlanPlacements)
    .where(eq(mediaPlanPlacements.mediaPlanPublisherId, mppId))
    .orderBy(asc(mediaPlanPlacements.sortOrder));

  // Insertar nuevo bloque justo después del original: corrimiento de
  // sort_order para todos los bloques posteriores en el mismo plan.
  await db
    .update(mediaPlanPublishers)
    .set({ sortOrder: sql`${mediaPlanPublishers.sortOrder} + 1` })
    .where(
      and(
        eq(mediaPlanPublishers.mediaPlanId, src.mediaPlanId),
        sql`${mediaPlanPublishers.sortOrder} > ${src.sortOrder}`,
      ),
    );

  const [dup] = await db
    .insert(mediaPlanPublishers)
    .values({
      mediaPlanId: src.mediaPlanId,
      publisherId: src.publisherId,
      totalPlannedUsd: src.totalPlannedUsd,
      agencyPaysOverride: src.agencyPaysOverride,
      sortOrder: src.sortOrder + 1,
    })
    .returning();

  if (srcPlacements.length > 0) {
    await db.insert(mediaPlanPlacements).values(
      srcPlacements.map((p) => ({
        mediaPlanPublisherId: dup.id,
        placementName: p.placementName,
        marketId: p.marketId,
        audience: p.audience,
        amountUsd: p.amountUsd,
        costMethod: p.costMethod,
        startDate: p.startDate,
        endDate: p.endDate,
        metricsJson: p.metricsJson ?? {},
        notesMd: p.notesMd,
        sortOrder: p.sortOrder,
      })),
    );
  }

  await recordAudit({
    entityType: "media_plan_publisher",
    entityId: dup.id,
    action: "create",
    afterJson: { ...dup, duplicatedFrom: mppId, placementsCopied: srcPlacements.length },
  });

  return { ok: true, mppId: dup.id };
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

  await recordAudit({
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

  await recordAudit({
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
    | "dCPA"
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

  await recordAudit({
    entityType: "media_plan_placement",
    entityId: input.placementId,
    action: "update",
    beforeJson: before,
    afterJson: after,
  });

  return { ok: true };
}

// Duplica un placement dentro del mismo bloque de publisher. El nuevo
// placement queda inmediatamente después del original.
export async function duplicatePlacement(
  placementId: string,
): Promise<Result<{ placementId: string }>> {
  const [src] = await db
    .select()
    .from(mediaPlanPlacements)
    .where(eq(mediaPlanPlacements.id, placementId))
    .limit(1);
  if (!src) return { ok: false, error: "Placement no encontrado" };

  await db
    .update(mediaPlanPlacements)
    .set({ sortOrder: sql`${mediaPlanPlacements.sortOrder} + 1` })
    .where(
      and(
        eq(mediaPlanPlacements.mediaPlanPublisherId, src.mediaPlanPublisherId),
        sql`${mediaPlanPlacements.sortOrder} > ${src.sortOrder}`,
      ),
    );

  const [dup] = await db
    .insert(mediaPlanPlacements)
    .values({
      mediaPlanPublisherId: src.mediaPlanPublisherId,
      placementName: src.placementName,
      marketId: src.marketId,
      audience: src.audience,
      amountUsd: src.amountUsd,
      costMethod: src.costMethod,
      startDate: src.startDate,
      endDate: src.endDate,
      metricsJson: src.metricsJson ?? {},
      notesMd: src.notesMd,
      sortOrder: src.sortOrder + 1,
    })
    .returning();

  await recordAudit({
    entityType: "media_plan_placement",
    entityId: dup.id,
    action: "create",
    afterJson: { ...dup, duplicatedFrom: placementId },
  });

  return { ok: true, placementId: dup.id };
}

export async function removePlacement(placementId: string): Promise<Result> {
  const [before] = await db
    .select()
    .from(mediaPlanPlacements)
    .where(eq(mediaPlanPlacements.id, placementId))
    .limit(1);
  if (!before) return { ok: false, error: "No encontrado" };

  await db.delete(mediaPlanPlacements).where(eq(mediaPlanPlacements.id, placementId));

  await recordAudit({
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

  await recordAudit({
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

  await recordAudit({
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

  await recordAudit({
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

// Publishers habilitados para UN cliente. Cada cliente tiene su propia lista
// (tabla `publishers` con client_id). El campo `agencyPaysDefault` que devuelve
// es el `agency_pays` per-cliente del publisher (se mantiene el nombre por
// compatibilidad con el editor del plan, donde es el default antes del override
// por bloque).
export async function listPublishersForClient(clientId: string) {
  return db
    .select({
      id: publishers.id,
      slug: publishers.slug,
      name: publishers.name,
      enabled: publishers.enabled,
      agencyPaysDefault: publishers.agencyPays,
      sortOrder: publishers.sortOrder,
    })
    .from(publishers)
    .where(and(eq(publishers.clientId, clientId), eq(publishers.enabled, true)))
    .orderBy(asc(publishers.sortOrder), asc(publishers.name));
}

// Markets per-cliente. clientId requerido — el listado es del subset del
// cliente que aplica al plan en cuestión.
export async function listMarketsForClient(clientId: string) {
  return db
    .select()
    .from(markets)
    .where(and(eq(markets.clientId, clientId), eq(markets.enabled, true)))
    .orderBy(asc(markets.sortOrder), asc(markets.name));
}

// Métricas per-cliente. clientId requerido.
export async function listMetricsForClient(clientId: string) {
  return db
    .select()
    .from(metricsCatalog)
    .where(
      and(
        eq(metricsCatalog.clientId, clientId),
        eq(metricsCatalog.enabled, true),
      ),
    )
    .orderBy(asc(metricsCatalog.sortOrder), asc(metricsCatalog.name));
}

// Versiones que devuelven TODAS las filas (incluyendo deshabilitadas) — para
// la página de admin per-cliente que necesita poder editar el flag enabled.
export async function listAllMarketsForClient(clientId: string) {
  return db
    .select()
    .from(markets)
    .where(eq(markets.clientId, clientId))
    .orderBy(asc(markets.sortOrder), asc(markets.name));
}

export async function listAllMetricsForClient(clientId: string) {
  return db
    .select()
    .from(metricsCatalog)
    .where(eq(metricsCatalog.clientId, clientId))
    .orderBy(asc(metricsCatalog.sortOrder), asc(metricsCatalog.name));
}

// ════════════════════════════════════════════════════════════════════════════
// Lookup para "duplicar plan" en el form de "+ Nuevo plan": lista todos los
// planes del cliente del proyecto destino (cualquier status, cualquier
// proyecto) con los markets y publishers presentes adentro + total media.
// Muestra al planner qué tiene cada plan antes de elegir cuál duplicar.
// ════════════════════════════════════════════════════════════════════════════

export type SourcePlanOption = {
  planId: string;
  planName: string;
  projectCode: string;
  projectName: string;
  status: string;
  totalMediaUsd: number;
  markets: string[];
  publishers: string[];
  periodStart: string | null;
  periodEnd: string | null;
};

export async function listSourcePlansForClient(
  clientId: string,
): Promise<SourcePlanOption[]> {
  // Una sola query con array_agg para markets / publishers + sum del total.
  // Filtramos null markets (placements sin mercado) para no contar "—" en
  // el listado. Los publishers vienen de los bloques (un mismo publisher
  // sale una sola vez por distinct).
  const rows = await db
    .select({
      planId: mediaPlans.id,
      planName: mediaPlans.name,
      status: mediaPlans.status,
      projectCode: projects.code,
      projectName: projects.name,
      totalMediaUsd: sql<string>`coalesce(sum(distinct ${mediaPlanPublishers.totalPlannedUsd}::numeric * 0 + ${mediaPlanPublishers.totalPlannedUsd}::numeric), 0)`,
      // Markets distintos a través de los placements del plan.
      markets: sql<string[]>`coalesce(array_agg(distinct ${markets.name}) filter (where ${markets.name} is not null), '{}'::text[])`,
      // Publishers distintos a través de los bloques.
      publishers: sql<string[]>`coalesce(array_agg(distinct ${publishers.name}) filter (where ${publishers.name} is not null), '{}'::text[])`,
      periodStart: sql<string | null>`min(${mediaPlanPlacements.startDate})::text`,
      periodEnd: sql<string | null>`max(${mediaPlanPlacements.endDate})::text`,
    })
    .from(mediaPlans)
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
    .leftJoin(
      mediaPlanPublishers,
      eq(mediaPlanPublishers.mediaPlanId, mediaPlans.id),
    )
    .leftJoin(publishers, eq(mediaPlanPublishers.publisherId, publishers.id))
    .leftJoin(
      mediaPlanPlacements,
      eq(mediaPlanPlacements.mediaPlanPublisherId, mediaPlanPublishers.id),
    )
    .leftJoin(markets, eq(mediaPlanPlacements.marketId, markets.id))
    .where(and(eq(projects.clientId, clientId), isNull(mediaPlans.deletedAt)))
    .groupBy(mediaPlans.id, projects.id);

  // El "sum distinct" arriba es un workaround porque drizzle no nos deja
  // hacer sum sobre el group de publishers (los joins generan filas
  // duplicadas). Si un mismo bloque aparece N veces por los joins de
  // placements/markets, el sum lo sobrecuenta. Como cada mediaPlanPublishers
  // tiene id único y totalPlannedUsd es escalar, hacemos el sum en JS para
  // evitar errores: re-fetch los totals con una query mínima por plan.
  const planIds = rows.map((r) => r.planId);
  const totalsByPlan = new Map<string, number>();
  if (planIds.length > 0) {
    const totals = await db
      .select({
        planId: mediaPlanPublishers.mediaPlanId,
        total: sql<string>`coalesce(sum(${mediaPlanPublishers.totalPlannedUsd}), 0)`,
      })
      .from(mediaPlanPublishers)
      .where(inArray(mediaPlanPublishers.mediaPlanId, planIds))
      .groupBy(mediaPlanPublishers.mediaPlanId);
    for (const t of totals) totalsByPlan.set(t.planId, Number.parseFloat(t.total));
  }

  return rows
    .map((r) => ({
      planId: r.planId,
      planName: r.planName,
      projectCode: r.projectCode,
      projectName: r.projectName,
      status: r.status,
      totalMediaUsd: totalsByPlan.get(r.planId) ?? 0,
      markets: [...r.markets].sort((a, b) => a.localeCompare(b)),
      publishers: [...r.publishers].sort((a, b) => a.localeCompare(b)),
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
    }))
    .sort((a, b) => {
      // Recientes primero (por periodStart desc, los sin fecha al final).
      if (a.periodStart && b.periodStart) return b.periodStart.localeCompare(a.periodStart);
      if (a.periodStart) return -1;
      if (b.periodStart) return 1;
      return a.planName.localeCompare(b.planName);
    });
}
