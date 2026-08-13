"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import type { ClientDetailProject } from "@/db/queries/client-detail";
import { formatPct, formatUsd } from "@/lib/format";
import { formatDate, type Language, t } from "@/lib/i18n";

// Sección "Proyectos" de la vista de cliente (/clientes/[slug], tab Resumen).
// El orden se computa en cliente sobre las filas ya cargadas (mismo patrón que
// /planes y /proyectos: no recarga la página).
//
// Default = código asc, que es el orden que devuelve `getClientDetail`.
// Fecha / Monto / Nombre arrancan **de mayor a menor** (desc) y un segundo
// click sobre la opción activa invierte la dirección.

type SortCol = "code" | "date" | "budget" | "name";
type SortDir = "asc" | "desc";

const DEFAULT_DIR: Record<SortCol, SortDir> = {
  code: "asc",
  date: "desc",
  budget: "desc",
  name: "desc",
};

// La fecha de referencia del proyecto es su inicio; si no lo tiene, cae al fin
// derivado de los placements.
function dateKey(p: ClientDetailProject): string | null {
  return p.startDate ?? p.endDate ?? null;
}

function sortProjects(
  rows: ClientDetailProject[],
  col: SortCol,
  dir: SortDir,
): ClientDetailProject[] {
  const sign = dir === "asc" ? 1 : -1;
  // Tie-breaker determinístico por código: localeCompare con sensitivity
  // "base" (y los empates de monto) no ordena estable entre renders.
  const tie = (a: ClientDetailProject, b: ClientDetailProject) =>
    a.code.localeCompare(b.code);

  return [...rows].sort((a, b) => {
    if (col === "date") {
      const ka = dateKey(a);
      const kb = dateKey(b);
      // Los proyectos sin fechas van siempre al final, en las dos direcciones.
      if (ka === null || kb === null) {
        if (ka === kb) return tie(a, b);
        return ka === null ? 1 : -1;
      }
      return ka.localeCompare(kb) * sign || tie(a, b);
    }
    const cmp =
      col === "budget"
        ? a.totalBudgetUsd - b.totalBudgetUsd
        : col === "name"
          ? a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
          : tie(a, b);
    return cmp * sign || tie(a, b);
  });
}

type Props = {
  projects: ClientDetailProject[];
  lang: Language;
  // Cuando hay un Budget Origin seleccionado el contador dice "en este origen"
  // en vez de "totales".
  scopedToOrigin: boolean;
};

