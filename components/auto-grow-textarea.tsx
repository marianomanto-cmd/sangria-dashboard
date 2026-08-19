"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

// ════════════════════════════════════════════════════════════════════════════
// Textarea que se estira con su contenido: arranca en `minHeight` y crece
// hasta `maxHeight` (recién ahí scrollea). Pensado para los campos de texto
// libre del inspector del plan (audiencia, notas), donde el contenido real son
// varias líneas y una caja fija de 3 renglones obligaba a scrollear adentro
// para leer algo que ya está escrito.
//
// No controlado, igual que el resto de los campos del editor: `defaultValue` +
// commit en el blur. Así una edición en curso nunca la pisa un re-render de
// las server actions.
// ════════════════════════════════════════════════════════════════════════════

// useLayoutEffect tira warning en SSR; en server caemos a useEffect
// (mismo truco que components/top-nav.tsx).
const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function AutoGrowTextarea({
  value,
  onCommit,
  disabled,
  placeholder,
  minHeight = "9rem",
  maxHeight = "28rem",
  className = "",
}: {
  value: string;
  onCommit: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  minHeight?: string;
  maxHeight?: string;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  // `height: auto` primero para que scrollHeight refleje el contenido y no la
  // altura vieja (si no, la caja sólo crecería, nunca se achicaría al borrar).
  // El tope lo pone max-height por CSS: pasado eso, scrollea.
  const fit = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    // scrollHeight es content+padding, pero `height` con box-sizing:border-box
    // (default de Tailwind) incluye el borde: sin sumarlo quedan 2px de menos y
    // la caja scrollea por un pelo justo cuando debería entrar justa.
    const borders = el.offsetHeight - el.clientHeight;
    el.style.height = `${el.scrollHeight + borders}px`;
  };

  // Al montar (el inspector remonta con key={placement.id}, así que esto corre
  // en cada cambio de placement) para abrir ya con el alto del texto guardado.
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (el) fit(el);
  }, []);

  return (
    <textarea
      ref={ref}
      defaultValue={value}
      disabled={disabled}
      placeholder={placeholder}
      onInput={(e) => fit(e.currentTarget)}
      onBlur={(e) => e.target.value !== value && onCommit(e.target.value)}
      style={{ minHeight, maxHeight }}
      className={`w-full text-sm leading-relaxed bg-white dark:bg-paper-2 border border-line rounded-md px-3 py-2 resize-y overflow-y-auto focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft disabled:opacity-50 disabled:resize-none ${className}`}
    />
  );
}
