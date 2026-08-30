// ────────────────────────────────────────────────────────────────────────────
// Filtro de año compartido por las tabs de Planes y Proyectos. Un período
// [start, end] (fechas de placement) "pertenece" a un año si lo intersecta.
// El default del filtro es el año actual; "all" muestra todos. Lógica pura,
// reutilizable entre ambas páginas (server components).
//
// ── Filas sin período ───────────────────────────────────────────────────────
// El período del plan se DERIVA de las fechas de sus placements, así que un
// plan sin placements (o con placements sin fechas) no tiene período. Antes
// esas filas se contaban como del AÑO ACTUAL, con la idea de que un plan recién
// creado, todavía sin fechas, no desapareciera de la vista por defecto.
//
// Eso se rompe con los planes históricos: una carga masiva de planes viejos
// —cáscaras sin publishers, que existen sólo para colgarles facturación— los
// metía a todos en el año en curso. Un "Boosting Octubre 2024" aparecía bajo el
// filtro 2026, e inflaba los KPIs de la página (que se calculan sobre el set ya
// filtrado): "74 campañas vigentes" contaba cáscaras de 2024.
//
// Por eso ahora se acepta un `fallback`: un período de respaldo para las filas
// sin fechas propias. En la práctica son los MESES DE FACTURACIÓN del plan
// (`plan_billings.month`, formato YYYY-MM), que para esos planes históricos son
// el único dato de fecha real que existe. `created_at` NO sirve: la carga
// masiva los creó a todos el mismo día del año en curso.
//
// Si tampoco hay fallback, se mantiene el criterio viejo (año actual), que es
// el correcto para un plan que se está armando ahora mismo.
// ────────────────────────────────────────────────────────────────────────────

type Period = { start: string | null; end: string | null };

// Fila a ubicar en el tiempo: su período propio + el de respaldo (opcional).
export type YearRow = Period & { fallback?: Period | null };

function yearSpan(p: Period): [number, number] | null {
  const lo = p.start ?? p.end;
  const hi = p.end ?? p.start;
  if (!lo || !hi) return null;
  // Sirve igual para YYYY-MM-DD (placements) que para YYYY-MM (billings).
  const a = Number.parseInt(lo.slice(0, 4), 10);
  const b = Number.parseInt(hi.slice(0, 4), 10);
  if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
  return [Math.min(a, b), Math.max(a, b)]; // tolera rangos invertidos
}

// Span efectivo de una fila: su período, o el de respaldo si no tiene.
// null = no hay ninguna fecha con la cual ubicarla.
function effectiveSpan(row: YearRow): [number, number] | null {
  return yearSpan(row) ?? (row.fallback ? yearSpan(row.fallback) : null);
}

// ¿La fila toca el año `year`? Sin ninguna fecha → cuenta como año actual.
export function periodMatchesYear(
  period: Period,
  year: number,
  currentYear: number,
  fallback?: Period | null,
): boolean {
  const span = effectiveSpan({ ...period, fallback });
  if (!span) return year === currentYear;
  return span[0] <= year && year <= span[1];
}

// Años con actividad (desc), garantizando que el año actual esté siempre.
export function availableYears(
  rows: YearRow[],
  currentYear: number,
): number[] {
  const set = new Set<number>([currentYear]);
  for (const r of rows) {
    const span = effectiveSpan(r);
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
