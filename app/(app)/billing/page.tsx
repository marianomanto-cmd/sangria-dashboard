import { BillingFilters } from "@/components/billing-filters";
import { BillingTable } from "@/components/billing-table";
import { PageShell } from "@/components/page-shell";
import {
  getBillingFilterOptions,
  getBillingsList,
} from "@/db/queries/billing";
import { resolveClientFromSearchParams } from "@/lib/client-filter.server";
import { DEFAULT_LANGUAGE } from "@/lib/i18n";

type SearchParams = {
  client?: string;
  budgetOrigin?: string;
  project?: string;
  status?: string;
  from?: string;
  to?: string;
};

type Props = {
  searchParams: Promise<SearchParams>;
};

const BILLING_STATUS_VALUES = [
  "draft",
  "ready",
  "sent",
  "invoiced",
  "paid",
] as const;
type BillingStatusValue = (typeof BILLING_STATUS_VALUES)[number];

function parseBillingStatus(v: string | undefined): BillingStatusValue | null {
  return v && (BILLING_STATUS_VALUES as readonly string[]).includes(v)
    ? (v as BillingStatusValue)
    : null;
}

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
    status: parseBillingStatus(sp.status),
    fromMonth: sp.from || null,
    toMonth: sp.to || null,
  });

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
        <BillingTable rows={rows} lang={lang} />
      )}
    </PageShell>
  );
}
