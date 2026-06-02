"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

// ════════════════════════════════════════════════════════════════════════════
// Toasts no bloqueantes. Reemplazan los alert() nativos para el feedback de
// éxito/error de las server actions. Mensajes de error usan role="alert"
// (se anuncian); los de éxito role="status". El contenedor es un live-region
// fijo abajo a la derecha. Se auto-cierran (error dura más).
// ════════════════════════════════════════════════════════════════════════════

type ToastKind = "success" | "error" | "info";
type ToastItem = { id: number; kind: ToastKind; message: string };

type ToastApi = {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast debe usarse dentro de <ToastProvider>");
  return ctx;
}

const ICONS: Record<ToastKind, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

const STYLES: Record<ToastKind, string> = {
  success: "border-success-soft bg-success-soft text-success",
  error: "border-danger-soft bg-danger-soft text-danger",
  info: "border-info-soft bg-info-soft text-info",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = ++idRef.current;
      setToasts((prev) => [...prev, { id, kind, message }]);
      window.setTimeout(() => remove(id), kind === "error" ? 6000 : 3500);
    },
    [remove],
  );

  const api: ToastApi = {
    success: (m) => push("success", m),
    error: (m) => push("error", m),
    info: (m) => push("info", m),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,360px)] flex-col gap-2"
        aria-live="polite"
      >
        {toasts.map((t) => {
          const Icon = ICONS[t.kind];
          return (
            <div
              key={t.id}
              role={t.kind === "error" ? "alert" : "status"}
              className={`pointer-events-auto flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm shadow-[var(--shadow-card-hover)] animate-toast-in ${STYLES[t.kind]}`}
            >
              <Icon size={16} strokeWidth={2} className="mt-0.5 shrink-0" />
              <span className="flex-1 leading-snug text-ink-2">{t.message}</span>
              <button
                type="button"
                onClick={() => remove(t.id)}
                aria-label="Cerrar"
                className="shrink-0 text-muted hover:text-ink -mr-1 -mt-0.5 p-0.5"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
