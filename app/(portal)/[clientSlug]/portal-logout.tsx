"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

export function PortalLogout() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await fetch("/api/portal/logout", { method: "POST" });
          router.refresh();
        })
      }
      className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink disabled:opacity-50"
    >
      <LogOut size={13} />
      Salir
    </button>
  );
}
