"use client";

// Tabs auxiliares del plan: grillas libres tipo Excel (N por plan) que salen
// como tabs extra del export Excel, después del "Budget por mercado". Cada tab
// muestra arriba la misma metadata que el tab exportado (proyecto, período,
// budget origin, read-only) y debajo la grilla editable.
//
// Capacidades estilo Excel:
//  • Selección de rango con mouse (arrastrar / Shift+click) y teclado
//    (flechas / Shift+flechas / Ctrl+A).
//  • Copiar / cortar / pegar / borrar rangos (Ctrl+C/X/V, Supr) en formato TSV
//    → se puede pegar desde Excel/Sheets y viceversa.
//  • Combinar / separar celdas (la unión vive en media_plan_aux_sheets.merges_
//    json; el valor queda en la celda top-left y se exporta con ws.mergeCells).
//  • Fórmulas: una celda que empieza con "=" es fórmula (refs A1 + SUM/AVERAGE/
//    MIN/MAX/COUNT). El editor muestra el resultado y la fórmula cruda al
//    editar; el export las escribe como fórmulas reales de Excel.
//
// La grilla y las uniones viven en estado local (nada más en la página las
// consume), así que los commits guardan sin router.refresh.

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Plus, Sheet, Trash2 } from "lucide-react";
import {
  createAuxSheet,
  deleteAuxSheet,
  updateAuxSheet,
} from "@/app/actions/aux-sheets";
import { Button } from "@/components/button";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-dialog";
import type { PlanAuxSheet, PlanDetail } from "@/db/queries/project-detail";
import {
  AUX_SHEET_GRID_ROW_OFFSET,
  AUX_SHEET_MAX_CELL_LEN,
  AUX_SHEET_MAX_COLS,
  AUX_SHEET_MAX_ROWS,
  type AuxMerge,
  type AuxStructural,
  auxColLetter,
  deleteAuxCol,
  deleteAuxRow,
  evalAuxFormula,
  findMerge,
  insertAuxCol,
  insertAuxRow,
  isAuxFormula,
  normalizeAuxGrid,
  rectsIntersect,
  sanitizeMerges,
} from "@/lib/aux-sheet";
import { formatDate, t, type Language } from "@/lib/i18n";
import { placementsPeriod } from "@/lib/plan-metrics";

export function AuxSheetSection({
  detail,
  editable,
  lang,
}: {
  detail: PlanDetail;
  editable: boolean;
  lang: Language;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  const onCreate = () => {
    startTransition(async () => {
      const r = await createAuxSheet({ planId: detail.plan.id });
      if (!r.ok) toast.error(r.error);
      else
        toast.success(
          lang === "es" ? "Tab auxiliar creado" : "Auxiliary tab created",
        );
      router.refresh();
    });
  };

  if (detail.auxSheets.length === 0 && !editable) return null;

  return (
    <>
      {detail.auxSheets.map((sheet) => (
        // key por id: si se borra y se vuelve a crear, el editor rearranca limpio.
        <AuxSheetEditor
          key={sheet.id}
          sheet={sheet}
          detail={detail}
          editable={editable}
          lang={lang}
        />
      ))}
      {editable && (
        <section className="rounded-lg border border-dashed border-line px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Tabs auxiliares</p>
            <p className="text-xs text-muted mt-0.5">
              Grillas libres tipo Excel que se agregan al Excel como tabs.
              Soportan copiar/pegar, combinar celdas y fórmulas:{" "}
              <code>=B5*2</code>, <code>=SUM(A5:A10)</code>.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={onCreate} disabled={pending}>
            <Plus size={14} strokeWidth={2} />
            Crear tab auxiliar
          </Button>
        </section>
      )}
    </>
  );
}

type Sel = { ar: number; ac: number; fr: number; fc: number };
type Rect = { r0: number; c0: number; r1: number; c1: number };
type AuxSnapshot = { grid: string[][]; merges: AuxMerge[] };

// Pasos de deshacer/rehacer que se guardan por tab.
const HISTORY_MAX = 50;

const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));

const normSel = (s: Sel): Rect => ({
  r0: Math.min(s.ar, s.fr),
  r1: Math.max(s.ar, s.fr),
  c0: Math.min(s.ac, s.fc),
  c1: Math.max(s.ac, s.fc),
});

