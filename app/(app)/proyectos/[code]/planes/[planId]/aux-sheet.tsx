"use client";

// Sheet auxiliar del plan: grilla libre tipo Excel (máx. 1 por plan) que sale
// como tab extra del export Excel, después del "Budget por mercado". Arriba
// muestra la misma metadata que ese tab (proyecto, período, budget origin,
// read-only) y debajo la grilla editable. La grilla vive en estado local (nada
// más en la página la consume), así que los commits guardan sin router.refresh.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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
  AUX_SHEET_MAX_COLS,
  AUX_SHEET_MAX_ROWS,
  auxColLetter,
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
          lang === "es" ? "Sheet auxiliar creado" : "Auxiliary sheet created",
        );
      router.refresh();
    });
  };

  if (!detail.auxSheet) {
    if (!editable) return null;
    return (
      <section className="rounded-lg border border-dashed border-line px-5 py-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">Sheet auxiliar</p>
          <p className="text-xs text-muted mt-0.5">
            Grilla libre que se agrega al Excel como un tab más, después del
            Budget split. Arranca con la info del plan arriba y filas vacías
            para completar a mano.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={onCreate} disabled={pending}>
          <Plus size={14} strokeWidth={2} />
          Agregar sheet auxiliar
        </Button>
      </section>
    );
  }

  // key por id: si se borra y se vuelve a crear, el editor rearranca limpio.
  return (
    <AuxSheetEditor
      key={detail.auxSheet.id}
      sheet={detail.auxSheet}
      detail={detail}
      editable={editable}
      lang={lang}
    />
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
  // Última grilla commiteada — los inputs son uncontrolled (defaultValue) como
  // el resto del editor; acá solo guardamos lo que ya se mandó a la action.
  const [grid, setGrid] = useState<string[][]>(() => normalizeAuxGrid(sheet.grid));

  const cols = grid[0]?.length ?? 0;

  const save = (next: string[][]) => {
    startTransition(async () => {
      const r = await updateAuxSheet({ sheetId: sheet.id, grid: next });
      if (!r.ok) toast.error(r.error);
    });
  };

  const commitCell = (r: number, c: number, value: string) => {
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
        title: "¿Eliminar el sheet auxiliar?",
        body: "Se pierde todo el contenido de la grilla y el tab deja de salir en el Excel. Esta acción no se puede deshacer.",
        confirmLabel: "Eliminar",
        danger: true,
      }))
    )
      return;
    startTransition(async () => {
      const r = await deleteAuxSheet({ sheetId: sheet.id });
      if (!r.ok) toast.error(r.error);
      else toast.success("Sheet auxiliar eliminado");
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
  // Los números de fila replican el layout del tab exportado: metadata,
  // una fila de aire y recién ahí la grilla.
  const gridRowOffset = infoRows.length + 2;

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
            ? "Sheet auxiliar · tab del Excel después del Budget split"
            : "Auxiliary sheet · Excel tab after the Budget split"}
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
                      {gridRowOffset + r}
                    </td>
                    {row.map((cell, c) => (
                      <td key={c} className="border border-line-soft p-0">
                        <input
                          type="text"
                          defaultValue={cell}
                          disabled={!editable}
                          onBlur={(e) => commitCell(r, c, e.target.value)}
                          className="w-full bg-transparent px-2 py-1 focus:outline-none focus:bg-accent-soft/40 disabled:opacity-60"
                        />
                      </td>
                    ))}
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
                title="Eliminar el sheet auxiliar (y su tab del Excel)"
              >
                <Trash2 size={12} strokeWidth={2} />
                Eliminar sheet
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
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
