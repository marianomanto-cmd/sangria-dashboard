// Helpers de formato — siempre rioplatense, monoespaciada en cifras.

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const usdFormatterCompact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 1,
});

export function formatUsd(value: number): string {
  return usdFormatter.format(value);
}

export function formatUsdCompact(value: number): string {
  return usdFormatterCompact.format(value);
}

export function formatPct(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}

// ── Entrada/edición de cifras: SIEMPRE formato US ──────────────────────────
// Punto = decimales, coma = separador de miles. Todos los inputs numéricos del
// dashboard (plan de medios, billing, etc.) deben mostrar y parsear con estos
// helpers para evitar la ambigüedad punto/coma.

const intInputFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const amountInputFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// Cifra entera con coma de miles US (ej: 1,500,000).
export function formatIntInput(value: number): string {
  return intInputFormatter.format(value);
}

// Monto con 2 decimales y coma de miles US (ej: 15,000.00).
export function formatAmountInput(value: number): string {
  return amountInputFormatter.format(value);
}

// Parsea texto ingresado por el usuario en formato US: la coma es separador de
// miles (se descarta) y el punto es decimal. Devuelve NaN si no hay número.
export function parseNumberInput(raw: string): number {
  const cleaned = raw.replace(/,/g, "").replace(/[^0-9.]/g, "");
  if (cleaned === "") return NaN;
  return Number.parseFloat(cleaned);
}
