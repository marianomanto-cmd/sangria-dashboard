"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { fetchBenchmarkDetail } from "@/app/actions/simulator";
import type { BenchmarkPlacementDetail } from "@/db/queries/simulator";
import { formatUsd } from "@/lib/format";
import type { BenchmarkFilters, BenchmarkRow } from "@/lib/simulator-types";

export function BenchmarkDetailDrawer(props: {
  open: boolean;
  onClose: () => void;
  row: BenchmarkRow | null;
  filters: BenchmarkFilters;
}) {
  if (!props.open || !props.row) return null;
  // Pasamos row no-nulo al inner para que el useEffect arranque limpio en
  // cada apertura (gate por mount/unmount).
  return <BenchmarkDetailDrawerInner {...props} row={props.row} />;
}

function BenchmarkDetailDrawerInner({
  onClose,
  row,
  filters,
}: {
  onClose: () => void;
  row: BenchmarkRow;
  filters: BenchmarkFilters;
}) {
  const [details, setDetails] = useState<BenchmarkPlacementDetail[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchBenchmarkDetail({
      filters,
      publisherId: row.publisherId,
      marketId: row.marketId,
      costMethod: row.costMethod,
    }).then((d) => {
      if (cancelled) return;
      setDetails(d);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [row, filters]);

  // Esc cierra el drawer
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm flex items-stretch justify-end"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl bg-paper border-l border-line shadow-xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sticky top-0 bg-paper border-b border-line px-5 py-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted font-medium">
              Drilldown del benchmark
            </p>
            <h2 className="text-base font-semibold text-ink mt-1">
              {row.publisherName}
              {row.marketName && (
                <span className="text-muted font-normal"> · {row.marketName}</span>
              )}
              {row.costMethod && (
                <span className="text-muted font-normal"> · {row.costMethod}</span>
              )}
            </h2>
            <p className="text-xs text-muted mt-1">
              {row.placements} placements observados · spend total{" "}
              {formatUsd(row.totalSpendUsd)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-muted hover:text-ink hover:bg-paper-2"
            aria-label="Cerrar"
          >
            <X size={16} />
          </button>
        </header>

        <div className="p-5">
          {loading ? (
            <p className="text-sm text-muted">Cargando placements…</p>
          ) : details.length === 0 ? (
            <p className="text-sm text-muted">Sin placements en este rango.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line bg-white dark:bg-paper-2">
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase tracking-wider text-muted bg-paper-2/60">
                  <tr className="border-b border-line">
                    <th className="px-2 py-2 text-left">Proyecto · Plan</th>
                    <th className="px-2 py-2 text-left">Placement</th>
                    <th className="px-2 py-2">Cierre</th>
                    <th className="px-2 py-2 text-right">Real</th>
                    <th className="px-2 py-2 text-right">Goal</th>
                    <th className="px-2 py-2 text-right">CPM</th>
                    <th className="px-2 py-2 text-right">CPC</th>
                    <th className="px-2 py-2 text-right">CPV</th>
                    <th className="px-2 py-2 text-right">CTR</th>
                  </tr>
                </thead>
                <tbody>
                  {details.map((d) => (
                    <tr key={d.placementId} className="border-b border-line/60">
                      <td className="px-2 py-1.5">
                        <div className="text-ink-2 truncate max-w-[180px]">
                          {d.projectName}
                        </div>
                        <div className="text-muted text-[10px] truncate max-w-[180px]">
                          {d.planName}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-ink-2 truncate max-w-[160px]">
                        {d.placementName}
                      </td>
                      <td className="px-2 py-1.5 text-center text-muted tabular-nums">
                        {d.snapshotDate}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {formatUsd(d.amountReal)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted">
                        {d.amountGoal != null ? formatUsd(d.amountGoal) : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {d.cpm != null ? `$${d.cpm.toFixed(2)}` : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {d.cpc != null ? `$${d.cpc.toFixed(2)}` : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {d.cpv != null ? `$${d.cpv.toFixed(3)}` : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {d.ctr != null ? `${d.ctr.toFixed(1)}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-[11px] text-muted">
            Cada fila es un placement con su snapshot más reciente dentro del
            rango filtrado.
          </p>
        </div>
      </div>
    </div>
  );
}
