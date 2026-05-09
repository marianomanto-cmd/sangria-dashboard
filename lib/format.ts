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
