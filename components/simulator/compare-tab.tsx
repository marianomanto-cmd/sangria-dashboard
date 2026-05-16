"use client";

import { useEffect, useState, useTransition } from "react";
import {
  fetchCompareablePlans,
  fetchScenario,
} from "@/app/actions/simulator";
import type {
  CompareablePlanSummary,
  ScenarioSummary,
  SimulatorCatalogs,
} from "@/db/queries/simulator";
import { formatUsd } from "@/lib/format";
import type { BenchmarkRow, ScenarioJson } from "@/lib/simulator-types";
import { aggregateTotals } from "./builder-helpers";

// Un slot puede tener un escenario o un plan real. Para uniformar el render,
// resolvemos cada slot a un `ColumnView` con las mismas métricas.
type SlotRef =
  | { kind: "scenario"; id: string }
  | { kind: "plan"; id: string }
  | null;

type ColumnView = {
  label: string;
  sublabel: string | null;
  budgetUsd: number;
  impressions: number;
  clicks: number;
  views: number;
  blendedCpm: number | null;
  blendedCpc: number | null;
  blendedCpv: number | null;
  rowCount: number;
};

export function CompareTab({
  clientId,
  scenarios,
  benchmarks,
}: {
  clientId: string;
  scenarios: ScenarioSummary[];
  catalogs: SimulatorCatalogs;
  benchmarks: BenchmarkRow[];
}) {
  const [slots, setSlots] = useState<SlotRef[]>([null, null, null]);
  const [scenarioCache, setScenarioCache] = useState<Record<string, ScenarioJson>>({});
  const [plans, setPlans] = useState<CompareablePlanSummary[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [pending, startTransition] = useTransition();

  // Carga inicial de planes comparables (planes approved/ready_to_send del
  // cliente actual). Se cachea al montar el tab.
  useEffect(() => {
    let cancelled = false;
    fetchCompareablePlans(clientId).then((p) => {
      if (cancelled) return;
      setPlans(p);
      setLoadingPlans(false);
    });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  // Cargar escenarios faltantes cuando cambia la selección.
  useEffect(() => {
    const toFetch = slots
      .filter((s): s is { kind: "scenario"; id: string } => s?.kind === "scenario")
      .map((s) => s.id)
      .filter((id) => !scenarioCache[id]);
    if (toFetch.length === 0) return;
    startTransition(async () => {
      const results = await Promise.all(toFetch.map((id) => fetchScenario(id)));
      const next = { ...scenarioCache };
      for (const sc of results) {
        if (sc) next[sc.id] = sc.rowsJson;
      }
      setScenarioCache(next);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots]);

  const setSlot = (slotIdx: number, val: SlotRef) => {
    setSlots((s) => s.map((v, i) => (i === slotIdx ? val : v)));
  };

  const parseSelectValue = (raw: string): SlotRef => {
    if (!raw) return null;
    const [kind, id] = raw.split(":");
    if (kind !== "scenario" && kind !== "plan") return null;
    return { kind, id };
  };

  // Opciones disponibles para un slot (excluye lo elegido en otros slots).
  const availableFor = (slotIdx: number) => {
    const taken = new Set(
      slots
        .filter((s, i) => i !== slotIdx && s != null)
        .map((s) => `${s!.kind}:${s!.id}`),
    );
    return {
      scenarios: scenarios.filter((s) => !taken.has(`scenario:${s.id}`)),
      plans: plans.filter((p) => !taken.has(`plan:${p.planId}`)),
    };
  };

  const resolveSlot = (slot: SlotRef): ColumnView | null => {
    if (!slot) return null;
    if (slot.kind === "scenario") {
      const summary = scenarios.find((s) => s.id === slot.id);
      const json = scenarioCache[slot.id];
      if (!summary) return null;
      if (!json) {
        return {
          label: summary.name,
          sublabel: "cargando…",
          budgetUsd: 0,
          impressions: 0,
          clicks: 0,
          views: 0,
          blendedCpm: null,
          blendedCpc: null,
          blendedCpv: null,
          rowCount: summary.rowCount,
        };
      }
      const totals = aggregateTotals(json.rows, benchmarks);
      return {
        label: summary.name,
        sublabel: "Escenario",
        ...totals,
        rowCount: json.rows.length,
      };
    }
    // plan real
    const plan = plans.find((p) => p.planId === slot.id);
    if (!plan) return null;
    return {
      label: plan.planName,
      sublabel: `Plan ${plan.status} · ${plan.projectName}`,
      budgetUsd: plan.budgetUsd,
      impressions: plan.impressions,
      clicks: plan.clicks,
      views: plan.views,
      blendedCpm: plan.blendedCpm,
      blendedCpc: plan.blendedCpc,
      blendedCpv: plan.blendedCpv,
      rowCount: 0, // no aplica para planes
    };
  };

  const cols = slots.map((slot) => resolveSlot(slot));
  const hasAnySelected = slots.some((s) => s != null);

  if (scenarios.length === 0 && !loadingPlans && plans.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-paper-2 p-8 text-center">
        <p className="text-sm text-muted">
          No hay escenarios guardados ni planes aprobados para comparar.
        </p>
        <p className="text-xs text-muted mt-2">
          Andá al tab <strong>Builder</strong> y armá un escenario, o aprobá
          un plan en algún proyecto del cliente.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        {[0, 1, 2].map((i) => {
          const slot = slots[i];
          const value = slot ? `${slot.kind}:${slot.id}` : "";
          const avail = availableFor(i);
          return (
            <div key={i}>
              <label className="text-[10px] uppercase tracking-wider text-muted font-medium block mb-1">
                Slot {i + 1}
              </label>
              <select
                value={value}
                onChange={(e) => setSlot(i, parseSelectValue(e.target.value))}
                className="w-full text-xs px-2 py-1.5 rounded-md border border-line bg-white dark:bg-paper-2 text-ink-2"
              >
                <option value="">— Vacío —</option>
                {avail.scenarios.length > 0 && (
                  <optgroup label="Escenarios">
                    {avail.scenarios.map((s) => (
                      <option key={s.id} value={`scenario:${s.id}`}>
                        {s.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {avail.plans.length > 0 && (
                  <optgroup label="Planes reales (goals)">
                    {avail.plans.map((p) => (
                      <option key={p.planId} value={`plan:${p.planId}`}>
                        {p.projectName} · {p.planName}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
          );
        })}
      </div>

      {!hasAnySelected && (
        <div className="rounded-lg border border-dashed border-line bg-paper-2 p-6 text-center text-sm text-muted">
          Elegí al menos un escenario o plan para empezar a comparar.
        </div>
      )}

      {hasAnySelected && (
        <div className="overflow-x-auto rounded-lg border border-line bg-white dark:bg-paper-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-paper-2/60">
                <th className="px-3 py-2 text-left text-[11px] uppercase tracking-wider text-muted font-medium">
                  Métrica
                </th>
                {cols.map((c, idx) => (
                  <th
                    key={idx}
                    className="px-3 py-2 text-right text-[11px] uppercase tracking-wider text-muted font-medium"
                  >
                    {c ? (
                      <>
                        <div className="text-ink normal-case tracking-normal">
                          {c.label}
                        </div>
                        {c.sublabel && (
                          <div className="text-[10px] text-muted/70 normal-case tracking-normal font-normal mt-0.5">
                            {c.sublabel}
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="text-muted/60">—</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <CompareRow
                label="Budget total"
                cols={cols}
                pick={(c) => formatUsd(c.budgetUsd)}
                emphasize
              />
              <CompareRow
                label="Impresiones"
                cols={cols}
                pick={(c) => (c.impressions ? formatInt(c.impressions) : "—")}
              />
              <CompareRow
                label="Clicks"
                cols={cols}
                pick={(c) => (c.clicks ? formatInt(c.clicks) : "—")}
              />
              <CompareRow
                label="Views"
                cols={cols}
                pick={(c) => (c.views ? formatInt(c.views) : "—")}
              />
              <CompareRow
                label="Blended CPM"
                cols={cols}
                pick={(c) =>
                  c.blendedCpm != null ? `$${c.blendedCpm.toFixed(2)}` : "—"
                }
              />
              <CompareRow
                label="Blended CPC"
                cols={cols}
                pick={(c) =>
                  c.blendedCpc != null ? `$${c.blendedCpc.toFixed(2)}` : "—"
                }
              />
              <CompareRow
                label="Blended CPV"
                cols={cols}
                pick={(c) =>
                  c.blendedCpv != null ? `$${c.blendedCpv.toFixed(3)}` : "—"
                }
              />
            </tbody>
          </table>
        </div>
      )}

      {pending && (
        <p className="mt-3 text-xs text-muted">Cargando…</p>
      )}

      <p className="mt-4 text-xs text-muted max-w-2xl">
        Los <strong>escenarios</strong> usan los rates del modo elegido en
        cada fila (P25/P50/P75/manual) para estimar impresiones/clicks/views.
        Los <strong>planes reales</strong> agregan los goals tal como están
        cargados en sus placements — son la fuente de verdad del plan
        aprobado.
      </p>
    </div>
  );
}

function CompareRow({
  label,
  cols,
  pick,
  emphasize = false,
}: {
  label: string;
  cols: Array<ColumnView | null>;
  pick: (c: ColumnView) => string;
  emphasize?: boolean;
}) {
  return (
    <tr className="border-b border-line/60">
      <td className="px-3 py-2 text-left text-muted">{label}</td>
      {cols.map((c, idx) => (
        <td
          key={idx}
          className={`px-3 py-2 text-right tabular-nums ${
            emphasize ? "font-semibold text-ink" : "text-ink-2"
          }`}
        >
          {c ? pick(c) : "—"}
        </td>
      ))}
    </tr>
  );
}

function formatInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}
