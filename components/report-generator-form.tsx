"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { ChevronDown, X } from "lucide-react";
import type { ReportFilterOptions } from "@/db/queries/historical-report";
import {
  IDENTITY_COL_IDS,
  MONEY_COL_IDS,
  identityLabel,
  moneyLabel,
  parseColsParam,
  serializeColsParam,
  type IdentityColId,
  type MoneyColId,
} from "@/lib/historical-report-columns";
import type { Language } from "@/lib/i18n";

type Current = {
  origin: string | null;
  project: string | null;
  plan: string | null;
  placement: string | null;
  from: string | null;
  to: string | null;
  cols: string | null;
};

export function ReportGeneratorForm({
  options,
  current,
  hasClient,
  lang,
}: {
  options: ReportFilterOptions;
  current: Current;
  hasClient: boolean;
  lang: Language;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const filteredProjects = useMemo(
    () =>
      current.origin
        ? options.projects.filter((p) => p.budgetOriginId === current.origin)
        : options.projects,
    [options.projects, current.origin],
  );
  const filteredPlans = useMemo(
    () =>
      current.project
        ? options.plans.filter((p) => p.projectId === current.project)
        : options.plans,
    [options.plans, current.project],
  );
  const filteredPlacements = useMemo(
    () =>
      current.plan
        ? options.placements.filter((p) => p.planId === current.plan)
        : options.placements,
    [options.placements, current.plan],
  );

  // Selección de columnas: null = default (todas). El picker materializa la
  // selección al primer toggle: arranca con todas las columnas habituales
  // marcadas; si el usuario las modifica, escribe `cols` en la URL.
  const colsSelected = useMemo(() => parseColsParam(current.cols), [
    current.cols,
  ]);

  // Para el estado visual de los checkboxes: si no hay `cols` en URL, todo
  // está chequeado. Si sí hay, solo lo que esté en el set.
  const isColChecked = (id: string): boolean =>
    colsSelected ? colsSelected.has(id) : true;

  const updateParams = (
    updates: Partial<{
      origin: string;
      project: string;
      plan: string;
      placement: string;
      from: string;
      to: string;
      cols: string;
    }>,
    cascadeReset?: Array<"project" | "plan" | "placement">,
  ) => {
    const next = new URLSearchParams(sp?.toString() ?? "");
    for (const [k, v] of Object.entries(updates)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (cascadeReset) for (const key of cascadeReset) next.delete(key);
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  const toggleCol = (id: string) => {
    // Materializa la selección al primer toggle: si todavía no hay `cols`
    // en la URL, arrancamos con el set completo (default), después destildamos
    // o tildamos según corresponda.
    const allIds = [
      ...IDENTITY_COL_IDS,
      ...MONEY_COL_IDS,
      ...options.metrics.map((m) => m.slug),
    ];
    const base = colsSelected ?? new Set<string>(allIds);
    if (base.has(id)) base.delete(id);
    else base.add(id);
    updateParams({ cols: serializeColsParam(base) });
  };

  const resetCols = () => updateParams({ cols: "" });

  const clearAll = () => {
    const next = new URLSearchParams();
    const clientSlug = sp?.get("client");
    if (clientSlug) next.set("client", clientSlug);
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  const anyFilter =
    current.origin ||
    current.project ||
    current.plan ||
    current.placement ||
    current.from ||
    current.to ||
    current.cols;

  return (
    <section className="rounded-lg border border-line bg-white dark:bg-paper-2 p-4 mb-5 space-y-4">
      {!hasClient && (
        <p className="text-[11px] text-warn">
          {lang === "es"
            ? "Elegí un cliente en el filtro del topbar para habilitar los demás filtros y el preview."
            : "Pick a client in the topbar filter to enable the rest of the filters and the preview."}
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Field label="Budget Origin">
          <Select
            value={current.origin ?? ""}
            disabled={!hasClient || options.budgetOrigins.length === 0}
            onChange={(v) =>
              updateParams({ origin: v }, ["project", "plan", "placement"])
            }
            options={[
              { value: "", label: lang === "es" ? "Todos" : "All" },
              ...options.budgetOrigins.map((o) => ({
                value: o.id,
                label: o.name,
              })),
            ]}
          />
        </Field>

        <Field label={lang === "es" ? "Proyecto" : "Project"}>
          <Select
            value={current.project ?? ""}
            disabled={!hasClient || filteredProjects.length === 0}
            onChange={(v) =>
              updateParams({ project: v }, ["plan", "placement"])
            }
            options={[
              { value: "", label: lang === "es" ? "Todos" : "All" },
              ...filteredProjects.map((p) => ({
                value: p.id,
                label: `${p.name} · ${p.code}`,
              })),
            ]}
          />
        </Field>

        <Field label="Plan">
          <Select
            value={current.plan ?? ""}
            disabled={!hasClient || filteredPlans.length === 0}
            onChange={(v) => updateParams({ plan: v }, ["placement"])}
            options={[
              { value: "", label: lang === "es" ? "Todos" : "All" },
              ...filteredPlans.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
        </Field>

        <Field label="Placement">
          <Select
            value={current.placement ?? ""}
            disabled={!hasClient || filteredPlacements.length === 0}
            onChange={(v) => updateParams({ placement: v })}
            options={[
              { value: "", label: lang === "es" ? "Todos" : "All" },
              ...filteredPlacements.map((p) => ({
                value: p.id,
                label: `${p.name} · ${p.publisherName}`,
              })),
            ]}
          />
        </Field>

        <Field label={lang === "es" ? "Desde (mes)" : "From (month)"}>
          <input
            type="month"
            value={current.from ?? ""}
            disabled={!hasClient}
            onChange={(e) => updateParams({ from: e.target.value })}
            className="w-full rounded-md border border-line bg-white dark:bg-paper-2 px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
          />
        </Field>

        <Field label={lang === "es" ? "Hasta (mes)" : "To (month)"}>
          <input
            type="month"
            value={current.to ?? ""}
            disabled={!hasClient}
            onChange={(e) => updateParams({ to: e.target.value })}
            className="w-full rounded-md border border-line bg-white dark:bg-paper-2 px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
          />
        </Field>
      </div>

      {/* Column picker (collapsible) */}
      <details className="border-t border-line-soft pt-3">
        <summary className="cursor-pointer text-sm font-medium text-ink-2 hover:text-ink inline-flex items-center gap-1.5 list-none">
          <ChevronDown
            size={14}
            strokeWidth={2}
            className="transition-transform group-open:rotate-180"
          />
          {lang === "es" ? "Columnas a mostrar" : "Columns to show"}
          <span className="text-[11px] text-muted font-normal ml-1">
            {colsSelected
              ? lang === "es"
                ? `(${colsSelected.size} seleccionadas)`
                : `(${colsSelected.size} selected)`
              : lang === "es"
                ? "(todas)"
                : "(all)"}
          </span>
        </summary>
        <div className="mt-3 space-y-3">
          <ColumnGroup
            title={lang === "es" ? "Identidad" : "Identity"}
            items={IDENTITY_COL_IDS.map((id) => ({
              id: id as IdentityColId,
              label: identityLabel(id, lang),
            }))}
            isChecked={isColChecked}
            onToggle={toggleCol}
          />
          <ColumnGroup
            title={lang === "es" ? "Monto" : "Money"}
            items={MONEY_COL_IDS.map((id) => ({
              id: id as MoneyColId,
              label: moneyLabel(id, lang),
            }))}
            isChecked={isColChecked}
            onToggle={toggleCol}
          />
          {options.metrics.length > 0 && (
            <ColumnGroup
              title={lang === "es" ? "Métricas" : "Metrics"}
              items={options.metrics.map((m) => ({
                id: m.slug,
                label: m.unit ? `${m.name} (${m.unit})` : m.name,
              }))}
              isChecked={isColChecked}
              onToggle={toggleCol}
            />
          )}
          {colsSelected != null && (
            <button
              type="button"
              onClick={resetCols}
              className="text-[11px] text-muted hover:text-ink"
            >
              {lang === "es"
                ? "Reset (mostrar todas las columnas)"
                : "Reset (show all columns)"}
            </button>
          )}
        </div>
      </details>

      {anyFilter && (
        <div className="pt-2 border-t border-line-soft">
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink"
          >
            <X size={12} strokeWidth={2.5} />
            {lang === "es" ? "Limpiar todo" : "Clear all"}
          </button>
        </div>
      )}
    </section>
  );
}

function ColumnGroup({
  title,
  items,
  isChecked,
  onToggle,
}: {
  title: string;
  items: { id: string; label: string }[];
  isChecked: (id: string) => boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <fieldset>
      <legend className="text-[10px] uppercase tracking-[0.08em] text-muted font-medium mb-1.5">
        {title}
      </legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {items.map((it) => (
          <label
            key={it.id}
            className="inline-flex items-center gap-1.5 text-xs text-ink-2 cursor-pointer hover:text-ink"
          >
            <input
              type="checkbox"
              checked={isChecked(it.id)}
              onChange={() => onToggle(it.id)}
              className="rounded border-line text-accent focus:ring-accent"
            />
            {it.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-[0.08em] text-muted font-medium block mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}

function Select({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border border-line bg-white dark:bg-paper-2 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
