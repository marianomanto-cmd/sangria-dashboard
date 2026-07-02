"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import type { BillingListRow } from "@/db/queries/billing";
import { formatUsd } from "@/lib/format";
import { formatDate, formatMonth, type Language } from "@/lib/i18n";
import { BillingStatusBadge } from "@/components/billing-status-badge";

// ════════════════════════════════════════════════════════════════════════════
// Tabla de /billing con buscador en vivo.
//
// Mismo patrón que el buscador de /planes y /proyectos: filtra EN CLIENTE sobre
// las filas ya cargadas (no recarga la página), case-insensitive, por N° de
// factura o nombre de plan. Los filtros duros (budget origin / proyecto /
// estado / rango de meses) siguen siendo URL-based y viven en BillingFilters:
// el buscador acota lo que esos filtros ya dejaron.
// ════════════════════════════════════════════════════════════════════════════

export function BillingTable({
  rows,
  lang,
}: {
  rows: BillingListRow[];
  lang: Language;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        (r.invoiceNumber?.toLowerCase().includes(q) ?? false) ||
        r.planName.toLowerCase().includes(q),
    );
  }, [rows, query]);

  const searching = query.trim().length > 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1 min-w-[220px]">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              lang === "es"
                ? "Buscar por N° de factura o plan…"
                : "Search by invoice # or plan…"
            }
            className="w-full rounded-md border border-line bg-white dark:bg-paper-2 pl-9 pr-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        {searching && (
          <p className="text-xs text-muted tabular-nums">
            {lang === "es"
              ? `${filtered.length} de ${rows.length}`
              : `${filtered.length} of ${rows.length}`}
          </p>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-line border-dashed bg-paper-2 px-5 py-12 text-center text-sm text-muted">
          {lang === "es"
            ? "Ninguna factura coincide con la búsqueda."
            : "No invoices match your search."}
        </div>
      ) : (
        <section className="rounded-lg border border-line bg-white dark:bg-paper-2 overflow-hidden">
          {/* Desktop: tabla. En mobile usamos tarjetas (abajo) para evitar
              scroll horizontal. */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full text-sm min-w-[960px]">
              <thead className="bg-paper">
                <tr className="text-[11px] uppercase tracking-[0.06em] text-muted">
                  <th className="text-left font-medium px-5 py-2.5">
                    {lang === "es" ? "N°" : "#"}
                  </th>
                  <th className="text-left font-medium px-5 py-2.5">
                    {lang === "es" ? "Mes" : "Month"}
                  </th>
                  <th className="text-left font-medium px-5 py-2.5">
                    {lang === "es" ? "Estado" : "Status"}
                  </th>
                  <th className="text-left font-medium px-5 py-2.5">Plan</th>
                  <th className="text-left font-medium px-5 py-2.5">
                    {lang === "es" ? "Proyecto" : "Project"}
                  </th>
                  <th className="text-left font-medium px-5 py-2.5">
                    Budget Origin
                  </th>
                  <th className="text-left font-medium px-5 py-2.5">
                    {lang === "es" ? "Cliente" : "Client"}
                  </th>
                  <th className="text-right font-medium px-5 py-2.5">Net</th>
                  <th className="text-right font-medium px-5 py-2.5">Fee</th>
                  <th className="text-right font-medium px-5 py-2.5">Total</th>
                  <th className="text-left font-medium px-5 py-2.5">
                    {lang === "es" ? "Vence" : "Due"}
                  </th>
                  <th className="px-2 py-2.5" aria-label="abrir" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const detailHref = `/proyectos/${r.projectCode}/planes/${r.planId}/billing?month=${r.month}`;
                  return (
                    <tr
                      key={r.id}
                      className="border-t border-line-soft group hover:bg-paper-2 transition-colors"
                    >
                      <RowCell href={detailHref}>
                        <span className="font-mono text-ink-2">
                          {r.invoiceNumber ?? "—"}
                        </span>
                      </RowCell>
                      <RowCell href={detailHref}>
                        <span className="text-ink-2">
                          {formatMonth(r.month, lang)}
                        </span>
                      </RowCell>
                      <RowCell href={detailHref}>
                        <BillingStatusBadge status={r.status} lang={lang} />
                      </RowCell>
                      <RowCell href={detailHref}>
                        <span className="text-ink font-medium">{r.planName}</span>
                      </RowCell>
                      <RowCell href={detailHref}>
                        <span className="text-ink-2">{r.projectName}</span>
                        <div className="font-mono text-[11px] text-muted">{r.projectCode}</div>
                      </RowCell>
                      <RowCell href={detailHref}>
                        <span className="text-ink-2">{r.budgetOriginName}</span>
                      </RowCell>
                      <RowCell href={detailHref}>
                        <span className="text-ink-2">{r.clientName}</span>
                      </RowCell>
                      <RowCell href={detailHref} align="right">
                        <span className="font-mono text-ink-2">
                          {formatUsd(r.totalNetUsd)}
                        </span>
                      </RowCell>
                      <RowCell href={detailHref} align="right">
                        <span className="font-mono text-muted text-xs">
                          {formatUsd(r.totalFeeUsd)}
                        </span>
                      </RowCell>
                      <RowCell href={detailHref} align="right">
                        <span className="font-mono font-semibold text-ink">
                          {formatUsd(r.totalUsd)}
                        </span>
                      </RowCell>
                      <RowCell href={detailHref}>
                        <span className="font-mono text-xs text-ink-2">
                          {formatDate(r.dueDate, lang)}
                        </span>
                      </RowCell>
                      <td className="px-2 py-3 align-middle">
                        <Link
                          href={detailHref}
                          aria-label={lang === "es" ? "Abrir" : "Open"}
                          className="inline-flex items-center justify-center w-7 h-7 rounded-md text-muted group-hover:text-ink group-hover:bg-paper transition-colors"
                        >
                          <ChevronRight size={16} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile: tarjetas (sin scroll horizontal). */}
          <div className="lg:hidden divide-y divide-line-soft">
            {filtered.map((r) => {
              const detailHref = `/proyectos/${r.projectCode}/planes/${r.planId}/billing?month=${r.month}`;
              return (
                <Link
                  key={r.id}
                  href={detailHref}
                  className="block px-4 py-3.5 hover:bg-paper-2 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-ink truncate">{r.planName}</p>
                      <p className="text-xs text-ink-2 truncate">{r.projectName}</p>
                      <p className="font-mono text-[11px] text-muted">
                        {r.projectCode} · {formatMonth(r.month, lang)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <BillingStatusBadge status={r.status} lang={lang} />
                      <p className="font-mono font-semibold text-ink mt-1.5">
                        {formatUsd(r.totalUsd)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                    <CardStat
                      label={lang === "es" ? "N°" : "#"}
                      value={r.invoiceNumber ?? "—"}
                    />
                    <CardStat label="Net" value={formatUsd(r.totalNetUsd)} />
                    <CardStat label="Fee" value={formatUsd(r.totalFeeUsd)} />
                    <CardStat label="Budget Origin" value={r.budgetOriginName} mono={false} />
                    <CardStat
                      label={lang === "es" ? "Cliente" : "Client"}
                      value={r.clientName}
                      mono={false}
                    />
                    <CardStat
                      label={lang === "es" ? "Vence" : "Due"}
                      value={formatDate(r.dueDate, lang)}
                    />
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function CardStat({
  label,
  value,
  mono = true,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
        {label}
      </p>
      <p
        className={`text-xs text-ink-2 mt-0.5 truncate ${
          mono ? "font-mono tabular-nums" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

// Celda que envuelve su contenido en un Link que cubre toda la celda. Esto
// hace que el row entero se vea clickeable sin caer en problemas de
// accesibilidad (cada celda tiene su propio link al mismo destino; el lector
// de pantalla escucha el primero útil).
function RowCell({
  children,
  href,
  align,
}: {
  children: React.ReactNode;
  href: string;
  align?: "right";
}) {
  return (
    <td className="p-0">
      <Link
        href={href}
        className={`block px-5 py-3 ${align === "right" ? "text-right" : ""}`}
      >
        {children}
      </Link>
    </td>
  );
}
