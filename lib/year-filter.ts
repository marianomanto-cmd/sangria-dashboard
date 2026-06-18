// ────────────────────────────────────────────────────────────────────────────
// Filtro de año compartido por las tabs de Planes y Proyectos. Un período
// [start, end] (fechas de placement) "pertenece" a un año si lo intersecta.
// Una fila sin fechas se considera del año actual (trabajo en curso, no se
// esconde por defecto). El default del filtro es el año actual; "all" muestra
// todos. Lógica pura, reutilizable entre ambas páginas (server components).
// ────────────────────────────────────────────────────────────────────────────

type Period = { start: string | null; end: string | null };

function yearSpan(p: Period): [number, number] | null {
  const lo = p.start ?? p.end;
  const hi = p.end ?? p.start;
  if (!lo || !hi) return null;
  const a = Number.parseInt(lo.slice(0, 4), 10);
  const b = Number.parseInt(hi.slice(0, 4), 10);
  if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
  return [Math.min(a, b), Math.max(a, b)]; // tolera rangos invertidos
}

// ¿El período toca el año `year`? Sin fechas → cuenta como año actual.
export function periodMatchesYear(
  period: Period,
  year: number,
  currentYear: number,
): boolean {
  const span = yearSpan(period);
  if (!span) return year === currentYear;
  return span[0] <= year && year <= span[1];
}

// Años con actividad (desc), garantizando que el año actual esté siempre.
export function availableYears(
  periods: Period[],
  currentYear: number,
): number[] {
  const set = new Set<number>([currentYear]);
  for (const p of periods) {
    const span = yearSpan(p);
    if (!span) continue;
    for (let y = span[0]; y <= span[1]; y++) {
      if (y >= 2000 && y <= currentYear + 5) set.add(y); // descarta fechas basura
    }
  }
  return [...set].sort((a, b) => b - a);
}

// Parsea el searchParam `year`: "all" → null (sin filtro); número válido → ese
// año; ausente / inválido → año actual (default).
export function resolveYearParam(
  raw: string | undefined,
  currentYear: number,
): number | null {
  if (raw === "all") return null;
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isInteger(n) && n >= 2000 && n <= currentYear + 5 ? n : currentYear;
}
