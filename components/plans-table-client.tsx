"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { formatUsd } from "@/lib/format";
import { formatDate, type Language } from "@/lib/i18n";

const STATUS_STYLE: Record<string, { label: string; cls: string; dot: string }> = {
  draft: { label: "draft", cls: "bg-paper-2 text-muted border-line", dot: "bg-muted" },
  ready_to_send: { label: "ready", cls: "bg-warn-soft text-warn border-warn-soft", dot: "bg-warn" },
  approved: { label: "approved", cls: "bg-success-soft text-success border-success-soft", dot: "bg-success" },
  archived: { label: "archived", cls: "bg-paper-2 text-muted border-line", dot: "bg-muted" },
};

export type PlanRow = {
  id: string;
  name: string;
  status: string;
  currentVersion: number;
  periodStart: string | null;
  periodEnd: string | null;
  projectCode: string;
  projectName: string;
  clientName: string;
  clientSlug: string;
  budgetOriginName: string;
  totalMediaUsd: string;
};

export function PlansTableClient({ plans, lang }: { plans: PlanRow[]; lang: Language }) {
  const [query, setQuery] = useState("");

  // Orden A-Z por nombre del plan como default (locale-aware para acentos).
  const sorted = useMemo(
    () =>
      [...plans].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      ),
    [plans],
  );

  // Filtro en vivo por nombre del plan o código del proyecto.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.projectCode.toLowerCase().includes(q),
    );
  }, [sorted, query]);

  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
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
              ? "Buscar por nombre o código…"
              : "Search by name or code…"
          }
          className="w-full rounded-md border border-line bg-white dark:bg-paper-2 pl-9 pr-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-line border-dashed bg-paper-2 px-5 py-12 text-center text-sm text-muted">
          {lang === "es"
            ? "Ningún plan coincide con la búsqueda."
            : "No plans match your search."}
        </div>
      ) : (
        <section className="rounded-lg border border-line bg-white dark:bg-paper-2 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-paper">
              <tr className="text-[11px] uppercase tracking-[0.06em] text-muted">
                <th className="text-left font-medium px-5 py-2.5">Plan</th>
                <th className="text-left font-medium px-5 py-2.5">
                  {lang === "es" ? "Proyecto" : "Project"}
                </th>
                <th className="text-left font-medium px-5 py-2.5">
                  {lang === "es" ? "Cliente" : "Client"}
                </th>
                <th className="text-left font-medium px-5 py-2.5">
                  {lang === "es" ? "Origen" : "Origin"}
                </th>
                <th className="text-left font-medium px-5 py-2.5">
                  {lang === "es" ? "Estado" : "Status"}
                </th>
                <th className="text-left font-medium px-5 py-2.5">
                  {lang === "es" ? "Período" : "Period"}
                </th>
                <th className="text-right font-medium px-5 py-2.5">
                  {lang === "es" ? "Total media" : "Media total"}
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const style = STATUS_STYLE[p.status] ?? STATUS_STYLE.draft;
                const totalMedia = Number.parseFloat(p.totalMediaUsd);
                return (
                  <tr
                    key={p.id}
                    className="border-t border-line-soft hover:bg-paper-2 transition-colors"
                  >
                    <td className="px-5 py-2.5">
                      <Link
                        href={`/proyectos/${p.projectCode}/planes/${p.id}`}
                        className="font-medium text-ink hover:underline"
                      >
                        {p.name}
                      </Link>
                      {p.currentVersion > 0 && (
                        <span className="ml-2 font-mono text-[10px] text-muted">
                          v{p.currentVersion}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-2.5">
                      <Link
                        href={`/proyectos/${p.projectCode}`}
                        className="text-ink-2 hover:underline"
                      >
                        {p.projectName}
                      </Link>
                      <div className="font-mono text-[11px] text-muted">{p.projectCode}</div>
                    </td>
                    <td className="px-5 py-2.5">
                      <Link
                        href={`/clientes/${p.clientSlug}`}
                        className="text-ink-2 hover:underline"
                      >
                        {p.clientName}
                      </Link>
                    </td>
                    <td className="px-5 py-2.5 text-ink-2">{p.budgetOriginName}</td>
                    <td className="px-5 py-2.5">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[11px] font-medium ${style.cls}`}
                      >
                        <span className={`inline-block h-1.5 w-1.5 rounded-full ${style.dot}`} />
                        {style.label}
                      </span>
                    </td>
                    <td className="px-5 py-2.5 font-mono text-[11px] text-ink-2">
                      {formatDate(p.periodStart, lang)}
                      <span className="text-line"> → </span>
                      {formatDate(p.periodEnd, lang)}
                    </td>
                    <td className="px-5 py-2.5 text-right font-mono text-ink">
                      {totalMedia > 0 ? formatUsd(totalMedia) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
