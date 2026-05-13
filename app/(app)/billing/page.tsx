import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { BillingFilters } from "@/components/billing-filters";
import { PageShell } from "@/components/page-shell";
import {
  getBillingFilterOptions,
  getBillingsList,
} from "@/db/queries/billing";
import { formatUsd } from "@/lib/format";
import { resolveClientFromSearchParams } from "@/lib/client-filter.server";
import { DEFAULT_LANGUAGE, formatDate, formatMonth } from "@/lib/i18n";

const STATUS_STYLE_BY_LANG: Record<
  "en" | "es",
  Record<string, { label: string; cls: string; dot: string }>
> = {
  es: {
    draft: { label: "borrador", cls: "bg-paper-2 text-muted border-line", dot: "bg-muted" },
    ready: { label: "listo", cls: "bg-warn-soft text-warn border-warn-soft", dot: "bg-warn" },
    sent: { label: "reportado", cls: "bg-info-soft text-info border-info-soft", dot: "bg-info" },
    invoiced: { label: "facturado", cls: "bg-accent-soft text-accent border-accent-soft", dot: "bg-accent" },
    paid: { label: "pagado", cls: "bg-success-soft text-success border-success-soft", dot: "bg-success" },
  },
  en: {
    draft: { label: "draft", cls: "bg-paper-2 text-muted border-line", dot: "bg-muted" },
    ready: { label: "ready", cls: "bg-warn-soft text-warn border-warn-soft", dot: "bg-warn" },
    sent: { label: "reported", cls: "bg-info-soft text-info border-info-soft", dot: "bg-info" },
    invoiced: { label: "invoiced", cls: "bg-accent-soft text-accent border-accent-soft", dot: "bg-accent" },
    paid: { label: "paid", cls: "bg-success-soft text-success border-success-soft", dot: "bg-success" },
  },
};

type SearchParams = {
  client?: string;
  budgetOrigin?: string;
  project?: string;
  from?: string;
  to?: string;
};

type Props = {
  searchParams: Promise<SearchParams>;
};

function enumerateMonths(start: string, end: string): string[] {
  const out: string[] = [];
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export default async function BillingPage({ searchParams }: Props) {
  const sp = await searchParams;
  const client = await resolveClientFromSearchParams(sp);
  const lang = client?.language ?? DEFAULT_LANGUAGE;

  // Las opciones de filtros se calculan a partir de billings que existen
  // para el cliente seleccionado (o todos si no hay ?client=). El proyecto
  // y budget origin filtran a partir de ahí.
  const filterOptions = await getBillingFilterOptions(client?.id ?? null);

  const rows = await getBillingsList({
    clientId: client?.id ?? null,
    budgetOriginId: sp.budgetOrigin || null,
    projectId: sp.project || null,
    fromMonth: sp.from || null,
    toMonth: sp.to || null,
  });
  const STATUS_STYLE = STATUS_STYLE_BY_LANG[lang];

  const monthsList = filterOptions.minMonth && filterOptions.maxMonth
    ? enumerateMonths(filterOptions.minMonth, filterOptions.maxMonth)
    : [];

  const title =
    lang === "es"
      ? client
        ? `Billing · ${client.name}`
        : "Facturación mensual"
      : client
        ? `Billing · ${client.name}`
        : "Monthly billing";
  const invoicesWord =
    lang === "es"
      ? `${rows.length} factura${rows.length === 1 ? "" : "s"}`
      : `${rows.length} invoice${rows.length === 1 ? "" : "s"}`;
  const subtitleTail =
    lang === "es"
      ? `${client ? ` de ${client.name}` : ""}. Click en una fila para verla y editar su estado/imputaciones.`
      : `${client ? ` for ${client.name}` : ""}. Click a row to open it and edit status/imputations.`;

  return (
    <PageShell
      eyebrow="Billing"
      title={title}
      subtitle={`${invoicesWord}${subtitleTail}`}
    >
      <BillingFilters
        budgetOrigins={filterOptions.budgetOrigins}
        projects={filterOptions.projects}
        monthsList={monthsList}
        lang={lang}
      />

      {rows.length === 0 ? (
        <div className="rounded-lg border border-line border-dashed bg-paper-2 px-5 py-12 text-center">
          <p className="text-sm font-medium text-ink-2">
            {lang === "es" ? "Sin facturas para los filtros aplicados" : "No invoices for the current filters"}
          </p>
          <p className="text-xs text-muted mt-1 max-w-md mx-auto">
            {lang === "es"
              ? "Limpiá los filtros, o generá una factura desde la página del plan correspondiente."
              : "Clear the filters, or generate an invoice from the corresponding plan page."}
          </p>
        </div>
      ) : (
        <section className="rounded-lg border border-line bg-white overflow-hidden">
          <table className="w-full text-sm">
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
              {rows.map((r) => {
                const style = STATUS_STYLE[r.status] ?? STATUS_STYLE.draft;
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
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[11px] font-medium ${style.cls}`}
                      >
                        <span className={`inline-block h-1.5 w-1.5 rounded-full ${style.dot}`} />
                        {style.label}
                      </span>
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
        </section>
      )}
    </PageShell>
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