// Expande un rect hasta cubrir cualquier unión que toque (Excel selecciona la
// unión entera). Itera hasta estabilizar (una unión puede arrastrar a otra).
const expandRectToMerges = (rect: Rect, merges: AuxMerge[]): Rect => {
  let { r0, c0, r1, c1 } = rect;
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of merges) {
      if (m.r0 <= r1 && m.r1 >= r0 && m.c0 <= c1 && m.c1 >= c0) {
        if (m.r0 < r0) { r0 = m.r0; changed = true; }
        if (m.r1 > r1) { r1 = m.r1; changed = true; }
        if (m.c0 < c0) { c0 = m.c0; changed = true; }
        if (m.c1 > c1) { c1 = m.c1; changed = true; }
      }
    }
  }
  return { r0, c0, r1, c1 };
};

// Recorta una selección a las dimensiones de una grilla (tras deshacer/rehacer,
// la grilla puede haber encogido).
const clampSel = (s: Sel, g: string[][]): Sel => {
  const R = Math.max(0, g.length - 1);
  const C = Math.max(0, (g[0]?.length ?? 1) - 1);
  return {
    ar: clamp(s.ar, 0, R),
    ac: clamp(s.ac, 0, C),
    fr: clamp(s.fr, 0, R),
    fc: clamp(s.fc, 0, C),
  };
};

