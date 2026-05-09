"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  deleteBillingDraft,
  markBillingPaid,
  sendBilling,
} from "@/app/actions/billing";

type Props = {
  id: string;
  status: "draft" | "sent" | "paid" | "overdue";
  invoiceNumber: string | null;
};

type LocalStatus = "idle" | "working" | "error";

export function BillingActions({ id, status }: Props) {
  const router = useRouter();
  const [local, setLocal] = useState<LocalStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const guard = async <T,>(fn: () => Promise<T>) => {
    setLocal("working");
    setError(null);
    try {
      return await fn();
    } finally {
      setLocal((s) => (s === "working" ? "idle" : s));
    }
  };

  const handleSend = async () => {
    const res = await guard(() => sendBilling(id));
    if (!res.ok) {
      setLocal("error");
      setError(res.error);
      return;
    }
    router.refresh();
  };

  const handlePaid = async () => {
    const res = await guard(() => markBillingPaid(id));
    if (!res.ok) {
      setLocal("error");
      setError(res.error);
      return;
    }
    router.refresh();
  };

  const handleDelete = async () => {
    if (!confirm("¿Borrar este draft? Esta acción no se audita como delete sino que elimina el row.")) {
      return;
    }
    const res = await guard(() => deleteBillingDraft(id));
    if (!res.ok) {
      setLocal("error");
      setError(res.error);
      return;
    }
    router.push("/billing");
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        {status === "draft" && (
          <>
            <button
              type="button"
              onClick={handleDelete}
              disabled={local === "working"}
              className="text-sm text-danger hover:bg-danger-soft px-3 py-1.5 rounded-md transition-colors disabled:opacity-50"
            >
              Borrar draft
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={local === "working"}
              className="inline-flex items-center gap-1.5 rounded-md bg-ink text-white px-3 py-1.5 text-sm font-medium hover:bg-ink-2 transition-colors disabled:opacity-50"
            >
              {local === "working" ? "Emitiendo…" : "Emitir factura"}
            </button>
          </>
        )}
        {status === "sent" && (
          <button
            type="button"
            onClick={handlePaid}
            disabled={local === "working"}
            className="inline-flex items-center gap-1.5 rounded-md bg-success text-white px-3 py-1.5 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {local === "working" ? "Marcando…" : "Marcar como pagada"}
          </button>
        )}
        {status === "paid" && (
          <span className="text-xs text-muted">Factura pagada — sin acciones disponibles</span>
        )}
      </div>
      {error && (
        <p className="text-xs text-danger max-w-xs text-right">{error}</p>
      )}
    </div>
  );
}
