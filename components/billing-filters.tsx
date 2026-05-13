"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { formatMonth, type Language } from "@/lib/i18n";

// ════════════════════════════════════════════════════════════════════════════
// Filtros del top de /billing:
//   • Budget Origin (dropdown)
//   • Proyecto (dropdown)
//   • Rango de meses (slider dual con dos handles)
//
// Persistimos cada filtro como query param. El filtro global ?client= se
// preserva sin tocar. Si todos los filtros están en sus valores neutros, los
// params se eliminan de la URL.
// ════════════════════════════════════════════════════════════════════════════

type Project = { id: string; code: string; name: string; clientId: string };
type BudgetOrigin = { id: string; name: string };

export function BillingFilters({
  budgetOrigins,
  projects,
  monthsList,
  lang,
}: {
  budgetOrigins: BudgetOrigin[];
  projects: Project[];
  monthsList: string[]; // YYYY-MM ordenado ascendente
  lang: Language;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentOrigin = searchParams?.get("budgetOrigin") ?? "";
  const currentProject = searchParams?.get("project") ?? "";
  const currentFrom = searchParams?.get("from") ?? "";
  const currentTo = searchParams?.get("to") ?? "";

  const monthCount = monthsList.length;
  const fromIdx = useMemo(() => {
    if (!currentFrom) return 0;
    const i = monthsList.indexOf(currentFrom);
    return i >= 0 ? i : 0;
  }, [currentFrom, monthsList]);
  const toIdx = useMemo(() => {
    if (!currentTo) return Math.max(0, monthCount - 1);
    const i = monthsList.indexOf(currentTo);
    return i >= 0 ? i : Math.max(0, monthCount - 1);
  }, [currentTo, monthsList, monthCount]);

  // Estado local del slider para feedback inmediato; URL se actualiza onChange
  // commit (mouseup / touchend).
  const [draftFrom, setDraftFrom] = useState(fromIdx);
  const [draftTo, setDraftTo] = useState(toIdx);
  useEffect(() => setDraftFrom(fromIdx), [fromIdx]);
  useEffect(() => setDraftTo(toIdx), [toIdx]);

  const updateParams = (
    updates: Partial<{
      budgetOrigin: string;
      project: string;
      from: string;
      to: string;
    }>,
  ) => {
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    for (const [k, v] of Object.entries(updates)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  const reset = () => {
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    next.delete("budgetOrigin");
    next.delete("project");
    next.delete("from");
    next.delete("to");
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  const isFiltered =
    !!currentOrigin || !!currentProject || !!currentFrom || !!currentTo;

  return (
    <section className="rounded-lg border border-line bg-white px-5 py-4 mb-5">
      <div className="flex items-end gap-4 flex-wrap">
        <Field label={lang === "es" ? "Budget Origin" : "Budget Origin"}>
          <select
            value={currentOrigin}
            onChange={(e) => updateParams({ budgetOrigin: e.target.value })}
            className="rounded-md border border-line bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent min-w-[180px]"
          >
            <option value="">{lang === "es" ? "Todos" : "All"}</option>
            {budgetOrigins.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label={lang === "es" ? "Proyecto" : "Project"}>
          <select
            value={currentProject}
            onChange={(e) => updateParams({ project: e.target.value })}
            className="rounded-md border border-line bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent min-w-[260px] max-w-[360px]"
          >
            <option value="">{lang === "es" ? "Todos" : "All"}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.name}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label={lang === "es" ? "Rango de meses" : "Month range"}
          grow
        >
          {monthCount === 0 ? (
            <p className="text-xs text-muted italic">
              {lang === "es"
                ? "Sin facturas para acotar"
                : "No invoices to filter"}
            </p>
          ) : (
            <MonthRangeSlider
              months={monthsList}
              fromIdx={draftFrom}
              toIdx={draftTo}
              lang={lang}
              onDraftChange={(f, t) => {
                setDraftFrom(f);
                setDraftTo(t);
              }}
              onCommit={(f, t) => {
                const fromMonth = monthsList[f];
                const toMonth = monthsList[t];
                const isFullRange =
                  f === 0 && t === monthsList.length - 1;
                updateParams({
                  from: isFullRange ? "" : fromMonth,
                  to: isFullRange ? "" : toMonth,
                });
              }}
            />
          )}
        </Field>

        {isFiltered && (
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2.5 py-1.5 text-xs text-muted hover:text-ink hover:bg-paper-2 transition-colors"
          >
            <X size={12} />
            {lang === "es" ? "Limpiar filtros" : "Clear filters"}
          </button>
        )}
      </div>
    </section>
  );
}

function Field({
  label,
  children,
  grow,
}: {
  label: string;
  children: React.ReactNode;
  grow?: boolean;
}) {
  return (
    <div className={grow ? "flex-1 min-w-[280px]" : undefined}>
      <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted mb-1">
        {label}
      </p>
      {children}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Dual-handle range slider sobre la lista de meses.
//
// Implementación: dos <input type="range"> superpuestos sobre el mismo track
// CSS. Cada uno controla un handle. El "track activo" se pinta con un div
// absoluto entre las dos posiciones. El commit a URL se hace en onMouseUp /
// onTouchEnd / onKeyUp para no spamear navegación mientras se arrastra.
// ────────────────────────────────────────────────────────────────────────────

function MonthRangeSlider({
  months,
  fromIdx,
  toIdx,
  lang,
  onDraftChange,
  onCommit,
}: {
  months: string[];
  fromIdx: number;
  toIdx: number;
  lang: Language;
  onDraftChange: (f: number, t: number) => void;
  onCommit: (f: number, t: number) => void;
}) {
  const max = months.length - 1;
  const fromPct = max > 0 ? (fromIdx / max) * 100 : 0;
  const toPct = max > 0 ? (toIdx / max) * 100 : 100;

  const lastValuesRef = useRef({ from: fromIdx, to: toIdx });
  useEffect(() => {
    lastValuesRef.current = { from: fromIdx, to: toIdx };
  }, [fromIdx, toIdx]);

  const commit = () => {
    onCommit(lastValuesRef.current.from, lastValuesRef.current.to);
  };

  const setFrom = (v: number) => {
    const clamped = Math.min(v, lastValuesRef.current.to);
    lastValuesRef.current.from = clamped;
    onDraftChange(clamped, lastValuesRef.current.to);
  };
  const setTo = (v: number) => {
    const clamped = Math.max(v, lastValuesRef.current.from);
    lastValuesRef.current.to = clamped;
    onDraftChange(lastValuesRef.current.from, clamped);
  };

  return (
    <div>
      <div className="flex justify-between text-[11px] font-mono text-ink-2 mb-1.5 tabular-nums">
        <span>{formatMonth(months[fromIdx], lang)}</span>
        <span className="text-muted">→</span>
        <span>{formatMonth(months[toIdx], lang)}</span>
      </div>
      <div className="relative h-6">
        {/* track base */}
        <div
          className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-1.5 rounded-full bg-line-soft"
          aria-hidden
        />
        {/* track activo */}
        <div
          className="absolute top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-accent"
          style={{
            left: `${fromPct}%`,
            width: `${Math.max(0, toPct - fromPct)}%`,
          }}
          aria-hidden
        />
        {/* range FROM */}
        <input
          type="range"
          min={0}
          max={max}
          step={1}
          value={fromIdx}
          aria-label={lang === "es" ? "Desde" : "From"}
          onChange={(e) => setFrom(Number(e.target.value))}
          onMouseUp={commit}
          onTouchEnd={commit}
          onKeyUp={commit}
          className="month-slider-thumb absolute top-0 left-0 w-full h-6 pointer-events-none appearance-none bg-transparent"
        />
        {/* range TO */}
        <input
          type="range"
          min={0}
          max={max}
          step={1}
          value={toIdx}
          aria-label={lang === "es" ? "Hasta" : "To"}
          onChange={(e) => setTo(Number(e.target.value))}
          onMouseUp={commit}
          onTouchEnd={commit}
          onKeyUp={commit}
          className="month-slider-thumb absolute top-0 left-0 w-full h-6 pointer-events-none appearance-none bg-transparent"
        />
      </div>
    </div>
  );
}
