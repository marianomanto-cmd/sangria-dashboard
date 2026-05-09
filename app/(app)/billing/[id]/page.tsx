import Link from "next/link";
import { notFound } from "next/navigation";
import { getBillingDetail } from "@/db/queries/billing";
import { formatPct, formatUsd } from "@/lib/format";
import { BillingActions } from "./actions";

type Props = { params: Promise<{ id: string }> };

const STATUS_STYLE: Record<
  string,
  { label: string; cls: string; dot: string }
> = {
  draft: {
    label: "draft",
    cls: "bg-paper-2 text-muted border-line",
    dot: "bg-muted",
  },
  sent: {
    label: "emitida",
    cls: "bg-info-soft text-info border-info-soft",
    dot: "bg-info",
  },
  paid: {
    label: "pagada",
    cls: "bg-success-soft text-success border-success-soft",
    dot: "bg-success",
  },
  overdue: {
    label: "vencida",
    cls: "bg-danger-soft text-danger border-danger-soft",
    dot: "bg-danger",
  },
};

export default async function BillingDetailPage({ params }: Props) {
  const { id } = await params;
  const detail = await getBillingDetail(id);
  if (!detail) notFound();

  const { billing, project, client, budgetOrigin, lines } = detail;
  const style = STATUS_STYLE[billing.status] ?? STATUS_STYLE.draft;

  // Group lines by publisher
  const grouped = new Map<string, typeof lines>();
  for (const ln of lines) {
    const list = grouped.get(ln.publisher) ?? [];
    list.push(ln);
    grouped.set(ln.publisher, list);
  }
  const groupedArray = Array.from(grouped.entries());

  return (
    <main className="px-8 py-10 max-w-[1180px] mx-auto w-full">
      <nav
        aria-label="Breadcrumb"
        className="text-xs text-muted flex items-center gap-1.5 mb-3"
      >
        <Link href="/billing" className="hover:text-ink">
          Billing
        </Link>
        <span className="text-stone-300">/</span>
        <span className="text-ink font-medium">
          {billing.invoiceNumber ?? "Draft"}
        </span>
      </nav>

      <header className="mb-5 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] uppercase text-accent">
            Factura · {billing.month}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight mt-2 flex items-center gap-3 flex-wrap">
            {billing.invoiceNumber ?? "Sin numerar"}
            <span
              className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[11px] font-medium ${style.cls}`}
            >
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${style.dot}`}
              />
              {style.label}
            </span>
          </h1>
        </div>
        <BillingActions
          id={billing.id}
          status={billing.status}
          invoiceNumber={billing.invoiceNumber}
        />
      </header>

      <section className="rounded-lg border border-line bg-white px-5 py-4 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 mb-6">
        <Meta label="Proyecto">
          <Link
            href={`/proyectos/${project.code}`}
            className="text-ink hover:underline font-medium text-sm"
          >
            {project.name}
          </Link>
        </Meta>
        <Meta label="Cliente">
          <Link
            href={`/clientes/${client.slug}`}
            className="text-ink hover:underline font-medium text-sm"
          >
            {client.name}
          </Link>
        </Meta>
        <Meta label="Budget Origin">
          <span className="inline-flex items-center gap-1.5 text-ink font-medium text-sm">
            {budgetOrigin.colorHex && (
              <span
                aria-hidden
                className="inline-block w-2 h-2 rounded-full"
                style={{ background: budgetOrigin.colorHex }}
              />
            )}
            {budgetOrigin.name}
          </span>
        </Meta>
        <Meta label="Vencimiento">
          <span className="font-mono text-sm text-ink-2">
            {billing.dueDate ?? "—"}
          </span>
        </Meta>
      </section>

      <section className="rounded-lg border border-line bg-white overflow-hidden">
        <div className="px-5 py-3 border-b border-line flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Líneas de la factura</h2>
          <span className="text-[11px] uppercase tracking-[0.08em] text-muted font-medium">
            {lines.length} placement{lines.length === 1 ? "" : "s"}
          </span>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-paper">
            <tr className="text-[11px] uppercase tracking-[0.06em] text-muted">
              <th className="text-left font-medium px-5 py-2.5">
                Publisher / Placement
              </th>
              <th className="text-right font-medium px-5 py-2.5">Net</th>
              <th className="text-right font-medium px-5 py-2.5">Fee</th>
              <th className="text-right font-medium px-5 py-2.5">Total</th>
            </tr>
          </thead>
          <tbody>
            {groupedArray.map(([publisher, items]) => {
              const groupNet = items.reduce((s, l) => s + l.amountNet, 0);
              const groupFee = items.reduce((s, l) => s + l.feeAmount, 0);
              const groupTotal = items.reduce((s, l) => s + l.total, 0);
              return (
                <BillingPublisherGroup
                  key={publisher}
                  publisher={publisher}
                  items={items}
                  groupNet={groupNet}
                  groupFee={groupFee}
                  groupTotal={groupTotal}
                />
              );
            })}
            <tr className="border-t-2 border-ink bg-paper-2">
              <td className="px-5 py-3 font-semibold">Total</td>
              <td className="px-5 py-3 text-right font-mono font-semibold tabular-nums text-ink-2">
                {formatUsd(Number.parseFloat(billing.totalNetUsd))}
              </td>
              <td className="px-5 py-3 text-right font-mono font-semibold tabular-nums text-ink-2">
                {formatUsd(Number.parseFloat(billing.totalFeeUsd))}
                <span className="text-muted text-xs ml-1">
                  ({formatPct(
                    (Number.parseFloat(billing.totalFeeUsd) /
                      Number.parseFloat(billing.totalNetUsd)) *
                      100,
                    1,
                  )})
                </span>
              </td>
              <td className="px-5 py-3 text-right font-mono font-semibold tabular-nums text-ink">
                {formatUsd(Number.parseFloat(billing.totalUsd))}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="mt-4 text-[11px] text-muted">
        Creada {billing.createdAt.toISOString().slice(0, 19).replace("T", " ")}
        {billing.sentAt && (
          <> · Emitida {billing.sentAt.toISOString().slice(0, 10)}</>
        )}
        {billing.paidAt && (
          <> · Pagada {billing.paidAt.toISOString().slice(0, 10)}</>
        )}
      </section>
    </main>
  );
}

