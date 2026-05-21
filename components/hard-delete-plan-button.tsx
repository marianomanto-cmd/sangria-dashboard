"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { hardDeletePlan } from "@/app/actions/plans";

// Borrado DEFINITIVO de un plan desde la papelera. Acción irreversible:
// confirmación explícita en inglés (igual que el resto de la feature).
export function HardDeletePlanButton({
  planId,
  planName,
}: {
  planId: string;
  planName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onConfirm = () => {
    setError(null);
    startTransition(async () => {
      const res = await hardDeletePlan({ planId });
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
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-1 text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
      >
        <Trash2 size={13} strokeWidth={2} />
        Delete forever
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
            <h3 className="text-base font-semibold">Delete permanently?</h3>
            <p className="text-sm text-muted">
              This will permanently delete{" "}
              <strong className="text-ink">{planName}</strong> and all of its
              data — publishers, placements, fees and billings.{" "}
              <strong className="text-ink">This cannot be undone.</strong>
            </p>
            {error && <p className="text-xs text-danger">{error}</p>}
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
                {pending ? "Deleting…" : "Delete forever"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
