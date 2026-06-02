"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deletePlan } from "@/app/actions/plans";

// Botón de borrado de un plan desde la vista de proyecto. Abre un modal de
// confirmación (en inglés, por pedido) y manda el plan a la papelera (soft
// delete). El texto es intencionalmente hardcodeado en inglés.
export function DeletePlanButton({
  planId,
  planName,
  className = "",
}: {
  planId: string;
  planName: string;
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onConfirm = () => {
    setError(null);
    startTransition(async () => {
      const res = await deletePlan({ planId });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <button
        type="button"
        aria-label="Delete plan"
        title="Delete plan"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className={`inline-flex items-center justify-center rounded-md p-1.5 text-muted hover:text-danger hover:bg-paper-2 transition-colors ${className}`}
      >
        <Trash2 size={15} strokeWidth={2} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !pending) setOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-lg border border-line bg-white dark:bg-paper-2 shadow-xl p-5 space-y-3">
            <h3 className="text-base font-semibold">Delete plan?</h3>
            <p className="text-sm text-muted">
              Are you sure you want to delete{" "}
              <strong className="text-ink">{planName}</strong>? It will be moved
              to the Trash and removed from the project. Nothing is lost — you
              can restore it later from Settings → Plan trash.
            </p>
            {error && <p role="alert" className="text-xs text-danger">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-1.5 text-sm hover:bg-paper-2 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={pending}
                className="rounded-md bg-danger text-white px-3 py-1.5 text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                {pending ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
