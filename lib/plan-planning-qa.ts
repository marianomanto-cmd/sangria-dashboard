// QA de PLANIFICACIÓN — las reglas de "está controlado" y sus helpers.
//
// Fuente ÚNICA, compartida por la barrera server-side y el modal. Módulo puro
// (sin DB ni React), igual que lib/plan-readiness.ts, para que las dos lo usen
// y no se desincronicen.
//
// Qué controla: antes de congelar un plan y mandarlo a firma, el MEDIA PLANNER
// repasa lo que acaba de cargar y tilda CADA PLACEMENT. No es lo mismo que el
// QA de armado (ése lo hace el AM/PM sobre un plan ya firmado, para verificar
// que la campaña esté montada en las plataformas): éste mira el plan en sí,
// cuando todavía se puede corregir sin abrir una versión nueva.
//
// Por qué tildar uno por uno y no un "confirmo todo": el acto de tildar ES el
// control. Un plan que sale a firma con un monto o una fecha mal obliga a una
// versión nueva, con su re-firma y su QA de armado de nuevo.
//
// Barrera real: `transitionPlanStatus` (app/actions/plans.ts) en el pase
// draft → ready_to_send, y `completePlanningQa` (app/actions/plan-planning-qa.ts),
// que cierra el QA y hace el pase en una sola acción.

// ── Formas mínimas que consumen las reglas ──────────────────────────────────

// El `item_kind` de la tabla se mantiene aunque hoy sólo exista un valor: la
// columna ya está en producción y dejarla abierta cuesta menos que migrarla si
// mañana vuelve a haber otra cosa que tildar.
export const PLANNING_QA_ITEM_KINDS = ["placement"] as const;
export type PlanningQaItemKind = (typeof PLANNING_QA_ITEM_KINDS)[number];

export function isPlanningQaItemKind(v: string): v is PlanningQaItemKind {
  return (PLANNING_QA_ITEM_KINDS as readonly string[]).includes(v);
}

// Un ítem tildable. El orden de la lista es el orden en que el modal los
// muestra y en que se enumeran los que faltan.
export type PlanningQaItem = {
  kind: PlanningQaItemKind;
  id: string;
  // Para los mensajes: "Meta · Awareness Feed".
  publisherName: string;
  placementName: string;
};

// Vista mínima de un placement, la arma `db/queries/plan-planning-qa.ts`.
export type PlanningQaPlacement = {
  placementId: string;
  publisherName: string;
  placementName: string | null;
};

const UNNAMED = "(placement sin nombre)";

// ── Qué hay que tildar ──────────────────────────────────────────────────────

// La lista COMPLETA de ítems del plan, en orden de pantalla.
export function buildPlanningQaItems(
  placements: readonly PlanningQaPlacement[],
): PlanningQaItem[] {
  return placements.map((pl) => ({
    kind: "placement" as const,
    id: pl.placementId,
    publisherName: pl.publisherName,
    placementName: (pl.placementName ?? "").trim() || UNNAMED,
  }));
}

// Clave estable de un ítem, para los Sets del modal y de las actions.
export function planningQaKey(kind: PlanningQaItemKind, id: string): string {
  return `${kind}:${id}`;
}

export function planningQaItemKey(item: PlanningQaItem): string {
  return planningQaKey(item.kind, item.id);
}

// Cómo se nombra un ítem en los mensajes de error.
export function planningQaItemLabel(item: PlanningQaItem): string {
  return `${item.publisherName} · ${item.placementName}`;
}

// ── Progreso ────────────────────────────────────────────────────────────────

export type PlanningQaProgress = {
  total: number;
  checked: number;
  missing: number;
  complete: boolean;
};

export function computePlanningQaProgress(
  items: readonly PlanningQaItem[],
  checkedKeys: ReadonlySet<string>,
): PlanningQaProgress {
  const checked = items.filter((i) => checkedKeys.has(planningQaItemKey(i))).length;
  const missing = items.length - checked;
  return {
    total: items.length,
    checked,
    missing,
    // Un plan sin ítems NO cuenta como controlado: no hay nada que controlar
    // porque no hay plan. El caso lo ataja readiness antes, pero la regla no
    // puede depender de eso.
    complete: items.length > 0 && missing === 0,
  };
}

// Los ítems que todavía faltan tildar, en orden de pantalla.
export function findPlanningQaMissing(
  items: readonly PlanningQaItem[],
  checkedKeys: ReadonlySet<string>,
): PlanningQaItem[] {
  return items.filter((i) => !checkedKeys.has(planningQaItemKey(i)));
}

// ── Mensajes ────────────────────────────────────────────────────────────────

// Se acota la enumeración: un plan de 40 líneas sin controlar vuelve el diálogo
// ilegible. Mismo criterio que lib/plan-readiness.ts.
const MAX_ITEMS = 8;

export function formatPlanningQaMissing(missing: readonly PlanningQaItem[]): string {
  const shown = missing.slice(0, MAX_ITEMS);
  const rest = missing.length - shown.length;
  const lines = shown.map((i) => `• ${planningQaItemLabel(i)}`);
  if (rest > 0) lines.push(`• (+${rest} más)`);
  return lines.join("\n");
}

// Error de cerrar el QA con líneas sin tildar.
export function planningQaIncompleteMessage(
  missing: readonly PlanningQaItem[],
): string {
  const n = missing.length;
  return [
    `Faltan controlar ${n} línea${n === 1 ? "" : "s"} del plan:`,
    formatPlanningQaMissing(missing),
    "El QA de planificación se cierra con todas las líneas tildadas.",
  ].join("\n\n");
}

// Error de intentar el pase a ready_to_send sin haber hecho el QA. Lo devuelve
// la barrera de `transitionPlanStatus` cuando alguien llama la action sin pasar
// por el modal.
export function planningQaRequiredMessage(
  progress: PlanningQaProgress,
  closed: boolean,
): string {
  const head = closed
    ? "No se puede marcar el plan como Listo para enviar — el QA de planificación quedó desactualizado:"
    : "No se puede marcar el plan como Listo para enviar — falta el QA de planificación:";
  const detail = closed
    ? `Se cerró con menos líneas de las que el plan tiene ahora (${progress.checked} de ${progress.total}). Volvé a abrirlo desde "Marcar listo para enviar".`
    : `Van ${progress.checked} de ${progress.total} líneas controladas.`;
  return [
    head,
    detail,
    'El planner tiene que repasar cada línea en el modal que abre el botón "Marcar listo para enviar".',
  ].join("\n\n");
}
