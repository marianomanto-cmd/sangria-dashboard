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
  | "month";

// Filtros URL-based del portal (read-only). Preserva el ?tab= y solo toca los
// params de filtro (bo / proj / camp / month / pstatus). Mismo patrón que los
// filtros internos pero scopeado al portal.
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
    next.delete("pstatus");
    next.delete("plan"); // colapsa también el pacing expandido
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  const campValues = cur("camp") ? cur("camp").split(",").filter(Boolean) : [];

  const isFiltered =
    (fields.includes("pstatus") && !!cur("pstatus")) ||
    (fields.includes("origin") && !!cur("bo")) ||
    (fields.includes("project") && !!cur("proj")) ||
    (fields.includes("campaign") && campValues.length > 0) ||
    (fields.includes("month") && !!cur("month"));

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
          <CampaignMultiSelect
            options={campaigns}
            values={campValues}
            onChange={(arr) => update("camp", arr.join(","))}
            lang={lang}
          />
        </Field>
      )}

      {fields.includes("origin") && (
        <Field label="Budget Origin">
          <select
            value={cur("bo")}
            onChange={(e) => update("bo", e.target.value)}
            className="rounded-md border border-line bg-white dark:bg-paper-2 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent min-w-[160px]"
          >
            <option value="">{lang === "es" ? "Todos" : "All"}</option>
            {budgetOrigins.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      {fields.includes("project") && (
        <Field label={lang === "es" ? "Proyecto" : "Project"}>
          <select
            value={cur("proj")}
            onChange={(e) => update("proj", e.target.value)}
            className="rounded-md border border-line bg-white dark:bg-paper-2 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent min-w-[220px] max-w-[320px]"
          >
            <option value="">{lang === "es" ? "Todos" : "All"}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      {fields.includes("month") && (
        <Field label={lang === "es" ? "Mes" : "Month"}>
          <select
            value={cur("month")}
            onChange={(e) => update("month", e.target.value)}
            className="rounded-md border border-line bg-white dark:bg-paper-2 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent min-w-[150px]"
          >
            <option value="">{lang === "es" ? "Todos" : "All"}</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {formatMonth(m, lang)}
              </option>
            ))}
          </select>
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

// Multi-select con buscador (popover de checkboxes). URL-based vía onChange del
// parent (GET, portal-safe). Cierra al hacer click afuera. Permite buscar las
// campañas por nombre y seleccionar varias a la vez.
function CampaignMultiSelect({
  options,
  values,
  onChange,
  lang,
}: {
  options: { id: string; name: string }[];
  values: string[];
  onChange: (next: string[]) => void;
  lang: Language;
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
  const filtered = q
    ? options.filter((o) => o.name.toLowerCase().includes(q))
    : options;

  const allLabel = lang === "es" ? "Todas" : "All";
  const summary =
    values.length === 0
      ? allLabel
      : values.length === 1
        ? (options.find((o) => o.id === values[0])?.name ?? "1")
        : `${values.length} ${lang === "es" ? "seleccionadas" : "selected"}`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="min-w-[220px] max-w-[320px] flex items-center justify-between gap-2 rounded-md border border-line bg-white dark:bg-paper-2 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
      >
        <span className={`truncate ${values.length ? "text-ink" : "text-muted"}`}>
          {summary}
        </span>
        <ChevronDown size={14} className="text-muted shrink-0" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-[min(320px,90vw)] rounded-md border border-line bg-white dark:bg-paper-2 shadow-lg">
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
                placeholder={
                  lang === "es" ? "Buscar campaña…" : "Search campaign…"
                }
                className="w-full rounded-md border border-line bg-white dark:bg-paper-2 pl-7 pr-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
          </div>
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
