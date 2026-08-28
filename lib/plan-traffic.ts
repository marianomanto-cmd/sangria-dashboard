// Brief de TRÁFICO del plan — la regla de "está completo" y sus helpers.
//
// Fuente ÚNICA de la regla, compartida por:
//   • la server action `transitionPlanStatus` (app/actions/plans.ts) — barrera
//     real, server-side, en el paso a `live`; y
//   • la ventana de Tráfico y el editor del plan — para mostrar qué falta ANTES
//     de intentar la transición.
// Módulo puro (sin DB ni React), igual que lib/plan-readiness.ts, para que las
// dos lo usen y no se desincronicen.
//
// Por qué es una regla dura: el plan describe QUÉ se compra, pero el trafficker
// arma los adsets con esto. Un placement sin tipo de anuncio, sin copy o sin
// carpeta de archivos es una campaña que no se puede montar; marcarla `live`
// sería decir que está al aire algo que nadie pudo cargar. Por eso, además del
// brief completo, `live` exige que TODOS los anuncios estén marcados como
// cargados: el estado `live` y la plataforma tienen que decir lo mismo.

// ── Catálogo de tipos de anuncio ────────────────────────────────────────────
// Los values espejan el enum `traffic_ad_format` de db/schema.ts.

export const TRAFFIC_AD_FORMATS = [
  { value: "single_image", label: "Single image" },
  { value: "carousel", label: "Carrusel" },
  { value: "video", label: "Video" },
  { value: "dgen_set", label: "Dgen set" },
  { value: "other", label: "Otro" },
] as const;

export type TrafficAdFormat = (typeof TRAFFIC_AD_FORMATS)[number]["value"];

export function isTrafficAdFormat(v: string): v is TrafficAdFormat {
  return TRAFFIC_AD_FORMATS.some((f) => f.value === v);
}

// Etiqueta visible del tipo de anuncio. Para "other" gana lo que el planner
// escribió a mano; si lo dejó vacío, se muestra "Otro" a secas.
export function adFormatLabel(
  format: string | null,
  other: string | null,
): string {
  if (!format) return "—";
  if (format === "other") return (other ?? "").trim() || "Otro";
  return TRAFFIC_AD_FORMATS.find((f) => f.value === format)?.label ?? format;
}

// ── Formas mínimas que consume la regla ─────────────────────────────────────

export type TrafficAd = {
  adFormat: string | null;
  adFormatOther: string | null;
  copy: string | null;
  headline: string | null;
  subheadline: string | null;
  cta: string | null;
  landingUrl: string | null;
  loadedAt: Date | string | null;
};

export type TrafficBrief = {
  adsetsCount: number;
  trafficFolderUrl: string | null;
  ads: TrafficAd[];
};

