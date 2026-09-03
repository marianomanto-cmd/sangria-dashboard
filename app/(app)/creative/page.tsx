import Link from "next/link";
import { EmptyState, PageShell } from "@/components/page-shell";
import { CreativeChart } from "@/components/creative-chart";
import { CreativeInvoiceForm } from "@/components/creative-invoice-form";
import { CreativeTable } from "@/components/creative-table";
import {
  getCreativeBillings,
  type CreativeSummary,
} from "@/db/queries/creative";
import { cachedClientOptions } from "@/db/queries/cached";
import { resolveClientFromSearchParams } from "@/lib/client-filter.server";
import { formatUsd } from "@/lib/format";
import { DEFAULT_LANGUAGE, type Language } from "@/lib/i18n";

// ════════════════════════════════════════════════════════════════════════════
// /creative — facturación del trabajo creativo.
//
// Vive aparte del Billing Tracker porque no cuelga de un media plan: los datos
// salen de `creative_billings` (ver db/schema.ts). Respeta el filtro global de
// cliente (?client=) igual que el resto de la app.
// ════════════════════════════════════════════════════════════════════════════

type SearchParams = { client?: string; status?: string };

export default async function CreativePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const client = await resolveClientFromSearchParams(sp);
  const lang: Language = client?.language ?? DEFAULT_LANGUAGE;
  const status =
    sp.status === "paid" || sp.status === "invoiced" ? sp.status : null;

  const [data, clientOptions] = await Promise.all([
    getCreativeBillings({ clientId: client?.id ?? null, status }),
    // Para el select del alta: todos los clientes vivos, no sólo los que ya
    // tienen facturas de creative (si no, el primero de un cliente nuevo no se
    // podría cargar). Cacheado, así no agrega un round-trip por carga.
    cachedClientOptions(),
  ]);

  const title = client ? `Creative · ${client.name}` : "Creative";
  const n = data.invoices.length;
  const subtitle =
    lang === "es"
      ? `${n} factura${n === 1 ? "" : "s"} de trabajo creativo. Facturación aparte de los planes de medios.`
      : `${n} creative invoice${n === 1 ? "" : "s"}. Billed separately from media plans.`;

  return (
    <PageShell eyebrow="Creative" title={title} subtitle={subtitle}>
      <CreativeInvoiceForm
        clients={clientOptions}
        defaultClientId={client?.id ?? null}
        lang={lang}
      />

      <StatusFilter current={status} lang={lang} search={sp} />

      {n === 0 ? (
        <EmptyState
          title={
            lang === "es"
              ? "Sin facturas de creative"
              : "No creative invoices"
          }
          hint={
            lang === "es"
              ? "Cargá la primera con el botón “Cargar factura” de arriba."
              : "Add the first one with the “Add invoice” button above."
          }
        />
      ) : (
        <div className="flex flex-col gap-5">
          <Totals data={data} lang={lang} />
          <CreativeChart data={data.byMonth} lang={lang} />
          <CreativeTable invoices={data.invoices} lang={lang} />
        </div>
      )}
    </PageShell>
  );
}

function Totals({ data, lang }: { data: CreativeSummary; lang: Language }) {
  const cards = [
    { label: lang === "es" ? "Total facturado" : "Total invoiced", v: data.totalUsd, strong: true },
    { label: lang === "es" ? "Cobrado" : "Paid", v: data.paidUsd, tone: "text-success" },
    { label: lang === "es" ? "Pendiente de cobro" : "Pending", v: data.pendingUsd, tone: "text-warn" },
  ];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-lg border border-line bg-white dark:bg-paper-2 px-5 py-4"
        >
          <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
            {c.label}
          </p>
          <p
            className={`font-mono text-2xl font-semibold tabular-nums mt-1 ${c.tone ?? "text-ink"}`}
          >
            {formatUsd(c.v)}
          </p>
        </div>
      ))}
    </div>
  );
}

// Filtro de estado URL-based (server), mismo patrón que el resto de la app.
function StatusFilter({
  current,
  lang,
  search,
}: {
  current: string | null;
  lang: Language;
  search: SearchParams;
}) {
  const opts = [
    { id: null, label: lang === "es" ? "Todas" : "All" },
    { id: "invoiced", label: lang === "es" ? "Pendientes" : "Pending" },
    { id: "paid", label: lang === "es" ? "Cobradas" : "Paid" },
  ];
  const href = (id: string | null) => {
    const p = new URLSearchParams();
    if (search.client) p.set("client", search.client);
    if (id) p.set("status", id);
    const qs = p.toString();
    return qs ? `/creative?${qs}` : "/creative";
  };
  return (
    <div className="flex items-center gap-1.5 mb-5 flex-wrap">
      {opts.map((o) => {
        const active = current === o.id;
        return (
          <Link prefetch={false}
            key={o.label}
            href={href(o.id)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
              active
                ? "border-accent bg-accent-soft text-accent"
                : "border-line text-muted hover:text-ink hover:bg-paper-2"
            }`}
          >
            {o.label}
          </Link>
        );
      })}
    </div>
  );
}
