"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { Menu } from "lucide-react";

// ════════════════════════════════════════════════════════════════════════════
// Estado compartido del nav mobile: el Sidebar se renderiza como drawer
// deslizable en < lg y el hamburger (MobileNavToggle, en el topbar) lo abre.
// Se cierra al navegar (cambio de pathname) y con Escape. En ≥ lg el sidebar
// vuelve a su comportamiento sticky normal y este estado es inerte.
// ════════════════════════════════════════════════════════════════════════════

type MobileNavCtx = {
  open: boolean;
  setOpen: (v: boolean) => void;
};

const Ctx = createContext<MobileNavCtx | null>(null);

export function useMobileNav(): MobileNavCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useMobileNav debe usarse dentro de <MobileNavProvider>");
  return ctx;
}

export function MobileNavProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  // El cierre al navegar se hace desde el onClick de cada link del sidebar
  // (evita el patrón setState-en-effect sobre pathname).

  // Cerrar con Escape.
  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [open]);

  return <Ctx.Provider value={{ open, setOpen }}>{children}</Ctx.Provider>;
}

// Botón hamburguesa — solo visible en < lg (el sidebar está oculto ahí).
export function MobileNavToggle() {
  const { open, setOpen } = useMobileNav();
  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      aria-label={open ? "Cerrar menú" : "Abrir menú"}
      aria-expanded={open}
      className="lg:hidden inline-flex items-center justify-center w-8 h-8 rounded-md text-ink-2 hover:bg-paper-2 transition-colors -ml-1"
    >
      <Menu size={18} strokeWidth={2} />
    </button>
  );
}
