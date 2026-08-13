"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { formatMonth, type Language } from "@/lib/i18n";

export type PortalFilterField =
  | "pstatus"
  // Orden de la lista de Proyectos (?psort=). Default "" = nombre A→Z.
  | "psort"
  | "year"
  | "origin"
  | "project"
  | "campaign"
  | "daterange"
  | "month"
  // Billing Tracker: año y mes MULTI-select, independientes entre sí
  // (?byr= y ?bmo=). No comparten params con `year`/`month`, que son los de
  // Estimación y Reportes, para no cambiarles el comportamiento.
  | "years"
  | "monthnum";

// Nombres de mes localizados a partir del índice (0-11). El multi de meses del
// Billing Tracker elige MES (01..12), no mes-de-un-año, así se puede cruzar
// "varios años × varios meses".
function monthNames(lang: Language): { id: string; name: string }[] {
  const fmt = new Intl.DateTimeFormat(lang === "es" ? "es-AR" : "en-US", {
    month: "long",
  });
  return Array.from({ length: 12 }, (_, i) => {
    const name = fmt.format(new Date(2000, i, 1));
    return {
      id: String(i + 1).padStart(2, "0"),
      name: name.charAt(0).toUpperCase() + name.slice(1),
    };
  });
}

// Opciones del orden de Proyectos (?psort=). El valor "" es el default (nombre
// A→Z) y no escribe param. Los tres criterios pedidos —fecha, monto y nombre—
// están en las dos direcciones, arrancando por la de "mayor a menor".
// Los values los valida `resolveProjectSort` en portal-content.tsx.
const PROJECT_SORT_OPTIONS: { value: string; es: string; en: string }[] = [
  { value: "", es: "Nombre (A → Z)", en: "Name (A → Z)" },
  { value: "nombre_desc", es: "Nombre (Z → A)", en: "Name (Z → A)" },
  { value: "fecha_desc", es: "Fecha (más reciente)", en: "Date (newest)" },
  { value: "fecha_asc", es: "Fecha (más antigua)", en: "Date (oldest)" },
  { value: "monto_desc", es: "Monto (mayor a menor)", en: "Amount (high → low)" },
  { value: "monto_asc", es: "Monto (menor a mayor)", en: "Amount (low → high)" },
];

// Filtros URL-based del portal (read-only). Preserva el ?tab= y solo toca los
// params de filtro (bo / proj / camp / month / pstatus / pfrom / pto / psort).
// Mismo patrón que los filtros internos pero scopeado al portal.
export function PortalFilters({
  fields,
  budgetOrigins,
  projects,
  campaigns = [],
  months,
  years = [],
  lang,
}: {
  fields: PortalFilterField[];
  budgetOrigins: { id: string; name: string }[];
  projects: { id: string; code: string; name: string }[];
  campaigns?: { id: string; name: string }[];
  months: string[];
  years?: string[];
  lang: Language;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const cur = (k: string) => searchParams?.get(k) ?? "";

  // Año actual = default del filtro de año (sin param). Las opciones combinan el
  // año actual con los años que efectivamente tienen reportes.
  const currentYear = String(new Date().getFullYear());
  const yearOpts = Array.from(new Set([currentYear, ...years]))
    .sort()
    .reverse();

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
    next.delete("year"); // vuelve al default (año actual)
    next.delete("pfrom");
    next.delete("pto");
    next.delete("pstatus");
    next.delete("psort"); // vuelve al default (nombre A→Z)
    next.delete("byr"); // vuelve al default (año en curso)
    next.delete("bmo"); // vuelve al default (mes en curso)
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

  // Billing Tracker. Default (sin params) = año y mes EN CURSO; "all" = todos.
  // El valor vacío en el MultiSelect significa "todos", así que cuando no hay
  // param mostramos el default explícito y al elegir "todos" escribimos "all".
  const thisYear = String(new Date().getFullYear());
  const thisMonth = String(new Date().getMonth() + 1).padStart(2, "0");
  const rawYr = cur("byr");
  const rawMo = cur("bmo");
  const yrValues = rawYr === "all" ? [] : rawYr ? rawYr.split(",").filter(Boolean) : [thisYear];
  const moValues = rawMo === "all" ? [] : rawMo ? rawMo.split(",").filter(Boolean) : [thisMonth];
  // Si el usuario deselecciona todo queda "all" (todos), no el default.
  const writeMulti = (k: string, arr: string[]) =>
    update(k, arr.length === 0 ? "all" : arr.join(","));
  const allLabel = lang === "es" ? "Todos" : "All";

  const isFiltered =
    (fields.includes("pstatus") && !!cur("pstatus")) ||
    (fields.includes("psort") && !!cur("psort")) ||
    (fields.includes("year") && !!cur("year")) ||
    (fields.includes("origin") && boValues.length > 0) ||
    (fields.includes("project") && projValues.length > 0) ||
    (fields.includes("campaign") && campValues.length > 0) ||
    (fields.includes("daterange") && (!!cur("pfrom") || !!cur("pto"))) ||
    (fields.includes("month") && monthValues.length > 0) ||
    (fields.includes("years") && !!rawYr) ||
    (fields.includes("monthnum") && !!rawMo);

  return (
    <div className="rounded-lg border border-line bg-white dark:bg-paper-2 px-4 py-3 mb-5 flex items-end gap-3 flex-wrap">
      {fields.includes("year") && (
        <Field label={lang === "es" ? "Año" : "Year"}>
          <select
            value={cur("year") || currentYear}
            onChange={(e) =>
              update("year", e.target.value === currentYear ? "" : e.target.value)
            }
            className="rounded-md border border-line bg-white dark:bg-paper-2 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent min-w-[110px]"
          >
            {yearOpts.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
            <option value="all">{lang === "es" ? "Todos" : "All"}</option>
          </select>
        </Field>
      )}

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

      {fields.includes("psort") && (
        <Field label={lang === "es" ? "Ordenar" : "Sort"}>
          <select
            value={cur("psort")}
            onChange={(e) => update("psort", e.target.value)}
            className="rounded-md border border-line bg-white dark:bg-paper-2 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent min-w-[190px]"
          >
            {PROJECT_SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {lang === "es" ? o.es : o.en}
              </option>
            ))}
          </select>
        </Field>
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

      {fields.includes("years") && (
        <Field label={lang === "es" ? "Año" : "Year"}>
          <MultiSelect
            options={Array.from(new Set([thisYear, ...years]))
              .sort()
              .reverse()
              .map((y) => ({ id: y, name: y }))}
            values={yrValues}
            onChange={(arr) => writeMulti("byr", arr)}
            lang={lang}
            allLabel={allLabel}
            widthClass="min-w-[130px] max-w-[220px]"
          />
        </Field>
      )}

      {fields.includes("monthnum") && (
        <Field label={lang === "es" ? "Mes" : "Month"}>
          <MultiSelect
            options={monthNames(lang)}
            values={moValues}
            onChange={(arr) => writeMulti("bmo", arr)}
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
