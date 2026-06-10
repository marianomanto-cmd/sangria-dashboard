// ════════════════════════════════════════════════════════════════════════════
// Helpers para renderizar el log de auditoría como oraciones legibles:
// "<actor> <verbo> el/la <entidad> '<nombre>' · <cuando>".
//
// La app todavía no tiene auth real, así que el userId del audit_log siempre
// está en null y el actor se renderiza como "Sistema" (placeholder hasta que
// agreguemos login). El verbo y el sustantivo se traducen al español a
// partir de entityType + action. El nombre amigable se extrae del before/
// afterJson según el tipo de entidad.
// ════════════════════════════════════════════════════════════════════════════

export type AuditAction = "create" | "update" | "delete" | (string & {});

// Verbo conjugado para mostrar (3ra persona, pretérito).
const ACTION_VERB: Record<string, string> = {
  create: "creó",
  update: "editó",
  delete: "eliminó",
};

// Cómo nombramos cada tipo de entidad en español, en SINGULAR con artículo.
// `(name) => string` permite ajustar el género si hace falta.
const ENTITY_NOUN: Record<string, { singular: string; article: "el" | "la" }> = {
  project: { singular: "proyecto", article: "el" },
  client: { singular: "cliente", article: "el" },
  budget_origin: { singular: "origen de presupuesto", article: "el" },
  publisher: { singular: "publisher", article: "el" },
  market: { singular: "mercado", article: "el" },
  metric: { singular: "métrica", article: "la" },
  media_plan: { singular: "plan", article: "el" },
  media_plan_publisher: { singular: "publisher del plan", article: "el" },
  media_plan_placement: { singular: "placement", article: "el" },
  media_plan_fee: { singular: "fee del plan", article: "el" },
  media_plan_aux_sheet: { singular: "sheet auxiliar del plan", article: "el" },
  plan_billing: { singular: "billing del plan", article: "el" },
  plan_billing_publisher: { singular: "consumo de publisher", article: "el" },
  plan_billing_fee: { singular: "imputación de fee", article: "la" },
  project_report: { singular: "reporte de proyecto", article: "el" },
  campaign_placement_actual: { singular: "valor real de placement", article: "el" },
  campaign_actual_snapshot: { singular: "snapshot de tracker", article: "el" },
  simulator_scenario: { singular: "escenario", article: "el" },
};

export type EntityNoun = { singular: string; article: "el" | "la" };

export function entityNoun(entityType: string): EntityNoun {
  return ENTITY_NOUN[entityType] ?? { singular: entityType, article: "el" };
}

export function actionVerb(action: AuditAction): string {
  return ACTION_VERB[action] ?? action;
}

// Saca un "label humano" del before/afterJson según el tipo de entidad.
// Prioridad: campos de la entidad concreta → 'name' → 'code' → null.
export function entityLabel(
  entityType: string,
  beforeJson: unknown,
  afterJson: unknown,
): string | null {
  // Para 'delete' usamos beforeJson; para 'create' afterJson; para 'update'
  // preferimos afterJson (el estado más reciente).
  const candidates: unknown[] = [afterJson, beforeJson].filter(
    (v): v is Record<string, unknown> => v !== null && typeof v === "object",
  );

  const pick = (keys: string[]): string | null => {
    for (const obj of candidates) {
      const o = obj as Record<string, unknown>;
      for (const k of keys) {
        const v = o[k];
        if (typeof v === "string" && v.trim()) return v.trim();
      }
    }
    return null;
  };

  switch (entityType) {
    case "media_plan_placement":
      return pick(["placementName", "placement_name"]);
    case "media_plan_publisher":
      // No tiene nombre propio en la tabla; fallback al id del publisher.
      return null;
    case "media_plan_fee":
      return pick(["name"]);
    case "media_plan":
    case "project":
    case "client":
    case "publisher":
    case "market":
    case "metric":
    case "budget_origin":
    case "simulator_scenario":
      return pick(["name", "code", "slug"]);
    case "plan_billing":
      return pick(["month"]);
    case "project_report":
      return pick(["projectName", "deliveryDate"]);
    default:
      return pick(["name", "label", "title", "month", "slug", "code"]);
  }
}

// "hace 5 minutos", "hoy 14:32", "ayer 09:15", "12/may 14:32",
// "18/may/2026 14:32" — depende de qué tan reciente es.
export function formatRelativeDateTime(
  date: Date,
  now: Date = new Date(),
): string {
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return "hace unos segundos";
  if (diffMin < 60) return `hace ${diffMin} ${diffMin === 1 ? "minuto" : "minutos"}`;

  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  if (sameDay) return `hoy ${hh}:${mm}`;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();
  if (isYesterday) return `ayer ${hh}:${mm}`;

  const months = [
    "ene", "feb", "mar", "abr", "may", "jun",
    "jul", "ago", "sep", "oct", "nov", "dic",
  ];
  const day = date.getDate();
  const mon = months[date.getMonth()];
  const sameYear = date.getFullYear() === now.getFullYear();
  return sameYear
    ? `${day}/${mon} ${hh}:${mm}`
    : `${day}/${mon}/${date.getFullYear()} ${hh}:${mm}`;
}

// Fecha y hora absoluta legible (para tooltip).
export function formatAbsoluteDateTime(date: Date): string {
  const months = [
    "ene", "feb", "mar", "abr", "may", "jun",
    "jul", "ago", "sep", "oct", "nov", "dic",
  ];
  const day = date.getDate();
  const mon = months[date.getMonth()];
  const year = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${day}/${mon}/${year} ${hh}:${mm}:${ss}`;
}

// Quién hizo la acción. Si tenemos el email (denormalizado en audit_log.
// userEmail desde el wire-up de auth), lo formateamos como "Nombre Apellido"
// derivado del local-part. Si no hay email pero hay userId quiere decir que
// la auth funcionó pero el email no se grabó (raro) — mostramos "usuario
// abc12345". Si no hay nada quiere decir que la row es vieja o vino de un
// script — "Sistema".
export function actorLabel(
  userEmail: string | null,
  userId: string | null = null,
): string {
  if (userEmail) {
    const local = userEmail.split("@")[0] ?? userEmail;
    return local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((s) => s[0].toUpperCase() + s.slice(1))
      .join(" ") || userEmail;
  }
  if (userId) return `usuario ${userId.slice(0, 8)}`;
  return "Sistema";
}
