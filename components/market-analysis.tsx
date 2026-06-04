"use client";

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { AmericasMap, type MapPoint } from "@/components/americas-map";
import type {
  ActivationRow,
  AnalysisFilterOptions,
  MarketAgg,
} from "@/db/queries/analysis";
import { resolveMarketGeo } from "@/lib/market-geo";
import { formatUsd, formatUsdCompact } from "@/lib/format";
import { formatDate, type Language } from "@/lib/i18n";

// Vista de análisis publisher × mercado: filtros URL-based (GET, portal-safe) +
// mapa de América con burbujas por mercado + ranking + tabla de activaciones.
// Reusada por la sección interna /analisis y por el tab del portal de cliente.
export function MarketAnalysis({
  rows,
  markets,
  options,
  lang,
}: {
  rows: ActivationRow[];
  markets: MarketAgg[];
  options: AnalysisFilterOptions;
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
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const reset = () => {
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    for (const k of ["pub", "mkt", "bo", "from", "to"]) next.delete(k);
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const selectedMkt = cur("mkt");
  const isFiltered =
    !!cur("pub") || !!selectedMkt || !!cur("bo") || !!cur("from") || !!cur("to");

  // Mercados → puntos del mapa (los que geocodifican). Los que no, a una lista.
  const { points, unmapped } = useMemo(() => {
    const pts: MapPoint[] = [];
    const un: MarketAgg[] = [];
    for (const m of markets) {
      const geo = resolveMarketGeo(m.marketSlug, m.marketName);
      if (geo) {
        pts.push({
          id: m.marketId,
          name: m.marketName,
          value: m.plannedUsd,
          count: m.count,
          lat: geo.lat,
          lng: geo.lng,
        });
      } else {
        un.push(m);
      }
    }
    return { points: pts, unmapped: un };
  }, [markets]);

  const totalSpend = rows.reduce((s, r) => s + r.amountUsd, 0);
  const maxMarket = Math.max(1, ...markets.map((m) => m.plannedUsd));

  return (
    <div className="space-y-5">
      {/* Filtros */}
      <div className="rounded-lg border border-line bg-white dark:bg-paper-2 px-4 py-3 flex items-end gap-3 flex-wrap">
        <Field label="Publisher">
          <Select value={cur("pub")} onChange={(v) => update("pub", v)} options={options.publishers} lang={lang} />
        </Field>
        <Field label={lang === "es" ? "Mercado" : "Market"}>
          <Select value={cur("mkt")} onChange={(v) => update("mkt", v)} options={options.markets} lang={lang} />
        </Field>
        <Field label="Budget Origin">
          <Select value={cur("bo")} onChange={(v) => update("bo", v)} options={options.budgetOrigins} lang={lang} />
        </Field>
        <Field label={lang === "es" ? "Desde" : "From"}>
          <input
            type="month"
            value={cur("from")}
            onChange={(e) => update("from", e.target.value)}
            className="rounded-md border border-line bg-white dark:bg-paper-2 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </Field>
        <Field label={lang === "es" ? "Hasta" : "To"}>
          <input
            type="month"
            value={cur("to")}
            onChange={(e) => update("to", e.target.value)}
            className="rounded-md border border-line bg-white dark:bg-paper-2 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </Field>
        {isFiltered && (
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-xs text-muted hover:text-ink"
          >
            <X size={12} />
            {lang === "es" ? "Limpiar" : "Clear"}
          </button>
        )}
      </div>

      {/* Strip de totales */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <Stat label={lang === "es" ? "Activaciones" : "Activations"} value={String(rows.length)} />
        <Stat label={lang === "es" ? "Mercados" : "Markets"} value={String(markets.length)} />
        <Stat label={lang === "es" ? "Inversión" : "Spend"} value={formatUsd(totalSpend)} mono />
      </div>

      {/* Mapa + ranking */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
        {points.length === 0 ? (
          <div className="rounded-lg border border-line border-dashed bg-paper-2 px-5 py-16 text-center text-sm text-muted">
            {lang === "es"
              ? "Sin mercados geolocalizables para los filtros aplicados."
              : "No mappable markets for the current filters."}
          </div>
        ) : (
          <AmericasMap
            points={points}
            selectedId={selectedMkt || null}
            onSelect={(id) => update("mkt", id ?? "")}
            lang={lang}
          />
        )}

        <div className="rounded-lg border border-line bg-white dark:bg-paper-2 p-4">
          <h3 className="text-sm font-semibold mb-3">
            {lang === "es" ? "Por mercado" : "By market"}
          </h3>
          {markets.length === 0 ? (
            <p className="text-xs text-muted">
              {lang === "es" ? "Sin datos." : "No data."}
            </p>
          ) : (
            <ul className="space-y-2.5">
              {markets.map((m) => {
                const active = selectedMkt === m.marketId;
                return (
                  <li key={m.marketId}>
                    <button
                      type="button"
                      onClick={() => update("mkt", active ? "" : m.marketId)}
                      className={`w-full text-left group ${active ? "" : ""}`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className={`font-medium truncate ${active ? "text-accent" : "text-ink-2 group-hover:text-ink"}`}>
                          {m.marketName}
                        </span>
                        <span className="font-mono text-muted shrink-0">
                          {formatUsdCompact(m.plannedUsd)} · {m.count}
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-paper-2 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2"
                          style={{ width: `${(m.plannedUsd / maxMarket) * 100}%` }}
                        />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {unmapped.length > 0 && (
            <p className="mt-3 pt-3 border-t border-line-soft text-[11px] text-muted">
              {lang === "es" ? "Sin ubicación en el mapa: " : "Not on map: "}
              {unmapped.map((m) => m.marketName).join(", ")}
            </p>
          )}
        </div>
      </div>

      {/* Tabla de activaciones */}
      <section className="rounded-lg border border-line bg-white dark:bg-paper-2 overflow-hidden">
        <div className="px-5 py-3 border-b border-line">
          <h3 className="text-sm font-semibold">
            {lang === "es" ? "Activaciones" : "Activations"}
          </h3>
        </div>
        {rows.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted">
            {lang === "es"
              ? "Sin activaciones para los filtros aplicados."
              : "No activations for the current filters."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[820px]">
              <thead className="bg-paper-2">
                <tr className="text-[11px] uppercase tracking-[0.06em] text-muted">
                  <th className="text-left font-medium px-5 py-2">{lang === "es" ? "Mercado" : "Market"}</th>
                  <th className="text-left font-medium px-5 py-2">Publisher</th>
                  <th className="text-left font-medium px-5 py-2">{lang === "es" ? "Proyecto" : "Project"}</th>
                  <th className="text-left font-medium px-5 py-2">Plan</th>
                  <th className="text-left font-medium px-5 py-2">{lang === "es" ? "Placement" : "Placement"}</th>
                  <th className="text-left font-medium px-5 py-2">{lang === "es" ? "Período" : "Period"}</th>
                  <th className="text-right font-medium px-5 py-2">{lang === "es" ? "Inversión" : "Spend"}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-line-soft hover:bg-paper-2/50">
                    <td className="px-5 py-2 text-ink-2">
                      {r.marketName ?? <span className="text-muted">—</span>}
                    </td>
                    <td className="px-5 py-2 text-ink font-medium">{r.publisherName}</td>
                    <td className="px-5 py-2 text-ink-2">{r.projectName}</td>
                    <td className="px-5 py-2 text-ink-2">{r.planName}</td>
                    <td className="px-5 py-2 text-muted">
                      {r.costMethod ? (
                        <span className="font-mono text-[11px] uppercase">{r.costMethod}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-5 py-2 text-muted text-xs">
                      {r.startDate && r.endDate
                        ? `${formatDate(r.startDate, lang)} – ${formatDate(r.endDate, lang)}`
                        : "—"}
                    </td>
                    <td className="px-5 py-2 text-right font-mono text-ink-2">
                      {formatUsd(r.amountUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted mb-1">
        {label}
      </p>
      {children}
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
  lang,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { id: string; name: string }[];
  lang: Language;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-line bg-white dark:bg-paper-2 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent min-w-[150px] max-w-[220px]"
    >
      <option value="">{lang === "es" ? "Todos" : "All"}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-white dark:bg-paper-2 px-4 py-3">
      <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted">{label}</p>
      <p className={`text-xl font-semibold mt-0.5 ${mono ? "font-mono tabular-nums" : ""}`}>{value}</p>
    </div>
  );
}
