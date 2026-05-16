"use client";

import { useEffect, useState, useTransition } from "react";
import { fetchScenario } from "@/app/actions/simulator";
import type {
  ScenarioSummary,
  SimulatorCatalogs,
} from "@/db/queries/simulator";
import { formatUsd } from "@/lib/format";
import type { BenchmarkRow, ScenarioJson } from "@/lib/simulator-types";
import { aggregateTotals } from "./builder-helpers";

type Loaded = {
  id: string;
  name: string;
  rowsJson: ScenarioJson;
};

export function CompareTab({
  scenarios,
  benchmarks,
}: {
  scenarios: ScenarioSummary[];
  catalogs: SimulatorCatalogs;
  benchmarks: BenchmarkRow[];
}) {
  // selectedIds tiene hasta 3 slots; null = vacío. La selección controlada
  // permite cambiar el escenario de un slot sin perder los otros.
  const [selectedIds, setSelectedIds] = useState<(string | null)[]>([
    null,
    null,
    null,
  ]);
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({});
  const [pending, startTransition] = useTransition();

  // Cargar escenarios faltantes cuando cambia la selección.
  useEffect(() => {
    const toFetch = selectedIds.filter(
      (id): id is string => id != null && !loaded[id],
    );
    if (toFetch.length === 0) return;
    startTransition(async () => {
      const results = await Promise.all(toFetch.map((id) => fetchScenario(id)));
      const next = { ...loaded };
      for (const sc of results) {
        if (sc) next[sc.id] = { id: sc.id, name: sc.name, rowsJson: sc.rowsJson };
      }
      setLoaded(next);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds]);

  const setSlot = (slotIdx: number, id: string | null) => {
    setSelectedIds((s) => s.map((v, i) => (i === slotIdx ? id : v)));
  };

  // Filtra escenarios disponibles para un slot (excluye los ya elegidos en
  // otros slots).
  const availableFor = (slotIdx: number) => {
    const otherIds = new Set(
      selectedIds.filter((id, i) => i !== slotIdx && id != null) as string[],
    );
    return scenarios.filter((s) => !otherIds.has(s.id));
  };

  const cols = selectedIds.map((id, i) => {
    const sc = id ? loaded[id] : null;
    return {
      slotIdx: i,
      id,
      summary: id ? scenarios.find((s) => s.id === id) ?? null : null,
      data: sc,
      totals: sc ? aggregateTotals(sc.rowsJson.rows, benchmarks) : null,
    };
  });

  const hasAnySelected = selectedIds.some((id) => id != null);

  if (scenarios.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-paper-2 p-8 text-center">
        <p className="text-sm text-muted">No hay escenarios guardados todavía.</p>
        <p className="text-xs text-muted mt-2">
          Andá al tab <strong>Builder</strong>, armá un escenario y guardalo.
          Después podés volver acá para compararlo con otros.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Selectores por slot */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        {[0, 1, 2].map((i) => (
          <div key={i}>
            <label className="text-[10px] uppercase tracking-wider text-muted font-medium block mb-1">
              Slot {i + 1}
            </label>
            <select
              value={selectedIds[i] ?? ""}
              onChange={(e) => setSlot(i, e.target.value || null)}
              className="w-full text-xs px-2 py-1.5 rounded-md border border-line bg-white dark:bg-paper-2 text-ink-2"
            >
              <option value="">— Vacío —</option>
              {availableFor(i).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {!hasAnySelected && (
        <div className="rounded-lg border border-dashed border-line bg-paper-2 p-6 text-center text-sm text-muted">
          Elegí al menos un escenario para empezar a comparar.
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
                    {c.data ? (
                      c.data.name
                    ) : c.id ? (
                      <span className="text-muted/60">cargando…</span>
                    ) : (
                      <span className="text-muted/60">—</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <CompareRow
                label="Líneas"
                cols={cols}
                pick={(t, d) => (d ? d.rowsJson.rows.length.toString() : "—")}
              />
              <CompareRow
                label="Budget total"
                cols={cols}
                pick={(t) => (t ? formatUsd(t.budgetUsd) : "—")}
                emphasize
              />
              <CompareRow
                label="Impresiones est."
                cols={cols}
                pick={(t) => (t && t.impressions ? formatInt(t.impressions) : "—")}
              />
              <CompareRow
                label="Clicks est."
                cols={cols}
                pick={(t) => (t && t.clicks ? formatInt(t.clicks) : "—")}
              />
              <CompareRow
                label="Views est."
                cols={cols}
                pick={(t) => (t && t.views ? formatInt(t.views) : "—")}
              />
              <CompareRow
                label="Blended CPM"
                cols={cols}
                pick={(t) =>
                  t && t.blendedCpm != null ? `$${t.blendedCpm.toFixed(2)}` : "—"
                }
              />
              <CompareRow
                label="Blended CPC"
                cols={cols}
                pick={(t) =>
                  t && t.blendedCpc != null ? `$${t.blendedCpc.toFixed(2)}` : "—"
                }
              />
              <CompareRow
                label="Blended CPV"
                cols={cols}
                pick={(t) =>
                  t && t.blendedCpv != null ? `$${t.blendedCpv.toFixed(3)}` : "—"
                }
              />
            </tbody>
          </table>
        </div>
      )}

      {pending && (
        <p className="mt-3 text-xs text-muted">Cargando escenarios…</p>
      )}

      <p className="mt-4 text-xs text-muted max-w-2xl">
        Todas las métricas estimadas usan el cost method y el modo
        (P25/P50/P75/manual) configurado en cada línea del escenario, con los
        benchmarks actuales del cliente.
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
  cols: Array<{
    id: string | null;
    data: Loaded | null;
    totals: ReturnType<typeof aggregateTotals> | null;
  }>;
  pick: (
    totals: ReturnType<typeof aggregateTotals> | null,
    data: Loaded | null,
  ) => string;
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
          {c.id ? pick(c.totals, c.data) : "—"}
        </td>
      ))}
    </tr>
  );
}

function formatInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}
