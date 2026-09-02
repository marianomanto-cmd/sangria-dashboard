"use server";

import { and, asc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { invalidate } from "@/lib/cache-invalidate";
import { PLANS_TAG } from "@/lib/cache-tags";
import { db } from "@/db";
import { recordAudit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import {
  mediaPlanPlacements,
  mediaPlanPublishers,
  mediaPlanQaChecks,
  mediaPlanQaRuns,
  mediaPlans,
  projects,
} from "@/db/schema";

// ════════════════════════════════════════════════════════════════════════════
// QA DE ARMADO del plan — el paso obligatorio entre "aprobado" y "live".
//
// El AM/PM abre el modal de QA (preview tipo Excel del plan), tilda
// "controlado" línea por línea y, con TODAS tildadas, cierra el QA. Recién ahí
// el plan pasa a `qa_done` y puede marcarse `live`.
//
// NO confundir con el QA DE PLANIFICACIÓN (app/actions/plan-planning-qa.ts):
// aquél lo hace el media planner sobre el BORRADOR, antes de la firma, y mira
// el plan; éste mira la campaña ya montada en las plataformas.
//
// El QA es por versión: aprobar la v(N+1) deja el plan en `approved` sin run
// para esa versión → hay que rehacerlo entero. Ver lib/plan-status.ts.
//
// Barreras reales (server-side):
//   • el plan tiene que estar en `approved` (QA en curso) para tildar líneas;
//   • el placement tiene que pertenecer AL PLAN (no se puede tildar la línea
//     de otro plan mandando otro id);
//   • cerrar el QA exige que TODAS las líneas vivas estén controladas.
// ════════════════════════════════════════════════════════════════════════════

type Result<T = void> =
  | (T extends void ? { ok: true } : { ok: true } & T)
  | { ok: false; error: string };

// Ids de los placements vivos del plan (las "líneas" que hay que controlar).
async function planPlacementIds(planId: string): Promise<string[]> {
  const pubs = await db
    .select({ id: mediaPlanPublishers.id })
    .from(mediaPlanPublishers)
    .where(eq(mediaPlanPublishers.mediaPlanId, planId))
    .orderBy(asc(mediaPlanPublishers.sortOrder));
  if (pubs.length === 0) return [];
  const rows = await db
    .select({ id: mediaPlanPlacements.id })
    .from(mediaPlanPlacements)
    .where(
      inArray(
        mediaPlanPlacements.mediaPlanPublisherId,
        pubs.map((p) => p.id),
      ),
    );
  return rows.map((r) => r.id);
}

async function revalidatePlan(planId: string, projectId: string) {
  const [proj] = await db
    .select({ code: projects.code })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (proj) {
    revalidatePath(`/proyectos/${proj.code}`);
    revalidatePath(`/proyectos/${proj.code}/planes/${planId}`);
    invalidate(PLANS_TAG);
  }
}

// Run de QA de la versión vigente del plan. Se crea al vuelo (lazy) la primera
// vez que alguien tilda una línea: así aprobar un plan no escribe filas que tal
// vez nunca se usen, y el modal puede abrirse siempre.
async function ensureQaRun(planId: string, versionNumber: number) {
  const [existing] = await db
    .select()
    .from(mediaPlanQaRuns)
    .where(
      and(
        eq(mediaPlanQaRuns.mediaPlanId, planId),
        eq(mediaPlanQaRuns.versionNumber, versionNumber),
      ),
    )
    .limit(1);
  if (existing) return existing;

  // onConflictDoNothing + re-lectura: dos planners tildando a la vez pueden
  // correr esto en paralelo y el unique (plan, versión) los serializa.
  await db
    .insert(mediaPlanQaRuns)
    .values({ mediaPlanId: planId, versionNumber })
    .onConflictDoNothing();

  const [run] = await db
    .select()
    .from(mediaPlanQaRuns)
    .where(
      and(
        eq(mediaPlanQaRuns.mediaPlanId, planId),
        eq(mediaPlanQaRuns.versionNumber, versionNumber),
      ),
    )
    .limit(1);
  return run ?? null;
}

// ────────────────────────────────────────────────────────────────────────────
// Tildar / destildar UNA línea del QA.
// ────────────────────────────────────────────────────────────────────────────

export async function setPlanQaCheck(input: {
  planId: string;
  placementId: string;
  checked: boolean;
}): Promise<Result<{ checkedCount: number; totalCount: number }>> {
  if (!input.planId) return { ok: false, error: "Falta plan_id" };
  if (!input.placementId) return { ok: false, error: "Falta placement_id" };

  const [plan] = await db
    .select()
    .from(mediaPlans)
    .where(eq(mediaPlans.id, input.planId))
    .limit(1);
  if (!plan) return { ok: false, error: "Plan no encontrado" };
  if (plan.deletedAt) return { ok: false, error: "El plan está en la papelera" };
  if (plan.status !== "approved") {
    return {
      ok: false,
      error:
        plan.status === "qa_done" || plan.status === "live"
          ? "El QA de esta versión ya está cerrado. Reabrilo si necesitás corregirlo."
          : `El QA se hace sobre un plan aprobado. Este plan está en "${plan.status}".`,
    };
  }
  if (plan.currentVersion < 1) {
    return { ok: false, error: "El plan no tiene una versión aprobada" };
  }

  // El placement tiene que ser de ESTE plan.
  const placementIds = await planPlacementIds(input.planId);
  if (!placementIds.includes(input.placementId)) {
    return { ok: false, error: "Esa línea no pertenece a este plan" };
  }

  const run = await ensureQaRun(input.planId, plan.currentVersion);
  if (!run) return { ok: false, error: "No se pudo abrir el QA del plan" };
  if (run.completedAt) {
    return {
      ok: false,
      error: "El QA de esta versión ya está cerrado. Reabrilo para editarlo.",
    };
  }

  const user = await getCurrentUser();

  if (input.checked) {
    await db
      .insert(mediaPlanQaChecks)
      .values({
        qaRunId: run.id,
        placementId: input.placementId,
        checkedByUserId: user?.id ?? null,
        checkedByEmail: user?.email ?? null,
      })
      .onConflictDoNothing();
  } else {
    await db
      .delete(mediaPlanQaChecks)
      .where(
        and(
          eq(mediaPlanQaChecks.qaRunId, run.id),
          eq(mediaPlanQaChecks.placementId, input.placementId),
        ),
      );
  }

  const checked = await db
    .select({ placementId: mediaPlanQaChecks.placementId })
    .from(mediaPlanQaChecks)
    .where(eq(mediaPlanQaChecks.qaRunId, run.id));

  // Solo cuentan los checks de líneas que siguen vivas.
  const alive = new Set(placementIds);
  const checkedCount = checked.filter((c) => alive.has(c.placementId)).length;

  return { ok: true, checkedCount, totalCount: placementIds.length };
}

// ────────────────────────────────────────────────────────────────────────────
// Cerrar el QA → el plan pasa a `qa_done`.
// ────────────────────────────────────────────────────────────────────────────

export async function completePlanQa(input: {
  planId: string;
  notes?: string | null;
}): Promise<Result> {
  if (!input.planId) return { ok: false, error: "Falta plan_id" };

  const [plan] = await db
    .select()
    .from(mediaPlans)
    .where(eq(mediaPlans.id, input.planId))
    .limit(1);
  if (!plan) return { ok: false, error: "Plan no encontrado" };
  if (plan.deletedAt) return { ok: false, error: "El plan está en la papelera" };
  if (plan.status !== "approved") {
    return {
      ok: false,
      error: `Solo se puede cerrar el QA de un plan aprobado. Este plan está en "${plan.status}".`,
    };
  }
  if (plan.currentVersion < 1) {
    return { ok: false, error: "El plan no tiene una versión aprobada" };
  }

  const placementIds = await planPlacementIds(input.planId);
  if (placementIds.length === 0) {
    return {
      ok: false,
      error: "El plan no tiene líneas para controlar. Revisá el plan.",
    };
  }

  const run = await ensureQaRun(input.planId, plan.currentVersion);
  if (!run) return { ok: false, error: "No se pudo abrir el QA del plan" };

  const checked = await db
    .select({ placementId: mediaPlanQaChecks.placementId })
    .from(mediaPlanQaChecks)
    .where(eq(mediaPlanQaChecks.qaRunId, run.id));
  const checkedSet = new Set(checked.map((c) => c.placementId));
  const missing = placementIds.filter((id) => !checkedSet.has(id)).length;
  if (missing > 0) {
    return {
      ok: false,
      error: `Faltan controlar ${missing} línea${missing === 1 ? "" : "s"} del plan. El QA se cierra con todas las líneas tildadas.`,
    };
  }

  const user = await getCurrentUser();
  const notes = input.notes?.trim() || null;

  await db
    .update(mediaPlanQaRuns)
    .set({
      completedAt: new Date(),
      completedByUserId: user?.id ?? null,
      completedByEmail: user?.email ?? null,
      notes,
    })
    .where(eq(mediaPlanQaRuns.id, run.id));

  await db
    .update(mediaPlans)
    .set({ status: "qa_done" })
    .where(eq(mediaPlans.id, input.planId));

  await recordAudit({
    entityType: "media_plan",
    entityId: input.planId,
    action: "update",
    beforeJson: plan,
    afterJson: {
      ...plan,
      status: "qa_done",
      qaVersion: plan.currentVersion,
      qaCheckedLines: placementIds.length,
      qaNotes: notes,
    },
  });

  await revalidatePlan(input.planId, plan.projectId);
  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────────────
// Reabrir el QA → el plan vuelve a `approved` (QA pendiente).
//
// Escape hatch para el QA cerrado por error, o para el "Live" marcado de más.
// Los checks NO se borran: son el registro de lo que se controló y con quién.
// El planner destilda lo que haga falta volver a verificar.
// ────────────────────────────────────────────────────────────────────────────

export async function reopenPlanQa(input: { planId: string }): Promise<Result> {
  if (!input.planId) return { ok: false, error: "Falta plan_id" };

  const [plan] = await db
    .select()
    .from(mediaPlans)
    .where(eq(mediaPlans.id, input.planId))
    .limit(1);
  if (!plan) return { ok: false, error: "Plan no encontrado" };
  if (plan.deletedAt) return { ok: false, error: "El plan está en la papelera" };
  if (plan.status !== "qa_done") {
    return {
      ok: false,
      error:
        plan.status === "live"
          ? "El plan está live. Primero devolvelo a QA realizado y después reabrí el QA."
          : `Solo se puede reabrir el QA de un plan en "QA realizado". Este plan está en "${plan.status}".`,
    };
  }

  await db
    .update(mediaPlanQaRuns)
    .set({ completedAt: null, completedByUserId: null, completedByEmail: null })
    .where(
      and(
        eq(mediaPlanQaRuns.mediaPlanId, input.planId),
        eq(mediaPlanQaRuns.versionNumber, plan.currentVersion),
      ),
    );

  await db
    .update(mediaPlans)
    .set({ status: "approved" })
    .where(eq(mediaPlans.id, input.planId));

  await recordAudit({
    entityType: "media_plan",
    entityId: input.planId,
    action: "update",
    beforeJson: plan,
    afterJson: { ...plan, status: "approved", qaReopenedForVersion: plan.currentVersion },
  });

  await revalidatePlan(input.planId, plan.projectId);
  return { ok: true };
}
