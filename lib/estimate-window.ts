// Ventana de meses de la tab Estimación del portal (server-side, puro).
//
// Centraliza el cálculo de meses/años para que la vista (portal-content) y el
// export (estimate.xlsx) usen EXACTAMENTE el mismo criterio. Antes cada uno
// duplicaba los helpers de mes; al agregar el filtro de Año conviene una única
// fuente de verdad para no desincronizarlos.
//
// Convención del filtro de Año (igual que Reportes):
//   "" (sin param) → año ACTUAL (default) · "all" → todos · "YYYY" → ese año.

export function currentYear(now: Date = new Date()): string {
  return String(now.getFullYear());
}

export function thisMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function previousMonth(now: Date = new Date()): string {
  let y = now.getFullYear();
  let m = now.getMonth(); // getMonth() es 0-based → esto ya es "mes anterior".
  if (m === 0) {
    y -= 1;
    m = 12;
  }
  return `${y}-${String(m).padStart(2, "0")}`;
}

export function nextMonths(count: number, now: Date = new Date()): string[] {
  const out: string[] = [];
  let y = now.getFullYear();
  let m = now.getMonth() + 1;
  for (let i = 0; i < count; i++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

// Los 12 meses "YYYY-01" … "YYYY-12" de un año.
function monthsOfYear(year: string): string[] {
  return Array.from(
    { length: 12 },
    (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`,
  );
}

// Universo de meses del filtro de Estimación: histórico real del cliente
// (`billingMonths`, meses con billings/placements) ∪ ventana futura generada
// (mes actual + próximos 6, para poder estimar aunque no haya placements tan
// adelante).
function universeMonths(
  billingMonths: string[],
  now: Date = new Date(),
): string[] {
  return Array.from(new Set([...billingMonths, ...nextMonths(6, now)]));
}

// Opciones del filtro de Mes, opcionalmente scopeadas a un año. Con un año
// puntual, solo devuelve los meses de ese año → así el multi-select de Mes
// nunca mezcla meses de otros años (raíz del "me trae cosas de otros años").
export function estimationMonthOptions(
  billingMonths: string[] = [],
  year?: string,
  now: Date = new Date(),
): string[] {
  const all = universeMonths(billingMonths, now);
  const scoped =
    !year || year === "all" ? all : all.filter((m) => m.slice(0, 4) === year);
  return scoped.sort();
}

// Años disponibles para el filtro (desc): año actual ∪ años del histórico ∪
// años de la ventana futura. El componente igual re-inyecta el año actual y
// agrega "Todos", pero acá dejamos el set completo por prolijidad.
export function estimationYearOptions(
  billingMonths: string[] = [],
  now: Date = new Date(),
): string[] {
  const years = new Set<string>([currentYear(now)]);
  for (const m of universeMonths(billingMonths, now)) {
    const y = m.slice(0, 4);
    if (/^\d{4}$/.test(y)) years.add(y);
  }
  return Array.from(years).sort().reverse();
}

// Meses efectivos a estimar dado (year, selectedMonths). Es la ventana que
// consume getBillingEstimate y el export, garantizando que ambos coincidan.
//
//   • Meses explícitos → mandan, pero scopeados al año elegido (salvo "all"),
//     para no arrastrar un mes viejo de otro año al cambiar el filtro de Año.
//   • Sin meses + año actual / "all" → ventana forward-looking de aterrizaje:
//     mes anterior + 2 próximos (comportamiento histórico, sin cambios).
//   • Sin meses + un año puntual (pasado o futuro) → los 12 meses de ese año,
//     para poder recorrer ese año mes a mes.
export function estimateWindowMonths(opts: {
  year: string;
  selectedMonths: string[];
  now?: Date;
}): string[] {
  const now = opts.now ?? new Date();
  const effYear = opts.year || currentYear(now); // "" → año actual
  const selected = opts.selectedMonths.filter(Boolean);

  if (selected.length) {
    return (
      effYear === "all"
        ? [...selected]
        : selected.filter((m) => m.slice(0, 4) === effYear)
    ).sort();
  }

  if (effYear === "all" || effYear === currentYear(now)) {
    return [previousMonth(now), ...nextMonths(2, now)];
  }

  return monthsOfYear(effYear);
}
