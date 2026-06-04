"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  clearBillingInvoiceNumber,
  ensureBillingForMonth,
  markBillingInvoiced,
  setFeeImputation,
  setPublisherConsumption,
  transitionBillingStatus,
} from "@/app/actions/plan-billing";
import type { planBillings as planBillingsTable } from "@/db/schema";
import { Button } from "@/components/button";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-dialog";
import { BillingStatusBadge } from "@/components/billing-status-badge";
import {
  evalNumberInput,
  formatAmountInput,
  formatUsd,
  formatUsdCompact,
} from "@/lib/format";

type Billing = typeof planBillingsTable.$inferSelect;

type PubLine = {
  publisherId: string;
  publisherName: string;
  publisherSlug: string;
  agencyPays: boolean;
  totalPlannedUsd: number;
  consumedBeforeUsd: number;
  amountThisMonthUsd: number;
  isBillable: boolean;
  notes: string | null;
};

type FeeLine = {
  mediaPlanFeeId: string;
  feeName: string;
  feeType: string;
  totalAmountUsd: number;
  accumulatedBeforeUsd: number;
  amountThisMonthUsd: number;
  notes: string | null;
};

export function BillingMonthEditor({
  planId,
  projectCode,
  month,
  billing,
  publisherLines,
  feeLines,
}: {
  planId: string;
  projectCode: string;
  month: string;
  billing: Billing | null;
  publisherLines: PubLine[];
  feeLines: FeeLine[];
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();

  if (!billing) {
    // Auto-create on load? Show CTA instead.
    const handleCreate = () => {
      startTransition(async () => {
        const r = await ensureBillingForMonth({ planId, month });
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
        router.refresh();
      });
    };
    return (
      <div className="rounded-lg border border-line bg-white dark:bg-paper-2 px-5 py-8 text-center">
        <p className="text-sm font-medium text-ink-2 mb-2">
          Sin carga para {month}
        </p>
        <p className="text-xs text-muted mb-4">
          Crear el billing draft del mes con todos los publishers + fees del
          plan pre-cargados en cero.
        </p>
        <Button onClick={handleCreate} disabled={pending}>
          {pending ? "Creando…" : `Crear draft para ${month}`}
        </Button>
      </div>
    );
  }

  const editable = billing.status === "draft";

  const onSetPublisher = (publisherId: string, partial: { amount?: number; isBillable?: boolean; notes?: string | null }) => {
    startTransition(async () => {
      const r = await setPublisherConsumption({
        billingId: billing.id,
        publisherId,
        amountRealUsd:
          partial.amount ??
          publisherLines.find((p) => p.publisherId === publisherId)?.amountThisMonthUsd ??
          0,
        isBillable: partial.isBillable,
        notes: partial.notes,
      });
      if (!r.ok) toast.error(r.error);
      router.refresh();
    });
  };

  const onSetFee = (feeId: string, amount: number, notes?: string | null) => {
    startTransition(async () => {
      const r = await setFeeImputation({
        billingId: billing.id,
        mediaPlanFeeId: feeId,
        amountImputedUsd: amount,
        notes,
      });
      if (!r.ok) toast.error(r.error);
      router.refresh();
    });
  };

  const onTransition = (to: "draft" | "ready" | "sent" | "paid" | "invoiced") => {
    startTransition(async () => {
      const r = await transitionBillingStatus({ billingId: billing.id, to });
      if (!r.ok) toast.error(r.error);
      router.refresh();
    });
  };

  // "Reportar" = transición ready → sent + descarga del PDF de finanzas.
  // El PDF se abre en una nueva pestaña ANTES de la transición para evitar
  // pop-up blockers; si la transición falla la descarga ya está en curso.
  const onReportar = async () => {
    if (
      !(await confirm({
        title: `¿Reportar el billing de ${month}?`,
        body: 'Se descarga el PDF para finanzas y el estado pasa a "reportado".',
        confirmLabel: "Reportar",
      }))
    )
      return;
    window.open(`/api/billings/${billing.id}/report.pdf`, "_blank");
    startTransition(async () => {
      const r = await transitionBillingStatus({ billingId: billing.id, to: "sent" });
      if (!r.ok) toast.error(r.error);
      router.refresh();
    });
  };

  const onFacturar = (invoiceNumber: string) => {
    startTransition(async () => {
      const r = await markBillingInvoiced({ billingId: billing.id, invoiceNumber });
      if (!r.ok) toast.error(r.error);
      router.refresh();
    });
  };

  // Quitar el número de factura: vuelve el billing a "reportado" y lo deja sin
  // número para poder cargar otro después.
  const onClearInvoice = async () => {
    if (
      !(await confirm({
        title: "¿Quitar el número de factura?",
        body: 'El billing vuelve a "reportado" y el número queda vacío. Después podés cargar otro número.',
        confirmLabel: "Quitar número",
        danger: true,
      }))
    )
      return;
    startTransition(async () => {
      const r = await clearBillingInvoiceNumber({ billingId: billing.id });
      if (!r.ok) toast.error(r.error);
      else toast.success("Número de factura quitado · volvió a reportado");
      router.refresh();
    });
  };

  const publisherSubtotal = publisherLines
    .filter((p) => p.isBillable)
    .reduce((s, p) => s + p.amountThisMonthUsd, 0);
  const feeSubtotal = feeLines.reduce((s, f) => s + f.amountThisMonthUsd, 0);
  const grand = publisherSubtotal + feeSubtotal;

  return (
    <div className="space-y-4">
      {/* Header del mes */}
      <div className="rounded-lg border border-line bg-white dark:bg-paper-2 px-5 py-4 flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
            Billing · {month}
          </p>
          <div className="flex items-center gap-3 mt-1">
            <h2 className="text-xl font-semibold">{month}</h2>
            <BillingStatusBadge status={billing.status} />
            {billing.invoiceNumber && (
              <span className="font-mono text-xs text-muted">
                N° {billing.invoiceNumber}
              </span>
            )}
          </div>
        </div>
        <BillingStatusActions
          status={billing.status}
          pending={pending}
          onTransition={onTransition}
          onReportar={onReportar}
          onFacturar={onFacturar}
          onClearInvoice={onClearInvoice}
          billingId={billing.id}
          currentInvoiceNumber={billing.invoiceNumber}
        />
      </div>

      {/* Publishers — consumo del mes */}
      <section className="rounded-lg border border-line bg-white dark:bg-paper-2 overflow-hidden">
        <div className="px-5 py-3 border-b border-line flex items-baseline justify-between">
          <h3 className="text-sm font-semibold">Consumo por publisher</h3>
          <span className="text-[11px] uppercase tracking-[0.08em] text-muted font-medium">
            Subtotal facturable: {formatUsd(publisherSubtotal)}
          </span>
        </div>
        {publisherLines.length === 0 ? (
          <div className="px-5 py-8 text-center text-xs text-muted">
            El plan no tiene publishers cargados.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-paper">
              <tr className="text-[11px] uppercase tracking-[0.06em] text-muted">
                <th className="text-left font-medium px-5 py-2">Publisher</th>
                <th className="text-left font-medium px-5 py-2">Facturable</th>
                <th className="text-right font-medium px-5 py-2">Plan</th>
                <th className="text-right font-medium px-5 py-2">Consumido antes</th>
                <th className="text-right font-medium px-5 py-2">Este mes</th>
                <th className="text-right font-medium px-5 py-2">Restante</th>
                <th className="text-left font-medium px-5 py-2">Notas</th>
              </tr>
            </thead>
            <tbody>
              {publisherLines.map((p) => {
                const remaining =
                  p.totalPlannedUsd - p.consumedBeforeUsd - p.amountThisMonthUsd;
                const isOver = remaining < -0.01;
                const isAtCap =
                  p.totalPlannedUsd > 0 && remaining < 0.01 && remaining > -0.01;
                return (
                  <tr
                    key={p.publisherId}
                    className="border-t border-line-soft hover:bg-paper-2/50"
                  >
                    <td className="px-5 py-2">
                      <span className="font-medium text-ink">{p.publisherName}</span>
                    </td>
                    <td className="px-5 py-2">
                      <input
                        type="checkbox"
                        checked={p.isBillable}
                        disabled={!editable}
                        onChange={(e) =>
                          onSetPublisher(p.publisherId, { isBillable: e.target.checked })
                        }
                      />
                    </td>
                    <td className="px-5 py-2 text-right font-mono text-ink-2">
                      {formatUsd(p.totalPlannedUsd)}
                    </td>
                    <td className="px-5 py-2 text-right font-mono text-muted text-xs">
                      {formatUsdCompact(p.consumedBeforeUsd)}
                    </td>
                    <td className="px-5 py-2 text-right">
                      <NumInput
                        value={p.amountThisMonthUsd}
                        disabled={!editable}
                        max={Math.max(
                          0,
                          p.totalPlannedUsd - p.consumedBeforeUsd,
                        )}
                        onCommit={(v) =>
                          onSetPublisher(p.publisherId, { amount: v })
                        }
                      />
                    </td>
                    <td
                      className={`px-5 py-2 text-right font-mono text-xs ${
                        isOver
                          ? "text-warn font-semibold"
                          : isAtCap
                            ? "text-success"
                            : "text-muted"
                      }`}
                    >
                      {formatUsd(remaining)}
                    </td>
                    <td className="px-5 py-2">
                      <TextInput
                        value={p.notes ?? ""}
                        disabled={!editable}
                        onCommit={(v) => onSetPublisher(p.publisherId, { notes: v || null })}
                        placeholder="—"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* Fees */}
      <section className="rounded-lg border border-line bg-white dark:bg-paper-2 overflow-hidden">
        <div className="px-5 py-3 border-b border-line flex items-baseline justify-between">
          <h3 className="text-sm font-semibold">Imputación de fees</h3>
          <span className="text-[11px] uppercase tracking-[0.08em] text-muted font-medium">
            Subtotal: {formatUsd(feeSubtotal)}
          </span>
        </div>
        {feeLines.length === 0 ? (
          <div className="px-5 py-8 text-center text-xs text-muted">
            El plan no tiene fees cargados.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-paper">
              <tr className="text-[11px] uppercase tracking-[0.06em] text-muted">
                <th className="text-left font-medium px-5 py-2">Tipo</th>
                <th className="text-left font-medium px-5 py-2">Nombre</th>
                <th className="text-right font-medium px-5 py-2">Total fee</th>
                <th className="text-right font-medium px-5 py-2">Imputado antes</th>
                <th className="text-right font-medium px-5 py-2">Este mes</th>
                <th className="text-right font-medium px-5 py-2">Restante</th>
                <th className="text-left font-medium px-5 py-2">Notas</th>
              </tr>
            </thead>
            <tbody>
              {feeLines.map((f) => {
                const remaining = f.totalAmountUsd - f.accumulatedBeforeUsd - f.amountThisMonthUsd;
                const isOver = remaining < -0.01;
                return (
                  <tr
                    key={f.mediaPlanFeeId}
                    className="border-t border-line-soft hover:bg-paper-2/50"
                  >
                    <td className="px-5 py-2 text-xs font-mono text-muted uppercase">
                      {f.feeType}
                    </td>
                    <td className="px-5 py-2 text-ink">
                      {f.feeName}
                      {f.feeType === "management" && (
                        <span
                          className="ml-2 text-[10px] uppercase tracking-[0.06em] text-muted font-medium"
                          title="Se autoprorratea con (gasto del mes / total media del plan) × total fee al cambiar los consumos. Editá a mano para sobreescribir."
                        >
                          auto
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-2 text-right font-mono text-ink-2">
                      {formatUsd(f.totalAmountUsd)}
                    </td>
                    <td className="px-5 py-2 text-right font-mono text-muted text-xs">
                      {formatUsdCompact(f.accumulatedBeforeUsd)}
                    </td>
                    <td className="px-5 py-2 text-right">
                      <NumInput
                        value={f.amountThisMonthUsd}
                        disabled={!editable}
                        max={Math.max(
                          0,
                          f.totalAmountUsd - f.accumulatedBeforeUsd,
                        )}
                        onCommit={(v) => onSetFee(f.mediaPlanFeeId, v)}
                      />
                    </td>
                    <td
                      className={`px-5 py-2 text-right font-mono text-xs ${
                        isOver ? "text-warn font-semibold" : "text-muted"
                      }`}
                    >
                      {formatUsd(remaining)}
                    </td>
                    <td className="px-5 py-2 text-xs text-muted">
                      {f.notes ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* Totales */}
      <div className="rounded-lg border-2 border-ink bg-paper-2 px-5 py-3 flex items-center justify-between">
        <span className="text-sm font-semibold">Total del mes</span>
        <div className="text-right">
          <span className="font-mono text-xl font-semibold tabular-nums">
            {formatUsd(grand)}
          </span>
          <p className="text-[11px] text-muted">
            {formatUsdCompact(publisherSubtotal)} consumo +{" "}
            {formatUsdCompact(feeSubtotal)} fees
          </p>
        </div>
      </div>

      <p className="text-[11px] text-muted">
        Edición disponible solo en estado <span className="font-mono">draft</span>.
        Una vez emitida la factura, el monto queda inmutable.
      </p>
      <div className="text-[11px] text-muted">
        <Link
          href={`/proyectos/${projectCode}/planes/${planId}`}
          className="hover:underline"
        >
          ← Volver al editor del plan
        </Link>
      </div>
    </div>
  );
}

// Botones del header del editor: muestran las acciones disponibles según el
// status. El "Reportar" descarga el PDF + transiciona a sent. El "Facturar"
// pide el número de factura y llama a markBillingInvoiced.
function BillingStatusActions({
  status,
  pending,
  onTransition,
  onReportar,
  onFacturar,
  onClearInvoice,
  billingId,
  currentInvoiceNumber,
}: {
  status: string;
  pending: boolean;
  onTransition: (to: "draft" | "ready" | "sent" | "paid" | "invoiced") => void;
  onReportar: () => void;
  onFacturar: (invoiceNumber: string) => void;
  onClearInvoice: () => void;
  billingId: string;
  currentInvoiceNumber: string | null;
}) {
  const [showInvoiceInput, setShowInvoiceInput] = useState(false);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {status === "draft" && (
        <button
          type="button"
          onClick={() => onTransition("ready")}
          disabled={pending}
          className="rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-1.5 text-xs font-medium text-ink hover:bg-paper-2 disabled:opacity-50"
        >
          Marcar listo
        </button>
      )}
      {status === "ready" && (
        <>
          <button
            type="button"
            onClick={() => onTransition("draft")}
            disabled={pending}
            className="text-xs text-muted hover:text-ink px-2 py-1.5 disabled:opacity-50"
          >
            Volver a borrador
          </button>
          <Button size="sm" onClick={onReportar} disabled={pending}>
            Reportar (PDF)
          </Button>
        </>
      )}
      {status === "sent" && (
        <>
          <button
            type="button"
            onClick={() => onTransition("ready")}
            disabled={pending}
            className="text-xs text-muted hover:text-ink px-2 py-1.5 disabled:opacity-50"
          >
            Volver a listo
          </button>
          <a
            href={`/api/billings/${billingId}/report.pdf`}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-1.5 text-xs text-ink-2 hover:bg-paper-2"
          >
            Bajar PDF de nuevo
          </a>
          {showInvoiceInput ? (
            <InvoiceInput
              initial=""
              pending={pending}
              onCancel={() => setShowInvoiceInput(false)}
              onSubmit={(v) => {
                setShowInvoiceInput(false);
                onFacturar(v);
              }}
            />
          ) : (
            <Button
              size="sm"
              onClick={() => setShowInvoiceInput(true)}
              disabled={pending}
            >
              Cargar número de factura
            </Button>
          )}
        </>
      )}
      {status === "invoiced" && (
        <>
          <button
            type="button"
            onClick={() => onTransition("sent")}
            disabled={pending}
            className="text-xs text-muted hover:text-ink px-2 py-1.5 disabled:opacity-50"
          >
            Volver a reportado
          </button>
          {showInvoiceInput ? (
            <InvoiceInput
              initial={currentInvoiceNumber ?? ""}
              pending={pending}
              onCancel={() => setShowInvoiceInput(false)}
              onSubmit={(v) => {
                setShowInvoiceInput(false);
                onFacturar(v);
              }}
            />
          ) : (
            <>
              <button
                type="button"
                onClick={() => setShowInvoiceInput(true)}
                disabled={pending}
                className="text-xs text-muted hover:text-ink px-2 py-1.5 disabled:opacity-50"
              >
                Editar número
              </button>
              <button
                type="button"
                onClick={onClearInvoice}
                disabled={pending}
                className="text-xs text-muted hover:text-danger px-2 py-1.5 disabled:opacity-50"
              >
                Quitar número
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => onTransition("paid")}
            disabled={pending}
            className="rounded-md bg-success text-white px-3 py-1.5 text-xs font-medium hover:opacity-90 disabled:opacity-50"
          >
            Marcar como pagado
          </button>
        </>
      )}
      {status === "paid" && (
        <>
          <button
            type="button"
            onClick={() => onTransition("invoiced")}
            disabled={pending}
            className="text-xs text-muted hover:text-ink px-2 py-1.5 disabled:opacity-50"
          >
            Revertir a facturado
          </button>
          {showInvoiceInput ? (
            <InvoiceInput
              initial={currentInvoiceNumber ?? ""}
              pending={pending}
              onCancel={() => setShowInvoiceInput(false)}
              onSubmit={(v) => {
                setShowInvoiceInput(false);
                onFacturar(v);
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => setShowInvoiceInput(true)}
              disabled={pending}
              className="text-xs text-muted hover:text-ink px-2 py-1.5 disabled:opacity-50"
            >
              Editar número
            </button>
          )}
        </>
      )}
    </div>
  );
}

function InvoiceInput({
  initial,
  pending,
  onSubmit,
  onCancel,
}: {
  initial: string;
  pending: boolean;
  onSubmit: (v: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const v = value.trim();
        if (!v) return;
        onSubmit(v);
      }}
      className="flex items-center gap-1.5"
    >
      <input
        type="text"
        autoFocus
        value={value}
        placeholder="N° de factura"
        onChange={(e) => setValue(e.target.value)}
        disabled={pending}
        className="rounded-md border border-line bg-white dark:bg-paper-2 px-2 py-1.5 text-xs w-36 focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
      />
      <Button type="submit" size="sm" disabled={pending || !value.trim()}>
        Guardar
      </Button>
      <button
        type="button"
        onClick={onCancel}
        disabled={pending}
        className="text-xs text-muted hover:text-ink px-1.5 disabled:opacity-50"
      >
        Cancelar
      </button>
    </form>
  );
}

function NumInput({
  value,
  onCommit,
  disabled,
  max,
}: {
  value: number;
  onCommit: (v: number) => void;
  disabled: boolean;
  max?: number;
}) {
  const toast = useToast();
  const overCap = max !== undefined && value > max + 0.01;
  const display = value > 0 ? formatAmountInput(value) : "";
  return (
    <input
      key={display}
      type="text"
      inputMode="decimal"
      defaultValue={display}
      disabled={disabled}
      placeholder="0"
      title={
        max !== undefined
          ? `Máximo facturable este mes: $${max.toFixed(2)}`
          : undefined
      }
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      onBlur={(e) => {
        const raw = e.target.value.trim();
        let v: number;
        if (raw === "") {
          v = 0;
        } else {
          const parsed = evalNumberInput(raw);
          if (!Number.isFinite(parsed)) {
            // Fórmula inválida → restaura el valor previo sin commitear.
            e.target.value = display;
            return;
          }
          v = parsed;
        }
        if (max !== undefined && v > max + 0.01) {
          // Hard cap: avisamos y clampeamos al máximo permitido.
          toast.error(
            `Excede el plan: máximo facturable este mes es $${max.toFixed(2)}. Se ajusta el valor.`,
          );
          v = Math.max(0, max);
        }
        // Reflejamos el resultado (fórmula evaluada / clamp) en el input.
        e.target.value = v > 0 ? formatAmountInput(v) : "";
        if (Math.abs(v - value) >= 0.01) onCommit(v);
      }}
      className={`w-32 text-right font-mono tabular-nums bg-transparent border-b ${
        overCap
          ? "border-danger text-warn"
          : "border-transparent hover:border-line focus:border-accent"
      } focus:outline-none px-1 disabled:opacity-50`}
    />
  );
}

function TextInput({
  value,
  onCommit,
  disabled,
  placeholder,
}: {
  value: string;
  onCommit: (v: string) => void;
  disabled: boolean;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      defaultValue={value}
      disabled={disabled}
      placeholder={placeholder}
      onBlur={(e) => e.target.value !== value && onCommit(e.target.value)}
      className="w-full text-xs text-muted bg-transparent border-b border-transparent hover:border-line focus:border-accent focus:outline-none px-1 disabled:opacity-50"
    />
  );
}
