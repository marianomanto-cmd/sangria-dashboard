"use client";

import { useState, useTransition } from "react";
import { Plus, Save, Trash2, Copy, Wand2, Rocket } from "lucide-react";
import {
  createScenario,
  deleteScenario,
  duplicateScenario,
  fetchScenario,
  updateScenario,
} from "@/app/actions/simulator";
import type {
  ScenarioSummary,
  SimulatorCatalogs,
} from "@/db/queries/simulator";
import { formatUsd } from "@/lib/format";
import { useConfirm } from "@/components/confirm-dialog";
import type { BenchmarkRow, ScenarioRow } from "@/lib/simulator-types";
import {
  MODES,
  aggregateTotals,
  effectiveRates,
  estimateDelivery,
  findBenchmark,
  newRow,
} from "./builder-helpers";
import { PromoteDialog } from "./promote-dialog";

type EditingState = {
  scenarioId: string | null;        // null = no guardado
  name: string;
  rows: ScenarioRow[];
  dirty: boolean;
};

const BLANK: EditingState = {
  scenarioId: null,
  name: "",
  rows: [newRow()],
  dirty: false,
};

export function BuilderTab({
  clientId,
  benchmarks,
  catalogs,
  scenarios,
  onScenariosChange,
}: {
  clientId: string;
  benchmarks: BenchmarkRow[];
  catalogs: SimulatorCatalogs;
  scenarios: ScenarioSummary[];
  onScenariosChange: (next: ScenarioSummary[]) => void;
}) {
  const [editing, setEditing] = useState<EditingState>(BLANK);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [promoteOpen, setPromoteOpen] = useState(false);
  const confirm = useConfirm();

  const confirmDiscard = () =>
    confirm({
      title: "Hay cambios sin guardar",
      body: "Si continuás, se descartan los cambios del escenario actual.",
      confirmLabel: "Descartar",
      danger: true,
    });

  const totals = aggregateTotals(editing.rows, benchmarks);

  // Cargar un escenario existente (read action).
  const loadScenario = async (id: string) => {
    if (editing.dirty && !(await confirmDiscard())) return;
    setError(null);
    startTransition(async () => {
      const sc = await fetchScenario(id);
      if (!sc) {
        setError("Escenario no encontrado");
        return;
      }
      // Aseguramos que cada row tenga id local; los guardados de antes
      // podrían no traerlos si vinieran de otra fuente.
      const normalized = sc.rowsJson.rows.map((r) => ({
        ...r,
        id: r.id ?? crypto.randomUUID(),
      }));
      setEditing({
        scenarioId: sc.id,
        name: sc.name,
        rows: normalized.length ? normalized : [newRow()],
        dirty: false,
      });
    });
  };

  const newBlank = async () => {
    if (editing.dirty && !(await confirmDiscard())) return;
    setError(null);
    setEditing({ ...BLANK, rows: [newRow()] });
  };

  const updateRow = (id: string, patch: Partial<ScenarioRow>) => {
    setEditing((e) => ({
      ...e,
      rows: e.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)),
      dirty: true,
    }));
  };

  const addRow = () => {
    setEditing((e) => ({ ...e, rows: [...e.rows, newRow()], dirty: true }));
  };

  const removeRow = (id: string) => {
    setEditing((e) => ({
      ...e,
      rows: e.rows.filter((r) => r.id !== id),
      dirty: true,
    }));
  };

  const save = (asNew = false) => {
    setError(null);
    const name = editing.name.trim();
    if (!name) {
      setError("El escenario necesita un nombre");
      return;
    }
    startTransition(async () => {
      if (editing.scenarioId && !asNew) {
        const res = await updateScenario({
          id: editing.scenarioId,
          name,
          rowsJson: { rows: editing.rows },
        });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setEditing((e) => ({ ...e, dirty: false }));
      } else {
        const res = await createScenario({
          clientId,
          name,
          rowsJson: { rows: editing.rows },
        });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setEditing((e) => ({ ...e, scenarioId: res.data!.id, dirty: false }));
      }
      // Refrescar lista de escenarios — re-fetch del server.
      // Para no agregar otra action, le mandamos a Compare/Builder un push
      // optimista: agregamos/actualizamos la fila en el array.
      // Acá la solución más simple: recargar haciendo un refetch del list
      // via la propia página. Como no tenemos eso, optimistic update:
      const optimisticBudget = editing.rows.reduce((s, r) => s + (r.budgetUsd || 0), 0);
      const updatedAt = new Date().toISOString();
      const next: ScenarioSummary[] = (() => {
        const existing = scenarios.find(
          (s) => s.id === (editing.scenarioId ?? "__new__"),
        );
        if (existing && !asNew) {
          return scenarios.map((s) =>
            s.id === editing.scenarioId
              ? {
                  ...s,
                  name,
                  rowCount: editing.rows.length,
                  totalBudgetUsd: optimisticBudget,
                  updatedAt,
                }
              : s,
          );
        }
        const id =
          editing.scenarioId && !asNew ? editing.scenarioId : "tmp-" + Date.now();
        return [
          {
            id,
            name,
            rowCount: editing.rows.length,
            totalBudgetUsd: optimisticBudget,
            updatedAt,
          },
          ...scenarios,
        ];
      })();
      onScenariosChange(next);
    });
  };

  const remove = async (id: string) => {
    if (!(await confirm({ title: "¿Borrar escenario?", confirmLabel: "Borrar", danger: true }))) return;
    startTransition(async () => {
      const res = await deleteScenario({ id });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onScenariosChange(scenarios.filter((s) => s.id !== id));
      if (editing.scenarioId === id) {
        setEditing(BLANK);
      }
    });
  };

  const duplicate = (id: string) => {
    startTransition(async () => {
      const res = await duplicateScenario({ id });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Igual que save: refresco optimista — la próxima navegación trae el
      // estado real.
      const src = scenarios.find((s) => s.id === id);
      if (src) {
        onScenariosChange([
          {
            id: res.data!.id,
            name: `${src.name} (copia)`,
            rowCount: src.rowCount,
            totalBudgetUsd: src.totalBudgetUsd,
            updatedAt: new Date().toISOString(),
          },
          ...scenarios,
        ]);
      }
    });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-5">
      {/* Sidebar de escenarios guardados */}
      <aside className="rounded-lg border border-line bg-white dark:bg-paper-2 p-3 h-fit lg:sticky lg:top-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs uppercase tracking-wider text-muted font-medium">
            Escenarios
          </h3>
          <button
            type="button"
            onClick={newBlank}
            className="text-xs flex items-center gap-1 text-accent hover:underline"
          >
            <Plus size={12} /> Nuevo
          </button>
        </div>
        {scenarios.length === 0 ? (
          <p className="text-xs text-muted py-3">
            Sin escenarios guardados aún.
          </p>
        ) : (
          <ul className="space-y-1">
            {scenarios.map((s) => {
              const active = editing.scenarioId === s.id;
              return (
                <li
                  key={s.id}
                  className={`group rounded-md px-2 py-1.5 text-xs cursor-pointer ${
                    active
                      ? "bg-accent/10 border border-accent/30"
                      : "hover:bg-paper-2 border border-transparent"
                  }`}
                  onClick={() => loadScenario(s.id)}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate font-medium text-ink">
                      {s.name}
                    </span>
                    <div className="flex gap-0.5 opacity-0 group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          duplicate(s.id);
                        }}
                        className="p-1 text-muted hover:text-ink-2"
                        title="Duplicar"
                      >
                        <Copy size={11} />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          remove(s.id);
                        }}
                        className="p-1 text-muted hover:text-rose-500"
                        title="Borrar"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                  <div className="text-muted mt-0.5 flex items-center justify-between">
                    <span>{s.rowCount} líneas</span>
                    <span className="tabular-nums">
                      {formatUsd(s.totalBudgetUsd)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      <div>
        {/* Header: nombre + acciones */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <input
            type="text"
            value={editing.name}
            onChange={(e) =>
              setEditing((s) => ({ ...s, name: e.target.value, dirty: true }))
            }
            placeholder="Nombre del escenario (ej. Q3 — Awareness LATAM)"
            className="flex-1 min-w-[240px] text-sm px-3 py-2 rounded-md border border-line bg-white dark:bg-paper-2"
          />
          <button
            type="button"
            onClick={() => save(false)}
            disabled={pending}
            className="text-xs px-3 py-2 rounded-md bg-accent text-white hover:bg-accent/90 disabled:opacity-50 flex items-center gap-1.5"
          >
            <Save size={12} />
            {editing.scenarioId ? "Guardar" : "Crear"}
          </button>
          {editing.scenarioId && (
            <button
              type="button"
              onClick={() => save(true)}
              disabled={pending}
              className="text-xs px-3 py-2 rounded-md border border-line text-muted hover:text-ink-2 disabled:opacity-50"
            >
              Guardar como nuevo
            </button>
          )}
          {editing.scenarioId && !editing.dirty && (
            <button
              type="button"
              onClick={() => setPromoteOpen(true)}
              disabled={pending}
              className="text-xs px-3 py-2 rounded-md border border-accent/40 text-accent hover:bg-accent/10 disabled:opacity-50 flex items-center gap-1.5"
              title="Crear un media plan real desde este escenario"
            >
              <Rocket size={12} />
              Promover a plan
            </button>
          )}
        </div>
        {error && (
          <div className="mb-3 text-xs text-rose-600 dark:text-rose-400 rounded-md border border-rose-300/40 bg-rose-50 dark:bg-rose-950/30 px-3 py-2">
            {error}
          </div>
        )}

        {/* Tabla de filas */}
        <div className="overflow-x-auto rounded-lg border border-line bg-white dark:bg-paper-2">
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-muted bg-paper-2/60">
              <tr className="border-b border-line">
                <th className="px-2 py-2 text-left">Publisher</th>
                <th className="px-2 py-2 text-left">Mercado</th>
                <th className="px-2 py-2 text-left">Formato</th>
                <th className="px-2 py-2 text-left">Cost method</th>
                <th className="px-2 py-2 text-right">Budget USD</th>
                <th className="px-2 py-2">Modo</th>
                <th className="px-2 py-2 text-right" title="CPM efectivo">CPM</th>
                <th className="px-2 py-2 text-right" title="CPC efectivo">CPC</th>
                <th className="px-2 py-2 text-right" title="CPV efectivo">CPV</th>
                <th className="px-2 py-2 text-right" title="Impresiones estimadas">Imps</th>
                <th className="px-2 py-2 text-right" title="Clicks estimados">Clicks</th>
                <th className="px-2 py-2 text-right" title="Views estimadas">Views</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {editing.rows.map((row) => (
                <BuilderRow
                  key={row.id}
                  row={row}
                  catalogs={catalogs}
                  benchmarks={benchmarks}
                  onChange={(patch) => updateRow(row.id, patch)}
                  onRemove={() => removeRow(row.id)}
                />
              ))}
            </tbody>
            <tfoot className="bg-paper-2/40 border-t border-line">
              <tr>
                <td colSpan={4} className="px-2 py-2 text-right text-muted">
                  Total
                </td>
                <td className="px-2 py-2 text-right font-semibold text-ink tabular-nums">
                  {formatUsd(totals.budgetUsd)}
                </td>
                <td></td>
                <td className="px-2 py-2 text-right text-ink-2 tabular-nums">
                  {totals.blendedCpm != null ? `$${totals.blendedCpm.toFixed(2)}` : "—"}
                </td>
                <td className="px-2 py-2 text-right text-ink-2 tabular-nums">
                  {totals.blendedCpc != null ? `$${totals.blendedCpc.toFixed(2)}` : "—"}
                </td>
                <td className="px-2 py-2 text-right text-ink-2 tabular-nums">
                  {totals.blendedCpv != null ? `$${totals.blendedCpv.toFixed(3)}` : "—"}
                </td>
                <td className="px-2 py-2 text-right font-semibold text-ink tabular-nums">
                  {totals.impressions ? formatInt(totals.impressions) : "—"}
                </td>
                <td className="px-2 py-2 text-right font-semibold text-ink tabular-nums">
                  {totals.clicks ? formatInt(totals.clicks) : "—"}
                </td>
                <td className="px-2 py-2 text-right font-semibold text-ink tabular-nums">
                  {totals.views ? formatInt(totals.views) : "—"}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={addRow}
            className="text-xs px-2 py-1 rounded-md border border-line text-muted hover:text-ink-2 flex items-center gap-1"
          >
            <Plus size={12} /> Agregar línea
          </button>
          <span className="text-[11px] text-muted ml-2">
            <Wand2 size={10} className="inline mr-1" />
            El modo P25/P50/P75 autocompleta CPM/CPC desde el benchmark del
            mismo publisher × mercado × cost method.
          </span>
        </div>
      </div>

      <PromoteDialog
        open={promoteOpen}
        onClose={() => setPromoteOpen(false)}
        clientId={clientId}
        scenarioId={editing.scenarioId}
        defaultPlanName={editing.name || "Nuevo plan"}
      />
    </div>
  );
}

function BuilderRow({
  row,
  catalogs,
  benchmarks,
  onChange,
  onRemove,
}: {
  row: ScenarioRow;
  catalogs: SimulatorCatalogs;
  benchmarks: BenchmarkRow[];
  onChange: (patch: Partial<ScenarioRow>) => void;
  onRemove: () => void;
}) {
  const bench = findBenchmark(benchmarks, row);
  const rates = effectiveRates(row, bench);
  const est = estimateDelivery(row, rates);
  const noMatch = !bench && row.publisherId;

  // Al cambiar a manual sin overrides previos, sembramos los overrides con
  // los valores del benchmark p50 — evita arrancar todos los rates en cero.
  const onModeChange = (mode: ScenarioRow["mode"]) => {
    if (
      mode === "manual" &&
      Object.keys(row.overrides).length === 0 &&
      bench
    ) {
      onChange({
        mode,
        overrides: {
          cpm: bench.cpm.p50 ?? undefined,
          cpc: bench.cpc.p50 ?? undefined,
          cpv: bench.cpv.p50 ?? undefined,
          ctr: bench.ctr.p50 ?? undefined,
        },
      });
    } else {
      onChange({ mode });
    }
  };

  return (
    <tr className="border-b border-line/60 align-top">
      <td className="px-2 py-1.5">
        <select
          value={row.publisherId ?? ""}
          onChange={(e) => onChange({ publisherId: e.target.value || null })}
          className="text-xs px-1 py-1 rounded border border-line bg-paper w-full"
        >
          <option value="">—</option>
          {catalogs.publishers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-1.5">
        <select
          value={row.marketId ?? ""}
          onChange={(e) => onChange({ marketId: e.target.value || null })}
          className="text-xs px-1 py-1 rounded border border-line bg-paper w-full"
        >
          <option value="">—</option>
          {catalogs.markets.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-1.5">
        <input
          type="text"
          value={row.formatText ?? ""}
          onChange={(e) => onChange({ formatText: e.target.value || null })}
          placeholder="In-stream, Display…"
          className="text-xs px-1 py-1 rounded border border-line bg-paper w-full"
        />
      </td>
      <td className="px-2 py-1.5">
        <select
          value={row.costMethod ?? ""}
          onChange={(e) => onChange({ costMethod: e.target.value || null })}
          className="text-xs px-1 py-1 rounded border border-line bg-paper w-full"
        >
          <option value="">—</option>
          {catalogs.costMethods.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-1.5 text-right">
        <input
          type="number"
          min={0}
          step={100}
          value={row.budgetUsd || ""}
          onChange={(e) =>
            onChange({ budgetUsd: Math.max(0, Number(e.target.value) || 0) })
          }
          className="text-xs px-1 py-1 rounded border border-line bg-paper w-24 text-right tabular-nums"
        />
      </td>
      <td className="px-2 py-1.5">
        <select
          value={row.mode}
          onChange={(e) => onModeChange(e.target.value as ScenarioRow["mode"])}
          className="text-xs px-1 py-1 rounded border border-line bg-paper"
          title={MODES.find((m) => m.value === row.mode)?.hint}
        >
          {MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        {noMatch && (
          <div className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">
            sin benchmark
          </div>
        )}
      </td>
      {/* CPM */}
      <RateCell
        value={rates.cpm}
        manual={row.mode === "manual"}
        onChange={(v) => onChange({ overrides: { ...row.overrides, cpm: v } })}
        decimals={2}
      />
      <RateCell
        value={rates.cpc}
        manual={row.mode === "manual"}
        onChange={(v) => onChange({ overrides: { ...row.overrides, cpc: v } })}
        decimals={2}
      />
      <RateCell
        value={rates.cpv}
        manual={row.mode === "manual"}
        onChange={(v) => onChange({ overrides: { ...row.overrides, cpv: v } })}
        decimals={3}
      />
      <td className="px-2 py-1.5 text-right tabular-nums text-ink-2">
        {est.impressions ? formatInt(est.impressions) : "—"}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums text-ink-2">
        {est.clicks ? formatInt(est.clicks) : "—"}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums text-ink-2">
        {est.views ? formatInt(est.views) : "—"}
      </td>
      <td className="px-1 py-1.5 text-center">
        <button
          type="button"
          onClick={onRemove}
          className="text-muted hover:text-rose-500"
          title="Quitar línea"
        >
          <Trash2 size={12} />
        </button>
      </td>
    </tr>
  );
}

function RateCell({
  value,
  manual,
  onChange,
  decimals,
}: {
  value: number | null;
  manual: boolean;
  onChange: (v: number | undefined) => void;
  decimals: number;
}) {
  if (manual) {
    return (
      <td className="px-2 py-1.5 text-right">
        <input
          type="number"
          step={Math.pow(10, -decimals)}
          min={0}
          value={value ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === "" ? undefined : Math.max(0, Number(v)));
          }}
          className="text-xs px-1 py-0.5 rounded border border-line bg-paper w-16 text-right tabular-nums"
        />
      </td>
    );
  }
  return (
    <td className="px-2 py-1.5 text-right tabular-nums text-muted">
      {value != null ? `$${value.toFixed(decimals)}` : "—"}
    </td>
  );
}

function formatInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}
