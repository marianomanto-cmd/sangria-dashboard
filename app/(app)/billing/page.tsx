import Link from "next/link";
import { PageShell } from "@/components/page-shell";
import { getBillingsList } from "@/db/queries/billing";
import { formatUsd } from "@/lib/format";
import { resolveClientFromSearchParams } from "@/lib/client-filter.server";

const STATUS_STYLE: Record<
  string,
  { label: string; cls: string; dot: string }
> = {
  draft: { label: "draft", cls: "bg-paper-2 text-muted border-line", dot: "bg-muted" },
  ready: { label: "listo", cls: "bg-warn-soft text-warn border-warn-soft", dot: "bg-warn" },
  sent:  { label: "emitida", cls: "bg-info-soft text-info border-info-soft", dot: "bg-info" },
  paid:  { label: "pagada", cls: "bg-success-soft text-success border-success-soft", dot: "bg-success" },
};

type Props = {
  searchParams: Promise<{ client?: string }>;
};

export default async function BillingPage({ searchParams }: Props) {
  const sp = await searchParams;
  const client = await resolveClientFromSearchParams(sp);
  const rows = await getBillingsList({ clientId: client?.id ?? null });

  return (
    <PageShell
      eyebrow="Billing"
      title={client ? `Billing · ${client.name}` : "Facturación mensual"}
      subtitle={`${rows.length} factura${rows.length === 1 ? "" : "s"}${client ? ` de ${client.name}` : ""}. Las facturas se generan a nivel de plan + mes desde la página de cada plan.`}
    >
      {rows.length === 0 ? (
        <div className="rounded-lg border border-line border-dashed bg-paper-2 px-5 py-12 text-center">
          <p className="text-sm font-medium text-ink-2">Sin facturas todavía</p>
          <p className="text-xs text-muted mt-1 max-w-md mx-auto">
            Para generar una factura: andá al plan correspondiente y abrí el tab Billing del plan.
          </p>
        </div>
      ) : (
        <section className="rounded-lg border border-line bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-paper">
              <tr className="text-[11px] uppercase tracking-[0.06em] text-muted">
                <th className="text-left font-medium px-5 py-2.5">N°</th>
                <th className="text-left font-medium px-5 py-2.5">Mes</th>
                <th className="text-left font-medium px-5 py-2.5">Estado</th>
                <th className="text-left font-medium px-5 py-2.5">Plan</th>
                <th className="text-left font-medium px-5 py-2.5">Proyecto</th>
                <th className="text-left font-medium px-5 py-2.5">Cliente</th>
                <th className="text-right font-medium px-5 py-2.5">Net</th>
                <th className="text-right font-medium px-5 py-2.5">Fee</th>
                <th className="text-right font-medium px-5 py-2.5">Total</th>
                <th className="text-left font-medium px-5 py-2.5">Vence</th>
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
                    <td className="px-5 py-3 font-mono text-ink-2">{r.month}</td>
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
                      {r.dueDate ?? "—"}
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
