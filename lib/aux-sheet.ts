// ════════════════════════════════════════════════════════════════════════════
// Sheet auxiliar del plan — constantes y helpers PUROS compartidos entre el
// editor (client), las server actions (app/actions/aux-sheets.ts) y el export
// Excel (app/api/plans/[planId]/export.xlsx). La grilla es un string[][]
// (filas × celdas) que se guarda tal cual en media_plan_aux_sheets.grid_json.
// ════════════════════════════════════════════════════════════════════════════

export const AUX_SHEET_DEFAULT_NAME = "Auxiliar";

// Dimensiones con las que nace la grilla (y mínimo que muestra el editor).
export const AUX_SHEET_DEFAULT_ROWS = 15;
export const AUX_SHEET_DEFAULT_COLS = 8;

// Techos duros — validados en la server action además de la UI.
export const AUX_SHEET_MAX_ROWS = 200;
export const AUX_SHEET_MAX_COLS = 26; // A–Z
export const AUX_SHEET_MAX_CELL_LEN = 1000;

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
