import { BillingFilters } from "@/components/billing-filters";
import {
  BillingMediaFeeChart,
  type MediaFeeMonth,
} from "@/components/billing-media-fee-chart";
import { BillingTable } from "@/components/billing-table";
import type { BillingListRow } from "@/db/queries/billing";

// Agrupa por mes las MISMAS filas que muestra la tabla (ya filtradas), así el
// gráfico refleja exactamente el período filtrado y no se desincroniza.
function mediaFeeByMonth(rows: BillingListRow[]): MediaFeeMonth[] {
  const map = new Map<string, MediaFeeMonth>();
  for (const r of rows) {
    const m = map.get(r.month) ?? {
      month: r.month,
      media: 0,
      fee: 0,
      total: 0,
    };
    m.media += r.totalNetUsd;
    m.fee += r.totalFeeUsd;
    m.total += r.totalUsd;
    map.set(r.month, m);
  }
  return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
}
import { PageShell } from "@/components/page-shell";
import { DegradedNotice } from "@/components/degraded-notice";
import { cachedBillingFilterOptions } from "@/db/queries/cached";
import {
  getBillingsList,
  type BillingFilterOptions,
} from "@/db/queries/billing";
import {
  resolveClientFromSearchParams,
  type ResolvedClientFilter,
} from "@/lib/client-filter.server";
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

const EMPTY_FILTER_OPTIONS: BillingFilterOptions = {
  budgetOrigins: [],
  projects: [],
  minMonth: null,
  maxMonth: null,
};

const SECTION_LABELS: Record<string, string> = {
  filters: "las opciones de filtro",
  rows: "las facturas",
};

function unwrap<T>(
  r: PromiseSettledResult<T>,
  fallback: T,
  label: string,
  failed: string[],
): T {
  if (r.status === "fulfilled") return r.value;
  const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
  console.error(`BILLQ[${label}]:${msg.slice(0, 80)}`, r.reason);
  failed.push(SECTION_LABELS[label] ?? label);
  return fallback;
}

export default async function BillingPage({ searchParams }: Props) {
  const sp = await searchParams;

  // Resolver el cliente no debe tumbar la página: si falla, seguimos sin filtro.
  let client: ResolvedClientFilter = null;
  try {
    client = await resolveClientFromSearchParams(sp);
  } catch (e) {
    console.error("BILLQ[client]:", e instanceof Error ? e.message : e);
  }
  const lang = client?.language ?? DEFAULT_LANGUAGE;

  // Las dos lecturas son INDEPENDIENTES entre sí (el listado filtra por
  // searchParams, no por lo que devuelvan las opciones), así que van en una
  // sola tanda en vez de dos round-trips en serie. Con `max: 1` cada `await`
  // suelto es un viaje completo a Ohio esperando al anterior.
  //
  // `allSettled`: si una falla, degradamos ESA parte y lo avisamos, en vez de
  // tumbar la vista entera con el error boundary del grupo. Mismo patrón que
  // el dashboard y el calendario de reportes.
  const failedSections: string[] = [];
  const [filterOptionsR, rowsR] = await Promise.allSettled([
    cachedBillingFilterOptions(client?.id ?? null),
    getBillingsList({
      clientId: client?.id ?? null,
      budgetOriginId: sp.budgetOrigin || null,
      projectId: sp.project || null,
      status: parseBillingStatus(sp.status),
      fromMonth: sp.from || null,
      toMonth: sp.to || null,
    }),
  ]);

  const filterOptions = unwrap(
    filterOptionsR,
    EMPTY_FILTER_OPTIONS,
    "filters",
    failedSections,
  );
  const rows = unwrap<Awaited<ReturnType<typeof getBillingsList>>>(
    rowsR,
    [],
    "rows",
    failedSections,
  );

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
      <DegradedNotice sections={failedSections} />
      <BillingFilters
        budgetOrigins={filterOptions.budgetOrigins}
        projects={filterOptions.projects}
        monthsList={monthsList}
        lang={lang}
      />

      {rows.length > 0 && (
        <BillingMediaFeeChart data={mediaFeeByMonth(rows)} lang={lang} />
      )}

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
