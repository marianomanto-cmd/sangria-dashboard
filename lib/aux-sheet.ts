// ════════════════════════════════════════════════════════════════════════════
// Tabs auxiliares del plan — constantes y helpers PUROS compartidos entre el
// editor (client), las server actions (app/actions/aux-sheets.ts) y el export
// Excel (app/api/plans/[planId]/export.xlsx). La grilla es un string[][]
// (filas × celdas) que se guarda tal cual en media_plan_aux_sheets.grid_json.
//
// Una celda que empieza con "=" es una FÓRMULA estilo Excel: aritmética
// (+ - * /, paréntesis, signos unarios), referencias A1 con la numeración
// VISIBLE del tab (la grilla arranca en la fila AUX_SHEET_GRID_ROW_OFFSET,
// igual que en el archivo exportado) y funciones SUM / AVERAGE / MIN / MAX /
// COUNT sobre rangos (A5:B10) o valores. El editor muestra el resultado y el
// export la escribe como fórmula real de Excel (mismas coordenadas).
// ════════════════════════════════════════════════════════════════════════════

export const AUX_SHEET_DEFAULT_NAME = "Auxiliar";

// Dimensiones con las que nace la grilla (y mínimo que muestra el editor).
export const AUX_SHEET_DEFAULT_ROWS = 15;
export const AUX_SHEET_DEFAULT_COLS = 8;

// Techos duros — validados en la server action además de la UI.
export const AUX_SHEET_MAX_ROWS = 200;
export const AUX_SHEET_MAX_COLS = 26; // A–Z
export const AUX_SHEET_MAX_CELL_LEN = 1000;

// Filas de metadata read-only arriba de la grilla (proyecto / período /
// budget origin) y fila visible donde arranca la grilla: metadata + 1 fila
// de aire + 1. El editor y el export usan la MISMA numeración para que las
// referencias de las fórmulas signifiquen lo mismo en ambos lados.
export const AUX_SHEET_INFO_ROWS = 3;
export const AUX_SHEET_GRID_ROW_OFFSET = AUX_SHEET_INFO_ROWS + 2;

export type AuxSheetGrid = string[][];

// Valida una grilla que llega del cliente. Devuelve la grilla saneada
// (celdas truncadas al máximo) o null si la forma no es válida.
export function sanitizeAuxGrid(grid: unknown): AuxSheetGrid | null {
  if (!Array.isArray(grid) || grid.length > AUX_SHEET_MAX_ROWS) return null;
  const out: AuxSheetGrid = [];
  for (const row of grid) {
    if (!Array.isArray(row) || row.length > AUX_SHEET_MAX_COLS) return null;
    const cells: string[] = [];
    for (const cell of row) {
      if (typeof cell !== "string") return null;
      cells.push(cell.slice(0, AUX_SHEET_MAX_CELL_LEN));
    }
    out.push(cells);
  }
  return out;
}

// Rectangulariza y aplica los mínimos de display: toda fila con la misma
// cantidad de columnas, al menos DEFAULT_ROWS × DEFAULT_COLS.
export function normalizeAuxGrid(grid: AuxSheetGrid): AuxSheetGrid {
  const rows = Math.min(
    AUX_SHEET_MAX_ROWS,
    Math.max(grid.length, AUX_SHEET_DEFAULT_ROWS),
  );
  const cols = Math.min(
    AUX_SHEET_MAX_COLS,
    Math.max(AUX_SHEET_DEFAULT_COLS, ...grid.map((r) => r.length)),
  );
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => grid[r]?.[c] ?? ""),
  );
}

