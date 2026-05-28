import { Download } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { ReportGeneratorForm } from "@/components/report-generator-form";
import {
  getHistoricalReport,
  getReportFilterOptions,
  type HistoricalReportFilters,
} from "@/db/queries/historical-report";
import { resolveClientFromSearchParams } from "@/lib/client-filter.server";
import { formatUsd } from "@/lib/format";
import { DEFAULT_LANGUAGE, formatDate, type Language } from "@/lib/i18n";

type SearchParams = {
  client?: string;
  origin?: string;
  project?: string;
  plan?: string;
  placement?: string;
  from?: string;
  to?: string;
};

type Props = {
  searchParams: Promise<SearchParams>;
};

export default async function ReportGeneratorPage({ searchParams }: Props) {
  const sp = await searchParams;
  const client = await resolveClientFromSearchParams(sp);
  const lang: Language = client?.language ?? DEFAULT_LANGUAGE;

  const filters: HistoricalReportFilters = {
    clientId: client?.id ?? null,
    budgetOriginId: sp.origin || null,
    projectId: sp.project || null,
    planId: sp.plan || null,
    placementId: sp.placement || null,
    fromMonth: sp.from || null,
    toMonth: sp.to || null,
  };

  const hasAnyFilter =
    !!client ||
    !!sp.origin ||
    !!sp.project ||
    !!sp.plan ||
    !!sp.placement ||
    !!sp.from ||
    !!sp.to;

  const [options, report] = await Promise.all([
    getReportFilterOptions(client?.id ?? null),
    // Sólo corremos la query si hay al menos un filtro: sin filtros la query
    // sería un escaneo cross-cliente. El usuario tiene que arrancar eligiendo
    // un cliente desde el global filter del topbar.
    hasAnyFilter
      ? getHistoricalReport(filters)
      : Promise.resolve({
          rows: [],
          metricColumns: [],
          totalPlacementsInScope: 0,
        }),
  ]);

  const title =
    lang === "es" ? "Generador de reportes" : "Report generator";
  const subtitle =
    lang === "es"
      ? "Armá un Excel con los datos históricos cargados (billing + tracker). Filtrá por cliente, proyecto, plan, placement y rango de fechas. El preview muestra exactamente lo que va a salir en el Excel."
      : "Build an Excel from loaded historical data (billing + tracker). Filter by client, project, plan, placement and date range. The preview mirrors the Excel output 1:1.";

  // El link de descarga preserva los mismos search params para que el route
  // handler use la misma query y devuelva la misma data del preview.
  const downloadParams = new URLSearchParams();
  if (client?.slug) downloadParams.set("client", client.slug);
  if (sp.origin) downloadParams.set("origin", sp.origin);
  if (sp.project) downloadParams.set("project", sp.project);
  if (sp.plan) downloadParams.set("plan", sp.plan);
  if (sp.placement) downloadParams.set("placement", sp.placement);
  if (sp.from) downloadParams.set("from", sp.from);
  if (sp.to) downloadParams.set("to", sp.to);
  const downloadHref = `/api/reports/historical.xlsx${
    downloadParams.toString() ? `?${downloadParams.toString()}` : ""
  }`;

  return (
    <PageShell
      eyebrow={lang === "es" ? "Reportes" : "Reports"}
      title={title}
      subtitle={subtitle}
      actions={
        <a
          href={downloadHref}
          className={`inline-flex items-center gap-1.5 rounded-md bg-ink text-white px-3 py-1.5 text-sm font-medium hover:bg-ink-2 transition-colors ${
            report.rows.length === 0
              ? "opacity-50 pointer-events-none"
              : ""
          }`}
          aria-disabled={report.rows.length === 0}
        >
          <Download size={14} strokeWidth={2} />
          {lang === "es" ? "Descargar Excel" : "Download Excel"}
        </a>
      }
    >
      <ReportGeneratorForm
        options={options}
        current={{
          origin: sp.origin ?? null,
          project: sp.project ?? null,
          plan: sp.plan ?? null,
          placement: sp.placement ?? null,
          from: sp.from ?? null,
          to: sp.to ?? null,
        }}
        hasClient={!!client}
        lang={lang}
      />

      {/* Preview */}
      {!hasAnyFilter ? (
        <div className="rounded-lg border border-line border-dashed bg-paper-2 px-5 py-12 text-center text-sm text-muted">
          {lang === "es"
            ? "Elegí un cliente (en el filtro global del topbar) y ajustá los filtros para ver el preview del Excel."
            : "Pick a client (global topbar filter) and tune the filters to see the Excel preview."}
        </div>
      ) : report.rows.length === 0 ? (
        <div className="rounded-lg border border-line border-dashed bg-paper-2 px-5 py-12 text-center text-sm text-muted">
          {lang === "es"
            ? "Sin datos históricos cargados para los filtros aplicados."
            : "No historical data loaded for the applied filters."}
          <p className="mt-1 text-[11px] text-muted">
            {lang === "es"
              ? `${report.totalPlacementsInScope} placements en scope; ninguno tiene billing/tracker en el rango.`
              : `${report.totalPlacementsInScope} placements in scope; none have billing/tracker in range.`}
          </p>
        </div>
      ) : (
        <section className="rounded-lg border border-line bg-white dark:bg-paper-2 overflow-hidden">
          <header className="flex items-baseline justify-between px-5 py-3 border-b border-line bg-paper">
            <h2 className="text-sm font-semibold">
              {lang === "es" ? "Preview del Excel" : "Excel preview"}
              <span className="ml-2 text-xs font-normal text-muted">
                {lang === "es"
                  ? `${report.rows.length} placement${
                      report.rows.length === 1 ? "" : "s"
                    }`
                  : `${report.rows.length} placement${
                      report.rows.length === 1 ? "" : "s"
                    }`}
              </span>
            </h2>
            <span className="text-[11px] uppercase tracking-[0.08em] text-muted font-medium">
              {lang === "es"
                ? "Esta tabla es lo que se descarga"
                : "This table is what gets downloaded"}
            </span>
          </header>
          <div className="overflow-x-auto">
            <table className="text-xs whitespace-nowrap">
              <thead className="bg-paper">
                <tr className="text-[10px] uppercase tracking-[0.06em] text-muted">
                  <Th>{lang === "es" ? "Cliente" : "Client"}</Th>
                  <Th>{lang === "es" ? "Proyecto" : "Project"}</Th>
                  <Th>Plan</Th>
                  <Th>Publisher</Th>
                  <Th>Placement</Th>
                  <Th>{lang === "es" ? "Mercado" : "Market"}</Th>
                  <Th>{lang === "es" ? "Período" : "Period"}</Th>
                  <Th align="right">
                    {lang === "es" ? "Planeado" : "Planned"}
                  </Th>
                  <Th align="right">
                    {lang === "es" ? "Facturado share" : "Billed share"}
                  </Th>
                  {report.metricColumns.map((m) => (
                    <Th key={m.slug} align="right">
                      {m.name}
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr
                    key={r.placementId}
                    className="border-t border-line-soft hover:bg-paper-2/40"
                  >
                    <Td>{r.clientName}</Td>
                    <Td>
                      <span className="text-ink-2">{r.projectName}</span>
                      <div className="font-mono text-[10px] text-muted">
                        {r.projectCode}
                      </div>
                    </Td>
                    <Td>{r.planName}</Td>
                    <Td>{r.publisherName}</Td>
                    <Td>{r.placementName}</Td>
                    <Td>
                      {r.marketName ?? (
                        <span className="text-muted">—</span>
                      )}
                    </Td>
                    <Td>
                      <span className="font-mono text-[10px] text-muted">
                        {formatDate(r.startDate, lang)}
                        <span className="text-line"> → </span>
                        {formatDate(r.endDate, lang)}
                      </span>
                    </Td>
                    <Td align="right">
                      <span className="font-mono tabular-nums text-ink-2">
                        {formatUsd(r.plannedUsd)}
                      </span>
                    </Td>
                    <Td align="right">
                      <span className="font-mono tabular-nums text-ink">
                        {formatUsd(r.billedShareUsd)}
                      </span>
                    </Td>
                    {report.metricColumns.map((m) => {
                      const v = r.trackedMetrics[m.slug];
                      return (
                        <Td key={m.slug} align="right">
                          <span className="font-mono tabular-nums text-ink-2">
                            {v == null || !Number.isFinite(v)
                              ? ""
                              : m.unit === "%"
                                ? `${(v * 100).toFixed(2)}%`
                                : m.unit === "$"
                                  ? `$${v.toFixed(v < 1 ? 4 : 2)}`
                                  : v.toLocaleString("en-US", {
                                      maximumFractionDigits: 0,
                                    })}
                          </span>
                        </Td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </PageShell>
  );
}

function Th({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: "right";
}) {
  return (
    <th
      className={`font-medium px-3 py-1.5 ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: "right";
}) {
  return (
    <td
      className={`px-3 py-1.5 ${align === "right" ? "text-right" : "text-left"}`}
    >
      {children}
    </td>
  );
}
