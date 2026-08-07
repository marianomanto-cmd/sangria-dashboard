"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, RotateCcw } from "lucide-react";
import { BillingStatusBadge } from "@/components/billing-status-badge";
import { setCreativeBillingPaid } from "@/app/actions/creative-billing";
import { formatUsd } from "@/lib/format";
import { formatDate, formatMonth, type Language } from "@/lib/i18n";
import type { CreativeInvoice } from "@/db/queries/creative";

// Tabla de facturación creative con el botón de cobro inline. Desktop: tabla.
// Mobile: tarjetas (mismo patrón que el Billing Tracker, sin scroll horizontal).
export function CreativeTable({
  invoices,
  lang = "es",
}: {
  invoices: CreativeInvoice[];
  lang?: Language;
}) {
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="rounded-lg border border-line bg-white dark:bg-paper-2 overflow-hidden">
      {error && (
        <p role="alert" className="px-5 py-2 text-xs text-danger bg-danger-soft">
          {error}
        </p>
      )}

      {/* Desktop */}
      <div className="hidden lg:block overflow-x-auto">
        <table className="w-full text-sm min-w-[820px]">
          <thead>
            <tr className="text-[11px] uppercase tracking-[0.06em] text-muted bg-paper-2">
              <th className="text-left font-medium px-5 py-2.5">
                {lang === "es" ? "N° factura" : "Invoice #"}
              </th>
              <th className="text-left font-medium px-5 py-2.5">
                {lang === "es" ? "Proyecto" : "Project"}
              </th>
              <th className="text-left font-medium px-5 py-2.5">
                {lang === "es" ? "Mes" : "Month"}
              </th>
              <th className="text-left font-medium px-5 py-2.5">
                {lang === "es" ? "Fecha" : "Date"}
              </th>
              <th className="text-right font-medium px-5 py-2.5">
                {lang === "es" ? "Monto" : "Amount"}
              </th>
              <th className="text-left font-medium px-5 py-2.5">
                {lang === "es" ? "Estado" : "Status"}
              </th>
              <th className="px-5 py-2.5" aria-label="acciones" />
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id} className="border-t border-line-soft hover:bg-paper-2 transition-colors">
                <td className="px-5 py-2.5 font-mono text-ink-2">
                  {inv.invoiceNumber}
                </td>
                <td className="px-5 py-2.5 min-w-0">
                  <p className="text-ink truncate">
                    {inv.projectName ?? inv.campaignCode ?? (
                      <span className="text-muted italic">
                        {lang === "es" ? "sin proyecto" : "no project"}
                      </span>
                    )}
                  </p>
                  {inv.projectName && inv.campaignCode && (
                    <p className="font-mono text-[10px] text-muted truncate">
                      {inv.campaignCode}
                    </p>
                  )}
                </td>
                <td className="px-5 py-2.5 text-ink-2">
                  {formatMonth(inv.month, lang)}
                </td>
                <td className="px-5 py-2.5 text-muted text-xs">
                  {inv.invoiceDate ? formatDate(inv.invoiceDate, lang) : "—"}
                </td>
                <td className="px-5 py-2.5 text-right font-mono font-semibold text-ink tabular-nums">
                  {formatUsd(inv.amountUsd)}
                </td>
                <td className="px-5 py-2.5">
                  <BillingStatusBadge status={inv.status} lang={lang} size="sm" />
                </td>
                <td className="px-5 py-2.5 text-right">
                  <PayButton invoice={inv} lang={lang} onError={setError} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile */}
      <div className="lg:hidden divide-y divide-line-soft">
        {invoices.map((inv) => (
          <div key={inv.id} className="px-5 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-ink font-medium truncate">
                  {inv.projectName ?? inv.campaignCode ?? "—"}
                </p>
                <p className="font-mono text-[11px] text-muted mt-0.5">
                  {inv.invoiceNumber} · {formatMonth(inv.month, lang)}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <BillingStatusBadge status={inv.status} lang={lang} size="sm" />
                <p className="font-mono font-semibold text-ink mt-1.5 tabular-nums">
                  {formatUsd(inv.amountUsd)}
                </p>
              </div>
            </div>
            <div className="mt-3">
              <PayButton invoice={inv} lang={lang} onError={setError} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function PayButton({
  invoice,
  lang,
  onError,
}: {
  invoice: CreativeInvoice;
  lang: Language;
  onError: (m: string | null) => void;
}) {
  const [pending, startTransition] = useTransition();
  const paid = invoice.status === "paid";

  const label = paid
    ? lang === "es"
      ? "Revertir cobro"
      : "Undo payment"
    : lang === "es"
      ? "Marcar pagado"
      : "Mark paid";

  return (
    <button
      type="button"
      disabled={pending}
      title={`${label} · ${invoice.invoiceNumber}`}
      onClick={() => {
        onError(null);
        startTransition(async () => {
          const res = await setCreativeBillingPaid({
            billingId: invoice.id,
            paid: !paid,
          });
          if (!res.ok) onError(res.error);
        });
      }}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors disabled:opacity-50 ${
        paid
          ? "border-line text-muted hover:text-ink hover:bg-paper-2"
          : "border-line bg-white dark:bg-paper-2 text-ink-2 hover:border-success-soft hover:bg-success-soft hover:text-success"
      }`}
    >
      {paid ? <RotateCcw size={12} /> : <CheckCircle2 size={12} />}
      {pending ? (lang === "es" ? "guardando…" : "saving…") : label}
    </button>
  );
}