// Si la celda parsea limpio como número US ("1500", "1,500.00", "$1200",
// "-3.5"), devuelve el número para que la celda del Excel sea numérica;
// si no, null y se exporta como texto.
export function auxCellNumber(value: string): number | null {
  const cleaned = value.trim().replace(/^\$\s*/, "").replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Letra de columna estilo Excel (0 → A). La grilla está capada a 26 columnas.
export function auxColLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

// ════════════════════════════════════════════════════════════════════════════
// Celdas combinadas (merge)
// ════════════════════════════════════════════════════════════════════════════
// Rangos rectangulares {r0,c0,r1,c1} en coordenadas de la GRILLA (0-based, las
// mismas que indexan grid_json). El valor vive en la celda top-left (master);
// las celdas tapadas se guardan VACÍAS, así el evaluador de fórmulas y el
// export las tratan como vacías sin lógica extra. El editor las rinde con
// rowSpan/colSpan y el export las escribe con ws.mergeCells (mismas coords).

export type AuxMerge = { r0: number; c0: number; r1: number; c1: number };

// Techo de uniones por tab (defensivo, validado server-side además de la UI).
export const AUX_SHEET_MAX_MERGES = 200;

export function rectsIntersect(a: AuxMerge, b: AuxMerge): boolean {
  return a.r0 <= b.r1 && a.r1 >= b.r0 && a.c0 <= b.c1 && a.c1 >= b.c0;
}

// La unión que cubre la celda (r,c), o null. La master es (m.r0, m.c0).
export function findMerge(
  merges: AuxMerge[],
  r: number,
  c: number,
): AuxMerge | null {
  for (const m of merges) {
    if (r >= m.r0 && r <= m.r1 && c >= m.c0 && c <= m.c1) return m;
  }
  return null;
}

// Valida las uniones que llegan del cliente/DB contra las dimensiones de la
// grilla: enteros, dentro de límites, normalizadas (r0≤r1, c0≤c1), de >1 celda
// y sin solaparse entre sí (la primera gana). Devuelve la lista saneada.
export function sanitizeMerges(input: unknown, grid: AuxSheetGrid): AuxMerge[] {
  if (!Array.isArray(input)) return [];
  const rows = grid.length;
  const cols = Math.max(0, ...grid.map((r) => r.length));
  const out: AuxMerge[] = [];
  for (const m of input) {
    if (!m || typeof m !== "object") continue;
    const { r0, c0, r1, c1 } = m as Record<string, unknown>;
    if (![r0, c0, r1, c1].every((n) => Number.isInteger(n))) continue;
    const R0 = Math.min(r0 as number, r1 as number);
    const R1 = Math.max(r0 as number, r1 as number);
    const C0 = Math.min(c0 as number, c1 as number);
    const C1 = Math.max(c0 as number, c1 as number);
    if (R0 < 0 || C0 < 0 || R1 >= rows || C1 >= cols) continue; // fuera de rango
    if (R0 === R1 && C0 === C1) continue; // una sola celda no es unión
    const cand = { r0: R0, c0: C0, r1: R1, c1: C1 };
    if (out.some((e) => rectsIntersect(e, cand))) continue; // sin solapes
    out.push(cand);
    if (out.length >= AUX_SHEET_MAX_MERGES) break;
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// Fórmulas
// ════════════════════════════════════════════════════════════════════════════

export function isAuxFormula(raw: string): boolean {
  return raw.trimStart().startsWith("=");
}

export type AuxFormulaResult =
  | { ok: true; value: number }
  | { ok: false; error: string };

// Errores con código estilo Excel (#REF!, #VALUE!, #DIV/0!, #CIRC!, #ERROR!).
class AuxFormulaError extends Error {}

type Token =
  | { kind: "num"; value: number }
  | { kind: "ref"; col: number; gridRow: number }
  | { kind: "ident"; name: string }
  | { kind: "op"; ch: string };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === " " || ch === "\t") {
      i++;
      continue;
    }
    if ("+-*/(),:".includes(ch)) {
      out.push({ kind: "op", ch });
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const m = src.slice(i).match(/^\d*\.?\d+/);
      if (!m) throw new AuxFormulaError("#ERROR!");
      out.push({ kind: "num", value: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z$]/.test(ch)) {
      // Ref tipo A5 / $A$5 (letras + dígitos) o nombre de función (solo letras).
      const m = src.slice(i).match(/^\$?([A-Za-z]+)(?:\$?(\d+))?/);
      if (!m) throw new AuxFormulaError("#ERROR!");
      const letters = m[1].toUpperCase();
      if (m[2] !== undefined) {
        // Columna A–Z (multi-letra cae fuera del cap de 26 → #REF al evaluar).
        const col =
          letters.length === 1 ? letters.charCodeAt(0) - 65 : AUX_SHEET_MAX_COLS;
        // La numeración visible arranca en AUX_SHEET_GRID_ROW_OFFSET.
        const gridRow = Number.parseInt(m[2], 10) - AUX_SHEET_GRID_ROW_OFFSET;
        out.push({ kind: "ref", col, gridRow });
      } else {
        out.push({ kind: "ident", name: letters });
      }
      i += m[0].length;
      continue;
    }
    throw new AuxFormulaError("#ERROR!");
  }
  return out;
}

// Valor numérico de una celda referenciada en contexto aritmético.
// Vacía = 0, texto = #VALUE!, fórmula = se evalúa (con detección de ciclos).
function refValue(
  grid: AuxSheetGrid,
  gridRow: number,
  col: number,
  visiting: Set<string>,
): number {
  if (gridRow < 0 || gridRow >= grid.length) throw new AuxFormulaError("#REF!");
  if (col < 0 || col >= AUX_SHEET_MAX_COLS) throw new AuxFormulaError("#REF!");
  const raw = (grid[gridRow][col] ?? "").trim();
  if (!raw) return 0;
  if (isAuxFormula(raw)) return evalNested(raw, grid, gridRow, col, visiting);
  const n = auxCellNumber(raw);
  if (n == null) throw new AuxFormulaError("#VALUE!");
  return n;
}

// Valor de una celda dentro de un RANGO: vacías y texto se ignoran (null),
// como hace Excel en SUM/AVERAGE; los errores de fórmulas sí se propagan.
function rangeValue(
  grid: AuxSheetGrid,
  gridRow: number,
  col: number,
  visiting: Set<string>,
): number | null {
  if (gridRow < 0 || gridRow >= grid.length) return null;
  if (col < 0 || col >= (grid[gridRow]?.length ?? 0)) return null;
  const raw = (grid[gridRow][col] ?? "").trim();
  if (!raw) return null;
  if (isAuxFormula(raw)) return evalNested(raw, grid, gridRow, col, visiting);
  return auxCellNumber(raw);
}

function evalNested(
  raw: string,
  grid: AuxSheetGrid,
  gridRow: number,
  col: number,
  visiting: Set<string>,
): number {
  const key = `${gridRow}:${col}`;
  if (visiting.has(key)) throw new AuxFormulaError("#CIRC!");
  visiting.add(key);
  try {
    return evalTokens(tokenize(raw.trimStart().slice(1)), grid, visiting);
  } finally {
    visiting.delete(key);
  }
}

const AUX_FUNCTIONS = ["SUM", "AVERAGE", "MIN", "MAX", "COUNT"] as const;

function evalTokens(
  tokens: Token[],
  grid: AuxSheetGrid,
  visiting: Set<string>,
): number {
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (ch: string) => {
    const t = peek();
    return t?.kind === "op" && t.ch === ch;
  };
  const expectOp = (ch: string) => {
    if (!isOp(ch)) throw new AuxFormulaError("#ERROR!");
    pos++;
  };

  // expr := term (("+"|"-") term)*
  function parseExpr(): number {
    let v = parseTerm();
    while (isOp("+") || isOp("-")) {
      const op = (tokens[pos++] as { ch: string }).ch;
      const rhs = parseTerm();
      v = op === "+" ? v + rhs : v - rhs;
    }
    return v;
  }

  // term := factor (("*"|"/") factor)*
  function parseTerm(): number {
    let v = parseFactor();
    while (isOp("*") || isOp("/")) {
      const op = (tokens[pos++] as { ch: string }).ch;
      const rhs = parseFactor();
      if (op === "/") {
        if (rhs === 0) throw new AuxFormulaError("#DIV/0!");
        v = v / rhs;
      } else {
        v = v * rhs;
      }
    }
    return v;
  }

  // factor := ("+"|"-") factor | primary
  function parseFactor(): number {
    if (isOp("+")) {
      pos++;
      return parseFactor();
    }
    if (isOp("-")) {
      pos++;
      return -parseFactor();
    }
    return parsePrimary();
  }

  function parsePrimary(): number {
    const t = peek();
    if (!t) throw new AuxFormulaError("#ERROR!");
    if (t.kind === "num") {
      pos++;
      return t.value;
    }
    if (t.kind === "ref") {
      pos++;
      return refValue(grid, t.gridRow, t.col, visiting);
    }
    if (t.kind === "op" && t.ch === "(") {
      pos++;
      const v = parseExpr();
      expectOp(")");
      return v;
    }
    if (t.kind === "ident") {
      const name = t.name as (typeof AUX_FUNCTIONS)[number];
      if (!AUX_FUNCTIONS.includes(name)) throw new AuxFormulaError("#ERROR!");
      pos++;
      expectOp("(");
      const values = parseArgs();
      expectOp(")");
      return applyFunction(name, values);
    }
    throw new AuxFormulaError("#ERROR!");
  }

  // args := arg ("," arg)* — cada arg es un rango (ref:ref) o una expresión.
  // Devuelve los valores numéricos recolectados (las celdas vacías / de texto
  // de un rango se ignoran).
  function parseArgs(): number[] {
    const values: number[] = [];
    for (;;) {
      const t = peek();
      const next = tokens[pos + 1];
      if (t?.kind === "ref" && next?.kind === "op" && next.ch === ":") {
        const from = t;
        pos += 2;
        const to = peek();
        if (to?.kind !== "ref") throw new AuxFormulaError("#ERROR!");
        pos++;
        const r0 = Math.min(from.gridRow, to.gridRow);
        const r1 = Math.max(from.gridRow, to.gridRow);
        const c0 = Math.min(from.col, to.col);
        const c1 = Math.max(from.col, to.col);
        if ((r1 - r0 + 1) * (c1 - c0 + 1) > AUX_SHEET_MAX_ROWS * AUX_SHEET_MAX_COLS)
          throw new AuxFormulaError("#REF!");
        for (let r = r0; r <= r1; r++) {
          for (let c = c0; c <= c1; c++) {
            const v = rangeValue(grid, r, c, visiting);
            if (v != null) values.push(v);
          }
        }
      } else {
        values.push(parseExpr());
      }
      if (isOp(",")) {
        pos++;
        continue;
      }
      return values;
    }
  }

  function applyFunction(
    name: (typeof AUX_FUNCTIONS)[number],
    values: number[],
  ): number {
    switch (name) {
      case "SUM":
        return values.reduce((s, v) => s + v, 0);
      case "AVERAGE":
        if (values.length === 0) throw new AuxFormulaError("#DIV/0!");
        return values.reduce((s, v) => s + v, 0) / values.length;
      case "MIN":
        return values.length === 0 ? 0 : Math.min(...values);
      case "MAX":
        return values.length === 0 ? 0 : Math.max(...values);
      case "COUNT":
        return values.length;
    }
  }

  const result = parseExpr();
  if (pos !== tokens.length) throw new AuxFormulaError("#ERROR!");
  return result;
}

// Evalúa la fórmula de una celda (raw arranca con "="). `self` son las
// coordenadas de la celda dentro de la GRILLA (0-based), para detectar
// auto-referencias. Nunca tira: devuelve {ok:false, error:"#…!"} ante
// cualquier problema.
export function evalAuxFormula(
  raw: string,
  grid: AuxSheetGrid,
  self?: { r: number; c: number },
): AuxFormulaResult {
  try {
    const src = raw.trimStart().slice(1);
    if (!src.trim()) return { ok: false, error: "#ERROR!" };
    // Una ref que quedó colgada de un insert/delete se serializa como "#REF!".
    if (src.includes("#REF!")) return { ok: false, error: "#REF!" };
    const visiting = new Set<string>();
    if (self) visiting.add(`${self.r}:${self.c}`);
    const value = evalTokens(tokenize(src), grid, visiting);
    if (!Number.isFinite(value)) return { ok: false, error: "#DIV/0!" };
    return { ok: true, value };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof AuxFormulaError ? e.message : "#ERROR!",
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Insertar / eliminar filas y columnas (estilo Excel)
// ════════════════════════════════════════════════════════════════════════════
// Operaciones PURAS sobre {grid, merges}: corren la data, mueven/encogen las
// uniones y —como hace Excel— reescriben TODAS las referencias de las fórmulas
// para que sigan apuntando a las mismas celdas. Las usa el editor (con su
// undo/redo + autosave); el export no las necesita (lee el estado ya resuelto).

// Parsea un token de referencia A1 ("$A$5", "A5", …). Solo una letra (cap A–Z);
// multi-letra → null (se deja la ref tal cual). gridRow es 0-based (descuenta
// AUX_SHEET_GRID_ROW_OFFSET, la numeración visible).
function parseAuxRef(
  token: string,
): { dCol: string; col: number; dRow: string; gridRow: number } | null {
  const m = /^(\$?)([A-Za-z]+)(\$?)(\d+)$/.exec(token);
  if (!m || m[2].length !== 1) return null;
  return {
    dCol: m[1],
    col: m[2].toUpperCase().charCodeAt(0) - 65,
    dRow: m[3],
    gridRow: Number.parseInt(m[4], 10) - AUX_SHEET_GRID_ROW_OFFSET,
  };
}

// Reconstruye una ref; fuera del rango válido (col fuera de A–Z, fila negativa)
// devuelve "#REF!" como hace Excel.
function buildAuxRef(
  dCol: string,
  col: number,
  dRow: string,
  gridRow: number,
): string {
  if (col < 0 || col >= AUX_SHEET_MAX_COLS || gridRow < 0) return "#REF!";
  return `${dCol}${String.fromCharCode(65 + col)}${dRow}${gridRow + AUX_SHEET_GRID_ROW_OFFSET}`;
}

// Reescribe cada referencia A1 de una fórmula cruda mapeando sus coords de
// GRILLA (0-based). `mapRow`/`mapCol` devuelven la nueva coord o null (→ #REF!).
// Útil para transformaciones por-ref simples; las ops de fila/columna usan la
// variante con conciencia de rangos (shiftAuxFormula). Nuestro lenguaje no
// tiene strings literales, así que un replace por regex es seguro: los nombres
// de función (SUM, …) no llevan dígitos y no matchean.
export function rewriteAuxFormulaRefs(
  raw: string,
  mapRow: (gridRow: number) => number | null,
  mapCol: (col: number) => number | null,
): string {
  return raw.replace(/\$?[A-Za-z]+\$?\d+/g, (token) => {
    const p = parseAuxRef(token);
    if (!p) return token;
    const nc = mapCol(p.col);
    const nr = mapRow(p.gridRow);
    if (nc == null || nr == null) return "#REF!";
    return buildAuxRef(p.dCol, nc, p.dRow, nr);
  });
}

// Una operación de línea: insertar/eliminar una fila o columna en el índice
// `at` (coord de GRILLA, 0-based).
type AuxLineOp = { axis: "row" | "col"; mode: "insert" | "delete"; at: number };

// Mapea una coord SUELTA del eje afectado. Borrar la línea exacta que la ref
// apunta → null (#REF!), igual que Excel con una celda referenciada borrada.
function mapAuxCoord(coord: number, op: AuxLineOp): number | null {
  if (op.mode === "insert") return coord >= op.at ? coord + 1 : coord;
  if (coord === op.at) return null;
  return coord > op.at ? coord - 1 : coord;
}

// Mapea el SPAN [lo..hi] de un rango sobre el eje afectado. Insertar adentro lo
// agranda; borrar adentro lo encoge (reusa shrinkSpan). null = el rango entero
// era la línea borrada (#REF!).
function mapAuxSpan(lo: number, hi: number, op: AuxLineOp): [number, number] | null {
  if (op.mode === "insert") {
    return [lo >= op.at ? lo + 1 : lo, hi >= op.at ? hi + 1 : hi];
  }
  return shrinkSpan(lo, hi, op.at);
}

const AUX_REF_SRC = "\\$?[A-Za-z]+\\$?\\d+";
const AUX_REF_OR_RANGE = new RegExp(
  `(${AUX_REF_SRC}):(${AUX_REF_SRC})|(${AUX_REF_SRC})`,
  "g",
);

// Reescribe una fórmula para una op de fila/columna, con conciencia de rangos:
// un rango (A5:A10) se encoge/agranda como una unidad (como en Excel), una ref
// suelta a la línea borrada queda #REF!. El eje NO afectado no se toca.
function shiftAuxFormula(raw: string, op: AuxLineOp): string {
  return raw.replace(
    AUX_REF_OR_RANGE,
    (whole, aTok: string, bTok: string, single: string | undefined) => {
      if (single !== undefined) {
        const p = parseAuxRef(single);
        if (!p) return whole;
        if (op.axis === "row") {
          const nr = mapAuxCoord(p.gridRow, op);
          return nr == null ? "#REF!" : buildAuxRef(p.dCol, p.col, p.dRow, nr);
        }
        const nc = mapAuxCoord(p.col, op);
        return nc == null ? "#REF!" : buildAuxRef(p.dCol, nc, p.dRow, p.gridRow);
      }
      const pa = parseAuxRef(aTok);
      const pb = parseAuxRef(bTok);
      if (!pa || !pb) return whole;
      if (op.axis === "row") {
        const span = mapAuxSpan(
          Math.min(pa.gridRow, pb.gridRow),
          Math.max(pa.gridRow, pb.gridRow),
          op,
        );
        if (!span) return "#REF!";
        const [aRow, bRow] = pa.gridRow <= pb.gridRow ? span : [span[1], span[0]];
        return `${buildAuxRef(pa.dCol, pa.col, pa.dRow, aRow)}:${buildAuxRef(pb.dCol, pb.col, pb.dRow, bRow)}`;
      }
      const span = mapAuxSpan(
        Math.min(pa.col, pb.col),
        Math.max(pa.col, pb.col),
        op,
      );
      if (!span) return "#REF!";
      const [aCol, bCol] = pa.col <= pb.col ? span : [span[1], span[0]];
      return `${buildAuxRef(pa.dCol, aCol, pa.dRow, pa.gridRow)}:${buildAuxRef(pb.dCol, bCol, pb.dRow, pb.gridRow)}`;
    },
  );
}

function remapAuxFormulas(grid: AuxSheetGrid, op: AuxLineOp): AuxSheetGrid {
  return grid.map((row) =>
    row.map((cell) => (isAuxFormula(cell) ? shiftAuxFormula(cell, op) : cell)),
  );
}

export type AuxStructural = { grid: AuxSheetGrid; merges: AuxMerge[] };

// Inserta una fila en blanco en el índice `at` (0-based): lo que estaba en `at`
// baja una posición. Una unión que la fila atraviesa se estira; las de abajo
// bajan. Insertar nunca rompe fórmulas (sólo corre refs hacia abajo).
export function insertAuxRow(
  grid: AuxSheetGrid,
  merges: AuxMerge[],
  at: number,
): AuxStructural {
  const cols = Math.max(0, ...grid.map((r) => r.length));
  const remapped = remapAuxFormulas(grid, { axis: "row", mode: "insert", at });
  const blank = Array<string>(cols).fill("");
  const nextGrid = [...remapped.slice(0, at), blank, ...remapped.slice(at)];
  const nextMerges = merges.map((m) => ({
    r0: m.r0 >= at ? m.r0 + 1 : m.r0,
    r1: m.r1 >= at ? m.r1 + 1 : m.r1,
    c0: m.c0,
    c1: m.c1,
  }));
  return { grid: nextGrid, merges: nextMerges };
}

// Inserta una columna en blanco en el índice `at` (0-based).
export function insertAuxCol(
  grid: AuxSheetGrid,
  merges: AuxMerge[],
  at: number,
): AuxStructural {
  const remapped = remapAuxFormulas(grid, { axis: "col", mode: "insert", at });
  const nextGrid = remapped.map((row) => {
    const r = [...row];
    r.splice(at, 0, "");
    return r;
  });
  const nextMerges = merges.map((m) => ({
    r0: m.r0,
    r1: m.r1,
    c0: m.c0 >= at ? m.c0 + 1 : m.c0,
    c1: m.c1 >= at ? m.c1 + 1 : m.c1,
  }));
  return { grid: nextGrid, merges: nextMerges };
}

// Encoge una unión [a..b] de un eje tras borrar la línea `at`. Devuelve el nuevo
// par [a',b'] o null si la unión desaparece (era sólo la línea borrada).
function shrinkSpan(
  a: number,
  b: number,
  at: number,
): [number, number] | null {
  const top = a === at ? a + 1 : a;
  const bot = b === at ? b - 1 : b;
  if (top > bot) return null; // la unión era exactamente la línea borrada
  return [top > at ? top - 1 : top, bot > at ? bot - 1 : bot];
}

// Elimina la fila `at`. Como en Excel: los rangos (SUM A5:A10) se encogen, y
// una ref suelta a la fila borrada queda #REF!. No borra la última fila.
export function deleteAuxRow(
  grid: AuxSheetGrid,
  merges: AuxMerge[],
  at: number,
): AuxStructural {
  if (grid.length <= 1) return { grid, merges };
  const remapped = remapAuxFormulas(grid, { axis: "row", mode: "delete", at });
  const nextGrid = [...remapped.slice(0, at), ...remapped.slice(at + 1)];
  const nextMerges: AuxMerge[] = [];
  for (const m of merges) {
    const span = shrinkSpan(m.r0, m.r1, at);
    if (!span) continue;
    const cand = { r0: span[0], c0: m.c0, r1: span[1], c1: m.c1 };
    if (cand.r0 === cand.r1 && cand.c0 === cand.c1) continue; // ya no es unión
    nextMerges.push(cand);
  }
  return { grid: nextGrid, merges: nextMerges };
}

// Elimina la columna `at` (misma semántica que deleteAuxRow). No borra la última.
export function deleteAuxCol(
  grid: AuxSheetGrid,
  merges: AuxMerge[],
  at: number,
): AuxStructural {
  const cols = Math.max(0, ...grid.map((r) => r.length));
  if (cols <= 1) return { grid, merges };
  const remapped = remapAuxFormulas(grid, { axis: "col", mode: "delete", at });
  const nextGrid = remapped.map((row) => {
    const r = [...row];
    if (at < r.length) r.splice(at, 1);
    return r;
  });
  const nextMerges: AuxMerge[] = [];
  for (const m of merges) {
    const span = shrinkSpan(m.c0, m.c1, at);
    if (!span) continue;
    const cand = { r0: m.r0, c0: span[0], r1: m.r1, c1: span[1] };
    if (cand.r0 === cand.r1 && cand.c0 === cand.c1) continue;
    nextMerges.push(cand);
  }
  return { grid: nextGrid, merges: nextMerges };
}
