"use client";

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { MonthRangeSlider } from "@/components/month-range-slider";
import { type Language } from "@/lib/i18n";

// Filtros del Billing Tracker:
//   • Proyecto (dropdown)
//   • Rango de meses (slider dual)
//
// Persistimos como ?project= ?from= ?to=. El filtro global ?client= no se toca.

type Project = { id: string; code: string; name: string };

export function BillingTrackerFilters({
  projects,
  monthsList,
  lang,
}: {
  projects: Project[];
  monthsList: string[];
  lang: Language;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

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

  const updateParams = (
    updates: Partial<{ project: string; from: string; to: string }>,
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
    next.delete("project");
    next.delete("from");
    next.delete("to");
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  const isFiltered = !!currentProject || !!currentFrom || !!currentTo;

  return (
    <section className="rounded-lg border border-line bg-white dark:bg-paper-2 px-5 py-4 mb-5">
      <div className="flex items-end gap-4 flex-wrap">
        <Field label={lang === "es" ? "Proyecto" : "Project"}>
          <select
            value={currentProject}
            onChange={(e) => updateParams({ project: e.target.value })}
            className="rounded-md border border-line bg-white dark:bg-paper-2 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent min-w-[260px] max-w-[360px]"
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
              key={`${fromIdx}-${toIdx}`}
              months={monthsList}
              initialFromIdx={fromIdx}
              initialToIdx={toIdx}
              lang={lang}
              onCommit={(f, t) => {
                const fromMonth = monthsList[f];
                const toMonth = monthsList[t];
                const isFullRange = f === 0 && t === monthsList.length - 1;
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
            className="inline-flex items-center gap-1 rounded-md border border-line bg-white dark:bg-paper-2 px-2.5 py-1.5 text-xs text-muted hover:text-ink hover:bg-paper-2 transition-colors"
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