function AuxSheetEditor({
  sheet,
  detail,
  editable,
  lang,
}: {
  sheet: PlanAuxSheet;
  detail: PlanDetail;
  editable: boolean;
  lang: Language;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(true);

  // Última grilla/uniones commiteadas (valores crudos, fórmulas incluidas).
  const [grid, setGrid] = useState<string[][]>(() => normalizeAuxGrid(sheet.grid));
  const [merges, setMerges] = useState<AuxMerge[]>(() =>
    sanitizeMerges(sheet.merges, normalizeAuxGrid(sheet.grid)),
  );
  // Celda en edición (muestra el valor crudo mientras tiene foco).
  const [editing, setEditing] = useState<{ r: number; c: number; draft: string } | null>(
    null,
  );
  // Selección: ancla (anchor) + foco (focus). El rect normalizado se deriva.
  const [sel, setSel] = useState<Sel>({ ar: 0, ac: 0, fr: 0, fc: 0 });
  // Historial deshacer/rehacer (Ctrl+Z / Ctrl+Shift+Z): cada mutación apila el
  // estado previo {grid, merges}; una edición nueva limpia el redo.
  const [undoStack, setUndoStack] = useState<AuxSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<AuxSnapshot[]>([]);
  // Menú contextual (click derecho en el N° de fila / letra de columna) para
  // insertar/eliminar filas y columnas en cualquier posición, estilo Excel.
  const [menu, setMenu] = useState<
    { x: number; y: number; kind: "row" | "col"; index: number } | null
  >(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const skipBlurRef = useRef(false);
  const editingRef = useRef<typeof editing>(null);
  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);

  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;

  // Soltar el arrastre en cualquier lado.
  useEffect(() => {
    const up = () => {
      draggingRef.current = false;
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  // Cerrar el menú contextual al clickear afuera, scrollear o apretar Escape.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  // Valores de display: fórmulas evaluadas (o su código de error), el resto
  // tal cual. Las uniones no cambian el cálculo (las celdas tapadas van vacías).
  const display = useMemo(
    () =>
      grid.map((row, r) =>
        row.map((cell, c) => {
          if (!isAuxFormula(cell)) return cell;
          const res = evalAuxFormula(cell, grid, { r, c });
          return res.ok ? fmtNumber(res.value) : res.error;
        }),
      ),
    [grid],
  );

  const selRect = useMemo(
    () => expandRectToMerges(normSel(sel), merges),
    [sel, merges],
  );
  const activeMerge = findMerge(merges, sel.fr, sel.fc);
  const active = activeMerge
    ? { r: activeMerge.r0, c: activeMerge.c0 }
    : { r: clamp(sel.fr, 0, rows - 1), c: clamp(sel.fc, 0, cols - 1) };

  const focusContainer = () =>
    requestAnimationFrame(() => containerRef.current?.focus());

  const save = (payload: { grid?: string[][]; merges?: AuxMerge[] }) => {
    startTransition(async () => {
      const r = await updateAuxSheet({ sheetId: sheet.id, ...payload });
      if (!r.ok) toast.error(r.error);
    });
  };

  // Apila el estado actual para poder deshacerlo; limpia el redo (rama nueva).
  const pushHistory = () => {
    setUndoStack((s) => [...s, { grid, merges }].slice(-HISTORY_MAX));
    setRedoStack([]);
  };

  const writeCell = (r: number, c: number, value: string) => {
    if (grid[r]?.[c] === value) return;
    pushHistory();
    const next = grid.map((row, ri) =>
      ri === r ? row.map((cell, ci) => (ci === c ? value : cell)) : row,
    );
    setGrid(next);
    save({ grid: next });
  };

  const commitCell = (r: number, c: number, value: string) => {
    setEditing(null);
    writeCell(r, c, value);
  };

  const beginEdit = (initial?: string) => {
    if (!editable) return;
    const { r, c } = active;
    setEditing({ r, c, draft: initial ?? (grid[r]?.[c] ?? "") });
  };

  // Tras editar: commit + mover el foco (Enter baja, Tab a la derecha, etc.).
  const commitAndMove = (value: string, dr: number, dc: number) => {
    const { r, c } = active;
    skipBlurRef.current = true;
    writeCell(r, c, value);
    setEditing(null);
    const m = findMerge(merges, r, c);
    const pr = dr > 0 ? (m ? m.r1 : r) : m ? m.r0 : r;
    const pc = dc > 0 ? (m ? m.c1 : c) : m ? m.c0 : c;
    let nr = clamp(pr + dr, 0, rows - 1);
    let nc = clamp(pc + dc, 0, cols - 1);
    const tm = findMerge(merges, nr, nc);
    if (tm) {
      nr = tm.r0;
      nc = tm.c0;
    }
    setSel({ ar: nr, ac: nc, fr: nr, fc: nc });
    focusContainer();
  };

  // Mover la celda activa en modo selección (sin editar).
  const moveActive = (dr: number, dc: number, extend: boolean) => {
    const m = findMerge(merges, sel.fr, sel.fc);
    const pr = dr > 0 ? (m ? m.r1 : sel.fr) : m ? m.r0 : sel.fr;
    const pc = dc > 0 ? (m ? m.c1 : sel.fc) : m ? m.c0 : sel.fc;
    let nr = clamp(pr + dr, 0, rows - 1);
    let nc = clamp(pc + dc, 0, cols - 1);
    const tm = findMerge(merges, nr, nc);
    if (tm) {
      nr = tm.r0;
      nc = tm.c0;
    }
    setSel((s) => (extend ? { ...s, fr: nr, fc: nc } : { ar: nr, ac: nc, fr: nr, fc: nc }));
  };

  const selectAll = () =>
    setSel({ ar: 0, ac: 0, fr: rows - 1, fc: cols - 1 });

  const clearSelection = () => {
    if (!editable) return;
    const { r0, c0, r1, c1 } = selRect;
    let changed = false;
    const next = grid.map((row, r) =>
      row.map((cell, c) => {
        if (r >= r0 && r <= r1 && c >= c0 && c <= c1 && cell !== "") {
          changed = true;
          return "";
        }
        return cell;
      }),
    );
    if (changed) {
      pushHistory();
      setGrid(next);
      save({ grid: next });
    }
  };

  // ─── Portapapeles (TSV) ───────────────────────────────────────────────────
  const selectionTSV = () => {
    const { r0, c0, r1, c1 } = selRect;
    const lines: string[] = [];
    for (let r = r0; r <= r1; r++) {
      const cells: string[] = [];
      for (let c = c0; c <= c1; c++) {
        const m = findMerge(merges, r, c);
        const isMaster = !m || (m.r0 === r && m.c0 === c);
        cells.push(isMaster ? grid[r]?.[c] ?? "" : "");
      }
      lines.push(cells.join("\t"));
    }
    return lines.join("\n");
  };

  const copySelection = async () => {
    try {
      await navigator.clipboard.writeText(selectionTSV());
    } catch {
      toast.error("No se pudo copiar al portapapeles");
    }
    focusContainer();
  };

  const cutSelection = async () => {
    if (!editable) return;
    try {
      await navigator.clipboard.writeText(selectionTSV());
    } catch {
      toast.error("No se pudo copiar al portapapeles");
    }
    clearSelection();
    focusContainer();
  };

  // Escribe una matriz desde (r0,c0), agrandando la grilla hasta los topes y
  // soltando las uniones que el bloque pegado pisa.
  const writeMatrixAt = (r0: number, c0: number, matrix: string[][]) => {
    const h = matrix.length;
    const w = Math.max(1, ...matrix.map((m) => m.length));
    const needRows = Math.min(AUX_SHEET_MAX_ROWS, Math.max(rows, r0 + h));
    const needCols = Math.min(AUX_SHEET_MAX_COLS, Math.max(cols, c0 + w));
    const next = Array.from({ length: needRows }, (_, r) =>
      Array.from({ length: needCols }, (_, c) => grid[r]?.[c] ?? ""),
    );
    for (let i = 0; i < h; i++) {
      if (r0 + i >= needRows) break;
      for (let j = 0; j < matrix[i].length; j++) {
        if (c0 + j >= needCols) break;
        next[r0 + i][c0 + j] = matrix[i][j].slice(0, AUX_SHEET_MAX_CELL_LEN);
      }
    }
    const written: Rect = {
      r0,
      c0,
      r1: Math.min(needRows - 1, r0 + h - 1),
      c1: Math.min(needCols - 1, c0 + w - 1),
    };
    const keptMerges = merges.filter((m) => !rectsIntersect(m, written));
    const mergesChanged = keptMerges.length !== merges.length;
    pushHistory();
    setGrid(next);
    if (mergesChanged) setMerges(keptMerges);
    setSel({ ar: written.r0, ac: written.c0, fr: written.r1, fc: written.c1 });
    save(mergesChanged ? { grid: next, merges: keptMerges } : { grid: next });
  };

  const pasteSelection = async () => {
    if (!editable) return;
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      toast.error("No se pudo leer el portapapeles");
      return;
    }
    if (!text) return;
    const linesArr = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    if (linesArr.length > 1 && linesArr[linesArr.length - 1] === "") linesArr.pop();
    let matrix = linesArr.map((line) => line.split("\t"));
    // 1×1 → rellena toda la selección con ese valor (como Excel).
    if (
      matrix.length === 1 &&
      matrix[0].length === 1 &&
      (selRect.r0 !== selRect.r1 || selRect.c0 !== selRect.c1)
    ) {
      const v = matrix[0][0];
      const h = selRect.r1 - selRect.r0 + 1;
      const w = selRect.c1 - selRect.c0 + 1;
      matrix = Array.from({ length: h }, () => Array.from({ length: w }, () => v));
    }
    writeMatrixAt(selRect.r0, selRect.c0, matrix);
    focusContainer();
  };

  // ─── Combinar / separar ───────────────────────────────────────────────────
  const canMerge =
    editable && (selRect.r0 !== selRect.r1 || selRect.c0 !== selRect.c1);
  const canUnmerge = editable && merges.some((m) => rectsIntersect(m, selRect));

  const doMerge = () => {
    if (!canMerge) return;
    const rect = selRect;
    const kept = merges.filter((m) => !rectsIntersect(m, rect));
    kept.push({ r0: rect.r0, c0: rect.c0, r1: rect.r1, c1: rect.c1 });
    // Consolidar: solo sobrevive el valor del top-left; el resto se limpia.
    const next = grid.map((row, r) =>
      row.map((cell, c) =>
        r >= rect.r0 &&
        r <= rect.r1 &&
        c >= rect.c0 &&
        c <= rect.c1 &&
        !(r === rect.r0 && c === rect.c0)
          ? ""
          : cell,
      ),
    );
    pushHistory();
    setGrid(next);
    setMerges(kept);
    setSel({ ar: rect.r0, ac: rect.c0, fr: rect.r0, fc: rect.c0 });
    save({ grid: next, merges: kept });
    focusContainer();
  };

  const doUnmerge = () => {
    if (!canUnmerge) return;
    const kept = merges.filter((m) => !rectsIntersect(m, selRect));
    pushHistory();
    setMerges(kept);
    save({ merges: kept });
    focusContainer();
  };

  const addRow = () => {
    if (rows >= AUX_SHEET_MAX_ROWS) return;
    pushHistory();
    const next = [...grid, Array<string>(cols).fill("")];
    setGrid(next);
    save({ grid: next });
  };

  const addCol = () => {
    if (cols >= AUX_SHEET_MAX_COLS) return;
    pushHistory();
    const next = grid.map((row) => [...row, ""]);
    setGrid(next);
    save({ grid: next });
  };

  // ─── Insertar / eliminar filas y columnas en cualquier posición ───────────
  // Las ops puras (lib/aux-sheet) corren la data, ajustan las uniones y
  // reescriben las referencias de las fórmulas; acá las envolvemos con el
  // historial, el autosave y la nueva selección.
  const applyStructural = (next: AuxStructural, nextSel: Sel) => {
    pushHistory();
    setEditing(null);
    const safeMerges = sanitizeMerges(next.merges, next.grid);
    setGrid(next.grid);
    setMerges(safeMerges);
    setSel(clampSel(nextSel, next.grid));
    save({ grid: next.grid, merges: safeMerges });
    focusContainer();
  };

  const insertRowAt = (at: number) => {
    if (!editable || rows >= AUX_SHEET_MAX_ROWS) return;
    applyStructural(insertAuxRow(grid, merges, at), {
      ar: at,
      ac: 0,
      fr: at,
      fc: cols - 1,
    });
  };

  const deleteRowAt = (at: number) => {
    if (!editable || rows <= 1) return;
    const next = deleteAuxRow(grid, merges, at);
    const nr = clamp(at, 0, next.grid.length - 1);
    applyStructural(next, { ar: nr, ac: 0, fr: nr, fc: cols - 1 });
  };

  const insertColAt = (at: number) => {
    if (!editable || cols >= AUX_SHEET_MAX_COLS) return;
    applyStructural(insertAuxCol(grid, merges, at), {
      ar: 0,
      ac: at,
      fr: rows - 1,
      fc: at,
    });
  };

  const deleteColAt = (at: number) => {
    if (!editable || cols <= 1) return;
    const next = deleteAuxCol(grid, merges, at);
    const nc = clamp(at, 0, (next.grid[0]?.length ?? 1) - 1);
    applyStructural(next, { ar: 0, ac: nc, fr: rows - 1, fc: nc });
  };

  // Click derecho en una cabecera (N° de fila o letra de columna): selecciona
  // la línea entera y abre el menú contextual.
  const openRowMenu = (e: React.MouseEvent, r: number) => {
    if (!editable) return;
    e.preventDefault();
    setSel({ ar: r, ac: 0, fr: r, fc: Math.max(0, cols - 1) });
    setMenu({ x: e.clientX, y: e.clientY, kind: "row", index: r });
  };

  const openColMenu = (e: React.MouseEvent, c: number) => {
    if (!editable) return;
    e.preventDefault();
    setSel({ ar: 0, ac: c, fr: Math.max(0, rows - 1), fc: c });
    setMenu({ x: e.clientX, y: e.clientY, kind: "col", index: c });
  };

  const undo = () => {
    if (!editable || undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack((s) => s.slice(0, -1));
    setRedoStack((r) => [...r, { grid, merges }].slice(-HISTORY_MAX));
    setEditing(null);
    setGrid(prev.grid);
    setMerges(prev.merges);
    setSel((s) => clampSel(s, prev.grid));
    save({ grid: prev.grid, merges: prev.merges });
    focusContainer();
  };

  const redo = () => {
    if (!editable || redoStack.length === 0) return;
    const snap = redoStack[redoStack.length - 1];
    setRedoStack((r) => r.slice(0, -1));
    setUndoStack((s) => [...s, { grid, merges }].slice(-HISTORY_MAX));
    setEditing(null);
    setGrid(snap.grid);
    setMerges(snap.merges);
    setSel((s) => clampSel(s, snap.grid));
    save({ grid: snap.grid, merges: snap.merges });
    focusContainer();
  };

  const onRename = (value: string) => {
    const v = value.trim();
    if (!v || v === sheet.name) return;
    startTransition(async () => {
      const r = await updateAuxSheet({ sheetId: sheet.id, name: v });
      if (!r.ok) toast.error(r.error);
      router.refresh();
    });
  };

  const onDelete = async () => {
    if (
      !(await confirm({
        title: `¿Eliminar el tab auxiliar "${sheet.name}"?`,
        body: "Se pierde todo el contenido de la grilla y el tab deja de salir en el Excel. Esta acción no se puede deshacer.",
        confirmLabel: "Eliminar",
        danger: true,
      }))
    )
      return;
    startTransition(async () => {
      const r = await deleteAuxSheet({ sheetId: sheet.id });
      if (!r.ok) toast.error(r.error);
      else toast.success("Tab auxiliar eliminado");
      router.refresh();
    });
  };

  // ─── Teclado de la grilla (modo selección) ────────────────────────────────
  const onGridKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (editing) return; // el input maneja sus teclas
    const k = e.key;
    const mod = e.ctrlKey || e.metaKey;
    if (mod) {
      if (k === "c" || k === "C") {
        e.preventDefault();
        void copySelection();
      } else if (k === "x" || k === "X") {
        e.preventDefault();
        void cutSelection();
      } else if (k === "v" || k === "V") {
        e.preventDefault();
        void pasteSelection();
      } else if (k === "z" || k === "Z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (k === "y" || k === "Y") {
        e.preventDefault();
        redo();
      } else if (k === "a" || k === "A") {
        e.preventDefault();
        selectAll();
      }
      return;
    }
    switch (k) {
      case "ArrowUp":
        e.preventDefault();
        moveActive(-1, 0, e.shiftKey);
        return;
      case "ArrowDown":
        e.preventDefault();
        moveActive(1, 0, e.shiftKey);
        return;
      case "ArrowLeft":
        e.preventDefault();
        moveActive(0, -1, e.shiftKey);
        return;
      case "ArrowRight":
        e.preventDefault();
        moveActive(0, 1, e.shiftKey);
        return;
      case "Tab":
        e.preventDefault();
        moveActive(0, e.shiftKey ? -1 : 1, false);
        return;
      case "Enter":
      case "F2":
        e.preventDefault();
        beginEdit();
        return;
      case "Backspace":
      case "Delete":
        e.preventDefault();
        clearSelection();
        return;
      case "Escape":
        return;
    }
    if (!e.altKey && k.length === 1) {
      e.preventDefault();
      beginEdit(k);
    }
  };

  const onCellMouseDown = (e: React.MouseEvent, r: number, c: number) => {
    if (e.button !== 0) return;
    e.preventDefault(); // evita selección de texto + conserva el foco del grid
    const ed = editingRef.current;
    if (ed) {
      writeCell(ed.r, ed.c, ed.draft);
      setEditing(null);
    }
    containerRef.current?.focus();
    if (e.shiftKey) setSel((s) => ({ ...s, fr: r, fc: c }));
    else setSel({ ar: r, ac: c, fr: r, fc: c });
    draggingRef.current = true;
  };

  const onCellMouseEnter = (r: number, c: number) => {
    if (draggingRef.current) setSel((s) => ({ ...s, fr: r, fc: c }));
  };

  const onCellDoubleClick = (r: number, c: number) => {
    if (!editable) return;
    const m = findMerge(merges, r, c);
    const mr = m ? m.r0 : r;
    const mc = m ? m.c0 : c;
    setSel({ ar: mr, ac: mc, fr: mr, fc: mc });
    setEditing({ r: mr, c: mc, draft: grid[mr]?.[mc] ?? "" });
  };

  // Misma metadata que encabeza el tab en el Excel (read-only acá).
  const allPlacements = detail.publishers.flatMap((g) => g.placements);
  const period = placementsPeriod(allPlacements);
  const periodFormatted =
    period.start && period.end
      ? `${formatDate(period.start, lang)} → ${formatDate(period.end, lang)}`
      : "—";
  const infoRows: [string, string][] = [
    [t("common.project", lang), `${detail.project.code} — ${detail.project.name}`],
    [t("common.period", lang), periodFormatted],
    [t("common.budgetOrigin", lang), detail.budgetOrigin.name],
  ];

  return (
    <section className="rounded-lg border border-line bg-white dark:bg-paper-2 overflow-hidden">
      <div
        className="flex items-center gap-2 px-4 py-2.5 cursor-pointer hover:bg-paper-2/40"
        onClick={() => setOpen((o) => !o)}
      >
        <Sheet size={14} className="text-accent shrink-0" />
        {editable ? (
          <input
            type="text"
            defaultValue={sheet.name}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => onRename(e.target.value)}
            className="text-sm font-semibold bg-transparent border-b border-transparent hover:border-line focus:border-accent focus:outline-none px-1 -mx-1"
            title="Nombre del tab en el Excel"
          />
        ) : (
          <span className="text-sm font-semibold">{sheet.name}</span>
        )}
        <span className="text-xs text-muted flex-1">
          {lang === "es"
            ? "Tab auxiliar · sale en el Excel después del Budget split"
            : "Auxiliary tab · exported to Excel after the Budget split"}
        </span>
        <ChevronDown
          size={16}
          className={`text-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
      </div>

      {open && (
        <>
          <div
            ref={containerRef}
            tabIndex={0}
            onKeyDown={onGridKeyDown}
            className="overflow-x-auto border-t border-line-soft outline-none focus:bg-accent-soft/5"
          >
            <table className="text-xs border-collapse select-none">
              <thead>
                <tr>
                  <th className="w-9 bg-paper border border-line-soft" />
                  {Array.from({ length: cols }, (_, c) => {
                    const colSel = c >= selRect.c0 && c <= selRect.c1;
                    return (
                      <th
                        key={c}
                        onMouseDown={(e) => {
                          if (e.button !== 0) return;
                          containerRef.current?.focus();
                          setSel({ ar: 0, ac: c, fr: Math.max(0, rows - 1), fc: c });
                        }}
                        onContextMenu={(e) => openColMenu(e, c)}
                        title={
                          editable
                            ? "Click: seleccionar columna · Click derecho: insertar/eliminar"
                            : undefined
                        }
                        className={`border border-line-soft px-2 py-1 text-[10px] font-medium min-w-[7.5rem] ${
                          editable ? "cursor-pointer" : ""
                        } ${
                          colSel ? "bg-accent-soft/60 text-accent" : "bg-paper text-muted"
                        }`}
                      >
                        {auxColLetter(c)}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {infoRows.map(([label, value], i) => (
                  <tr key={label}>
                    <td className="bg-paper border border-line-soft text-center text-[10px] text-muted">
                      {i + 1}
                    </td>
                    <td className="border border-line-soft bg-accent text-white font-semibold px-2 py-1">
                      {label}
                    </td>
                    <td
                      className="border border-line-soft bg-paper font-medium px-2 py-1"
                      colSpan={Math.max(1, cols - 1)}
                    >
                      {value}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td className="bg-paper border border-line-soft text-center text-[10px] text-muted">
                    {infoRows.length + 1}
                  </td>
                  <td className="border border-line-soft" colSpan={cols} />
                </tr>
                {grid.map((row, r) => {
                  const rowSel = r >= selRect.r0 && r <= selRect.r1;
                  return (
                    <tr key={r}>
                      <td
                        onMouseDown={(e) => {
                          if (e.button !== 0) return;
                          containerRef.current?.focus();
                          setSel({ ar: r, ac: 0, fr: r, fc: Math.max(0, cols - 1) });
                        }}
                        onContextMenu={(e) => openRowMenu(e, r)}
                        title={
                          editable
                            ? "Click: seleccionar fila · Click derecho: insertar/eliminar"
                            : undefined
                        }
                        className={`border border-line-soft text-center text-[10px] ${
                          editable ? "cursor-pointer" : ""
                        } ${
                          rowSel ? "bg-accent-soft/60 text-accent" : "bg-paper text-muted"
                        }`}
                      >
                        {AUX_SHEET_GRID_ROW_OFFSET + r}
                      </td>
                      {row.map((cell, c) => {
                        const m = findMerge(merges, r, c);
                        // Celda tapada por una unión (no master): no se renderiza.
                        if (m && !(m.r0 === r && m.c0 === c)) return null;
                        const rowSpan = m ? m.r1 - m.r0 + 1 : 1;
                        const colSpan = m ? m.c1 - m.c0 + 1 : 1;
                        const inSel =
                          r >= selRect.r0 &&
                          r <= selRect.r1 &&
                          c >= selRect.c0 &&
                          c <= selRect.c1;
                        const isActive = r === active.r && c === active.c;
                        const isEditing = editing?.r === r && editing?.c === c;
                        const formula = !isEditing && isAuxFormula(cell);
                        return (
                          <td
                            key={c}
                            rowSpan={rowSpan}
                            colSpan={colSpan}
                            className="border border-line-soft p-0 align-top"
                          >
                            {isEditing ? (
                              <input
                                autoFocus
                                type="text"
                                value={editing.draft}
                                onMouseDown={(e) => e.stopPropagation()}
                                onChange={(e) =>
                                  setEditing({ r, c, draft: e.target.value })
                                }
                                onKeyDown={(e) => {
                                  const k = e.key;
                                  if (k === "Enter") {
                                    e.preventDefault();
                                    commitAndMove(e.currentTarget.value, e.shiftKey ? -1 : 1, 0);
                                  } else if (k === "Tab") {
                                    e.preventDefault();
                                    commitAndMove(e.currentTarget.value, 0, e.shiftKey ? -1 : 1);
                                  } else if (k === "Escape") {
                                    e.preventDefault();
                                    skipBlurRef.current = true;
                                    setEditing(null);
                                    focusContainer();
                                  }
                                }}
                                onBlur={(e) => {
                                  if (skipBlurRef.current) {
                                    skipBlurRef.current = false;
                                    return;
                                  }
                                  commitCell(r, c, e.target.value);
                                }}
                                className="w-full bg-white dark:bg-paper-2 px-2 py-1 outline-none ring-2 ring-inset ring-accent"
                              />
                            ) : (
                              <div
                                onMouseDown={(e) => onCellMouseDown(e, r, c)}
                                onMouseEnter={() => onCellMouseEnter(r, c)}
                                onDoubleClick={() => onCellDoubleClick(r, c)}
                                className={`px-2 py-1 min-h-[1.75rem] cursor-cell truncate ${
                                  inSel ? "bg-accent-soft/40" : ""
                                } ${
                                  isActive ? "ring-2 ring-inset ring-accent" : ""
                                } ${formula ? "font-mono tabular-nums text-right text-accent" : ""}`}
                              >
                                {display[r][c] || " "}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-4 py-2 border-t border-line-soft">
            {editable && (
              <>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={undo}
                  disabled={undoStack.length === 0}
                  title="Deshacer (Ctrl/Cmd+Z)"
                >
                  Deshacer
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={redo}
                  disabled={redoStack.length === 0}
                  title="Rehacer (Ctrl/Cmd+Shift+Z)"
                >
                  Rehacer
                </Button>
                <span className="text-line">|</span>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={addRow}
                  disabled={pending || rows >= AUX_SHEET_MAX_ROWS}
                >
                  <Plus size={12} strokeWidth={2} />
                  Fila
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={addCol}
                  disabled={pending || cols >= AUX_SHEET_MAX_COLS}
                >
                  <Plus size={12} strokeWidth={2} />
                  Columna
                </Button>
                <span className="text-line">|</span>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={doMerge}
                  disabled={!canMerge}
                  title="Combinar las celdas seleccionadas (queda el valor de la celda superior izquierda)"
                >
                  Combinar
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={doUnmerge}
                  disabled={!canUnmerge}
                  title="Separar las celdas combinadas de la selección"
                >
                  Separar
                </Button>
                <span className="text-line">|</span>
                <Button variant="ghost" size="xs" onClick={() => void copySelection()}>
                  Copiar
                </Button>
                <Button variant="ghost" size="xs" onClick={() => void pasteSelection()}>
                  Pegar
                </Button>
                <Button variant="ghost" size="xs" onClick={clearSelection}>
                  Borrar
                </Button>
                <span className="text-[11px] text-muted hidden md:inline">
                  Ctrl/Cmd+C/V/Z · doble click o Enter para editar · click derecho
                  en N°/letra para insertar o eliminar ·{" "}
                  <code>=SUM(A{AUX_SHEET_GRID_ROW_OFFSET}:A{AUX_SHEET_GRID_ROW_OFFSET + 5})</code>
                </span>
              </>
            )}
            <span className="flex-1 text-right text-[11px] text-muted">
              {pending ? "Guardando…" : `${rows} filas × ${cols} columnas`}
            </span>
            {editable && (
              <button
                type="button"
                onClick={onDelete}
                disabled={pending}
                className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-danger disabled:opacity-50"
                title="Eliminar el tab auxiliar (y su tab del Excel)"
              >
                <Trash2 size={12} strokeWidth={2} />
                Eliminar tab
              </button>
            )}
          </div>

          {menu && (
            // Menú contextual estilo Excel. Posición fija al cursor; se cierra
            // solo (efecto global). stopPropagation evita que el click que
            // dispara una acción lo cierre antes de tiempo.
            <div
              role="menu"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              style={{ top: menu.y, left: menu.x }}
              className="fixed z-50 min-w-[15rem] rounded-md border border-line bg-surface dark:bg-paper-2 py-1 shadow-lg text-xs"
            >
              {menu.kind === "row" ? (
                <>
                  <AuxMenuItem
                    label="Insertar fila arriba"
                    onClick={() => {
                      insertRowAt(menu.index);
                      setMenu(null);
                    }}
                    disabled={rows >= AUX_SHEET_MAX_ROWS}
                  />
                  <AuxMenuItem
                    label="Insertar fila abajo"
                    onClick={() => {
                      insertRowAt(menu.index + 1);
                      setMenu(null);
                    }}
                    disabled={rows >= AUX_SHEET_MAX_ROWS}
                  />
                  <div className="my-1 border-t border-line-soft" />
                  <AuxMenuItem
                    label="Eliminar fila"
                    danger
                    onClick={() => {
                      deleteRowAt(menu.index);
                      setMenu(null);
                    }}
                    disabled={rows <= 1}
                  />
                </>
              ) : (
                <>
                  <AuxMenuItem
                    label="Insertar columna a la izquierda"
                    onClick={() => {
                      insertColAt(menu.index);
                      setMenu(null);
                    }}
                    disabled={cols >= AUX_SHEET_MAX_COLS}
                  />
                  <AuxMenuItem
                    label="Insertar columna a la derecha"
                    onClick={() => {
                      insertColAt(menu.index + 1);
                      setMenu(null);
                    }}
                    disabled={cols >= AUX_SHEET_MAX_COLS}
                  />
                  <div className="my-1 border-t border-line-soft" />
                  <AuxMenuItem
                    label="Eliminar columna"
                    danger
                    onClick={() => {
                      deleteColAt(menu.index);
                      setMenu(null);
                    }}
                    disabled={cols <= 1}
                  />
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

// Ítem del menú contextual (insertar / eliminar fila o columna).
function AuxMenuItem({
  label,
  onClick,
  disabled,
  danger,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={`block w-full px-3 py-1.5 text-left hover:bg-accent-soft/50 disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed ${
        danger ? "text-danger" : ""
      }`}
    >
      {label}
    </button>
  );
}

// Resultado de fórmula en formato US (regla de la app), hasta 2 decimales.
function fmtNumber(v: number): string {
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
