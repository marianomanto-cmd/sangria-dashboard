import Link from "next/link";
import { PageShell } from "@/components/page-shell";
import { getBillingsList } from "@/db/queries/billing";
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
    sent: { label: "emitida", cls: "bg-info-soft text-info border-info-soft", dot: "bg-info" },
    paid: { label: "pagada", cls: "bg-success-soft text-success border-success-soft", dot: "bg-success" },
  },
  en: {
    draft: { label: "draft", cls: "bg-paper-2 text-muted border-line", dot: "bg-muted" },
    ready: { label: "ready", cls: "bg-warn-soft text-warn border-warn-soft", dot: "bg-warn" },
    sent: { label: "sent", cls: "bg-info-soft text-info border-info-soft", dot: "bg-info" },
    paid: { label: "paid", cls: "bg-success-soft text-success border-success-soft", dot: "bg-success" },
  },
};

type Props = {
  searchParams: Promise<{ client?: string }>;
};

export default async function BillingPage({ searchParams }: Props) {
  const sp = await searchParams;
  const client = await resolveClientFromSearchParams(sp);
  const lang = client?.language ?? DEFAULT_LANGUAGE;
  const rows = await getBillingsList({ clientId: client?.id ?? null });
  const STATUS_STYLE = STATUS_STYLE_BY_LANG[lang];

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
      ? `${client ? ` de ${client.name}` : ""}. Las facturas se generan a nivel de plan + mes desde la página de cada plan.`
      : `${client ? ` for ${client.name}` : ""}. Invoices are generated per plan + month from each plan's page.`;

  return (
    <PageShell
      eyebrow="Billing"
      title={title}
      subtitle={`${invoicesWord}${subtitleTail}`}
    >
      {rows.length === 0 ? (
        <div className="rounded-lg border border-line border-dashed bg-paper-2 px-5 py-12 text-center">
          <p className="text-sm font-medium text-ink-2">
            {lang === "es" ? "Sin facturas todavía" : "No invoices yet"}
          </p>
          <p className="text-xs text-muted mt-1 max-w-md mx-auto">
            {lang === "es"
              ? "Para generar una factura: andá al plan correspondiente y abrí el tab Billing del plan."
              : "To create an invoice: open the corresponding plan and switch to its Billing tab."}
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
                  {lang === "es" ? "Cliente" : "Client"}
                </th>
                <th className="text-right font-medium px-5 py-2.5">Net</th>
                <th className="text-right font-medium px-5 py-2.5">Fee</th>
                <th className="text-right font-medium px-5 py-2.5">Total</th>
                <th className="text-left font-medium px-5 py-2.5">
                  {lang === "es" ? "Vence" : "Due"}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const style = STATUS_STYLE[r.status] ?? STATUS_STYLE.draft;
                return (
                  <tr
                    key={r.id}
                    className="border-t border-line-soft hover:bg-paper-2 transition-colors"
                  >
                    <td className="px-5 py-3 font-mono text-ink-2">
                      {r.invoiceNumber ?? "—"}
                    </td>
                    <td className="px-5 py-3 text-ink-2">
                      {formatMonth(r.month, lang)}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[11px] font-medium ${style.cls}`}
                      >
                        <span className={`inline-block h-1.5 w-1.5 rounded-full ${style.dot}`} />
                        {style.label}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <Link
                        href={`/proyectos/${r.projectCode}/planes/${r.planId}`}
                        className="text-ink hover:underline font-medium"
                      >
                        {r.planName}
                      </Link>
                    </td>
                    <td className="px-5 py-3">
                      <Link
                        href={`/proyectos/${r.projectCode}`}
                        className="text-ink-2 hover:underline"
                      >
                        {r.projectName}
                      </Link>
                      <div className="font-mono text-[11px] text-muted">{r.projectCode}</div>
                    </td>
                    <td className="px-5 py-3 text-ink-2">{r.clientName}</td>
                    <td className="px-5 py-3 text-right font-mono text-ink-2">
                      {formatUsd(r.totalNetUsd)}
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-muted text-xs">
                      {formatUsd(r.totalFeeUsd)}
                    </td>
                    <td className="px-5 py-3 text-right font-mono font-semibold text-ink">
                      {formatUsd(r.totalUsd)}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-ink-2">
                      {formatDate(r.dueDate, lang)}
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
