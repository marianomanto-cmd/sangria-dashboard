"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import type { Language } from "@/lib/i18n";

// Botón "Marcar pagado" del portal: un click pasa la factura de facturado
// (invoiced) a pagado (paid) en la DB. Sólo se rendea cuando el estado es
// 'invoiced' — si ya está pagada, el badge alcanza.
//
// No es un Server Action (el proxy sólo abre GET para el portal): pega contra
// un endpoint dedicado de `/api/portal/*`, que valida cookie de portal +
// ownership de la factura. El refresh vuelve a pedir la página
// (force-dynamic) y el badge pasa a "pagado".
//
// Sirve para las DOS tablas de facturas del portal, que son tablas distintas
// con endpoints distintos: `billing` = `plan_billings` (Billing Tracker) y
// `creative` = `creative_billings` (tab Creative). El `kind` elige el endpoint;
// el resto del comportamiento es idéntico.
const ENDPOINTS = {
  billing: "/api/portal/billing/mark-paid",
  creative: "/api/portal/creative/mark-paid",
} as const;

export function PortalMarkPaidButton({
  billingId,
  clientSlug,
  invoiceNumber,
  lang,
  kind = "billing",
}: {
  billingId: string;
  clientSlug: string;
  invoiceNumber: string;
  lang: Language;
  kind?: keyof typeof ENDPOINTS;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const label = lang === "es" ? "Marcar pagado" : "Mark paid";
  const title =
    lang === "es"
      ? `Marcar la factura ${invoiceNumber} como pagada`
      : `Mark invoice ${invoiceNumber} as paid`;

  return (
    <span className="inline-flex items-center gap-1.5 align-middle">
      <button
        type="button"
        disabled={pending}
        title={title}
        aria-label={title}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              const res = await fetch(ENDPOINTS[kind], {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ billingId, clientSlug }),
              });
              const data: { ok?: boolean; error?: string } = await res
                .json()
                .catch(() => ({}));
              if (!res.ok || !data.ok) {
                setError(
                  data.error ??
                    (lang === "es"
                      ? "No se pudo marcar como pagada."
                      : "Couldn't mark as paid."),
                );
                return;
              }
              router.refresh();
            } catch {
              setError(
                lang === "es"
                  ? "No se pudo marcar como pagada."
                  : "Couldn't mark as paid.",
              );
            }
          });
        }}
        className="inline-flex items-center gap-1 rounded-sm border border-line bg-white dark:bg-paper-2 px-1.5 py-0.5 text-[10px] font-medium text-ink-2 whitespace-nowrap hover:border-success-soft hover:bg-success-soft hover:text-success transition-colors disabled:opacity-50"
      >
        <CheckCircle2 size={11} strokeWidth={2} />
        {pending ? (lang === "es" ? "guardando…" : "saving…") : label}
      </button>
      {error && (
        <span role="alert" className="text-[10px] text-danger">
          {error}
        </span>
      )}
    </span>
  );
}
