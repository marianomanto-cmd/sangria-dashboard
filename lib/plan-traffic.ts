// TRÁFICO del plan — las reglas de "está completo" y sus helpers.
//
// Fuente ÚNICA, compartida por las barreras server-side y la UI. Módulo puro
// (sin DB ni React), igual que lib/plan-readiness.ts, para que las dos lo usen
// y no se desincronicen.
//
// Hay DOS gates, porque hay dos roles llenando la sección en dos momentos:
//
//   ADSETS → los llena el MEDIA PLANNER, y bloquean `ready_to_send`/`approved`.
//     Un plan que sale a firma sin los adsets designados (audiencia, budget,
//     pilar creativo y fechas de cada uno) no se puede comprar ni armar: el
//     planner tiene que haber decidido cómo se parte cada placement ANTES de
//     que el cliente firme.
//
//   ADS → los llena el AM/PM, y bloquean el QA (y con él, Live). Pueden estar
//     vacíos cuando el plan se manda a firmar — todavía no hay creatividades —
//     pero no se puede dar por controlada una campaña cuyos anuncios nadie
//     definió. Además, para marcar Live cada ad tiene que estar registrado
//     como cargado en la plataforma.
//
// Barreras reales: `transitionPlanStatus` (app/actions/plans.ts) para los
// adsets y para Live; `completePlanQa` (app/actions/plan-qa.ts) para los ads.

// ── Formas mínimas que consumen las reglas ──────────────────────────────────

export type TrafficAd = {
  adTypeId: string | null;
  // Si el tipo elegido pide detalle ("Otro"), hay que escribirlo a mano.
  adTypeRequiresDetail: boolean;
  adTypeOther: string | null;
  creativeUrl: string | null;
  copy: string | null;
  headline: string | null;
  subheadline: string | null;
  clickUrl: string | null;
  landingUrl: string | null;
  loadedAt: Date | string | null;
};

export type TrafficAdset = {
  name: string | null;
  audience: string | null;
  budgetUsd: number | null;
  creativePillar: string | null;
  startDate: string | null;
  endDate: string | null;
  ads: TrafficAd[];
};

export type TrafficPlacement = {
  publisherName: string;
  placementName: string | null;
  // null = el placement todavía no tiene brief de tráfico creado.
  brief: { adsets: TrafficAdset[] } | null;
};

export type TrafficIssue = {
  publisherName: string;
  placementName: string;
  // Qué falta, en lenguaje del planner.
  missing: string[];
};

const UNNAMED = "(placement sin nombre)";

function blank(v: string | null | undefined): boolean {
  return !(v ?? "").trim();
}

function adsetsOf(pl: TrafficPlacement): TrafficAdset[] {
  return pl.brief?.adsets ?? [];
}

export function adsOf(pl: TrafficPlacement): TrafficAd[] {
  return adsetsOf(pl).flatMap((a) => a.ads);
}

// ── Gate 1: ADSETS (bloquean "listo para enviar") ───────────────────────────

// Qué le falta a UN adset. Array vacío = completo. El nombre no es obligatorio
// (se muestra "Adset N" si está vacío); lo que el trafficker necesita sí.
export function findAdsetIssues(adset: TrafficAdset, index: number): string[] {
  const missing: string[] = [];
  const where = `adset ${index + 1}`;
  if (blank(adset.audience)) missing.push(`la audiencia del ${where}`);
  if (!(adset.budgetUsd != null && adset.budgetUsd > 0)) {
    missing.push(`el budget del ${where}`);
  }
  if (blank(adset.creativePillar)) missing.push(`el pilar creativo del ${where}`);
  if (blank(adset.startDate)) missing.push(`la fecha de inicio del ${where}`);
  if (blank(adset.endDate)) missing.push(`la fecha de fin del ${where}`);
  // Rango invertido: mismo criterio que el resto del plan (ver
  // bulkUpdatePlacementDates) — un rango dado vuelta rompe el prorrateo.
  if (
    !blank(adset.startDate) &&
    !blank(adset.endDate) &&
    (adset.endDate as string) < (adset.startDate as string)
  ) {
    missing.push(`corregir las fechas del ${where} (el fin es anterior al inicio)`);
  }
  return missing;
}

