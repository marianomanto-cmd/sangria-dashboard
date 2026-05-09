"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { upsertActualSpend } from "@/app/actions/actual-spend";
import type {
  ActualsLine,
  ActualsPublisherGroup,
  ProjectActuals,
} from "@/db/queries/project-actuals";
import { formatPct, formatUsd, formatUsdCompact } from "@/lib/format";

const MONTH_LABELS_ES = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];

const SAVE_DEBOUNCE_MS = 300;
const STATUS_FLASH_MS = 1500;
const OVER_TOLERANCE = 1.01;

function formatMonthHeader(yyyymm: string): string {
  const idx = Number.parseInt(yyyymm.slice(5, 7), 10) - 1;
  return `${MONTH_LABELS_ES[idx] ?? yyyymm} ${yyyymm.slice(2, 4)}`;
}

type CellStatus = "idle" | "saving" | "saved" | "error";

type StateMap = Record<string, number>; // key = `${lineId}::${month}`

const cellKey = (lineId: string, month: string) => `${lineId}::${month}`;

export function ActualsGridEditable({ data }: { data: ProjectActuals }) {
  const [values, setValues] = useState<StateMap>(() => {
    const init: StateMap = {};
    for (const g of data.groups) {
      for (const ln of g.lines) {
        for (const m of data.months) {
          init[cellKey(ln.id, m)] = ln.cells[m].real;
        }
      }
    }
    return init;
  });

  const [statuses, setStatuses] = useState<Record<string, CellStatus>>({});

  const setStatus = useCallback((key: string, status: CellStatus) => {
    setStatuses((prev) => ({ ...prev, [key]: status }));
  }, []);

  const onCellSet = useCallback((key: string, value: number) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  // ─── Totales derivados de `values` (live) ──────────────────────────────
  const { groupTotals, columnTotals, grandTotalReal, grandTotalPlanned } =
    useMemo(() => {
      const groupTotals: Record<
        string,
        { totalReal: number; monthly: Record<string, number> }
      > = {};
      const columnTotals: Record<string, number> = {};
      let grandTotalReal = 0;
      let grandTotalPlanned = 0;

      for (const m of data.months) columnTotals[m] = 0;

      for (const g of data.groups) {
        const monthly: Record<string, number> = {};
        let total = 0;
        for (const m of data.months) monthly[m] = 0;

        for (const ln of g.lines) {
          for (const m of data.months) {
            const v = values[cellKey(ln.id, m)] ?? 0;
            monthly[m] += v;
            total += v;
            columnTotals[m] += v;
          }
        }

        groupTotals[g.publisher] = { totalReal: total, monthly };
        grandTotalReal += total;
        grandTotalPlanned += g.totalPlanned;
      }

      return { groupTotals, columnTotals, grandTotalReal, grandTotalPlanned };
    }, [values, data]);

  if (data.groups.length === 0) {
    return (
      <div className="rounded-lg border border-line border-dashed bg-paper-2 px-5 py-12 text-center">
        <p className="text-sm font-medium text-ink-2">Plan vacío</p>
        <p className="text-xs text-muted mt-1">
          El plan vigente no tiene líneas. Importá un Excel desde Fase 6.
        </p>
      </div>
    );
  }

  const totalConsumption =
    grandTotalPlanned > 0 ? (grandTotalReal / grandTotalPlanned) * 100 : 0;

  return (
    <section className="rounded-lg border border-line bg-white overflow-hidden">
      <div className="px-5 py-3 border-b border-line flex items-baseline justify-between">
        <div>
          <h2 className="text-sm font-semibold">Grilla editable</h2>
          <p className="text-[11px] mt-0.5 text-muted">
            Autosave 300ms · cada cambio se audita
          </p>
        </div>
        <div className="flex items-center gap-4 text-[11px] uppercase tracking-[0.06em] font-medium text-muted">
          <span className="font-mono normal-case tracking-normal text-ink-2">
            {formatUsd(grandTotalReal)}
            <span className="text-muted"> de </span>
            {formatUsd(grandTotalPlanned)}
          </span>
          <span
            className={`font-mono normal-case tracking-normal ${
              totalConsumption > 100 ? "text-warn font-semibold" : "text-ink"
            }`}
          >
            {formatPct(totalConsumption, 0)}
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-paper">
            <tr className="text-[11px] uppercase tracking-[0.06em] text-muted">
              <th className="text-left font-medium px-5 py-2.5 sticky left-0 bg-paper z-10 min-w-[280px]">
                Publisher / Placement
              </th>
              {data.months.map((m) => (
                <th
                  key={m}
                  className="text-right font-medium px-3 py-2.5 min-w-[120px]"
                >
                  {formatMonthHeader(m)}
                </th>
              ))}
              <th className="text-right font-medium px-5 py-2.5 min-w-[100px]">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {data.groups.map((g) => (
              <PublisherRows
                key={g.publisher}
                group={g}
                months={data.months}
                values={values}
                statuses={statuses}
                groupTotal={groupTotals[g.publisher]}
                onCellSet={onCellSet}
                onStatusSet={setStatus}
              />
            ))}
            <tr className="border-t-2 border-ink bg-paper-2">
              <td className="px-5 py-3 font-semibold sticky left-0 bg-paper-2 z-10">
                Total
              </td>
              {data.months.map((m) => {
                const plannedSum = data.groups.reduce(
                  (s, g) => s + g.totals[m].planned,
                  0,
                );
                const realSum = columnTotals[m];
                const over = plannedSum > 0 && realSum > plannedSum * OVER_TOLERANCE;
                return (
                  <td
                    key={m}
                    className={`px-3 py-3 text-right font-mono font-semibold tabular-nums ${
                      over ? "text-warn" : "text-ink"
                    }`}
                  >
                    {formatUsdCompact(realSum)}
                  </td>
                );
              })}
              <td className="px-5 py-3 text-right font-mono font-semibold tabular-nums text-ink">
                {formatUsd(grandTotalReal)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="px-5 py-2.5 border-t border-line-soft text-[11px] text-muted">
        Click en un valor para editarlo. Tab / shift-Tab para navegar entre
        celdas. Los valores en{" "}
        <span className="text-warn font-medium">color warn</span> superan la
        prorrata mensual del plan.
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────

function PublisherRows({
  group,
  months,
  values,
  statuses,
  groupTotal,
  onCellSet,
  onStatusSet,
}: {
  group: ActualsPublisherGroup;
  months: string[];
  values: StateMap;
  statuses: Record<string, CellStatus>;
  groupTotal: { totalReal: number; monthly: Record<string, number> };
  onCellSet: (key: string, v: number) => void;
  onStatusSet: (key: string, s: CellStatus) => void;
}) {
  const consumption =
    group.totalPlanned > 0 ? (groupTotal.totalReal / group.totalPlanned) * 100 : 0;

  return (
    <>
      <tr className="border-t-2 border-line bg-paper-2/60">
        <td className="px-5 py-2 sticky left-0 bg-paper-2 z-10">
          <span className="font-semibold text-ink">{group.publisher}</span>
          <span className="ml-2 text-xs text-muted font-normal">
            · {group.lines.length} placement
            {group.lines.length === 1 ? "" : "s"}
          </span>
        </td>
        {months.map((m) => {
          const realSum = groupTotal.monthly[m];
          const plannedSum = group.totals[m].planned;
          const over = plannedSum > 0 && realSum > plannedSum * OVER_TOLERANCE;
          return (
            <td
              key={m}
              className={`px-3 py-2 text-right font-mono font-semibold tabular-nums ${
                over ? "text-warn" : "text-ink-2"
              }`}
            >
              {realSum > 0 ? formatUsdCompact(realSum) : "—"}
            </td>
          );
        })}
        <td
          className={`px-5 py-2 text-right font-mono font-semibold tabular-nums ${
            consumption > 100 ? "text-warn" : "text-ink"
          }`}
        >
          {formatUsdCompact(groupTotal.totalReal)}
        </td>
      </tr>
      {group.lines.map((ln) => (
        <LineRow
          key={ln.id}
          line={ln}
          months={months}
          values={values}
          statuses={statuses}
          onCellSet={onCellSet}
          onStatusSet={onStatusSet}
        />
      ))}
    </>
  );
}

function LineRow({
  line,
  months,
  values,
  statuses,
  onCellSet,
  onStatusSet,
}: {
  line: ActualsLine;
  months: string[];
  values: StateMap;
  statuses: Record<string, CellStatus>;
  onCellSet: (key: string, v: number) => void;
  onStatusSet: (key: string, s: CellStatus) => void;
}) {
  const lineTotal = months.reduce(
    (s, m) => s + (values[cellKey(line.id, m)] ?? 0),
    0,
  );
  return (
    <tr className="border-t border-line-soft hover:bg-paper-2/60 transition-colors">
      <td className="px-5 py-1.5 pl-8 sticky left-0 bg-white z-10">
        <div className="text-[13px] text-ink-2">{line.placementName}</div>
        {line.audienceMarket && (
          <div className="text-[11px] text-muted truncate max-w-[280px]">
            {line.audienceMarket}
          </div>
        )}
      </td>
      {months.map((m) => {
        const key = cellKey(line.id, m);
        const cell = line.cells[m];
        return (
          <EditableCell
            key={key}
            cellKey={key}
            value={values[key] ?? 0}
            planned={cell.planned}
            hasActive={cell.hasActive}
            mediaPlanLineId={line.id}
            month={m}
            status={statuses[key] ?? "idle"}
            onCellSet={onCellSet}
            onStatusSet={onStatusSet}
          />
        );
      })}
      <td className="px-5 py-1.5 text-right font-mono text-ink-2 tabular-nums text-[13px]">
        {lineTotal > 0 ? formatUsd(lineTotal) : "—"}
      </td>
    </tr>
  );
}

function EditableCell({
  cellKey: ck,
  value,
  planned,
  hasActive,
  mediaPlanLineId,
  month,
  status,
  onCellSet,
  onStatusSet,
}: {
  cellKey: string;
  value: number;
  planned: number;
  hasActive: boolean;
  mediaPlanLineId: string;
  month: string;
  status: CellStatus;
  onCellSet: (key: string, v: number) => void;
  onStatusSet: (key: string, s: CellStatus) => void;
}) {
  const [text, setText] = useState(value > 0 ? value.toFixed(2) : "");
  const [focused, setFocused] = useState(false);

  // `text` solo se muestra mientras el input está focused; cuando no, se
  // muestra `value` formateado directo. Por eso no hace falta useEffect
  // para sincronizar text ← value: el resync ocurre al onFocus.

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const queueSave = useCallback(
    (rawText: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        const parsed = rawText.trim() === "" ? 0 : Number.parseFloat(rawText);
        if (!Number.isFinite(parsed) || parsed < 0) {
          onStatusSet(ck, "error");
          return;
        }
        // Reflejamos optimísticamente.
        onCellSet(ck, parsed);
        onStatusSet(ck, "saving");

        const res = await upsertActualSpend({
          mediaPlanLineId,
          month,
          amount: parsed,
        });

        if (res.ok) {
          onStatusSet(ck, "saved");
          if (flashRef.current) clearTimeout(flashRef.current);
          flashRef.current = setTimeout(() => onStatusSet(ck, "idle"), STATUS_FLASH_MS);
        } else {
          onStatusSet(ck, "error");
        }
      }, SAVE_DEBOUNCE_MS);
    },
    [ck, mediaPlanLineId, month, onCellSet, onStatusSet],
  );

  // Cleanup
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (flashRef.current) clearTimeout(flashRef.current);
    };
  }, []);

  const isOver = planned > 0 && value > planned * OVER_TOLERANCE;
  const isInactive = !hasActive && value === 0;

  const cellClasses = [
    "px-3 py-1 relative",
    isOver ? "bg-danger-soft/30" : "",
  ].join(" ");

  const inputClasses = [
    "w-full text-right font-mono tabular-nums bg-transparent border border-transparent rounded px-1.5 py-1 outline-none",
    "hover:border-line",
    "focus:border-accent focus:bg-white focus:shadow-[0_0_0_3px_var(--color-accent-soft)]",
    isInactive ? "text-stone-300" : isOver ? "text-warn" : "text-ink-2",
    status === "error"
      ? "border-danger bg-danger-soft/40"
      : "",
  ].join(" ");

  return (
    <td
      className={cellClasses}
      title={
        planned > 0
          ? `Plan: ${formatUsd(planned)}${isOver ? " · superado" : ""}`
          : undefined
      }
    >
      <input
        type="text"
        inputMode="decimal"
        value={focused ? text : value > 0 ? formatUsdCompact(value) : ""}
        placeholder={isInactive ? "—" : "0"}
        className={inputClasses}
        onFocus={() => {
          setFocused(true);
          // Al entrar en foco, mostramos el número raw para edición.
          setText(value > 0 ? value.toFixed(2) : "");
        }}
        onBlur={() => {
          setFocused(false);
        }}
        onChange={(e) => {
          // Aceptamos solo dígitos y un punto decimal.
          const sanitized = e.target.value.replace(/[^0-9.]/g, "");
          // Evitar múltiples puntos.
          const parts = sanitized.split(".");
          const clean =
            parts.length > 1 ? parts[0] + "." + parts.slice(1).join("") : sanitized;
          setText(clean);
          queueSave(clean);
        }}
      />
      <CellStatusDot status={status} />
    </td>
  );
}

function CellStatusDot({ status }: { status: CellStatus }) {
  if (status === "idle") return null;
  const color = {
    saving: "bg-info animate-pulse",
    saved: "bg-success",
    error: "bg-danger",
    idle: "bg-transparent",
  }[status];
  return (
    <span
      aria-hidden
      className={`absolute top-1 right-1.5 w-1.5 h-1.5 rounded-full ${color}`}
    />
  );
}
