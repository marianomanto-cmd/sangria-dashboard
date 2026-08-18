// ════════════════════════════════════════════════════════════════════════════
// Lifecycle de un PLAN de medios — fuente de verdad ÚNICA.
//
// El status de un plan se lee en MUCHOS lugares (planes, proyectos, dashboard,
// portal del cliente, analysis, campaign tracker, simulador, billing). Antes
// cada query hardcodeaba `status = 'approved'` como sinónimo de "plan vigente";
// al sumar el paso de QA eso se rompía en silencio (un plan `live` habría
// desaparecido del portal y del pacing). Por eso los sets viven acá y las
// queries los importan.
//
//   draft         → editable por el MM
//   ready_to_send → MM lo congeló, AM puede bajar el PDF y mandarlo a firma
//   approved      → cliente firmó. Falta el QA de la versión → NO puede ir a live
//   qa_done       → el planner controló línea por línea que la campaña esté
//                   armada tal cual el plan. Habilitado para pasar a live
//   live          → campaña al aire
//   archived      → reemplazado por una nueva versión o cancelado
//
// El QA es OBLIGATORIO y es POR VERSIÓN: aprobar la v(N+1) devuelve el plan a
// `approved`, así que hay que volver a controlarlo antes de marcarlo live.
// Ver `media_plan_qa_runs` / `media_plan_qa_checks` en db/schema.ts.
// ════════════════════════════════════════════════════════════════════════════

export const PLAN_STATUSES = [
  "draft",
  "ready_to_send",
  "approved",
  "qa_done",
  "live",
  "archived",
] as const;

export type PlanStatus = (typeof PLAN_STATUSES)[number];

export function isPlanStatus(value: string): value is PlanStatus {
  return (PLAN_STATUSES as readonly string[]).includes(value);
}

// ── Sets de estado ──────────────────────────────────────────────────────────

// Planes FIRMADOS por el cliente: la versión vigente es un compromiso real.
// Es el reemplazo de `status = 'approved'` en todas las queries que existían
// antes del QA (portal, analysis, campaign tracker, pendings, dashboard).
// Un plan aprobado sigue siendo un plan aprobado esté en QA, con QA hecho o
// al aire — el QA no cambia los números, solo verifica el armado.
export const PLAN_SIGNED_STATUSES = ["approved", "qa_done", "live"] as const;

// Planes que ya comprometen plata: firmados + el `ready_to_send` que el MM
// congeló. Alimentan estimación, pacing y comparables del simulador.
export const PLAN_COMMITTED_STATUSES = [
  "ready_to_send",
  "approved",
  "qa_done",
  "live",
] as const;

// Estados en los que el plan NO se edita (hay que abrir una nueva versión).
export const PLAN_LOCKED_STATUSES = [
  "ready_to_send",
  "approved",
  "qa_done",
  "live",
  "archived",
] as const;

export function isPlanSigned(status: string): boolean {
  return (PLAN_SIGNED_STATUSES as readonly string[]).includes(status);
}

export function isPlanCommitted(status: string): boolean {
  return (PLAN_COMMITTED_STATUSES as readonly string[]).includes(status);
}

// Un plan firmado cuyo QA de la versión vigente todavía no se hizo.
export function isQaPending(status: string): boolean {
  return status === "approved";
}

// ── Transiciones ────────────────────────────────────────────────────────────
//
// La barrera real vive en `transitionPlanStatus` (app/actions/plans.ts); esto
// es el mapa que consultan tanto la action como la UI.
//
// Regla dura: `live` SOLO se alcanza desde `qa_done`. No hay atajo desde
// `approved` — ni para planes nuevos ni para versiones nuevas.
export const PLAN_STATUS_TRANSITIONS: Record<PlanStatus, PlanStatus[]> = {
  draft: ["ready_to_send", "archived"],
  ready_to_send: ["draft", "approved", "archived"],
  // approved → qa_done NO se hace con transitionPlanStatus: lo cierra
  // `completePlanQa` cuando todas las líneas están controladas.
  approved: ["draft", "qa_done", "archived"],
  // qa_done → approved = reabrir el QA (`reopenPlanQa`).
  qa_done: ["draft", "approved", "live", "archived"],
  // live → qa_done = deshacer un "Live" marcado de más (el QA sigue válido).
  // live → draft = editar, que abre la v(N+1) y obliga a rehacer el QA.
  live: ["draft", "qa_done", "archived"],
  archived: [], // terminal
};

export function canTransition(from: string, to: string): boolean {
  const allowed = PLAN_STATUS_TRANSITIONS[from as PlanStatus];
  return !!allowed && (allowed as string[]).includes(to);
}

// ── Labels ──────────────────────────────────────────────────────────────────
//
// Los badges de status del plan son lang-agnósticos en toda la app (siempre en
// inglés, igual que `draft` / `ready to send`). Los textos de acción del editor
// sí van en castellano, como el resto del editor.
export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = {
  draft: "draft",
  ready_to_send: "ready to send",
  approved: "approved",
  qa_done: "QA done",
  live: "live",
  archived: "archived",
};

// Qué significa cada estado, para tooltips y textos de ayuda.
export const PLAN_STATUS_HINTS: Record<PlanStatus, string> = {
  draft: "Borrador editable por el media manager.",
  ready_to_send: "Congelado por el MM, listo para mandar a firma del cliente.",
  approved:
    "Firmado por el cliente. Falta el QA de esta versión — hasta hacerlo no se puede marcar Live.",
  qa_done:
    "QA hecho sobre esta versión: se controló línea por línea que la campaña esté armada como el plan. Listo para marcar Live.",
  live: "Campaña al aire.",
  archived: "Reemplazado por una versión nueva o cancelado.",
};