export function isAdsetComplete(adset: TrafficAdset, index = 0): boolean {
  return findAdsetIssues(adset, index).length === 0;
}

// Qué le falta a UN placement para que el plan pueda marcarse listo para
// enviar: al menos un adset, y todos completos.
export function findPlacementAdsetIssues(pl: TrafficPlacement): string[] {
  const adsets = adsetsOf(pl);
  if (adsets.length === 0) {
    return ["designar los adsets del placement (al menos uno)"];
  }
  return adsets.flatMap((a, i) => findAdsetIssues(a, i));
}

// ── Gate 2: ADS (bloquean el QA y, con él, Live) ────────────────────────────

// Qué le falta a UN ad. No incluye el "cargado": eso es el registro del
// trafficker, que se chequea aparte (un ad puede estar perfectamente definido
// y todavía no cargado en la plataforma).
export function findAdIssues(ad: TrafficAd, label: string): string[] {
  const missing: string[] = [];
  if (!ad.adTypeId) {
    missing.push(`el tipo de ad del ${label}`);
  } else if (ad.adTypeRequiresDetail && blank(ad.adTypeOther)) {
    missing.push(`escribir qué tipo de ad es el ${label}`);
  }
  if (blank(ad.creativeUrl)) missing.push(`el link del creativo del ${label}`);
  if (blank(ad.copy)) missing.push(`el copy del ${label}`);
  if (blank(ad.headline)) missing.push(`el título del ${label}`);
  if (blank(ad.subheadline)) missing.push(`el subtítulo del ${label}`);
  if (blank(ad.clickUrl)) missing.push(`la URL del ${label}`);
  if (blank(ad.landingUrl)) missing.push(`la landing del ${label}`);
  return missing;
}

export function isAdComplete(ad: TrafficAd): boolean {
  return findAdIssues(ad, "ad").length === 0;
}

export function isAdLoaded(ad: TrafficAd): boolean {
  return ad.loadedAt != null;
}

// Etiqueta de un ad dentro del placement, para que el mensaje de error diga
// exactamente dónde está: "ad 2 del adset 1".
function adLabel(adsetIndex: number, adIndex: number): string {
  return `ad ${adIndex + 1} del adset ${adsetIndex + 1}`;
}

// Qué le falta a UN placement para poder cerrar el QA. `requireLoaded` suma la
// exigencia de Live: que cada ad esté registrado como cargado.
export function findPlacementAdIssues(
  pl: TrafficPlacement,
  requireLoaded = false,
): string[] {
  const adsets = adsetsOf(pl);
  if (adsets.length === 0) {
    return ["designar los adsets del placement y cargarles sus ads"];
  }

  const missing: string[] = [];
  adsets.forEach((adset, i) => {
    if (adset.ads.length === 0) {
      missing.push(`cargar al menos un ad en el adset ${i + 1}`);
      return;
    }
    adset.ads.forEach((ad, j) => {
      missing.push(...findAdIssues(ad, adLabel(i, j)));
      if (requireLoaded && !isAdLoaded(ad)) {
        missing.push(`marcar como cargado el ${adLabel(i, j)}`);
      }
    });
  });
  return missing;
}

// ── Agregados por plan ──────────────────────────────────────────────────────

function collect(
  placements: TrafficPlacement[],
  per: (pl: TrafficPlacement) => string[],
): TrafficIssue[] {
  const issues: TrafficIssue[] = [];
  for (const pl of placements) {
    const missing = per(pl);
    if (missing.length === 0) continue;
    issues.push({
      publisherName: pl.publisherName,
      placementName: (pl.placementName ?? "").trim() || UNNAMED,
      missing,
    });
  }
  return issues;
}