function BillingPublisherGroup({
  publisher,
  items,
  groupNet,
  groupFee,
  groupTotal,
}: {
  publisher: string;
  items: Array<{
    id: string;
    placementName: string;
    amountNet: number;
    feeAmount: number;
    total: number;
  }>;
  groupNet: number;
  groupFee: number;
  groupTotal: number;
}) {
  return (
    <>
      <tr className="border-t-2 border-line bg-paper-2/60">
        <td className="px-5 py-2 font-semibold text-ink">
          {publisher}
          <span className="ml-2 text-xs font-normal text-muted">
            · {items.length}
          </span>
        </td>
        <td className="px-5 py-2 text-right font-mono font-semibold tabular-nums text-ink-2">
          {formatUsd(groupNet)}
        </td>
        <td className="px-5 py-2 text-right font-mono font-semibold tabular-nums text-ink-2">
          {formatUsd(groupFee)}
        </td>
        <td className="px-5 py-2 text-right font-mono font-semibold tabular-nums text-ink">
          {formatUsd(groupTotal)}
        </td>
      </tr>
      {items.map((ln) => (
        <tr
          key={ln.id}
          className="border-t border-line-soft hover:bg-paper-2 transition-colors"
        >
          <td className="px-5 py-2 pl-8 text-[13px] text-ink-2">
            {ln.placementName}
          </td>
          <td className="px-5 py-2 text-right font-mono text-ink-2 tabular-nums text-[13px]">
            {formatUsd(ln.amountNet)}
          </td>
          <td className="px-5 py-2 text-right font-mono text-muted tabular-nums text-[13px]">
            {formatUsd(ln.feeAmount)}
          </td>
          <td className="px-5 py-2 text-right font-mono text-ink tabular-nums text-[13px]">
            {formatUsd(ln.total)}
          </td>
        </tr>
      ))}
    </>
  );
}

function Meta({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
        {label}
      </dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}
