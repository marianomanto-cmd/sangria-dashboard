"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { X } from "lucide-react";
import type { ReportFilterOptions } from "@/db/queries/historical-report";
import type { Language } from "@/lib/i18n";

type Current = {
  origin: string | null;
  project: string | null;
  plan: string | null;
  placement: string | null;
  from: string | null;
  to: string | null;
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

  // Cascade: si hay project seleccionado, los plans se filtran a ese proyecto;
  // si hay plan seleccionado, los placements se filtran a ese plan. Filtramos
  // client-side a partir de la lista completa (chica para Sangria-scale).
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

  const updateParams = (
    updates: Partial<{
      origin: string;
      project: string;
      plan: string;
      placement: string;
      from: string;
      to: string;
    }>,
    cascadeReset?: Array<"project" | "plan" | "placement">,
  ) => {
    const next = new URLSearchParams(sp?.toString() ?? "");
    for (const [k, v] of Object.entries(updates)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    // Cuando cambia un filtro padre, limpiamos los hijos para no quedarnos
    // con un placement de un plan que ya no está en scope.
    if (cascadeReset)
      for (const key of cascadeReset) next.delete(key);
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  const clearAll = () => {
    const next = new URLSearchParams();
    // Preservar el cliente del topbar.
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
    current.to;

  return (
    <section className="rounded-lg border border-line bg-white dark:bg-paper-2 p-4 mb-5">
      {!hasClient && (
        <p className="text-[11px] text-warn mb-3">
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

      {anyFilter && (
        <button
          type="button"
          onClick={clearAll}
          className="mt-3 inline-flex items-center gap-1 text-xs text-muted hover:text-ink"
        >
          <X size={12} strokeWidth={2.5} />
          {lang === "es" ? "Limpiar filtros" : "Clear filters"}
        </button>
      )}
    </section>
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
