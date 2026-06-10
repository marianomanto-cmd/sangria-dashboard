"use client";

// "Última edición" de la versión vigente del plan: chip clickeable en el
// header del editor (quién + cuándo, derivado del audit_log) que abre un
// modal SOLO LECTURA con la lista de cambios de la versión vigente —
// renderizados con el mismo AuditEntry de /auditoria (oración + diff de
// campos). Los eventos llegan ya acotados desde el server (page.tsx computa
// la ventana con los snapshots: desde la última aprobación, o desde la
// creación si nunca se aprobó).

import { useEffect, useRef, useState } from "react";
import { History, X } from "lucide-react";
import { AuditEntry } from "@/components/audit-entry";
import type { AuditLogRow } from "@/db/queries/audit-log";
import { actorLabel, formatRelativeDateTime } from "@/lib/audit-format";

export type PlanEditHistory = {
  events: AuditLogRow[];
  // Nota de ventana para el modal ("desde la aprobación de v2", etc.).
  windowNote: string;
};

export function PlanLastEdit({ history }: { history: PlanEditHistory }) {
  const [open, setOpen] = useState(false);

  const last = history.events[0];
  if (!last) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted">
        <History size={12} strokeWidth={2} />
        Última edición: sin registro
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink underline-offset-2 hover:underline"
        title="Ver los cambios de la versión vigente"
      >
        <History size={12} strokeWidth={2} />
        Última edición:{" "}
        <span className="font-medium text-ink-2">
          {actorLabel(last.userEmail, last.userId)}
        </span>
        <span className="font-mono">· {formatRelativeDateTime(last.createdAt)}</span>
      </button>
      {open && <HistoryModal history={history} onClose={() => setOpen(false)} />}
    </>
  );
}

// Modal solo lectura. Mismo patrón a11y que confirm-dialog: role=dialog +
// aria-modal, Escape y backdrop cierran, scroll-lock del body, foco inicial
// en el botón de cerrar y restauración del foco al cerrar.
function HistoryModal({
  history,
  onClose,
}: {
  history: PlanEditHistory;
  onClose: () => void;
}) {
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    lastFocused.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeBtnRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      lastFocused.current?.focus?.();
    };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      onKeyDown={onKeyDown}
    >
      <div
        className="absolute inset-0 bg-ink/40 backdrop-blur-[1px] animate-fade-in"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-history-title"
        className="relative w-full max-w-2xl max-h-[80vh] flex flex-col rounded-lg border border-line bg-white dark:bg-paper-2 shadow-[var(--shadow-card-hover)] animate-dialog-in"
      >
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-line-soft">
          <div>
            <h2 id="plan-history-title" className="text-base font-semibold text-ink">
              Cambios de la versión vigente
            </h2>
            <p className="text-xs text-muted mt-0.5">
              {history.windowNote} · {history.events.length}{" "}
              {history.events.length === 1 ? "evento" : "eventos"} · solo lectura
            </p>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1.5 text-muted hover:text-ink hover:bg-paper-2"
            aria-label="Cerrar"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        <div className="overflow-y-auto">
          <ul className="divide-y divide-line-soft">
            {history.events.map((row) => (
              <li key={row.id} className="px-5 py-3">
                <AuditEntry row={row} />
              </li>
            ))}
          </ul>
        </div>

        <p className="px-5 py-2.5 border-t border-line-soft text-[11px] text-muted">
          Incluye plan, publishers, placements, fees y tabs auxiliares (también
          los ya borrados). El log completo vive en Auditoría.
        </p>
      </div>
    </div>
  );
}