export type TrafficPlacement = {
  publisherName: string;
  placementName: string | null;
  // null = el placement todavía no tiene brief de tráfico creado.
  brief: TrafficBrief | null;
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

// ── Completitud de un anuncio ───────────────────────────────────────────────

// Qué le falta a UN anuncio para estar listo para armarse. Array vacío =
// completo. No incluye el "cargado": eso es el registro del trafficker, que se
// chequea aparte (un anuncio puede estar perfectamente briefeado y todavía no
// cargado en la plataforma).
export function findAdIssues(ad: TrafficAd, index: number): string[] {
  const missing: string[] = [];
  const where = `anuncio ${index + 1}`;
  if (!ad.adFormat) {
    missing.push(`el tipo de anuncio del ${where}`);
  } else if (ad.adFormat === "other" && blank(ad.adFormatOther)) {
    missing.push(`escribir qué tipo de anuncio es el ${where}`);
  }
  if (blank(ad.copy)) missing.push(`el copy del ${where}`);
  if (blank(ad.headline)) missing.push(`el título del ${where}`);
  if (blank(ad.subheadline)) missing.push(`el subtítulo del ${where}`);
  if (blank(ad.cta)) missing.push(`el CTA del ${where}`);
  if (blank(ad.landingUrl)) missing.push(`la landing page del ${where}`);
  return missing;
}

export function isAdComplete(ad: TrafficAd, index = 0): boolean {
  return findAdIssues(ad, index).length === 0;
}

export function isAdLoaded(ad: TrafficAd): boolean {
  return ad.loadedAt != null;
}

// ── Completitud del brief de un placement ───────────────────────────────────

// `requireLoaded` distingue los dos usos: la ventana de Tráfico muestra el
// avance del brief (sin exigir el tilde de cargado) y el paso a Live sí lo
// exige — es la respuesta a "live tiene que significar que está al aire".
export function findPlacementTrafficIssues(
  pl: TrafficPlacement,
  requireLoaded: boolean,
): string[] {
  const brief = pl.brief;
  if (!brief || brief.ads.length === 0) {
    return ["cargar el brief de tráfico (cantidad de adsets, carpeta y anuncios)"];
  }

  const missing: string[] = [];
  if (!(brief.adsetsCount > 0)) missing.push("la cantidad de adsets");
  if (blank(brief.trafficFolderUrl)) missing.push("el link a la carpeta de tráfico");

  brief.ads.forEach((ad, i) => {
    missing.push(...findAdIssues(ad, i));
  });

  if (requireLoaded) {
    const pending = brief.ads
      .map((ad, i) => (isAdLoaded(ad) ? null : i + 1))
      .filter((n): n is number => n != null);
    if (pending.length === brief.ads.length) {
      missing.push(
        pending.length === 1
          ? "marcar el anuncio como cargado"
          : `marcar los ${pending.length} anuncios como cargados`,
      );
    } else if (pending.length > 0) {
      missing.push(
        pending.length === 1
          ? `marcar como cargado el anuncio ${pending[0]}`
          : `marcar como cargados los anuncios ${pending.join(", ")}`,
      );
    }
  }

  return missing;
}

export function isPlacementTrafficComplete(
  pl: TrafficPlacement,
  requireLoaded = false,
): boolean {
  return findPlacementTrafficIssues(pl, requireLoaded).length === 0;
}

// Todo lo que falta para que el plan pueda pasar a Live. Array vacío = listo.
export function findPlanTrafficIssues(
  placements: TrafficPlacement[],
  requireLoaded = true,
): TrafficIssue[] {
  const issues: TrafficIssue[] = [];
  for (const pl of placements) {
    const missing = findPlacementTrafficIssues(pl, requireLoaded);
    if (missing.length === 0) continue;
    issues.push({
      publisherName: pl.publisherName,
      placementName: (pl.placementName ?? "").trim() || UNNAMED,
      missing,
    });
  }
  return issues;
}

// ── Progreso, para los contadores de la UI ──────────────────────────────────

export type TrafficProgress = {
  placements: number;
  placementsComplete: number;
  ads: number;
  adsComplete: number;
  adsLoaded: number;
};

export function computeTrafficProgress(
  placements: TrafficPlacement[],
): TrafficProgress {
  const p: TrafficProgress = {
    placements: placements.length,
    placementsComplete: 0,
    ads: 0,
    adsComplete: 0,
    adsLoaded: 0,
  };
  for (const pl of placements) {
    if (isPlacementTrafficComplete(pl)) p.placementsComplete += 1;
    const ads = pl.brief?.ads ?? [];
    p.ads += ads.length;
    ads.forEach((ad, i) => {
      if (isAdComplete(ad, i)) p.adsComplete += 1;
      if (isAdLoaded(ad)) p.adsLoaded += 1;
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
// respeta saltos de línea) y para el error de la server action.
export function formatTrafficIssues(issues: TrafficIssue[]): string {
  return issues
    .map((i) => `• ${i.publisherName} · ${i.placementName}: falta ${joinEs(i.missing)}`)
    .join("\n");
}

// Mensaje completo del error server-side. La UI muestra el diálogo, pero la
// action tiene que explicarse sola: la pueden llamar sin pasar por el editor.
export function trafficErrorMessage(issues: TrafficIssue[]): string {
  return [
    "No se puede marcar el plan como Live — falta completar la sección Tráfico:",
    formatTrafficIssues(issues),
    'El trafficker arma los adsets con esta información. Completala en la ventana "Tráfico" del plan y marcá cada anuncio como cargado.',
  ].join("\n\n");
}
