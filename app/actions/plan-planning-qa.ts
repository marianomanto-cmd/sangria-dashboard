"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import {
  computePlanningQaProgress,
  findPlanningQaMissing,
  isPlanningQaItemKind,
  planningQaIncompleteMessage,
  planningQaKey,
  type PlanningQaItemKind,
} from "@/lib/plan-planning-qa";
import { assertCanWrite } from "@/lib/read-only";
import {
  getPlanningQaItems,
  planningQaCheckedKeys,
  planningQaVersion,
  type PlanningQaCheck,
} from "@/db/queries/plan-planning-qa";
import {
  mediaPlanPlanningQaChecks,
  mediaPlanPlanningQaRuns,
  mediaPlans,
} from "@/db/schema";
import { transitionPlanStatus } from "@/app/actions/plans";

// ════════════════════════════════════════════════════════════════════════════
// QA de PLANIFICACIÓN — el control del media planner antes de mandar a firma.
//
// El planner termina de cargar el plan, aprieta "Marcar listo para enviar" y en
// vez de congelarse el plan se abre este QA: la lista de sus placements y sus
// adsets, con una casilla por cada uno. Con todo tildado, el mismo botón cierra
// el QA y hace el pase a `ready_to_send`.
//
// Es el espejo del QA de armado (app/actions/plan-qa.ts) en el otro extremo del
// ciclo, y NO lo reemplaza: aquél lo hace el AM/PM sobre un plan ya firmado.
//
// Barreras reales (server-side):
//   • el plan tiene que estar en `draft` para tildar (es lo único editable);
//   • el ítem tiene que pertenecer AL PLAN (no se puede tildar la línea de otro
//     plan mandando otro id);
//   • cerrar exige que TODOS los ítems vivos estén tildados;
//   • el pase en sí lo hace `transitionPlanStatus`, que vuelve a chequear todo
//     (readiness, adsets y este mismo QA) antes de mover el status.
// ════════════════════════════════════════════════════════════════════════════

type Result<T = void> =
  | (T extends void ? { ok: true } : { ok: true } & T)
  | { ok: false; error: string };

// Run de la versión que este draft va a ser. Se crea al vuelo (lazy) al primer
// tilde: abrir el modal no escribe filas que tal vez nunca se usen.
async function ensurePlanningRun(planId: string, versionNumber: number) {
  const [existing] = await db
    .select()
    .from(mediaPlanPlanningQaRuns)
    .where(
      and(
        eq(mediaPlanPlanningQaRuns.mediaPlanId, planId),
        eq(mediaPlanPlanningQaRuns.versionNumber, versionNumber),
      ),
    )
    .limit(1);
  if (existing) return existing;

  // onConflictDoNothing + re-lectura: dos planners tildando a la vez pueden
  // correr esto en paralelo y el unique (plan, versión) los serializa.
  await db
    .insert(mediaPlanPlanningQaRuns)
    .values({ mediaPlanId: planId, versionNumber })
    .onConflictDoNothing();

  const [run] = await db
    .select()
    .from(mediaPlanPlanningQaRuns)
    .where(
      and(
        eq(mediaPlanPlanningQaRuns.mediaPlanId, planId),
        eq(mediaPlanPlanningQaRuns.versionNumber, versionNumber),
      ),
    )
    .limit(1);
  return run ?? null;
}

// Plan + validaciones comunes de las dos actions. Union explícito con
// discriminante `ok` para que TS estreche de verdad en el caller.
type LoadedPlan =
  | { ok: true; plan: typeof mediaPlans.$inferSelect }
  | { ok: false; error: string };

async function loadDraftPlan(planId: string): Promise<LoadedPlan> {
  const [plan] = await db
    .select()
    .from(mediaPlans)
    .where(eq(mediaPlans.id, planId))
    .limit(1);
  if (!plan) return { ok: false, error: "Plan no encontrado" };
  if (plan.deletedAt) return { ok: false, error: "El plan está en la papelera" };
  if (plan.status !== "draft") {
    return {
      ok: false,
      error: `El QA de planificación se hace sobre el borrador, antes de mandar el plan a firma. Este plan está en "${plan.status}".`,
    };
  }
  return { ok: true, plan };
}

// ────────────────────────────────────────────────────────────────────────────
// Tildar / destildar UN ítem (un placement o un adset).
// ────────────────────────────────────────────────────────────────────────────

