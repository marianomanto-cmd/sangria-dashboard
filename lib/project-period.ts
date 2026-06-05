import type { Language } from "@/lib/i18n";

// ════════════════════════════════════════════════════════════════════════════
// Período de un proyecto derivado de sus planes (min start / max end de los
// placements) + helper de "termina pronto" (aviso a ≤ N días del fin).
// Todo en la UI; no hay columna de fin en `projects`.
// ════════════════════════════════════════════════════════════════════════════

export function projectPeriod(
  plans: { periodStart: string | null; periodEnd: string | null }[],
): { start: string | null; end: string | null } {
  let start: string | null = null;
  let end: string | null = null;
  for (const p of plans) {
    if (p.periodStart && (!start || p.periodStart < start)) start = p.periodStart;
    if (p.periodEnd && (!end || p.periodEnd > end)) end = p.periodEnd;
  }
  return { start, end };
}

// Días hasta la fecha de fin (negativo si ya pasó). null si no hay fin/fecha.
export function daysUntilEnd(endISO: string | null): number | null {
  if (!endISO) return null;
  const m = endISO.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const end = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((end.getTime() - today.getTime()) / 86400000);
}

// Si el proyecto termina dentro de `within` días (incl. hoy), devuelve los días;
// si no, null.
export function endingSoonDays(endISO: string | null, within = 7): number | null {
  const d = daysUntilEnd(endISO);
  return d !== null && d >= 0 && d <= within ? d : null;
}

export function endingSoonLabel(days: number, lang: Language): string {
  if (lang === "es") {
    if (days === 0) return "Termina hoy";
    if (days === 1) return "Termina mañana";
    return `Termina en ${days} días`;
  }
  if (days === 0) return "Ends today";
  if (days === 1) return "Ends tomorrow";
  return `Ends in ${days} days`;
}
