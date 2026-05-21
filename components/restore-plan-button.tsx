"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { restorePlan } from "@/app/actions/plans";

// Restaura un plan desde la papelera. Texto en inglés (igual que el resto de
// esta feature). Si hay colisión de nombre con un plan vivo, la action devuelve
// un error y lo mostramos.
export function RestorePlanButton({ planId }: { planId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const onClick = () => {
    startTransition(async () => {
      const res = await restorePlan({ planId });
      if (!res.ok) {
        alert(res.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-1 text-xs font-medium text-ink hover:bg-paper-2 disabled:opacity-50"
    >
      <RotateCcw size={13} strokeWidth={2} />
      {pending ? "Restoring…" : "Restore"}
    </button>
  );
}
