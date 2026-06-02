"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/button";

// ════════════════════════════════════════════════════════════════════════════
// Diálogo de confirmación accesible. Reemplaza al confirm() nativo (bloqueante,
// no estilable). API promise-based vía useConfirm(): el call-site casi no
// cambia —`if (!(await confirm({...}))) return;`—. Un solo modal vive en el
// provider. Focus-trap básico (Tab cicla dentro), Escape = cancelar, click en
// backdrop = cancelar, scroll-lock del body, foco inicial en el botón primario
// y restauración del foco al cerrar. role="dialog" aria-modal.
// ════════════════════════════════════════════════════════════════════════════

type ConfirmOptions = {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm debe usarse dentro de <ConfirmProvider>");
  return ctx;
}

type Pending = { opts: ConfirmOptions; resolve: (v: boolean) => void };

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      lastFocused.current = document.activeElement as HTMLElement | null;
      setPending({ opts, resolve });
    });
  }, []);

  const settle = useCallback(
    (value: boolean) => {
      setPending((p) => {
        p?.resolve(value);
        return null;
      });
      // Restaurar el foco al elemento que abrió el diálogo.
      lastFocused.current?.focus?.();
    },
    [],
  );

  // Scroll-lock + foco inicial mientras está abierto.
  useEffect(() => {
    if (!pending) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    confirmBtnRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [pending]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      settle(false);
      return;
    }
    if (e.key === "Tab") {
      // Focus-trap: mantener el Tab dentro del diálogo.
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const opts = pending?.opts;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {opts && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4"
          onKeyDown={onKeyDown}
        >
          {/* backdrop */}
          <div
            className="absolute inset-0 bg-ink/40 backdrop-blur-[1px] animate-fade-in"
            onClick={() => settle(false)}
            aria-hidden
          />
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            className="relative w-full max-w-sm rounded-lg border border-line bg-white dark:bg-paper-2 p-5 shadow-[var(--shadow-card-hover)] animate-dialog-in"
          >
            <h2 id="confirm-title" className="text-base font-semibold text-ink">
              {opts.title}
            </h2>
            {opts.body && (
              <p className="mt-2 text-sm text-muted leading-relaxed whitespace-pre-line">
                {opts.body}
              </p>
            )}
            <div className="mt-5 flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => settle(false)}>
                {opts.cancelLabel ?? "Cancelar"}
              </Button>
              <button
                ref={confirmBtnRef}
                type="button"
                onClick={() => settle(true)}
                className={
                  opts.danger
                    ? "inline-flex items-center justify-center gap-1.5 rounded-md bg-danger text-white px-3 py-1.5 text-sm font-medium hover:opacity-90 transition-colors"
                    : "inline-flex items-center justify-center gap-1.5 rounded-md bg-ink text-white px-3 py-1.5 text-sm font-medium hover:bg-ink-2 transition-colors"
                }
              >
                {opts.confirmLabel ?? "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
