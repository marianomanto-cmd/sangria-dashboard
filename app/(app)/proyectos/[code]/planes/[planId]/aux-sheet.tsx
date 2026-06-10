"use client";

// Tabs auxiliares del plan: grillas libres tipo Excel (N por plan) que salen
// como tabs extra del export Excel, después del "Budget por mercado". Cada tab
// muestra arriba la misma metadata que el tab exportado (proyecto, período,
// budget origin, read-only) y debajo la grilla editable. Las celdas que
// empiezan con "=" son fórmulas (refs A1 con la numeración visible + SUM/
// AVERAGE/MIN/MAX/COUNT): el editor muestra el resultado y la fórmula cruda
// al enfocar; el export las escribe como fórmulas reales de Excel. La grilla
// vive en estado local (nada más en la página la consume), así que los
// commits guardan sin router.refresh.

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
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
  AUX_SHEET_MAX_COLS,
  AUX_SHEET_MAX_ROWS,
  auxColLetter,
  evalAuxFormula,
  isAuxFormula,
  normalizeAuxGrid,
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
              Grillas libres que se agregan al Excel como tabs, después del
              Budget split. Soportan fórmulas: <code>=B5*2</code>,{" "}
              <code>=SUM(A5:A10)</code>.
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
  // Última grilla commiteada (valores crudos, fórmulas incluidas).
  const [grid, setGrid] = useState<string[][]>(() => normalizeAuxGrid(sheet.grid));
  // Celda en edición: muestra el valor crudo mientras tiene foco; el resto
  // de las celdas muestran el valor computado (como Excel).
  const [editing, setEditing] = useState<{ r: number; c: number; draft: string } | null>(
    null,
  );

  const cols = grid[0]?.length ?? 0;

  // Valores de display: fórmulas evaluadas (o su código de error), el resto
  // tal cual. Recomputa solo cuando la grilla commiteada cambia.
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

  const save = (next: string[][]) => {
    startTransition(async () => {
      const r = await updateAuxSheet({ sheetId: sheet.id, grid: next });
      if (!r.ok) toast.error(r.error);
    });
  };

  const commitCell = (r: number, c: number, value: string) => {
    setEditing(null);
    if (grid[r][c] === value) return;
    const next = grid.map((row, ri) =>
      ri === r ? row.map((cell, ci) => (ci === c ? value : cell)) : row,
    );
    setGrid(next);
    save(next);
  };

  const addRow = () => {
    if (grid.length >= AUX_SHEET_MAX_ROWS) return;
    const next = [...grid, Array<string>(cols).fill("")];
    setGrid(next);
    save(next);
  };

  const addCol = () => {
    if (cols >= AUX_SHEET_MAX_COLS) return;
    const next = grid.map((row) => [...row, ""]);
    setGrid(next);
    save(next);
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
          <div className="overflow-x-auto border-t border-line-soft">
            <table
              className="text-xs border-collapse"
              onKeyDown={(e) => moveAuxGridFocus(e, addRow)}
            >
              <thead>
                <tr>
                  <th className="w-9 bg-paper border border-line-soft" />
                  {Array.from({ length: cols }, (_, c) => (
                    <th
                      key={c}
                      className="bg-paper border border-line-soft px-2 py-1 text-[10px] font-medium text-muted min-w-[7.5rem]"
                    >
                      {auxColLetter(c)}
                    </th>
                  ))}
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
                {grid.map((row, r) => (
                  <tr key={r}>
                    <td className="bg-paper border border-line-soft text-center text-[10px] text-muted">
                      {AUX_SHEET_GRID_ROW_OFFSET + r}
                    </td>
                    {row.map((cell, c) => {
                      const isEditing = editing?.r === r && editing?.c === c;
                      return (
                        <td key={c} className="border border-line-soft p-0">
                          <input
                            type="text"
                            value={isEditing ? editing.draft : display[r][c]}
                            disabled={!editable}
                            onFocus={() => setEditing({ r, c, draft: cell })}
                            onChange={(e) =>
                              setEditing({ r, c, draft: e.target.value })
                            }
                            onBlur={(e) => commitCell(r, c, e.target.value)}
                            className={`w-full bg-transparent px-2 py-1 focus:outline-none focus:bg-accent-soft/40 disabled:opacity-60 ${
                              !isEditing && isAuxFormula(cell)
                                ? "font-mono tabular-nums text-right"
                                : ""
                            }`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-2 px-4 py-2 border-t border-line-soft">
            {editable && (
              <>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={addRow}
                  disabled={pending || grid.length >= AUX_SHEET_MAX_ROWS}
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
                <span className="text-[11px] text-muted">
                  Fórmulas: <code>=B{AUX_SHEET_GRID_ROW_OFFSET}*2</code> ·{" "}
                  <code>
                    =SUM(A{AUX_SHEET_GRID_ROW_OFFSET}:A
                    {AUX_SHEET_GRID_ROW_OFFSET + 5})
                  </code>{" "}
                  · AVERAGE / MIN / MAX / COUNT
                </span>
              </>
            )}
            <span className="flex-1 text-right text-[11px] text-muted">
              {pending ? "Guardando…" : `${grid.length} filas × ${cols} columnas`}
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
        </>
      )}
    </section>
  );
}

// Resultado de fórmula en formato US (regla de la app), hasta 2 decimales.
function fmtNumber(v: number): string {
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

// Navegación tipo planilla (igual que la grilla de placements): Enter baja a
// la misma columna de la fila siguiente, Shift+Enter sube; Enter en la última
// fila agrega una nueva.
function moveAuxGridFocus(
  e: React.KeyboardEvent<HTMLTableElement>,
  onAddRow: () => void,
) {
  if (e.key !== "Enter") return;
  const el = e.target;
  if (!(el instanceof HTMLInputElement)) return;
  const td = el.closest("td");
  const tr = el.closest("tr");
  if (!td || !tr) return;
  e.preventDefault();
  const colIndex = td.cellIndex;
  const sib = e.shiftKey ? tr.previousElementSibling : tr.nextElementSibling;
  if (sib instanceof HTMLTableRowElement) {
    const cell = sib.cells[colIndex];
    const focusable = cell?.querySelector<HTMLInputElement>("input");
    if (focusable) {
      el.blur();
      focusable.focus();
      focusable.select();
    }
    return;
  }
  if (!e.shiftKey) {
    el.blur();
    onAddRow();
  }
}
