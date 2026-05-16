"use client";

import { useState, useTransition } from "react";
import { fetchBenchmarks } from "@/app/actions/simulator";
import type { SimulatorCatalogs } from "@/db/queries/simulator";
import { formatUsd } from "@/lib/format";
import type { BenchmarkRow } from "@/lib/simulator-types";

export function BenchmarksTab({
  clientId,
  initialRows,
  catalogs,
}: {
  clientId: string;
  initialRows: BenchmarkRow[];
  catalogs: SimulatorCatalogs;
}) {
  const [rows, setRows] = useState<BenchmarkRow[]>(initialRows);
  const [publisherId, setPublisherId] = useState<string>("");
  const [marketId, setMarketId] = useState<string>("");
  const [costMethod, setCostMethod] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [pending, startTransition] = useTransition();

  const applyFilters = () => {
    startTransition(async () => {
      const next = await fetchBenchmarks({
        clientId,
        publisherId: publisherId || null,
        marketId: marketId || null,
        costMethod: costMethod || null,
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
      });
      setRows(next);
    });
  };

  const clearFilters = () => {
    setPublisherId("");
    setMarketId("");
    setCostMethod("");
    setDateFrom("");
    setDateTo("");
    startTransition(async () => {
      const next = await fetchBenchmarks({ clientId });
      setRows(next);
    });
  };

  return (
    <div>
      <div className="rounded-lg border border-line bg-paper-2 p-4 mb-5 grid grid-cols-2 md:grid-cols-6 gap-3 items-end">
        <FilterSelect
          label="Publisher"
          value={publisherId}
          onChange={setPublisherId}
          options={catalogs.publishers.map((p) => ({ value: p.id, label: p.name }))}
        />
        <FilterSelect
          label="Mercado"
          value={marketId}
          onChange={setMarketId}
          options={catalogs.markets.map((m) => ({ value: m.id, label: m.name }))}
        />
        <FilterSelect
          label="Cost method"
          value={costMethod}
          onChange={setCostMethod}
          options={catalogs.costMethods.map((c) => ({ value: c, label: c }))}
        />
        <FilterDate label="Desde" value={dateFrom} onChange={setDateFrom} />
        <FilterDate label="Hasta" value={dateTo} onChange={setDateTo} />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={applyFilters}
            disabled={pending}
            className="text-xs px-3 py-1.5 rounded-md bg-accent text-white hover:bg-accent/90 disabled:opacity-50"
          >
            {pending ? "Buscando…" : "Aplicar"}
          </button>
          <button
            type="button"
            onClick={clearFilters}
            disabled={pending}
            className="text-xs px-3 py-1.5 rounded-md border border-line text-muted hover:text-ink-2"
          >
            Limpiar
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-paper-2 p-8 text-center">
          <p className="text-sm text-muted">
            Sin datos para los filtros actuales.
          </p>
          <p className="text-xs text-muted mt-2 max-w-md mx-auto">
            Los benchmarks se construyen con placements de proyectos cerrados
            que tienen snapshot de actuals del Campaign Tracker. A medida que
            se cierren más proyectos, esta tabla crece.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-white dark:bg-paper-2">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-muted bg-paper-2/60">
              <tr className="border-b border-line">
                <Th className="text-left">Publisher</Th>
                <Th className="text-left">Mercado</Th>
                <Th>Cost method</Th>
                <Th title="Cantidad de placements con data agregada">N</Th>
                <Th title="Inversión total agregada de la muestra">Spend</Th>
                <Th title="Mediana de real ÷ goal (cuando hay goal)">Delivery</Th>
                <Th colSpan={3} className="border-l border-line">CPM (p25 · p50 · p75)</Th>
                <Th colSpan={3} className="border-l border-line">CPC</Th>
                <Th colSpan={3} className="border-l border-line">CPV</Th>
                <Th colSpan={3} className="border-l border-line">CTR %</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={`${r.publisherId}|${r.marketId ?? "_"}|${r.costMethod ?? "_"}`}
                  className="border-b border-line/60 hover:bg-paper-2/40"
                >
                  <Td className="text-left font-medium text-ink">
                    {r.publisherName}
                  </Td>
                  <Td className="text-left text-ink-2">
                    {r.marketName ?? <span className="text-muted">—</span>}
                  </Td>
                  <Td>
                    {r.costMethod ? (
                      <span className="px-1.5 py-0.5 rounded bg-paper-2 border border-line text-[11px]">
                        {r.costMethod}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </Td>
                  <Td className="text-ink-2 tabular-nums">{r.placements}</Td>
                  <Td className="tabular-nums text-ink-2">
                    {formatUsd(r.totalSpendUsd)}
                  </Td>
                  <Td className="tabular-nums">
                    {r.deliveryPctMedian == null ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <span
                        className={
                          r.deliveryPctMedian >= 95 && r.deliveryPctMedian <= 110
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-amber-600 dark:text-amber-400"
                        }
                      >
                        {r.deliveryPctMedian.toFixed(0)}%
                      </span>
                    )}
                  </Td>
                  <PCells bundle={r.cpm} prefix="$" />
                  <PCells bundle={r.cpc} prefix="$" />
                  <PCells bundle={r.cpv} prefix="$" />
                  <PCells bundle={r.ctr} suffix="%" />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-muted max-w-2xl">
        Cada fila agrega placements con la misma combinación{" "}
        <em>publisher × mercado × cost method</em>. Los percentiles se calculan
        sobre métricas derivadas por placement (CPM = spend / impressions × 1000,
        etc.). La columna <em>Delivery</em> es la mediana de inversión real ÷
        goal congelado al cierre.
      </p>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-muted font-medium">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-xs px-2 py-1.5 rounded-md border border-line bg-white dark:bg-paper-2 text-ink-2"
      >
        <option value="">Todos</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function FilterDate({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-muted font-medium">
        {label}
      </span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-xs px-2 py-1.5 rounded-md border border-line bg-white dark:bg-paper-2 text-ink-2"
      />
    </label>
  );
}

function Th({
  children,
  className = "",
  colSpan,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  colSpan?: number;
  title?: string;
}) {
  return (
    <th
      colSpan={colSpan}
      title={title}
      className={`px-3 py-2 font-medium text-center ${className}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-3 py-2 text-center ${className}`}>{children}</td>;
}

function PCells({
  bundle,
  prefix = "",
  suffix = "",
}: {
  bundle: { p25: number | null; p50: number | null; p75: number | null };
  prefix?: string;
  suffix?: string;
}) {
  const fmt = (v: number | null) => {
    if (v == null) return "—";
    if (prefix === "$") {
      return `${prefix}${v < 1 ? v.toFixed(2) : v.toFixed(2)}${suffix}`;
    }
    return `${prefix}${v.toFixed(1)}${suffix}`;
  };
  return (
    <>
      <td className="px-2 py-2 text-center text-[11px] text-muted tabular-nums border-l border-line/60">
        {fmt(bundle.p25)}
      </td>
      <td className="px-2 py-2 text-center text-xs text-ink tabular-nums font-medium">
        {fmt(bundle.p50)}
      </td>
      <td className="px-2 py-2 text-center text-[11px] text-muted tabular-nums">
        {fmt(bundle.p75)}
      </td>
    </>
  );
}
