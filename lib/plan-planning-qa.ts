// QA de PLANIFICACIÓN — las reglas de "está controlado" y sus helpers.
//
// Fuente ÚNICA, compartida por la barrera server-side y el modal. Módulo puro
// (sin DB ni React), igual que lib/plan-readiness.ts y lib/plan-traffic.ts,
// para que las dos lo usen y no se desincronicen.
//
// Qué controla: antes de congelar un plan y mandarlo a firma, el MEDIA PLANNER
// repasa lo que acaba de cargar y tilda CADA PLACEMENT y CADA ADSET. No es lo
// mismo que el QA que ya existía (ése lo hace el AM/PM sobre un plan ya firmado,
// para verificar que la campaña esté montada en las plataformas): éste mira el
// plan en sí, cuando todavía se puede corregir sin abrir una versión nueva.
//
// Por qué tildar uno por uno y no un "confirmo todo": el acto de tildar ES el
// control. Un plan que sale a firma con un monto o una fecha mal obliga a una
// versión nueva, con su re-firma y su QA de armado de nuevo.
//
// Barrera real: `transitionPlanStatus` (app/actions/plans.ts) en el pase
// draft → ready_to_send, y `completePlanningQa` (app/actions/plan-planning-qa.ts),
// que cierra el QA y hace el pase en una sola acción.

// ── Formas mínimas que consumen las reglas ──────────────────────────────────

export const PLANNING_QA_ITEM_KINDS = ["placement", "adset"] as const;
export type PlanningQaItemKind = (typeof PLANNING_QA_ITEM_KINDS)[number];

export function isPlanningQaItemKind(v: string): v is PlanningQaItemKind {
  return (PLANNING_QA_ITEM_KINDS as readonly string[]).includes(v);
}

// Un ítem tildable, ya aplanado. El orden de la lista es el orden en que el
// modal los muestra y en que se enumeran los que faltan.
export type PlanningQaItem = {
  kind: PlanningQaItemKind;
  id: string;
  // Para los mensajes: "Meta · Awareness Feed" / "Meta · Awareness Feed → adset 2".
  publisherName: string;
  placementName: string;
  // Sólo en los adsets: qué adset del placement es (1-based) y su nombre.
  adsetIndex?: number;
  adsetName?: string | null;
};

// Vista mínima de un placement con sus adsets. La arma
// `db/queries/plan-planning-qa.ts` cruzando el plan con el tráfico.
export type PlanningQaPlacement = {
  placementId: string;
  publisherName: string;
  placementName: string | null;
  adsets: { id: string; name: string | null }[];
};

const UNNAMED = "(placement sin nombre)";

// ── Qué hay que tildar ──────────────────────────────────────────────────────

// La lista COMPLETA de ítems del plan, en orden de pantalla: por cada
// placement, primero la línea y después sus adsets.
//
// Un placement sin adsets aporta sólo su línea. No es un agujero: el gate de
// adsets (lib/plan-traffic.ts) corre ANTES que este QA en la misma transición,
// así que para cuando el modal se abre ya está garantizado que todos los
// placements tienen al menos un adset completo.
export function buildPlanningQaItems(
  placements: readonly PlanningQaPlacement[],
): PlanningQaItem[] {
  const items: PlanningQaItem[] = [];
  for (const pl of placements) {
    const placementName = (pl.placementName ?? "").trim() || UNNAMED;
    items.push({
      kind: "placement",
      id: pl.placementId,
      publisherName: pl.publisherName,
      placementName,
    });
    pl.adsets.forEach((a, i) => {
      items.push({
        kind: "adset",
        id: a.id,
        publisherName: pl.publisherName,
        placementName,
        adsetIndex: i + 1,
        adsetName: a.name,
      });
    });
  }
  return items;
}

