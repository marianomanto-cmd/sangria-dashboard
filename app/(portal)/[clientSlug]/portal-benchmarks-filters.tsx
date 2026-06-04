"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import type { SimulatorCatalogs } from "@/db/queries/simulator";

// Filtros del tab Benchmarks del portal (read-only, URL-based con GET — no usa
// Server Actions, a diferencia del simulador interno). Params: bp/bm/bcm/bfrom/bto.
export function PortalBenchmarksFilters({
  catalogs,
}: {
  catalogs: SimulatorCatalogs;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const cur = (k: string) => searchParams?.get(k) ?? "";

  const update = (k: string, v: string) => {
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    if (v) next.set(k, v);
    else next.delete(k);
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  const reset = () => {
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    for (const k of ["bp", "bm", "bcm", "bfrom", "bto"]) next.delete(k);
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  const filtered =
    !!cur("bp") || !!cur("bm") || !!cur("bcm") || !!cur("bfrom") || !!cur("bto");

  return (
    <div className="rounded-lg border border-line bg-white dark:bg-paper-2 p-4 mb-5 grid grid-cols-2 md:grid-cols-6 gap-3 items-end">
      <Sel
        label="Publisher"
        value={cur("bp")}
        onChange={(v) => update("bp", v)}
        options={catalogs.publishers.map((p) => ({ value: p.id, label: p.name }))}
      />
      <Sel
        label="Mercado"
        value={cur("bm")}
        onChange={(v) => update("bm", v)}
        options={catalogs.markets.map((m) => ({ value: m.id, label: m.name }))}
      />
      <Sel
        label="Cost method"
        value={cur("bcm")}
        onChange={(v) => update("bcm", v)}
        options={catalogs.costMethods.map((c) => ({ value: c, label: c }))}
      />
      <Dt label="Desde" value={cur("bfrom")} onChange={(v) => update("bfrom", v)} />
      <Dt label="Hasta" value={cur("bto")} onChange={(v) => update("bto", v)} />
      {filtered && (
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center justify-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-xs text-muted hover:text-ink h-fit"
        >
          <X size={12} />
          Limpiar
        </button>
      )}
    </div>
  );
}

function Sel({
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

function Dt({
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
