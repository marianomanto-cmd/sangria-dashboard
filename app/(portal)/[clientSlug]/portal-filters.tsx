"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { formatMonth, type Language } from "@/lib/i18n";

export type PortalFilterField = "pstatus" | "origin" | "project" | "month";

// Filtros URL-based del portal (read-only). Preserva el ?tab= y solo toca los
// params de filtro (bo / proj / month). Mismo patrón que los filtros internos
// pero scopeado al portal.
export function PortalFilters({
  fields,
  budgetOrigins,
  projects,
  months,
  lang,
}: {
  fields: PortalFilterField[];
  budgetOrigins: { id: string; name: string }[];
  projects: { id: string; code: string; name: string }[];
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
    next.delete("month");
    next.delete("pstatus");
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  const isFiltered =
    (fields.includes("pstatus") && !!cur("pstatus")) ||
    (fields.includes("origin") && !!cur("bo")) ||
    (fields.includes("project") && !!cur("proj")) ||
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
          </select>
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
