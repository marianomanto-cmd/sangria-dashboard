"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  closeDailyLoad,
  setPlacementActual,
} from "@/app/actions/campaign-tracker";
import { GoalBar, PaceBadge } from "@/components/campaign-tracker-bits";
import type { TrackerPublisherGroup } from "@/db/queries/campaign-tracker";
import {
  buildMetricRows,
  computePaceStatus,
  formatCellValue,
  formatMetricValue,
  parseCellValue,
  parseLocalDate,
  type DirectGoal,
  type MetricUnit,
} from "@/lib/campaign-metrics";
import { TrackerChart } from "./tracker-chart";

// Estructura normalizada por placement: lo que el editor necesita para
// recomputar todo client-side cuando la trafficker edita una celda.
type EditorPlacement = {
  id: string;
  name: string;
  audience: string | null;
  marketName: string | null;
  costMethod: string | null;
  pacePct: number;
  directGoals: DirectGoal[];
  labelByKey: Record<string, string>;
  initialActuals: Record<string, number>;
  previousActuals: Record<string, number>;
};

type EditorPublisher = {
  id: string;
  publisherName: string;
  publisherSlug: string;
  placements: EditorPlacement[];
};

type MetricRow = ReturnType<typeof buildMetricRows>[number];

export function CampaignTrackerEditor({
  planId,
  pacePct,
  publishers,
  lastCloseDate,
}: {
  planId: string;
  pacePct: number;
  publishers: TrackerPublisherGroup[];
  lastCloseDate: string | null;
}) {
  const router = useRouter();

  // Normalización (una vez): de la estructura del query a la del editor.
  const editorPublishers = useMemo<EditorPublisher[]>(
    () =>
      publishers.map((pub) => ({
        id: pub.id,
        publisherName: pub.publisherName,
        publisherSlug: pub.publisherSlug,
        placements: pub.placements.map((pl) => {
          const directGoals: DirectGoal[] = [];
          const initialActuals: Record<string, number> = {};
          const labelByKey: Record<string, string> = {};
          for (const m of pl.metrics) {
            labelByKey[m.key] = m.label;
            if (m.kind === "direct") {
              directGoals.push({ key: m.key, goal: m.goal ?? 0 });
              initialActuals[m.key] = m.actual;
            }
          }
          return {
            id: pl.id,
            name: pl.name,
            audience: pl.audience,
            marketName: pl.marketName,
            costMethod: pl.costMethod,
            pacePct: pl.pacePct,
            directGoals,
            labelByKey,
            initialActuals,
            previousActuals: pl.previousActuals,
          };
        }),
      })),
    [publishers],
  );

  // Estado fuente de verdad: valores reales por placement → métrica.
  const [actuals, setActuals] = useState<
    Record<string, Record<string, number>>
  >(() => {
    const init: Record<string, Record<string, number>> = {};
    for (const pub of editorPublishers) {
      for (const pl of pub.placements) {
        init[pl.id] = { ...pl.initialActuals };
      }
    }
    return init;
  });

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [editedKeys, setEditedKeys] = useState<Set<string>>(new Set());
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle",
  );
  const [compareMode, setCompareMode] = useState(false);
  const [closeFeedback, setCloseFeedback] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [closing, startClose] = useTransition();
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Autosave con debounce de 300ms. El estado local se actualiza al instante
  // (chart + métricas derivadas reaccionan sin reload); el save al server se
  // difiere.
  const commitCell = (
    placementId: string,
    metricKey: string,
    value: number,
  ) => {
    setActuals((prev) => ({
      ...prev,
      [placementId]: { ...prev[placementId], [metricKey]: value },
    }));
    setEditedKeys((prev) => {
      const next = new Set(prev);
      next.add(`${placementId}:${metricKey}`);
      return next;
    });
    setSaveState("saving");

    const cellKey = `${placementId}:${metricKey}`;
    const existing = timers.current.get(cellKey);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      timers.current.delete(cellKey);
      startTransition(async () => {
        const r = await setPlacementActual({
          planId,
          placementId,
          metricKey,
          value,
        });
        if (!r.ok) {
          alert(r.error);
          setSaveState("idle");
          return;
        }
        setSaveState("saved");
      });
    }, 300);
    timers.current.set(cellKey, t);
  };

  const handleClose = () => {
    if (
      !confirm(
        "¿Cerrar la carga de hoy? Se guarda un snapshot del estado actual en el histórico para Reportes. Podés seguir editando y volver a cerrar.",
      )
    )
      return;
    startClose(async () => {
      const r = await closeDailyLoad({ planId });
      if (!r.ok) {
        alert(r.error);
        return;
      }
      setCloseFeedback(
        `Carga cerrada · ${r.rowCount} valor${
          r.rowCount === 1 ? "" : "es"
        } guardado${r.rowCount === 1 ? "" : "s"} en el histórico`,
      );
      router.refresh();
    });
  };

  // Filas de métricas recomputadas para cada placement con el estado actual.
  const placementRows = useMemo(() => {
    const map = new Map<string, MetricRow[]>();
    for (const pub of editorPublishers) {
      for (const pl of pub.placements) {
        map.set(
          pl.id,
          buildMetricRows(
            pl.directGoals,
            actuals[pl.id] ?? {},
            (k, fb) => pl.labelByKey[k] ?? fb,
          ),
        );
      }
    }
    return map;
  }, [editorPublishers, actuals]);

  // Filas de la última carga cerrada, por placement → métrica. Para el modo
  // "Comparar con última carga".
  const previousRows = useMemo(() => {
    const map = new Map<string, Map<string, MetricRow>>();
    for (const pub of editorPublishers) {
      for (const pl of pub.placements) {
        const rows = buildMetricRows(
          pl.directGoals,
          pl.previousActuals,
          (k, fb) => pl.labelByKey[k] ?? fb,
        );
        map.set(pl.id, new Map(rows.map((r) => [r.key, r])));
      }
    }
    return map;
  }, [editorPublishers]);

  // Datos del chart: % de consumo de inversión por placement.
  const chartData = useMemo(() => {
    const out: { name: string; pct: number }[] = [];
    for (const pub of editorPublishers) {
      for (const pl of pub.placements) {
        const rows = placementRows.get(pl.id) ?? [];
        const amountRow = rows.find((r) => r.key === "amount");
        out.push({
          name: `${pub.publisherSlug.slice(0, 2).toUpperCase()} · ${pl.name}`,
          pct: amountRow?.goalPct ?? 0,
        });
      }
    }
    return out;
  }, [editorPublishers, placementRows]);

  const saveLabel =
    saveState === "saving"
      ? "Guardando…"
      : saveState === "saved"
        ? "Auto-guardado"
        : "Auto-guardado activo";

  const lastCloseLabel = lastCloseDate
    ? (parseLocalDate(lastCloseDate)?.toLocaleDateString("es-AR", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }) ?? lastCloseDate)
    : null;

  const colCount = compareMode ? 9 : 7;

  return (
    <div className="space-y-5">
      {/* Tabs internas — Histórico / Resumen son visual / próximamente */}
      <div className="flex items-center border-b border-line">
        <div className="px-4 py-2.5 text-[13px] font-medium text-ink border-b-2 border-accent -mb-px">
          Carga del día
        </div>
        <button
          type="button"
          disabled
          title="Próximamente — esta entrega no maneja vista de histórico diario"
          className="px-4 py-2.5 text-[13px] font-medium text-muted/60 cursor-not-allowed"
        >
          Histórico
        </button>
        <button
          type="button"
          disabled
          title="Próximamente"
          className="px-4 py-2.5 text-[13px] font-medium text-muted/60 cursor-not-allowed"
        >
          Resumen acumulado
        </button>
        <div className="ml-auto flex items-center gap-1.5 pr-1 text-xs text-muted">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              saveState === "saving" ? "bg-warn" : "bg-success"
            }`}
          />
          {saveLabel} · debounce 300ms
        </div>
      </div>

      {/* Tabla de placements + métricas */}
      <div className="rounded-lg border border-line bg-white overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="bg-paper">
            <tr className="text-[11px] uppercase tracking-[0.06em] text-muted">
              <th className="text-left font-medium px-4 py-2 w-[22%]">
                Placement
              </th>
              <th className="text-left font-medium px-4 py-2">Métrica</th>
              <th className="text-right font-medium px-4 py-2">Goal</th>
              <th className="text-right font-medium px-4 py-2 w-[130px]">
                Actual
              </th>
              {compareMode && (
                <>
                  <th className="text-right font-medium px-4 py-2">
                    Última carga
                  </th>
                  <th className="text-right font-medium px-4 py-2">Δ</th>
                </>
              )}
              <th className="text-right font-medium px-4 py-2">% goal</th>
              <th className="text-right font-medium px-4 py-2">% pace</th>
              <th className="text-left font-medium px-4 py-2 w-[18%]">
                Progreso
              </th>
            </tr>
          </thead>
          <tbody>
            {editorPublishers.map((pub) => {
              const isCollapsed = collapsed[pub.id] ?? false;
              // Progreso del publisher: consumo / goal de inversión.
              let goalSum = 0;
              let actualSum = 0;
              for (const pl of pub.placements) {
                const rows = placementRows.get(pl.id) ?? [];
                const amt = rows.find((r) => r.key === "amount");
                goalSum += amt?.goal ?? 0;
                actualSum += amt?.actual ?? 0;
              }
              const pubPct = goalSum > 0 ? (actualSum / goalSum) * 100 : 0;
              const pubStatus = computePaceStatus(pubPct, pacePct);
              return (
                <PublisherBlock
                  key={pub.id}
                  pub={pub}
                  isCollapsed={isCollapsed}
                  onToggle={() =>
                    setCollapsed((prev) => ({
                      ...prev,
                      [pub.id]: !isCollapsed,
                    }))
                  }
                  pubPct={pubPct}
                  pubStatus={pubStatus}
                  colCount={colCount}
                  compareMode={compareMode}
                  placementRows={placementRows}
                  previousRows={previousRows}
                  commitCell={commitCell}
                />
              );
            })}
          </tbody>
        </table>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-line flex items-center justify-between flex-wrap gap-2 text-xs">
          <div className="flex items-center gap-3 text-muted flex-wrap">
            <span>
              <b className="text-ink-2">{editedKeys.size}</b> valor
              {editedKeys.size === 1 ? "" : "es"} editado
              {editedKeys.size === 1 ? "" : "s"} en esta sesión
            </span>
            <span className="text-stone-300">·</span>
            <span className="flex items-center gap-1.5">
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  saveState === "saving" ? "bg-warn" : "bg-success"
                }`}
              />
              {saveLabel}
            </span>
            <span className="text-stone-300">·</span>
            <span>
              Última carga cerrada:{" "}
              <b className="text-ink-2">{lastCloseLabel ?? "nunca"}</b>
            </span>
            {closeFeedback && (
              <span className="text-success font-medium">{closeFeedback}</span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setCompareMode((m) => !m)}
              disabled={!lastCloseDate}
              title={
                lastCloseDate
                  ? "Compara el estado actual contra la última carga cerrada"
                  : "Todavía no hay ninguna carga cerrada para comparar"
              }
              className={`rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed ${
                compareMode
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line bg-white text-ink hover:bg-paper-2"
              }`}
            >
              {compareMode ? "Ocultar comparación" : "Comparar con última carga"}
            </button>
            <button
              type="button"
              onClick={handleClose}
              disabled={closing}
              title="Guarda un snapshot del estado actual en el histórico (para Reportes). No bloquea la edición."
              className="rounded-md bg-ink text-white px-3 py-1.5 text-xs font-medium hover:bg-ink-2 disabled:opacity-50"
            >
              {closing ? "Cerrando…" : "Cerrar carga del día"}
            </button>
          </div>
        </div>
      </div>

      {/* Chart de progreso */}
      <div>
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="text-base font-semibold">Progreso vs Goal</h2>
          <p className="text-xs text-muted">
            consumo de inversión por placement · línea accent = pace esperado
          </p>
        </div>
        <div className="rounded-lg border border-line bg-white p-5">
          <TrackerChart data={chartData} pacePct={pacePct} />
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-3 rounded-sm bg-ink" />
              consumo real
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-3 rounded-sm bg-paper-2 border border-line" />
              restante para goal
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-3 rounded-sm bg-danger" />
              exceso (&gt;100%)
            </span>
            <span className="ml-auto flex items-center gap-1.5">
              <span className="inline-block h-3 w-[1.5px] bg-accent" />
              pace esperado ({pacePct.toFixed(0)}%)
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function PublisherBlock({
  pub,
  isCollapsed,
  onToggle,
  pubPct,
  pubStatus,
  colCount,
  compareMode,
  placementRows,
  previousRows,
  commitCell,
}: {
  pub: EditorPublisher;
  isCollapsed: boolean;
  onToggle: () => void;
  pubPct: number;
  pubStatus: ReturnType<typeof computePaceStatus>;
  colCount: number;
  compareMode: boolean;
  placementRows: Map<string, MetricRow[]>;
  previousRows: Map<string, Map<string, MetricRow>>;
  commitCell: (placementId: string, metricKey: string, value: number) => void;
}) {
  return (
    <>
      <tr className="bg-paper-2">
        <td colSpan={colCount} className="px-4 py-2">
          <button
            type="button"
            onClick={onToggle}
            className="flex items-center gap-2 w-full text-left"
          >
            {isCollapsed ? (
              <ChevronRight size={13} className="text-muted" />
            ) : (
              <ChevronDown size={13} className="text-muted" />
            )}
            <span className="w-5 h-5 rounded bg-white border border-line flex items-center justify-center text-[10px] font-semibold text-muted">
              {pub.publisherSlug.slice(0, 2).toUpperCase()}
            </span>
            <span className="font-semibold text-ink">{pub.publisherName}</span>
            <span className="text-xs text-muted">
              · {pub.placements.length} placement
              {pub.placements.length === 1 ? "" : "s"}
            </span>
            <span className="ml-2">
              <PaceBadge status={pubStatus} />
            </span>
            <span className="ml-auto text-xs text-muted font-mono">
              {pubPct.toFixed(0)}% consumo
            </span>
          </button>
        </td>
      </tr>
      {!isCollapsed &&
        pub.placements.map((pl) => {
          const rows = placementRows.get(pl.id) ?? [];
          const prev = previousRows.get(pl.id);
          return rows.map((row, idx) => (
            <tr
              key={`${pl.id}:${row.key}`}
              className="border-t border-line-soft hover:bg-paper-2/40"
            >
              {idx === 0 && (
                <td
                  rowSpan={rows.length}
                  className="px-4 py-2.5 align-top border-r border-line-soft"
                >
                  <div className="font-medium text-ink">{pl.name}</div>
                  {pl.audience && (
                    <div className="text-xs text-muted mt-0.5">
                      {pl.audience}
                    </div>
                  )}
                  <div className="text-xs text-muted mt-0.5">
                    {[pl.marketName, pl.costMethod]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </div>
                </td>
              )}
              <MetricRowCells
                placementId={pl.id}
                placementPace={pl.pacePct}
                row={row}
                previousRow={compareMode ? prev?.get(row.key) : undefined}
                compareMode={compareMode}
                commitCell={commitCell}
              />
            </tr>
          ));
        })}
    </>
  );
}

function MetricRowCells({
  placementId,
  placementPace,
  row,
  previousRow,
  compareMode,
  commitCell,
}: {
  placementId: string;
  placementPace: number;
  row: MetricRow;
  previousRow: MetricRow | undefined;
  compareMode: boolean;
  commitCell: (placementId: string, metricKey: string, value: number) => void;
}) {
  const isCalc = row.kind === "calculated";

  // % goal: para direct es el ratio; para calculadas es el delta vs goal.
  let goalPctCell = "—";
  let goalPctCls = "text-muted";
  if (row.goalPct != null) {
    if (isCalc) {
      const delta = row.goalPct - 100;
      goalPctCell = `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`;
      goalPctCls =
        row.lowerIsBetter && delta > 5
          ? "text-warn"
          : !row.lowerIsBetter && delta < -5
            ? "text-warn"
            : "text-muted";
    } else {
      goalPctCell = `${row.goalPct.toFixed(0)}%`;
      goalPctCls =
        row.goalPct > 110
          ? "text-danger"
          : row.goalPct >= placementPace - 10
            ? "text-success"
            : "text-warn";
    }
  }

  // % pace: solo aplica a métricas direct.
  let pacePctCell = "—";
  if (!isCalc && row.goalPct != null) {
    const d = row.goalPct - placementPace;
    pacePctCell = `${d >= 0 ? "+" : ""}${d.toFixed(0)}%`;
  }

  // Δ vs última carga cerrada.
  const delta =
    compareMode && previousRow ? row.actual - previousRow.actual : 0;
  const deltaCell =
    delta === 0
      ? "—"
      : `${delta > 0 ? "+" : "−"}${formatMetricValue(Math.abs(delta), row.unit)}`;

  return (
    <>
      <td className="px-4 py-2 text-ink-2">
        <span className="flex items-center gap-1.5">
          {row.label}
          {isCalc && (
            <span className="inline-flex items-center rounded-sm border border-line bg-paper-2 px-1 py-px text-[9px] font-medium uppercase tracking-wide text-muted">
              calc.
            </span>
          )}
        </span>
      </td>
      <td className="px-4 py-2 text-right font-mono text-ink-2">
        {formatMetricValue(row.goal, row.unit)}
      </td>
      <td className="px-4 py-2 text-right">
        {isCalc ? (
          <input
            type="text"
            disabled
            value={formatMetricValue(row.actual, row.unit)}
            className="w-full text-right font-mono text-[12.5px] rounded border border-line bg-paper-2 text-muted px-2 py-1 cursor-not-allowed"
          />
        ) : (
          <MetricCell
            placementId={placementId}
            metricKey={row.key}
            value={row.actual}
            unit={row.unit}
            commitCell={commitCell}
          />
        )}
      </td>
      {compareMode && (
        <>
          <td className="px-4 py-2 text-right font-mono text-[12.5px] text-muted">
            {previousRow
              ? formatMetricValue(previousRow.actual, row.unit)
              : "—"}
          </td>
          <td
            className={`px-4 py-2 text-right font-mono text-[12.5px] ${
              delta > 0
                ? "text-success"
                : delta < 0
                  ? "text-warn"
                  : "text-muted"
            }`}
          >
            {deltaCell}
          </td>
        </>
      )}
      <td
        className={`px-4 py-2 text-right font-mono text-[12.5px] ${goalPctCls}`}
      >
        {goalPctCell}
      </td>
      <td className="px-4 py-2 text-right font-mono text-[12.5px] text-muted">
        {pacePctCell}
      </td>
      <td className="px-4 py-2">
        <GoalBar
          goalPct={row.goalPct}
          pacePct={placementPace}
          showPace={!isCalc}
        />
      </td>
    </>
  );
}

// Celda editable amarilla con autosave. Uncontrolled: el texto que se ve es
// lo que tipea la trafficker; el valor numérico parseado dispara el commit
// (estado + debounce). Al salir del foco se reformatea con separadores.
function MetricCell({
  placementId,
  metricKey,
  value,
  unit,
  commitCell,
}: {
  placementId: string;
  metricKey: string;
  value: number;
  unit: MetricUnit;
  commitCell: (placementId: string, metricKey: string, value: number) => void;
}) {
  return (
    <input
      type="text"
      inputMode="decimal"
      defaultValue={formatCellValue(value, unit)}
      placeholder="0"
      onChange={(e) =>
        commitCell(placementId, metricKey, parseCellValue(e.target.value))
      }
      onBlur={(e) => {
        e.target.value = formatCellValue(
          parseCellValue(e.target.value),
          unit,
        );
      }}
      className="w-full text-right font-mono text-[12.5px] rounded border border-[#fde68a] bg-[#fffbea] px-2 py-1 focus:outline-none focus:border-accent focus:bg-white focus:ring-2 focus:ring-accent-soft"
    />
  );
}