export async function setPlanningQaCheck(input: {
  planId: string;
  itemKind: PlanningQaItemKind;
  itemId: string;
  checked: boolean;
}): Promise<Result<{ checkedCount: number; totalCount: number }>> {
  // Barrera de escritura: la sesión de auditoría y los usuarios con rol Viewer
  // no pueden mutar nada. Ver lib/read-only.ts.
  const denied = await assertCanWrite();
  if (denied) return denied;

  if (!input.planId) return { ok: false, error: "Falta plan_id" };
  if (!input.itemId) return { ok: false, error: "Falta item_id" };
  if (!isPlanningQaItemKind(input.itemKind)) {
    return { ok: false, error: "Tipo de ítem inválido" };
  }

  const loaded = await loadDraftPlan(input.planId);
  if (!loaded.ok) return loaded;
  const { plan } = loaded;

  // El ítem tiene que ser de ESTE plan.
  const items = await getPlanningQaItems(input.planId);
  const key = planningQaKey(input.itemKind, input.itemId);
  if (!items.some((i) => planningQaKey(i.kind, i.id) === key)) {
    return { ok: false, error: "Ese ítem no pertenece a este plan" };
  }

  const version = planningQaVersion(plan.currentVersion);
  const run = await ensurePlanningRun(input.planId, version);
  if (!run) return { ok: false, error: "No se pudo abrir el QA de planificación" };

  const user = await getCurrentUser();

  if (input.checked) {
    await db
      .insert(mediaPlanPlanningQaChecks)
      .values({
        qaRunId: run.id,
        itemKind: input.itemKind,
        itemId: input.itemId,
        checkedByUserId: user?.id ?? null,
        checkedByEmail: user?.email ?? null,
      })
      .onConflictDoNothing();
  } else {
    await db
      .delete(mediaPlanPlanningQaChecks)
      .where(
        and(
          eq(mediaPlanPlanningQaChecks.qaRunId, run.id),
          eq(mediaPlanPlanningQaChecks.itemKind, input.itemKind),
          eq(mediaPlanPlanningQaChecks.itemId, input.itemId),
        ),
      );
  }

  // Destildar algo reabre el QA: si estaba cerrado, ya no lo está.
  if (run.completedAt && !input.checked) {
    await db
      .update(mediaPlanPlanningQaRuns)
      .set({ completedAt: null, completedByUserId: null, completedByEmail: null })
      .where(eq(mediaPlanPlanningQaRuns.id, run.id));
  }

  const checkRows = await db
    .select({
      itemKind: mediaPlanPlanningQaChecks.itemKind,
      itemId: mediaPlanPlanningQaChecks.itemId,
    })
    .from(mediaPlanPlanningQaChecks)
    .where(eq(mediaPlanPlanningQaChecks.qaRunId, run.id));

  // Solo cuentan los tildes de ítems que siguen vivos: borrar un placement no
  // puede dejar el QA "completo" con un tilde fantasma. Lo mismo vale para los
  // tildes viejos de adsets, que el enum de la base todavía admite.
  const progress = computePlanningQaProgress(
    items,
    new Set(
      checkRows
        .filter((c) => isPlanningQaItemKind(c.itemKind))
        .map((c) => planningQaKey(c.itemKind as PlanningQaItemKind, c.itemId)),
    ),
  );

  return { ok: true, checkedCount: progress.checked, totalCount: progress.total };
}

// ────────────────────────────────────────────────────────────────────────────
// Cerrar el QA → el plan pasa a `ready_to_send`.
//
// Las dos cosas van juntas a propósito: el QA de planificación no tiene valor
// por separado, existe para habilitar el pase. Si el pase falla (readiness,
// adsets), se revierte el cierre para no dejar un QA "hecho" sobre un plan que
// no se movió.
// ────────────────────────────────────────────────────────────────────────────

export async function completePlanningQa(input: {
  planId: string;
  notes?: string | null;
}): Promise<Result> {
  const denied = await assertCanWrite();
  if (denied) return denied;

  if (!input.planId) return { ok: false, error: "Falta plan_id" };

  const loaded = await loadDraftPlan(input.planId);
  if (!loaded.ok) return loaded;
  const { plan } = loaded;

  const items = await getPlanningQaItems(input.planId);
  if (items.length === 0) {
    return {
      ok: false,
      error: "El plan no tiene líneas para controlar. Revisá el plan.",
    };
  }

  const version = planningQaVersion(plan.currentVersion);
  const run = await ensurePlanningRun(input.planId, version);
  if (!run) return { ok: false, error: "No se pudo abrir el QA de planificación" };

  const checkRows = await db
    .select({
      itemKind: mediaPlanPlanningQaChecks.itemKind,
      itemId: mediaPlanPlanningQaChecks.itemId,
      checkedAt: mediaPlanPlanningQaChecks.checkedAt,
      checkedByEmail: mediaPlanPlanningQaChecks.checkedByEmail,
    })
    .from(mediaPlanPlanningQaChecks)
    .where(eq(mediaPlanPlanningQaChecks.qaRunId, run.id));

  const checkedKeys = planningQaCheckedKeys(
    checkRows.filter((c): c is PlanningQaCheck =>
      isPlanningQaItemKind(c.itemKind),
    ),
  );
  const missing = findPlanningQaMissing(items, checkedKeys);
  if (missing.length > 0) {
    return { ok: false, error: planningQaIncompleteMessage(missing) };
  }

  const user = await getCurrentUser();
  const notes = input.notes?.trim() || null;

  await db
    .update(mediaPlanPlanningQaRuns)
    .set({
      completedAt: new Date(),
      completedByUserId: user?.id ?? null,
      completedByEmail: user?.email ?? null,
      notes,
    })
    .where(eq(mediaPlanPlanningQaRuns.id, run.id));

  // El pase real, con TODAS sus barreras (readiness, adsets y este QA, que
  // ahora está cerrado y completo).
  const moved = await transitionPlanStatus({
    planId: input.planId,
    to: "ready_to_send",
  });

  if (!moved.ok) {
    // Revertir el cierre: el plan sigue en draft, así que el QA sigue abierto.
    await db
      .update(mediaPlanPlanningQaRuns)
      .set({ completedAt: null, completedByUserId: null, completedByEmail: null })
      .where(eq(mediaPlanPlanningQaRuns.id, run.id));
    return moved;
  }

  // Ni audit ni revalidate acá: `transitionPlanStatus` ya hizo los dos. Meter
  // un segundo recordAudit dejaría DOS entradas en el historial de edición por
  // una sola acción del planner. El registro del QA en sí (quién lo cerró,
  // cuándo y con qué observaciones) vive en la fila del run, que es su lugar.
  return { ok: true };
}
