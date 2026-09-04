"use server";

import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { invalidate } from "@/lib/cache-invalidate";
import { ANALYSIS_TAG, BILLING_TAG, DASHBOARD_TAG, PLANS_TAG, TRACKER_TAG } from "@/lib/cache-tags";
import { db } from "@/db";
import { recordAudit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { canApprovePlans } from "@/lib/permissions";
import {
  findPlanReadinessIssues,
  type ReadinessPlacement,
  readinessErrorMessage,
} from "@/lib/plan-readiness";
import {
  PLAN_STATUS_LABELS,
  PLAN_STATUS_TRANSITIONS,
  type PlanStatus,
} from "@/lib/plan-status";
import { assertCanWrite } from "@/lib/read-only";
import {
  getPlanningQaItems,
  getPlanningQaState,
  planningQaCheckedKeys,
  planningQaVersion,
} from "@/db/queries/plan-planning-qa";
import {
  computePlanningQaProgress,
  planningQaRequiredMessage,
} from "@/lib/plan-planning-qa";
import { mediaPlanPlanningQaRuns } from "@/db/schema";
import {
  markets,
  mediaPlanFees,
  mediaPlanPlacements,
  mediaPlanPublishers,
  mediaPlanQaRuns,
  mediaPlanSnapshots,
  mediaPlans,
  metricsCatalog,
  planBillingFees,
  planBillings,
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
  // Barrera de escritura: en modo solo lectura (auditoría externa o rol
  // Viewer) la action corta acá, antes de validar o tocar la base. Ver
  // lib/read-only.ts.
  const denied = await assertCanWrite();
  if (denied) return denied;

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
  invalidate(PLANS_TAG, DASHBOARD_TAG, TRACKER_TAG, ANALYSIS_TAG, BILLING_TAG);

  return { ok: true, planId: plan.id };
}

// Borra un plan (soft delete): lo manda a la papelera (deletedAt = now) en vez
// de eliminarlo físicamente. Se conserva ad eternum con todos sus publishers /
// placements / fees / billings, que dejan de aparecer porque las queries de
// listado filtran por deletedAt IS NULL. Se puede restaurar desde la papelera.
export async function deletePlan(input: { planId: string }): Promise<Result> {
  const denied = await assertCanWrite();
  if (denied) return denied;

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
  invalidate(PLANS_TAG, DASHBOARD_TAG, TRACKER_TAG, ANALYSIS_TAG, BILLING_TAG);

  return { ok: true };
}

// Restaura un plan desde la papelera (deletedAt = null). Si en el proyecto ya
// hay un plan VIVO con el mismo nombre, el partial unique index lo rechazaría,
// así que pre-chequeamos y devolvemos un error legible.
export async function restorePlan(input: { planId: string }): Promise<Result> {
  const denied = await assertCanWrite();
  if (denied) return denied;

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
  invalidate(PLANS_TAG, DASHBOARD_TAG, TRACKER_TAG, ANALYSIS_TAG, BILLING_TAG);

  return { ok: true };
}

// Borra DEFINITIVAMENTE un plan desde la papelera (hard delete). Sólo se
// permite si el plan ya está en la papelera (deletedAt != null). El delete
// físico cascadea a publishers / placements / fees / snapshots / billings
// (FKs onDelete: cascade). Es irreversible.
export async function hardDeletePlan(input: { planId: string }): Promise<Result> {
  const denied = await assertCanWrite();
  if (denied) return denied;

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
  invalidate(PLANS_TAG, DASHBOARD_TAG, TRACKER_TAG, ANALYSIS_TAG, BILLING_TAG);

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
  const denied = await assertCanWrite();
  if (denied) return denied;

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
  invalidate(PLANS_TAG, DASHBOARD_TAG, TRACKER_TAG, ANALYSIS_TAG, BILLING_TAG);

  return { ok: true, planId: newPlan.id };
}

export async function updatePlanMetadata(input: {
  planId: string;
  name?: string;
  notesMd?: string | null;
}): Promise<Result> {
  const denied = await assertCanWrite();
  if (denied) return denied;

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
  to: PlanStatus;
  notes?: string;
}): Promise<Result> {
  const denied = await assertCanWrite();
  if (denied) return denied;

  if (!input.planId) return { ok: false, error: "Falta plan_id" };

  // Aprobar un plan está restringido a una allowlist de usuarios (aprobar
  // congela un snapshot inmutable). Barrera real server-side; la UI esconde el
  // botón como conveniencia.
  if (input.to === "approved") {
    const user = await getCurrentUser();
    if (!(await canApprovePlans(user?.email))) {
      return {
        ok: false,
        error:
          "No tenés permiso para aprobar planes. Hace falta el rol Admin o Aprobador (Configuración → Usuarios y roles).",
      };
    }
  }

  const [before] = await db
    .select()
    .from(mediaPlans)
    .where(eq(mediaPlans.id, input.planId))
    .limit(1);
  if (!before) return { ok: false, error: "Plan no encontrado" };

  // Validar transiciones permitidas (mapa en lib/plan-status.ts).
  if (!PLAN_STATUS_TRANSITIONS[before.status].includes(input.to)) {
    return {
      ok: false,
      error: `Transición ${before.status} → ${input.to} no permitida`,
    };
  }

  // Regla dura del QA: `qa_done` y `live` exigen que el QA de la versión
  // vigente esté CERRADO. Es lo que hace obligatorio el control del planner
  // antes de que una campaña salga al aire — para el plan nuevo y para cada
  // versión nueva.
  //
  //   • approved → qa_done  lo cierra `completePlanQa` (marca el run como
  //     completo cuando están todas las líneas tildadas); llamar acá con
  //     to='qa_done' sin el QA hecho rebota.
  //   • live sólo se alcanza desde qa_done, y re-chequeamos el run por si el
  //     status llegó de una corrección manual en la base.
  if (input.to === "qa_done" || input.to === "live") {
    const [qaRun] = await db
      .select()
      .from(mediaPlanQaRuns)
      .where(
        and(
          eq(mediaPlanQaRuns.mediaPlanId, input.planId),
          eq(mediaPlanQaRuns.versionNumber, before.currentVersion),
        ),
      )
      .limit(1);
    if (!qaRun?.completedAt) {
      return {
        ok: false,
        error:
          input.to === "live"
            ? `Falta el QA de la v${before.currentVersion}. Abrí "Realizar QA", controlá todas las líneas y recién ahí se habilita Live.`
            : `El QA de la v${before.currentVersion} no está cerrado. Se cierra desde "Realizar QA", con todas las líneas controladas.`,
      };
    }
  }

  // Regla dura: un plan NO puede pasar a "listo" ni "aprobado" incompleto —
  // publisher sin monto o sin placements, placement vacío, o placement al que le
  // falta un campo principal (nombre, monto, cost method, fechas) o la métrica
  // principal de su cost method. Un plan Listo/Aprobado alimenta la facturación,
  // la estimación y los exports: por ejemplo, un placement sin fechas no entra al
  // prorrateo (getBillingEstimate lo saltea con `if (!startDate || !endDate)
  // continue`), así que su media —y el management fee sobre esa media—
  // desaparecen silenciosamente del estimado.
  //
  // La regla vive en lib/plan-readiness.ts porque el editor la usa también, para
  // mostrar el diálogo con lo que falta antes de llamar acá. Ésta es la barrera
  // real (server-side); el diálogo es la conveniencia.
  if (input.to === "ready_to_send" || input.to === "approved") {
    const pubRows = await db
      .select({
        id: mediaPlanPublishers.id,
        publisherName: publishers.name,
        totalPlannedUsd: mediaPlanPublishers.totalPlannedUsd,
      })
      .from(mediaPlanPublishers)
      .innerJoin(publishers, eq(mediaPlanPublishers.publisherId, publishers.id))
      .where(eq(mediaPlanPublishers.mediaPlanId, input.planId))
      .orderBy(asc(mediaPlanPublishers.sortOrder));

    const mppIds = pubRows.map((p) => p.id);
    const plRows = mppIds.length
      ? await db
          .select({
            mediaPlanPublisherId: mediaPlanPlacements.mediaPlanPublisherId,
            placementName: mediaPlanPlacements.placementName,
            amountUsd: mediaPlanPlacements.amountUsd,
            costMethod: mediaPlanPlacements.costMethod,
            startDate: mediaPlanPlacements.startDate,
            endDate: mediaPlanPlacements.endDate,
            metricsJson: mediaPlanPlacements.metricsJson,
          })
          .from(mediaPlanPlacements)
          .where(inArray(mediaPlanPlacements.mediaPlanPublisherId, mppIds))
          .orderBy(asc(mediaPlanPlacements.sortOrder))
      : [];

    const byPub = new Map<string, ReadinessPlacement[]>();
    for (const pl of plRows) {
      const list = byPub.get(pl.mediaPlanPublisherId) ?? [];
      list.push({
        placementName: pl.placementName,
        amountUsd: Number.parseFloat(pl.amountUsd ?? "0"),
        costMethod: pl.costMethod,
        startDate: pl.startDate,
        endDate: pl.endDate,
        metricsJson: pl.metricsJson ?? {},
      });
      byPub.set(pl.mediaPlanPublisherId, list);
    }

    const issues = findPlanReadinessIssues(
      pubRows.map((p) => ({
        publisherName: p.publisherName,
        totalPlannedUsd: Number.parseFloat(p.totalPlannedUsd ?? "0"),
        placements: byPub.get(p.id) ?? [],
      })),
    );

    if (issues.length > 0) {
      return { ok: false, error: readinessErrorMessage(issues, input.to) };
    }
  }

  // Regla dura del QA DE PLANIFICACIÓN: antes de congelar el plan y mandarlo a
  // firma, el planner tiene que haber repasado y tildado cada placement y cada
  // adset. Lo hace en el modal que abre "Marcar listo para enviar", y el cierre
  // del QA es el que llama acá (`completePlanningQa`).
  //
  // Se exige SOLO en el pase a `ready_to_send`, no en `approved`, por dos
  // razones: al aprobado sólo se llega desde ready_to_send —así que el control
  // ya pasó—, y gatearlo también dejaría trabados los planes que quedaron
  // congelados antes de que este QA existiera.
  //
  // La regla vive en lib/plan-planning-qa.ts porque el modal la usa también,
  // para contar el progreso con el mismo criterio con el que esto bloquea.
  if (input.to === "ready_to_send") {
    const version = planningQaVersion(before.currentVersion);
    const [items, state] = await Promise.all([
      getPlanningQaItems(input.planId),
      getPlanningQaState(input.planId, version),
    ]);
    const progress = computePlanningQaProgress(
      items,
      planningQaCheckedKeys(state.checks),
    );
    if (!state.completedAt || !progress.complete) {
      return {
        ok: false,
        error: planningQaRequiredMessage(progress, state.completedAt != null),
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

  // Volver a draft REABRE el QA de planificación de esa versión. Lo que se
  // controló fue el plan como estaba antes de volver a editarlo; dar por bueno
  // ese control sobre contenido que puede haber cambiado es justo el error que
  // este QA existe para evitar. Los tildes NO se borran (son el registro de qué
  // se miró y quién): el planner reabre el modal, revisa y confirma.
  //
  // Sólo aplica al ready_to_send → draft: desde un estado firmado, "Editar
  // (nueva versión)" apunta a una versión que todavía no tiene run.
  if (input.to === "draft") {
    await db
      .update(mediaPlanPlanningQaRuns)
      .set({ completedAt: null, completedByUserId: null, completedByEmail: null })
      .where(
        and(
          eq(mediaPlanPlanningQaRuns.mediaPlanId, input.planId),
          eq(
            mediaPlanPlanningQaRuns.versionNumber,
            planningQaVersion(before.currentVersion),
          ),
        ),
      );
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
    invalidate(PLANS_TAG, DASHBOARD_TAG, TRACKER_TAG, ANALYSIS_TAG, BILLING_TAG);
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
// approved/qa_done/live → draft de v(N+1)): si el planner abrió un draft sobre
// un MP ya firmado y se arrepiente, esto tira TODOS los cambios del draft y
// restaura el plan al snapshot de la última versión aprobada (version =
// currentVersion), dejándolo en 'qa_done' si el QA de esa versión ya estaba
// cerrado, o en 'approved' (QA pendiente) si no. Sólo aplica a un draft con
// currentVersion > 0 (tiene un snapshot al cual volver). Irreversible.
export async function revertPlanToApprovedSnapshot(input: {
  planId: string;
}): Promise<Result> {
  const denied = await assertCanWrite();
  if (denied) return denied;

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

  // A qué estado vuelve el plan. Descartar el borrador restaura EXACTAMENTE la
  // vN, así que si el QA de esa versión ya estaba cerrado sigue siendo válido y
  // el plan vuelve a `qa_done` (listo para marcar Live). Si nunca se cerró,
  // vuelve a `approved` con el QA pendiente. Nunca volvemos directo a `live`:
  // que alguien confirme que la campaña está al aire es un click barato y evita
  // dar por viva una campaña que se bajó mientras se editaba el borrador.
  const [qaRun] = await db
    .select({ completedAt: mediaPlanQaRuns.completedAt })
    .from(mediaPlanQaRuns)
    .where(
      and(
        eq(mediaPlanQaRuns.mediaPlanId, input.planId),
        eq(mediaPlanQaRuns.versionNumber, plan.currentVersion),
      ),
    )
    .limit(1);
  const restoredStatus = qaRun?.completedAt ? "qa_done" : "approved";

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

  // Fees que el draft agregó y que ya tienen plata imputada en algún mes: no
  // se borran aunque el snapshot no los tenga (lo facturado no se toca).
  const keptBilledFees: string[] = [];

  try {
    await db.transaction(async (tx) => {
      // El delete de publishers cascadea a sus placements (FK onDelete cascade).
      // Los consumos del billing (plan_billing_publishers) NO cuelgan de acá:
      // apuntan al catálogo de publishers, así que sobreviven al revert.
      await tx
        .delete(mediaPlanPublishers)
        .where(eq(mediaPlanPublishers.mediaPlanId, input.planId));

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
        await tx
          .insert(mediaPlanPlacements)
          .values(
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

      // ── Fees: reconciliación NO destructiva ───────────────────────────────
      // Los fees NO se borran y reinsertan como los publishers. Cada fee es el
      // padre de las imputaciones mensuales (plan_billing_fees), o sea de lo
      // YA FACTURADO: si lo borráramos, se llevaría puesta la historia de
      // billing de todos los meses (antes pasaba exactamente eso, y "Imputado
      // antes" quedaba en 0 para siempre). En cambio:
      //   · fee del snapshot que ya existe (mismo id) → UPDATE a los valores
      //     aprobados. El id se mantiene, así que las imputaciones siguen
      //     colgando del mismo fee.
      //   · fee del snapshot que no existe → INSERT conservando el id del
      //     snapshot (si el draft lo había borrado, sus imputaciones no
      //     existen igual, pero volver a usar el id evita divergencias).
      //   · fee vivo que el snapshot no tiene (lo agregó el draft) → se borra
      //     SOLO si no tiene nada imputado; si ya se imputó en algún mes, se
      //     conserva (lo facturado no se toca) y se reporta.
      const snapFees = data.fees ?? [];
      const liveFees = await tx
        .select({ id: mediaPlanFees.id })
        .from(mediaPlanFees)
        .where(eq(mediaPlanFees.mediaPlanId, input.planId));
      const liveFeeIds = new Set(liveFees.map((f) => f.id));
      const snapFeeIds = new Set(snapFees.map((f) => f.id));

      for (const f of snapFees) {
        if (liveFeeIds.has(f.id)) {
          await tx
            .update(mediaPlanFees)
            .set({
              feeType: f.feeType,
              name: f.name,
              ratePct: f.ratePct,
              amountUsd: f.amountUsd,
              notes: f.notes,
              sortOrder: f.sortOrder,
            })
            .where(eq(mediaPlanFees.id, f.id));
        } else {
          await tx.insert(mediaPlanFees).values({
            id: f.id,
            mediaPlanId: input.planId,
            feeType: f.feeType,
            name: f.name,
            ratePct: f.ratePct,
            amountUsd: f.amountUsd,
            notes: f.notes,
            sortOrder: f.sortOrder,
          });
        }
      }

      const extraFeeIds = liveFees
        .map((f) => f.id)
        .filter((id) => !snapFeeIds.has(id));
      for (const feeId of extraFeeIds) {
        const [imputed] = await tx
          .select({
            total: sql<string>`coalesce(sum(${planBillingFees.amountImputedUsd}), 0)`,
          })
          .from(planBillingFees)
          .where(eq(planBillingFees.mediaPlanFeeId, feeId));
        if (Number.parseFloat(imputed.total) > 0) {
          keptBilledFees.push(feeId);
          continue;
        }
        // Sin imputar: limpiamos las filas en 0 que precrea el billing del mes
        // y recién ahí borramos el fee (la FK es `no action`, no cascade).
        await tx
          .delete(planBillingFees)
          .where(eq(planBillingFees.mediaPlanFeeId, feeId));
        await tx.delete(mediaPlanFees).where(eq(mediaPlanFees.id, feeId));
      }

      // Restaurar metadata (nombre + notas) y volver al estado firmado que
      // corresponda (`qa_done` si el QA de la vN ya estaba cerrado, si no
      // `approved`). currentVersion no cambia: seguimos en la versión aprobada
      // vigente.
      await tx
        .update(mediaPlans)
        .set({
          name: data.plan.name,
          notesMd: data.plan.notesMd,
          status: restoredStatus,
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
      status: restoredStatus,
      revertedToVersion: plan.currentVersion,
      // Fees del draft que se conservaron por tener imputaciones ya cargadas.
      keptBilledFees,
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
    invalidate(PLANS_TAG, DASHBOARD_TAG, TRACKER_TAG, ANALYSIS_TAG, BILLING_TAG);
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
  const denied = await assertCanWrite();
  if (denied) return denied;

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
  const denied = await assertCanWrite();
  if (denied) return denied;

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
  const denied = await assertCanWrite();
  if (denied) return denied;

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
  const denied = await assertCanWrite();
  if (denied) return denied;

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
  const denied = await assertCanWrite();
  if (denied) return denied;

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
  const denied = await assertCanWrite();
  if (denied) return denied;

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
  const denied = await assertCanWrite();
  if (denied) return denied;

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
  const denied = await assertCanWrite();
  if (denied) return denied;

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
// Cambio masivo de fechas — una sola pasada sobre TODOS los placements del
// plan. El caso real: el cliente corre la campaña dos semanas y hay que mover
// 40 líneas a mano, una por una, desde el inspector.
//
// Reglas, todas con barrera server-side (la UI las repite como conveniencia):
//
//   • SOLO sobre un plan en `draft`. Si el plan está firmado (approved /
//     qa_done / live) hay que apretar "Editar (nueva versión)" primero: mover
//     las fechas de un plan firmado cambia el compromiso con el cliente, así
//     que tiene que pasar por el mismo camino que cualquier otra edición —
//     re-aprobación (que congela la v(N+1)), QA de la versión nueva y recién
//     ahí Live. Esta guarda es lo que garantiza eso: sin ella el botón sería
//     un atajo para editar un plan aprobado sin dejar rastro de versión.
//   • Se puede aplicar solo inicio, solo fin o ambos. `undefined` = no tocar
//     ese campo; NO se pueden borrar fechas en masa (un placement sin fechas
//     se cae del prorrateo mensual, ver lib/budget-split.ts).
//   • Nunca deja un rango invertido (fin < inicio). Si se aplica un solo
//     extremo, se valida contra la fecha que YA tiene cada placement: con
//     fin < inicio, `prorateByMonth` manda todo el monto a NO_DATE_KEY y la
//     plata desaparece del split por mes sin avisar.
//
// Auditoría: una sola row a nivel plan (no una por placement). Son N updates
// de un mismo acto del planner, y `recordAudit` hace un lookup de auth por
// llamada — 40 rows serían 40 round-trips y 40 líneas de ruido en el modal de
// "Última edición" para un cambio que se cuenta en una oración.
// ════════════════════════════════════════════════════════════════════════════

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function bulkUpdatePlacementDates(input: {
  planId: string;
  // undefined = no tocar ese extremo. Formato ISO "YYYY-MM-DD".
  startDate?: string;
  endDate?: string;
}): Promise<Result<{ updated: number; total: number }>> {
  const denied = await assertCanWrite();
  if (denied) return denied;

  if (!input.planId) return { ok: false, error: "Falta plan_id" };

  const startDate = input.startDate?.trim() || undefined;
  const endDate = input.endDate?.trim() || undefined;

  if (!startDate && !endDate) {
    return { ok: false, error: "Elegí al menos una fecha para cambiar" };
  }
  if (startDate && !ISO_DATE_RE.test(startDate)) {
    return { ok: false, error: "Fecha de inicio inválida" };
  }
  if (endDate && !ISO_DATE_RE.test(endDate)) {
    return { ok: false, error: "Fecha de fin inválida" };
  }
  if (startDate && endDate && endDate < startDate) {
    return {
      ok: false,
      error: "La fecha de fin no puede ser anterior a la de inicio",
    };
  }

  const [plan] = await db
    .select()
    .from(mediaPlans)
    .where(eq(mediaPlans.id, input.planId))
    .limit(1);
  if (!plan) return { ok: false, error: "Plan no encontrado" };
  if (plan.deletedAt) return { ok: false, error: "El plan está en la papelera" };

  // La regla del enunciado: para tocar las fechas en masa hay que estar
  // editando un borrador. Un plan firmado se edita abriendo la versión
  // siguiente, y esa versión vuelve a pasar por aprobación y QA.
  if (plan.status !== "draft") {
    return {
      ok: false,
      error:
        plan.status === "archived"
          ? "Plan archivado, no se puede editar"
          : `El plan está en "${PLAN_STATUS_LABELS[plan.status]}". Para cambiar las fechas abrí una nueva versión con "Editar (nueva versión)": el plan vuelve a borrador y, al aprobarlo, hay que rehacer el QA antes de marcarlo Live.`,
    };
  }

  const rows = await db
    .select({
      id: mediaPlanPlacements.id,
      placementName: mediaPlanPlacements.placementName,
      startDate: mediaPlanPlacements.startDate,
      endDate: mediaPlanPlacements.endDate,
    })
    .from(mediaPlanPlacements)
    .innerJoin(
      mediaPlanPublishers,
      eq(mediaPlanPlacements.mediaPlanPublisherId, mediaPlanPublishers.id),
    )
    .where(eq(mediaPlanPublishers.mediaPlanId, input.planId))
    .orderBy(asc(mediaPlanPublishers.sortOrder), asc(mediaPlanPlacements.sortOrder));

  if (rows.length === 0) {
    return { ok: false, error: "El plan no tiene placements" };
  }

  // Rango invertido: solo puede pasar cuando se aplica UN extremo y el otro
  // queda como estaba en cada línea.
  const inverted = rows.filter((r) => {
    const s = startDate ?? r.startDate;
    const e = endDate ?? r.endDate;
    return !!s && !!e && e < s;
  });
  if (inverted.length > 0) {
    const names = inverted.slice(0, 3).map((r) => `“${r.placementName}”`).join(", ");
    const rest = inverted.length > 3 ? ` y ${inverted.length - 3} más` : "";
    return {
      ok: false,
      error: startDate
        ? `El inicio ${startDate} queda después del fin de ${inverted.length} placement${inverted.length === 1 ? "" : "s"} (${names}${rest}). Cambiá también la fecha de fin.`
        : `El fin ${endDate} queda antes del inicio de ${inverted.length} placement${inverted.length === 1 ? "" : "s"} (${names}${rest}). Cambiá también la fecha de inicio.`,
    };
  }

  const changed = rows.filter(
    (r) =>
      (startDate !== undefined && r.startDate !== startDate) ||
      (endDate !== undefined && r.endDate !== endDate),
  );
  if (changed.length === 0) {
    return { ok: true, updated: 0, total: rows.length };
  }

  const update: Record<string, unknown> = {};
  if (startDate !== undefined) update.startDate = startDate;
  if (endDate !== undefined) update.endDate = endDate;

  await db
    .update(mediaPlanPlacements)
    .set(update)
    .where(
      inArray(
        mediaPlanPlacements.id,
        changed.map((r) => r.id),
      ),
    );

  await recordAudit({
    entityType: "media_plan",
    entityId: input.planId,
    action: "update",
    beforeJson: {
      name: plan.name,
      ...(startDate !== undefined && {
        placementsStartDate: summarizeDates(rows.map((r) => r.startDate)),
      }),
      ...(endDate !== undefined && {
        placementsEndDate: summarizeDates(rows.map((r) => r.endDate)),
      }),
    },
    afterJson: {
      name: plan.name,
      ...(startDate !== undefined && { placementsStartDate: startDate }),
      ...(endDate !== undefined && { placementsEndDate: endDate }),
      placementsActualizados: `${changed.length} de ${rows.length}`,
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
    invalidate(PLANS_TAG, DASHBOARD_TAG, TRACKER_TAG, ANALYSIS_TAG, BILLING_TAG);
  }

  return { ok: true, updated: changed.length, total: rows.length };
}

// Resumen legible del "antes" para el audit: una sola fecha si todas
// coincidían, el rango si estaban mezcladas, "—" si no había ninguna.
function summarizeDates(dates: (string | null)[]): string {
  const set = [...new Set(dates.filter((d): d is string => !!d))].sort();
  const blanks = dates.length - dates.filter(Boolean).length;
  if (set.length === 0) return "—";
  const base =
    set.length === 1 ? set[0] : `${set[0]} … ${set[set.length - 1]} (mixtas)`;
  return blanks > 0 ? `${base} + ${blanks} sin fecha` : base;
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
  const denied = await assertCanWrite();
  if (denied) return denied;

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
  const denied = await assertCanWrite();
  if (denied) return denied;

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
  const denied = await assertCanWrite();
  if (denied) return denied;

  const [before] = await db
    .select()
    .from(mediaPlanFees)
    .where(eq(mediaPlanFees.id, feeId))
    .limit(1);
  if (!before) return { ok: false, error: "No encontrado" };

  // Lo facturado no se borra: si el fee ya tiene plata imputada en algún mes,
  // borrarlo se llevaría puesta esa imputación (y el mes quedaría con un total
  // que no cierra contra ninguna línea). Cortamos acá y decimos en qué meses
  // está, para que la analista los ponga en 0 primero si de verdad quiere
  // sacarlo del plan.
  const imputedMonths = await db
    .select({
      month: planBillings.month,
      amount: planBillingFees.amountImputedUsd,
    })
    .from(planBillingFees)
    .innerJoin(planBillings, eq(planBillingFees.planBillingId, planBillings.id))
    .where(eq(planBillingFees.mediaPlanFeeId, feeId))
    .orderBy(asc(planBillings.month));

  const billed = imputedMonths.filter((m) => Number.parseFloat(m.amount) > 0);
  if (billed.length > 0) {
    const detalle = billed
      .map((m) => `${m.month}: $${Number.parseFloat(m.amount).toFixed(2)}`)
      .join(" · ");
    return {
      ok: false,
      error: `No se puede eliminar "${before.name}": ya tiene imputaciones cargadas en el billing (${detalle}). Poné esos meses en 0 y volvé a intentar.`,
    };
  }

  // Solo quedan filas en 0 (las precrea el billing de cada mes). Se limpian a
  // mano porque la FK es `no action`: sin esto el delete del fee falla.
  await db
    .delete(planBillingFees)
    .where(eq(planBillingFees.mediaPlanFeeId, feeId));
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