// Clave estable de un ítem, para los Sets del modal y de las actions. El id
// solo no alcanza: un placement y un adset son entidades distintas y sus ids
// viven en tablas distintas.
export function planningQaKey(kind: PlanningQaItemKind, id: string): string {
  return `${kind}:${id}`;
}

export function planningQaItemKey(item: PlanningQaItem): string {
  return planningQaKey(item.kind, item.id);
}

// Cómo se nombra un ítem en los mensajes de error.
export function planningQaItemLabel(item: PlanningQaItem): string {
  const where = `${item.publisherName} · ${item.placementName}`;
  if (item.kind === "placement") return where;
  const name = (item.adsetName ?? "").trim();
  return `${where} → adset ${item.adsetIndex}${name ? ` (${name})` : ""}`;
}

// ── Progreso ────────────────────────────────────────────────────────────────

export type PlanningQaProgress = {
  placements: number;
  placementsChecked: number;
  adsets: number;
  adsetsChecked: number;
  total: number;
  checked: number;
  missing: number;
  complete: boolean;
};

export function computePlanningQaProgress(
  items: readonly PlanningQaItem[],
  checkedKeys: ReadonlySet<string>,
): PlanningQaProgress {
  const p: PlanningQaProgress = {
    placements: 0,
    placementsChecked: 0,
    adsets: 0,
    adsetsChecked: 0,
    total: items.length,
    checked: 0,
    missing: 0,
    complete: false,
  };
  for (const item of items) {
    const done = checkedKeys.has(planningQaItemKey(item));
    if (item.kind === "placement") {
      p.placements += 1;
      if (done) p.placementsChecked += 1;
    } else {
      p.adsets += 1;
      if (done) p.adsetsChecked += 1;
    }
    if (done) p.checked += 1;
  }
  p.missing = p.total - p.checked;
  // Un plan sin ítems NO cuenta como controlado: no hay nada que controlar
  // porque no hay plan. El caso lo ataja readiness antes, pero la regla no
  // puede depender de eso.
  p.complete = p.total > 0 && p.missing === 0;
  return p;
}

// Los ítems que todavía faltan tildar, en orden de pantalla.
export function findPlanningQaMissing(
  items: readonly PlanningQaItem[],
  checkedKeys: ReadonlySet<string>,
): PlanningQaItem[] {
  return items.filter((i) => !checkedKeys.has(planningQaItemKey(i)));
}

// ── Mensajes ────────────────────────────────────────────────────────────────

// Se acota la enumeración: un plan de 40 líneas sin controlar genera 80 ítems y
// el diálogo se vuelve ilegible. Mismo criterio que lib/plan-traffic.ts.
const MAX_ITEMS = 8;

export function formatPlanningQaMissing(missing: readonly PlanningQaItem[]): string {
  const shown = missing.slice(0, MAX_ITEMS);
  const rest = missing.length - shown.length;
  const lines = shown.map((i) => `• ${planningQaItemLabel(i)}`);
  if (rest > 0) lines.push(`• (+${rest} más)`);
  return lines.join("\n");
}

// Error de cerrar el QA con cosas sin tildar.
export function planningQaIncompleteMessage(
  missing: readonly PlanningQaItem[],
): string {
  const n = missing.length;
  return [
    `Faltan controlar ${n} ítem${n === 1 ? "" : "s"} del plan:`,
    formatPlanningQaMissing(missing),
    "El QA de planificación se cierra con todos los placements y todos los adsets tildados.",
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
    ? `Se cerró con menos ítems de los que el plan tiene ahora (${progress.checked} de ${progress.total}). Volvé a abrirlo desde "Marcar listo para enviar".`
    : `Van ${progress.checked} de ${progress.total} ítems controlados (${progress.placementsChecked}/${progress.placements} placements · ${progress.adsetsChecked}/${progress.adsets} adsets).`;
  return [
    head,
    detail,
    'El planner tiene que repasar cada placement y cada adset en el modal que abre el botón "Marcar listo para enviar".',
  ].join("\n\n");
}
