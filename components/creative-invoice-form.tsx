"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/button";
import { createCreativeBilling } from "@/app/actions/creative-billing";
import type { Language } from "@/lib/i18n";

// ════════════════════════════════════════════════════════════════════════════
// Alta de una factura de creative desde /creative.
//
// Antes las facturas entraban SÓLO por SQL a mano (db/creative-billings.sql):
// no había forma de cargar una sin abrir el SQL Editor de Supabase. Este panel
// es esa forma. La validación real vive en la action (`createCreativeBilling`);
// acá sólo se arma el payload y se muestra el error que devuelve.
//
// Pensado para cargar VARIAS seguidas (así llegan: por tanda mensual). Después
// de guardar, el panel queda abierto y conserva cliente + mes + estado — lo que
// se repite en una tanda — y limpia lo que cambia en cada factura.
// ════════════════════════════════════════════════════════════════════════════

type ClientOption = { id: string; name: string };

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const INPUT =
  "w-full rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft";

export function CreativeInvoiceForm({
  clients,
  defaultClientId,
  lang = "es",
}: {
  clients: ClientOption[];
  // Cliente del filtro global (?client=), si hay uno activo.
  defaultClientId?: string | null;
  lang?: Language;
}) {
  const router = useRouter();
  const es = lang === "es";

  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState(
    defaultClientId ?? clients[0]?.id ?? "",
  );
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [month, setMonth] = useState(currentMonth());
  const [invoiceDate, setInvoiceDate] = useState("");
  const [amount, setAmount] = useState("");
  const [campaignCode, setCampaignCode] = useState("");
  const [projectName, setProjectName] = useState("");
  const [status, setStatus] = useState<"invoiced" | "paid">("invoiced");
  const [notes, setNotes] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit =
    !!clientId && invoiceNumber.trim().length > 0 && !!month && !!amount;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setError(null);
    setSaved(null);
    setSubmitting(true);

    const res = await createCreativeBilling({
      clientId,
      invoiceNumber: invoiceNumber.trim(),
      month,
      amountUsd: Number.parseFloat(amount),
      campaignCode: campaignCode || null,
      projectName: projectName || null,
      invoiceDate: invoiceDate || null,
      status,
      notesMd: notes || null,
    });
    setSubmitting(false);

    if (!res.ok) {
      setError(res.error);
      return;
    }

    // Se conservan cliente + mes + estado (se repiten en una tanda); se limpia
    // lo propio de cada factura.
    setSaved(invoiceNumber.trim());
    setInvoiceNumber("");
    setAmount("");
    setCampaignCode("");
    setProjectName("");
    setInvoiceDate("");
    setNotes("");
    router.refresh();
  };

  return (
    <section className="rounded-lg border border-line bg-white dark:bg-paper-2 mb-5">
      <header className="flex items-start justify-between gap-4 px-5 py-3.5">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">
            {es ? "Cargar factura de creative" : "Add creative invoice"}
          </p>
          <p className="text-xs text-muted mt-0.5">
            {es
              ? "Trabajo creativo facturado aparte de los planes de medios. Se suma a la tabla de abajo y al portal del cliente."
              : "Creative work billed separately from media plans. It shows up in the table below and in the client portal."}
          </p>
        </div>
        <Button
          variant={open ? "secondary" : "primary"}
          size="sm"
          onClick={() => {
            setOpen((v) => !v);
            setError(null);
            setSaved(null);
          }}
          aria-expanded={open}
        >
          {open ? <X size={14} strokeWidth={2} /> : <Plus size={14} strokeWidth={2} />}
          {open
            ? es
              ? "Cerrar"
              : "Close"
            : es
              ? "Cargar factura"
              : "Add invoice"}
        </Button>
      </header>

      {open && (
        <form
          onSubmit={handleSubmit}
          className="border-t border-line-soft px-5 py-4 flex flex-col gap-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Field label={es ? "Cliente" : "Client"} required>
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className={INPUT}
                required
              >
                {clients.length === 0 && (
                  <option value="">
                    {es ? "Sin clientes" : "No clients"}
                  </option>
                )}
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={es ? "N° de factura" : "Invoice #"} required>
              <input
                type="text"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                placeholder="1226"
                required
                className={`${INPUT} font-mono`}
              />
            </Field>

            <Field label={es ? "Mes" : "Month"} required>
              {/* type="month" da YYYY-MM nativo; donde el browser no lo soporta
                  (Firefox) cae a texto y la action valida el formato igual. */}
              <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                placeholder="YYYY-MM"
                required
                className={`${INPUT} font-mono`}
              />
            </Field>

            <Field label={es ? "Monto (USD)" : "Amount (USD)"} required>
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) =>
                  setAmount(e.target.value.replace(/[^0-9.]/g, ""))
                }
                placeholder="3500.00"
                required
                className={`${INPUT} font-mono`}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Field
              label={es ? "Proyecto (opcional)" : "Project (optional)"}
              hint={
                es
                  ? "Nombre legible, es lo que se muestra en la tabla."
                  : "Readable name — this is what the table shows."
              }
            >
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder={es ? "Salta Creative" : "Salta Creative"}
                className={INPUT}
              />
            </Field>

            <Field
              label={es ? "Código de campaña (opcional)" : "Campaign code (optional)"}
              hint={
                es
                  ? "Los c#### de creative tienen numeración propia."
                  : "Creative c#### codes have their own numbering."
              }
            >
              <input
                type="text"
                value={campaignCode}
                onChange={(e) => setCampaignCode(e.target.value)}
                placeholder="COPA.c1117.SaltaCreative"
                className={`${INPUT} font-mono text-xs`}
              />
            </Field>

            <Field label={es ? "Fecha de factura (opcional)" : "Invoice date (optional)"}>
              <input
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                className={INPUT}
              />
            </Field>

            <Field label={es ? "Estado" : "Status"}>
              <select
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value === "paid" ? "paid" : "invoiced")
                }
                className={INPUT}
              >
                <option value="invoiced">
                  {es ? "Facturada (pendiente de cobro)" : "Invoiced (pending)"}
                </option>
                <option value="paid">{es ? "Cobrada" : "Paid"}</option>
              </select>
            </Field>
          </div>

          <Field label={es ? "Notas (opcional)" : "Notes (optional)"}>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className={INPUT}
            />
          </Field>

          {error && (
            <p
              role="alert"
              className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-xs text-danger"
            >
              {error}
            </p>
          )}
          {saved && !error && (
            <p className="rounded-md border border-success-soft bg-success-soft px-3 py-2 text-xs text-success">
              {es
                ? `Factura ${saved} cargada. Podés seguir con la siguiente.`
                : `Invoice ${saved} saved. You can add the next one.`}
            </p>
          )}

          <div className="flex items-center gap-3 border-t border-line-soft pt-4">
            <Button type="submit" disabled={!canSubmit || submitting}>
              {submitting
                ? es
                  ? "Guardando…"
                  : "Saving…"
                : es
                  ? "Guardar factura"
                  : "Save invoice"}
            </Button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-sm text-muted hover:text-ink"
            >
              {es ? "Cancelar" : "Cancel"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium uppercase tracking-[0.08em] text-muted mb-1.5">
        {label}
        {required && <span className="text-danger ml-0.5">*</span>}
      </span>
      {children}
      {hint && <span className="block mt-1 text-[11px] text-muted">{hint}</span>}
    </label>
  );
}
