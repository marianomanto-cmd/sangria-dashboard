"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { formatMonth, type Language } from "@/lib/i18n";

export type PortalFilterField =
  | "pstatus"
  | "origin"
  | "project"
  | "campaign"
  | "daterange"
  | "month";

// Filtros URL-based del portal (read-only). Preserva el ?tab= y solo toca los
// params de filtro (bo / proj / camp / month / pstatus / pfrom / pto). Mismo
// patrón que los filtros internos pero scopeado al portal.
export function PortalFilters({
  fields,
  budgetOrigins,
  projects,
  campaigns = [],
  months,
  lang,
}: {
  fields: PortalFilterField[];
  budgetOrigins: { id: string; name: string }[];
  projects: { id: string; code: string; name: string }[];
  campaigns?: { id: string; name: string }[];
  months: string[];
  lang: Language;
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
    next.delete("bo");
    next.delete("proj");
    next.delete("camp");
    next.delete("month");
    next.delete("pfrom");
    next.delete("pto");
    next.delete("pstatus");
    next.delete("plan"); // colapsa también el pacing expandido
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  // Todos los filtros de selección del portal son multi (listas separadas por
  // coma). El parent las consume con split.
  const list = (k: string) =>
    cur(k) ? cur(k).split(",").filter(Boolean) : [];
  const campValues = list("camp");
  const boValues = list("bo");
  const projValues = list("proj");
  const monthValues = list("month");
  const allLabel = lang === "es" ? "Todos" : "All";

  const isFiltered =
    (fields.includes("pstatus") && !!cur("pstatus")) ||
    (fields.includes("origin") && boValues.length > 0) ||
    (fields.includes("project") && projValues.length > 0) ||
    (fields.includes("campaign") && campValues.length > 0) ||
    (fields.includes("daterange") && (!!cur("pfrom") || !!cur("pto"))) ||
    (fields.includes("month") && monthValues.length > 0);

  return (
    <div className="rounded-lg border border-line bg-white dark:bg-paper-2 px-4 py-3 mb-5 flex items-end gap-3 flex-wrap">
      {fields.includes("pstatus") && (
        <Field label={lang === "es" ? "Estado" : "Status"}>
          <select
            value={cur("pstatus") || "abiertos"}
            onChange={(e) =>
              update("pstatus", e.target.value === "abiertos" ? "" : e.target.value)
            }
            className="rounded-md border border-line bg-white dark:bg-paper-2 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent min-w-[140px]"
          >
            <option value="abiertos">{lang === "es" ? "Abiertos" : "Open"}</option>
            <option value="cerrados">{lang === "es" ? "Cerrados" : "Closed"}</option>
            <option value="todos">{lang === "es" ? "Todos" : "All"}</option>
          </select>
        </Field>
      )}

      {fields.includes("campaign") && (
        <Field label={lang === "es" ? "Campañas" : "Campaigns"}>
          <MultiSelect
            options={campaigns}
            values={campValues}
            onChange={(arr) => update("camp", arr.join(","))}
            lang={lang}
            allLabel={lang === "es" ? "Todas" : "All"}
            searchable
            searchPlaceholder={
              lang === "es" ? "Buscar campaña…" : "Search campaign…"
            }
            widthClass="min-w-[220px] max-w-[320px]"
          />
        </Field>
      )}

      {fields.includes("origin") && (
        <Field label="Budget Origin">
          <MultiSelect
            options={budgetOrigins}
            values={boValues}
            onChange={(arr) => update("bo", arr.join(","))}
            lang={lang}
            allLabel={allLabel}
            widthClass="min-w-[160px] max-w-[260px]"
          />
        </Field>
      )}

      {fields.includes("project") && (
        <Field label={lang === "es" ? "Proyecto" : "Project"}>
          <MultiSelect
            options={projects.map((p) => ({ id: p.id, name: p.name }))}
            values={projValues}
            onChange={(arr) => update("proj", arr.join(","))}
            lang={lang}
            allLabel={allLabel}
            searchable
            searchPlaceholder={
              lang === "es" ? "Buscar proyecto…" : "Search project…"
            }
            widthClass="min-w-[220px] max-w-[320px]"
          />
        </Field>
      )}

      {fields.includes("daterange") && (
        <>
          <Field label={lang === "es" ? "Desde" : "From"}>
            <input
              type="date"
              value={cur("pfrom")}
              max={cur("pto") || undefined}
              onChange={(e) => update("pfrom", e.target.value)}
              className="rounded-md border border-line bg-white dark:bg-paper-2 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </Field>
          <Field label={lang === "es" ? "Hasta" : "To"}>
            <input
              type="date"
              value={cur("pto")}
              min={cur("pfrom") || undefined}
              onChange={(e) => update("pto", e.target.value)}
              className="rounded-md border border-line bg-white dark:bg-paper-2 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </Field>
        </>
      )}

      {fields.includes("month") && (
        <Field label={lang === "es" ? "Mes" : "Month"}>
          <MultiSelect
            options={months.map((m) => ({ id: m, name: formatMonth(m, lang) }))}
            values={monthValues}
            onChange={(arr) => update("month", arr.join(","))}
            lang={lang}
            allLabel={allLabel}
            widthClass="min-w-[150px] max-w-[240px]"
          />
        </Field>
      )}

      {isFiltered && (
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-1 rounded-md border border-line bg-white dark:bg-paper-2 px-2.5 py-1.5 text-xs text-muted hover:text-ink transition-colors"
        >
          <X size={12} />
          {lang === "es" ? "Limpiar" : "Clear"}
        </button>
      )}
    </div>
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
    <div>
      <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted mb-1">
        {label}
      </p>
      {children}
    </div>
  );
}

// Multi-select genérico (popover de checkboxes). URL-based vía onChange del
// parent (GET, portal-safe). Cierra al hacer click afuera. `searchable` agrega
// un buscador por nombre (útil para listas largas como campañas/proyectos).
function MultiSelect({
  options,
  values,
  onChange,
  lang,
  allLabel,
  searchable = false,
  searchPlaceholder,
  widthClass = "min-w-[160px]",
}: {
  options: { id: string; name: string }[];
  values: string[];
  onChange: (next: string[]) => void;
  lang: Language;
  allLabel: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  widthClass?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const toggle = (id: string) =>
    onChange(
      values.includes(id) ? values.filter((v) => v !== id) : [...values, id],
    );

  const q = query.trim().toLowerCase();
  const filtered =
    searchable && q
      ? options.filter((o) => o.name.toLowerCase().includes(q))
      : options;

  const summary =
    values.length === 0
      ? allLabel
      : values.length === 1
        ? (options.find((o) => o.id === values[0])?.name ?? "1")
        : `${values.length} ${lang === "es" ? "seleccionados" : "selected"}`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`${widthClass} flex items-center justify-between gap-2 rounded-md border border-line bg-white dark:bg-paper-2 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent`}
      >
        <span className={`truncate ${values.length ? "text-ink" : "text-muted"}`}>
          {summary}
        </span>
        <ChevronDown size={14} className="text-muted shrink-0" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-[min(320px,90vw)] rounded-md border border-line bg-white dark:bg-paper-2 shadow-lg">
          {searchable && (
            <div className="p-2 border-b border-line-soft">
              <div className="relative">
                <Search
                  size={13}
                  className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted"
                />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="w-full rounded-md border border-line bg-white dark:bg-paper-2 pl-7 pr-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            </div>
          )}
          <div className="max-h-60 overflow-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-2.5 py-1.5 text-xs text-muted">
                {lang === "es" ? "Sin resultados" : "No results"}
              </p>
            ) : (
              filtered.map((o) => {
                const checked = values.includes(o.id);
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => toggle(o.id)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-paper-2"
                  >
                    <span
                      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        checked
                          ? "bg-accent border-accent text-white"
                          : "border-line"
                      }`}
                    >
                      {checked && <Check size={11} strokeWidth={3} />}
                    </span>
                    <span className="truncate text-ink-2">{o.name}</span>
                  </button>
                );
              })
            )}
          </div>
          {values.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="w-full border-t border-line-soft px-2.5 py-1.5 text-left text-xs text-muted hover:text-ink"
            >
              {lang === "es" ? "Limpiar" : "Clear"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