// Lo que bloquea "listo para enviar" / "aprobado".
export function findPlanAdsetIssues(
  placements: TrafficPlacement[],
): TrafficIssue[] {
  return collect(placements, findPlacementAdsetIssues);
}

// Lo que bloquea cerrar el QA (y, con requireLoaded, marcar Live).
export function findPlanAdIssues(
  placements: TrafficPlacement[],
  requireLoaded = false,
): TrafficIssue[] {
  return collect(placements, (pl) => findPlacementAdIssues(pl, requireLoaded));
}

// ── Progreso, para los contadores de la UI ──────────────────────────────────

export type TrafficProgress = {
  placements: number;
  placementsWithAdsets: number;
  adsets: number;
  adsetsComplete: number;
  ads: number;
  adsComplete: number;
  adsLoaded: number;
};

export function computeTrafficProgress(
  placements: TrafficPlacement[],
): TrafficProgress {
  const p: TrafficProgress = {
    placements: placements.length,
    placementsWithAdsets: 0,
    adsets: 0,
    adsetsComplete: 0,
    ads: 0,
    adsComplete: 0,
    adsLoaded: 0,
  };
  for (const pl of placements) {
    if (findPlacementAdsetIssues(pl).length === 0) p.placementsWithAdsets += 1;
    const adsets = adsetsOf(pl);
    p.adsets += adsets.length;
    adsets.forEach((a, i) => {
      if (isAdsetComplete(a, i)) p.adsetsComplete += 1;
      p.ads += a.ads.length;
      for (const ad of a.ads) {
        if (isAdComplete(ad)) p.adsComplete += 1;
        if (isAdLoaded(ad)) p.adsLoaded += 1;
      }
    });
  }
  return p;
}

// ── Mensajes ────────────────────────────────────────────────────────────────

function joinEs(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
}

// Una línea por placement con problemas, lista para el body del diálogo (que
// respeta saltos de línea) y para el error de la server action. Se acota la
// enumeración por línea: un placement con 4 adsets incompletos genera 20
// ítems y el diálogo se vuelve ilegible.
const MAX_ITEMS_PER_LINE = 6;

export function formatTrafficIssues(issues: TrafficIssue[]): string {
  return issues
    .map((i) => {
      const shown = i.missing.slice(0, MAX_ITEMS_PER_LINE);
      const rest = i.missing.length - shown.length;
      const tail = rest > 0 ? ` (+${rest} más)` : "";
      return `• ${i.publisherName} · ${i.placementName}: falta ${joinEs(shown)}${tail}`;
    })
    .join("\n");
}

// Mensajes completos de error server-side. La UI muestra el diálogo, pero las
// actions tienen que explicarse solas: las pueden llamar sin pasar por el
// editor.
export function adsetsErrorMessage(
  issues: TrafficIssue[],
  target: "ready_to_send" | "approved",
): string {
  const label = target === "approved" ? "Aprobado" : "Listo para enviar";
  return [
    `No se puede marcar el plan como ${label} — faltan adsets en la sección Tráfico:`,
    formatTrafficIssues(issues),
    'Cada placement necesita al menos un adset con su audiencia, budget, pilar creativo y fechas. Completalos en la ventana "Tráfico" del plan (el botón "Del placement" copia audiencia, budget y fechas de la línea cuando el adset coincide con el placement).',
  ].join("\n\n");
}

export function adsErrorMessage(issues: TrafficIssue[]): string {
  return [
    "No se puede cerrar el QA — faltan ads en la sección Tráfico:",
    formatTrafficIssues(issues),
    'El AM/PM completa los ads de cada adset (tipo, creativo, copy, título, subtítulo, URL y landing) en la ventana "Tráfico" del plan.',
  ].join("\n\n");
}

export function liveErrorMessage(issues: TrafficIssue[]): string {
  return [
    "No se puede marcar el plan como Live — la sección Tráfico está incompleta:",
    formatTrafficIssues(issues),
    'Todos los ads tienen que estar completos y marcados como cargados en la plataforma.',
  ].join("\n\n");
}
