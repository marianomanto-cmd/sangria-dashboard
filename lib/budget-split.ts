// ════════════════════════════════════════════════════════════════════════════
// Budget split por mercado — prorratea la inversión de cada placement por
// días entre los meses que cubre [startDate, endDate] y la agrega por
// mercado × mes. Compartido entre el Tab 2 del export Excel
// (app/api/plans/[planId]/export.xlsx) y el preview del editor del plan
// (toggle "Budget por mercado" en ExcelPreview) para que nunca diverjan.
// Helpers PUROS, client-safe.
// ════════════════════════════════════════════════════════════════════════════

// Clave especial para montos sin fechas: van a una columna propia para que
// la plata nunca se "pierda".
export const NO_DATE_KEY = "no-date";

// Prorratea un monto entre los meses que cubre [startISO, endISO] usando
// proporción de días (inclusive en ambos extremos). Si faltan fechas (o son
// inválidas) devuelve el monto bajo NO_DATE_KEY.
export function prorateByMonth(
  amount: number,
  startISO: string | null,
  endISO: string | null,
): Map<string, number> {
  const out = new Map<string, number>();
  if (amount === 0) return out;
  if (!startISO || !endISO) {
    out.set(NO_DATE_KEY, amount);
    return out;
  }
  const s = parseDate(startISO);
  const e = parseDate(endISO);
  if (!s || !e || e < s) {
    out.set(NO_DATE_KEY, amount);
    return out;
  }
  const totalDays = daysBetween(s, e) + 1;
  if (totalDays <= 0) {
    out.set(NO_DATE_KEY, amount);
    return out;
  }
  let cursor = new Date(s.getFullYear(), s.getMonth(), 1);
  while (cursor <= e) {
    const y = cursor.getFullYear();
    const mIdx = cursor.getMonth();
    const monthStart = new Date(y, mIdx, 1);
    const monthEnd = new Date(y, mIdx + 1, 0);
    const segStart = monthStart > s ? monthStart : s;
    const segEnd = monthEnd < e ? monthEnd : e;
    const days = daysBetween(segStart, segEnd) + 1;
    if (days > 0) {
      const key = `${y}-${String(mIdx + 1).padStart(2, "0")}`;
      out.set(key, (out.get(key) ?? 0) + (amount * days) / totalDays);
    }
    cursor = new Date(y, mIdx + 1, 1);
  }
  return out;
}

function parseDate(iso: string): Date | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(
    Number.parseInt(m[1], 10),
    Number.parseInt(m[2], 10) - 1,
    Number.parseInt(m[3], 10),
  );
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

// ────────────────────────────────────────────────────────────────────────────
// Agregación mercado × mes
// ────────────────────────────────────────────────────────────────────────────

export type BudgetSplitInput = {
  amountUsd: number;
  startDate: string | null;
  endDate: string | null;
  marketName: string | null;
};

export type BudgetSplit = {
  // "YYYY-MM" ordenados; NO_DATE_KEY al final si hay montos sin fecha.
  monthKeys: string[];
  // Nombres de mercado ordenados locale-aware (con el fallback incluido).
  markets: string[];
  amounts: Map<string, Map<string, number>>; // market → monthKey → USD
  monthTotals: Map<string, number>;
  marketTotals: Map<string, number>;
  grandTotal: number;
};

export function buildBudgetSplit(
  placements: BudgetSplitInput[],
  opts: { noMarketLabel: string; locale: string },
): BudgetSplit {
  const amounts = new Map<string, Map<string, number>>();
  const monthsSet = new Set<string>();
  let hasNoDate = false;

  for (const pl of placements) {
    if (!pl.amountUsd) continue;
    const market = pl.marketName ?? opts.noMarketLabel;
    const alloc = prorateByMonth(pl.amountUsd, pl.startDate, pl.endDate);
    let m = amounts.get(market);
    if (!m) {
      m = new Map();
      amounts.set(market, m);
    }
    for (const [key, usd] of alloc) {
      m.set(key, (m.get(key) ?? 0) + usd);
      if (key === NO_DATE_KEY) hasNoDate = true;
      else monthsSet.add(key);
    }
  }

  const monthKeys = [...monthsSet].sort();
  if (hasNoDate) monthKeys.push(NO_DATE_KEY);
  const markets = [...amounts.keys()].sort((a, b) =>
    a.localeCompare(b, opts.locale),
  );

  const monthTotals = new Map<string, number>(monthKeys.map((k) => [k, 0]));
  const marketTotals = new Map<string, number>();
  let grandTotal = 0;
  for (const market of markets) {
    const m = amounts.get(market)!;
    let rowTotal = 0;
    for (const k of monthKeys) {
      const v = m.get(k) ?? 0;
      rowTotal += v;
      monthTotals.set(k, (monthTotals.get(k) ?? 0) + v);
    }
    marketTotals.set(market, rowTotal);
    grandTotal += rowTotal;
  }

  return { monthKeys, markets, amounts, monthTotals, marketTotals, grandTotal };
}
