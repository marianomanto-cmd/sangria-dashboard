"use client";

import { ToastProvider } from "@/components/toast";
import { ConfirmProvider } from "@/components/confirm-dialog";

// Providers client-side de la chrome de la app: toasts (feedback no bloqueante)
// + diálogo de confirmación accesible. Se montan en el layout, envolviendo el
// contenido para que cualquier página/editor pueda usar useToast()/useConfirm().
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <ConfirmProvider>{children}</ConfirmProvider>
    </ToastProvider>
  );
}
