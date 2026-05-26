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

// Evalúa lo que el usuario tipea en un campo numérico, admitiendo fórmulas
// aritméticas simples al estilo Excel (ej: "+2*2" → 4, "=1000*12" → 12000,
// "(1500+500)*3" → 6000). La coma sigue siendo separador de miles y el punto
// decimal. Si el texto contiene caracteres no aritméticos cae al parseo
// tolerante de parseNumberInput. Devuelve NaN si no se puede interpretar.
export function evalNumberInput(raw: string): number {
  let s = raw.trim();
  if (s === "") return NaN;
  // Prefijo "=" estilo planilla, opcional.
  if (s.startsWith("=")) s = s.slice(1).trim();
  // Coma de miles, símbolo de moneda y espacios se descartan.
  s = s.replace(/[,$\s]/g, "");
  if (s === "") return NaN;
  // Solo dígitos, operadores, paréntesis y punto → es una fórmula candidata.
  if (!/^[0-9+\-*/().]+$/.test(s)) return parseNumberInput(raw);
  try {
    return evalArithmetic(s);
  } catch {
    return NaN;
  }
}

// Evaluador aritmético seguro (descenso recursivo). NO usa eval(). Soporta
// + - * / , paréntesis y signos unarios. Lanza si la expresión es inválida o
// el resultado no es finito (ej: división por cero).
function evalArithmetic(expr: string): number {
  let pos = 0;

  function parseExpression(): number {
    let value = parseTerm();
    while (pos < expr.length) {
      const op = expr[pos];
      if (op === "+" || op === "-") {
        pos++;
        const rhs = parseTerm();
        value = op === "+" ? value + rhs : value - rhs;
      } else break;
    }
    return value;
  }

  function parseTerm(): number {
    let value = parseFactor();
    while (pos < expr.length) {
      const op = expr[pos];
      if (op === "*" || op === "/") {
        pos++;
        const rhs = parseFactor();
        value = op === "*" ? value * rhs : value / rhs;
      } else break;
    }
    return value;
  }

  function parseFactor(): number {
    const ch = expr[pos];
    if (ch === "+") {
      pos++;
      return parseFactor();
    }
    if (ch === "-") {
      pos++;
      return -parseFactor();
    }
    if (ch === "(") {
      pos++;
      const value = parseExpression();
      if (expr[pos] !== ")") throw new Error("paréntesis sin cerrar");
      pos++;
      return value;
    }
    return parseNumberToken();
  }

  function parseNumberToken(): number {
    const start = pos;
    while (pos < expr.length && /[0-9.]/.test(expr[pos])) pos++;
    if (pos === start) throw new Error("se esperaba un número");
    const n = Number.parseFloat(expr.slice(start, pos));
    if (!Number.isFinite(n)) throw new Error("número inválido");
    return n;
  }

  const result = parseExpression();
  if (pos !== expr.length) throw new Error("token inesperado");
  if (!Number.isFinite(result)) throw new Error("resultado no finito");
  return result;
}
