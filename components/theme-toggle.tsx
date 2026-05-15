"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

declare global {
  interface Window {
    __setTheme?: (v: Theme) => void;
  }
}

// El tema vive en la clase `dark` de <html>. Lo modelamos como un store
// externo (DOM) para evitar el patrón de `useEffect + setState`, que React
// 19 marca como warning (cascading renders). `useSyncExternalStore`
// devuelve "light" en SSR y se hidrata con el valor real en cliente.
const THEME_CHANGE_EVENT = "sangria:theme-change";

function getSnapshot(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function getServerSnapshot(): Theme {
  return "light";
}

function subscribe(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  window.addEventListener(THEME_CHANGE_EVENT, cb);
  return () => {
    obs.disconnect();
    window.removeEventListener(THEME_CHANGE_EVENT, cb);
  };
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const isDark = theme === "dark";

  const toggle = () => {
    const next: Theme = isDark ? "light" : "dark";
    window.__setTheme?.(next);
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  };

  const label = isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="inline-flex items-center justify-center w-7 h-7 rounded-md text-muted hover:bg-paper-2 hover:text-ink transition-colors"
    >
      {/* Sun/Moon swap con leve fade — sin layout shift gracias al
          contenedor de tamaño fijo del botón. */}
      <span className="relative inline-flex w-3.5 h-3.5">
        <Sun
          size={14}
          strokeWidth={2}
          className={`absolute inset-0 transition-opacity duration-200 ${
            isDark ? "opacity-100" : "opacity-0"
          }`}
        />
        <Moon
          size={14}
          strokeWidth={2}
          className={`absolute inset-0 transition-opacity duration-200 ${
            isDark ? "opacity-0" : "opacity-100"
          }`}
        />
      </span>
    </button>
  );
}