export function ClientProjectsTable({ projects, lang, scopedToOrigin }: Props) {
  const [sort, setSort] = useState<{ col: SortCol; dir: SortDir }>({
    col: "code",
    dir: "asc",
  });

  const sorted = useMemo(
    () => sortProjects(projects, sort.col, sort.dir),
    [projects, sort],
  );

  const toggleSort = (col: SortCol) => {
    setSort((cur) =>
      cur.col === col
        ? { col, dir: cur.dir === "asc" ? "desc" : "asc" }
        : { col, dir: DEFAULT_DIR[col] },
    );
  };

  return (
    <section className="rounded-lg border border-line bg-white dark:bg-paper-2 overflow-hidden">
      <div className="px-5 py-3 border-b border-line flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h2 className="text-sm font-semibold">
            {lang === "es" ? "Proyectos" : "Projects"}
          </h2>
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
            {projects.length}{" "}
            {scopedToOrigin
              ? lang === "es"
                ? "en este origen"
                : "in this origin"
              : lang === "es"
                ? "totales"
                : "total"}
          </span>
        </div>
        {projects.length > 0 && (
          <SortControl sort={sort} onSort={toggleSort} lang={lang} />
        )}
      </div>

      {projects.length === 0 ? (
        <div className="px-5 py-12 text-center text-sm text-muted">
          {lang === "es"
            ? "No hay proyectos para esta selección."
            : "No projects match this selection."}
        </div>
      ) : (
        <>
          {/* Desktop: tabla. En mobile usamos tarjetas (abajo). */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="bg-paper">
                <tr className="text-[11px] uppercase tracking-[0.06em] text-muted">
                  <SortableTh
                    col="name"
                    sort={sort}
                    onSort={toggleSort}
                    label={lang === "es" ? "Proyecto" : "Project"}
                  />
                  <th className="text-left font-medium px-5 py-2.5">
                    {lang === "es" ? "Estado" : "Status"}
                  </th>
                  <SortableTh
                    col="date"
                    sort={sort}
                    onSort={toggleSort}
                    label={lang === "es" ? "Período" : "Period"}
                  />
                  <SortableTh
                    col="budget"
                    sort={sort}
                    onSort={toggleSort}
                    label="Budget"
                    align="right"
                  />
                  <th className="text-right font-medium px-5 py-2.5">
                    {lang === "es" ? "Gastado" : "Spent"}
                  </th>
                  <th className="text-left font-medium px-5 py-2.5 w-[180px]">
                    {lang === "es" ? "Avance" : "Progress"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((p) => {
                  const overConsumed = p.consumptionPct > 100;
                  const barWidth = Math.min(p.consumptionPct, 100);
                  return (
                    <tr
                      key={p.id}
                      className="border-t border-line-soft hover:bg-paper-2 transition-colors"
                    >
                      <td className="px-5 py-3">
                        <Link
                          href={`/proyectos/${p.code}`}
                          className="font-medium text-ink hover:underline"
                        >
                          {p.name}
                        </Link>
                        <div className="font-mono text-[11px] text-muted">
                          {p.code}
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge status={p.status} />
                      </td>
                      <td className="px-5 py-3 text-ink-2 font-mono text-xs whitespace-nowrap">
                        {formatDate(p.startDate, lang)} →{" "}
                        {formatDate(p.endDate, lang)}
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-ink-2 tabular-nums">
                        {formatUsd(p.totalBudgetUsd)}
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-ink-2 tabular-nums">
                        {p.spentUsd > 0 ? formatUsd(p.spentUsd) : "—"}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex-1 h-1.5 rounded-full bg-paper-2 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                overConsumed
                                  ? "bg-warn"
                                  : "bg-gradient-to-r from-accent to-accent-2"
                              }`}
                              style={{ width: `${barWidth}%` }}
                            />
                          </div>
                          <span
                            className={`font-mono text-xs ${
                              overConsumed ? "text-warn font-medium" : "text-ink-2"
                            }`}
                          >
                            {formatPct(p.consumptionPct, 0)}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile: tarjetas (sin scroll horizontal). */}
          <div className="lg:hidden divide-y divide-line-soft">
            {sorted.map((p) => {
              const overConsumed = p.consumptionPct > 100;
              const barWidth = Math.min(p.consumptionPct, 100);
              return (
                <Link
                  key={p.id}
                  href={`/proyectos/${p.code}`}
                  className="block px-4 py-3.5 hover:bg-paper-2 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-medium text-ink">{p.name}</span>
                      <p className="font-mono text-[11px] text-muted">{p.code}</p>
                    </div>
                    <span className="shrink-0">
                      <StatusBadge status={p.status} />
                    </span>
                  </div>

                  <div className="mt-2.5 flex items-center gap-3">
                    <div className="flex-1 h-1.5 rounded-full bg-paper-2 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          overConsumed
                            ? "bg-warn"
                            : "bg-gradient-to-r from-accent to-accent-2"
                        }`}
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                    <span
                      className={`font-mono text-xs tabular-nums ${
                        overConsumed ? "text-warn font-medium" : "text-ink-2"
                      }`}
                    >
                      {formatPct(p.consumptionPct, 0)}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                        Budget
                      </p>
                      <p className="font-mono text-xs text-ink-2 tabular-nums mt-0.5">
                        {formatUsd(p.totalBudgetUsd)}
                      </p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                        {lang === "es" ? "Gastado" : "Spent"}
                      </p>
                      <p className="font-mono text-xs text-ink-2 tabular-nums mt-0.5">
                        {p.spentUsd > 0 ? formatUsd(p.spentUsd) : "—"}
                      </p>
                    </div>
                    <div className="min-w-0 col-span-2 sm:col-span-1">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                        {lang === "es" ? "Período" : "Period"}
                      </p>
                      <p className="font-mono text-[11px] text-ink-2 mt-0.5">
                        {formatDate(p.startDate, lang)} →{" "}
                        {formatDate(p.endDate, lang)}
                      </p>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

// ── Control de orden ───────────────────────────────────────────────────────
// Pills (mismo look que YearSelector / ProjectStatusSelector) pero client-side.
// Visible en desktop y mobile: las tarjetas de mobile no tienen headers
// clickeables, así que este control es el único acceso al orden ahí.

function SortControl({
  sort,
  onSort,
  lang,
}: {
  sort: { col: SortCol; dir: SortDir };
  onSort: (col: SortCol) => void;
  lang: Language;
}) {
  const options: { col: SortCol; label: string }[] = [
    { col: "code", label: t("common.code", lang) },
    { col: "date", label: t("common.date", lang) },
    { col: "budget", label: t("common.amount", lang) },
    { col: "name", label: t("common.name", lang) },
  ];

  return (
    <div className="inline-flex flex-wrap items-center gap-1 px-2 py-1 rounded-md bg-paper-2 border border-line">
      <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted mr-1">
        {lang === "es" ? "Ordenar" : "Sort"}
      </span>
      <div className="flex flex-wrap items-center gap-0.5">
        {options.map((o) => {
          const active = sort.col === o.col;
          const Icon = active
            ? sort.dir === "asc"
              ? ArrowUp
              : ArrowDown
            : ArrowUpDown;
          return (
            <button
              key={o.col}
              type="button"
              onClick={() => onSort(o.col)}
              data-active={active}
              aria-pressed={active}
              title={
                lang === "es"
                  ? `Ordenar por ${o.label.toLowerCase()}${active ? " (click para invertir)" : ""}`
                  : `Sort by ${o.label.toLowerCase()}${active ? " (click to reverse)" : ""}`
              }
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs text-muted hover:text-ink data-[active=true]:bg-white dark:data-[active=true]:bg-paper data-[active=true]:text-ink data-[active=true]:shadow-sm transition-colors"
            >
              {o.label}
              <Icon size={11} strokeWidth={2.5} className={active ? "" : "opacity-50"} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SortableTh({
  col,
  sort,
  onSort,
  label,
  align,
}: {
  col: SortCol;
  sort: { col: SortCol; dir: SortDir };
  onSort: (col: SortCol) => void;
  label: string;
  align?: "right";
}) {
  const active = sort.col === col;
  const Icon = active ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th
      className={`font-medium px-5 py-2.5 ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      <button
        type="button"
        onClick={() => onSort(col)}
        className={`inline-flex items-center gap-1 hover:text-ink ${
          active ? "text-ink" : "text-muted"
        }`}
        aria-label={`Sort by ${label}`}
      >
        {label}
        <Icon size={11} strokeWidth={2.5} />
      </button>
    </th>
  );
}
