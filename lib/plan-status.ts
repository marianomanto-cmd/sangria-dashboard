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
//   qa_done       → el AM/PM controló línea por línea que la campaña esté
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
  "finished",
  "archived",
] as const;

export type PlanStatus = (typeof PLAN_STATUSES)[number];

export function isPlanStatus(value: string): value is PlanStatus {
  return (PLAN_STATUSES as readonly string[]).includes(value);
}

// ── Sets de estado ──────────────────────────────────────────────────────────

// ── FIRMADO vs VIGENTE ──────────────────────────────────────────────────────
//
// Son dos ideas distintas, y hasta que apareció `finished` estaban colapsadas
// en un solo set porque coincidían. Ya no:
//
//   FIRMADO  = "el cliente firmó esto alguna vez". Incluye las campañas que ya
//              terminaron. Es lo que define el HISTÓRICO: qué ve el cliente en
//              su portal, qué entra al análisis publisher × mercado, qué se
//              muestra como plan cerrado.
//
//   VIGENTE  = "esto todavía es trabajo en curso". NO incluye `finished`. Es lo
//              que define el TRABAJO PENDIENTE: qué billing falta cargar, qué
//              tracking del día falta, qué campañas siguen en el tracker.
//
// Confundirlas tiene consecuencias concretas en las dos direcciones: si
// `finished` entra en VIGENTE, campañas de 2024 resucitan en el tablero de
// pendientes ("falta el billing de octubre"); si queda afuera de FIRMADO, el
// cliente pierde su histórico en el portal.

// Planes FIRMADOS por el cliente, terminados o no. Es el reemplazo de
// `status = 'approved'` en las queries de histórico (portal, analysis).
// Un plan aprobado sigue siendo un plan aprobado esté en QA, con QA hecho, al
// aire o cerrado — el QA no cambia los números, solo verifica el armado.
export const PLAN_SIGNED_STATUSES = [
  "approved",
  "qa_done",
  "live",
  "finished",
] as const;

// Planes VIGENTES: firmados y todavía en curso. Lo usan el tablero de
// pendientes y el campaign tracker, que preguntan "¿qué falta hacer?" — y sobre
// una campaña terminada la respuesta es "nada".
export const PLAN_ACTIVE_STATUSES = ["approved", "qa_done", "live"] as const;

// Planes que ya comprometen plata: firmados (incluidos los terminados, que
// gastaron de verdad) + el `ready_to_send` que el MM congeló. Alimentan
// estimación, pacing y comparables del simulador.
export const PLAN_COMMITTED_STATUSES = [
  "ready_to_send",
  ...PLAN_SIGNED_STATUSES,
] as const;

// Estados en los que el plan NO se edita (hay que abrir una nueva versión).
export const PLAN_LOCKED_STATUSES = [
  "ready_to_send",
  "approved",
  "qa_done",
  "live",
  "finished",
  "archived",
] as const;

export function isPlanSigned(status: string): boolean {
  return (PLAN_SIGNED_STATUSES as readonly string[]).includes(status);
}

export function isPlanActive(status: string): boolean {
  return (PLAN_ACTIVE_STATUSES as readonly string[]).includes(status);
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
  // live → finished = la campaña corrió y cerró.
  live: ["draft", "qa_done", "finished", "archived"],
  // finished → live = reabrir una campaña que se cerró de más.
  finished: ["live", "archived"],
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
  finished: "finished",
  archived: "archived",
};

// Qué significa cada estado, para tooltips y textos de ayuda.
export const PLAN_STATUS_HINTS: Record<PlanStatus, string> = {
  draft: "Borrador editable por el media planner. Para mandarlo a firma hay que pasar el QA de planificación.",
  ready_to_send: "Congelado por el MM, listo para mandar a firma del cliente.",
  approved:
    "Firmado por el cliente. Falta el QA de esta versión — hasta hacerlo no se puede marcar Live.",
  qa_done:
    "QA de armado hecho sobre esta versión: el AM/PM controló línea por línea que la campaña esté montada como el plan. Listo para marcar Live.",
  live: "Campaña al aire.",
  finished:
    "Campaña terminada: corrió y cerró. Sigue contando para el histórico (portal, análisis, benchmarks) pero ya no genera pendientes ni aparece en el campaign tracker.",
  archived: "Reemplazado por una versión nueva o cancelado.",
};
