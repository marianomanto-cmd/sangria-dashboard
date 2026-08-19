"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Users } from "lucide-react";
import { t, type Language } from "@/lib/i18n";

// ════════════════════════════════════════════════════════════════════════════
// Cuadrito flotante con el detalle de audiencia de un placement.
//
// Se usa en la vista del plan de medios (planilla editable + vista previa tipo
// Excel): dejando el mouse quieto sobre el nombre del placement aparece la
// audiencia, que si no hay que abrir el inspector no se ve en ningún lado.
//
// Decisiones:
// - **Delay de 2s** a propósito. La planilla se recorre con el mouse todo el
//   tiempo (seleccionar filas, editar montos); un tooltip instantáneo sería
//   ruido. Sólo aparece si el mouse se queda quieto ahí.
// - **pointer-events: none** — el cuadrito nunca intercepta un click (la fila
//   sigue seleccionándose) ni tapa un input.
// - **position: fixed** con coordenadas calculadas del ancla, misma técnica que
//   el menú contextual de aux-sheet.tsx y el "Más" del top-nav: las tablas
//   viven dentro de contenedores con overflow y un `absolute` quedaría
//   recortado.
// - Se cierra solo al salir del ancla, al scrollear, al hacer click y al
//   cambiar el tamaño de la ventana (el cuadrito quedaría flotando desanclado).
// ════════════════════════════════════════════════════════════════════════════

// Cuánto hay que quedarse quieto encima para que aparezca.
export const AUDIENCE_HOVER_DELAY_MS = 2000;

const GAP = 6; // separación entre el ancla y el cuadrito
const MARGIN = 8; // margen mínimo contra los bordes del viewport

// top/left en coordenadas de viewport. `adjusted` marca si ya pasó por la
// corrección de borde (hasta entonces se renderiza invisible para medirlo sin
// que se vea saltar).
type Pos = { top: number; left: number; adjusted: boolean };

// useLayoutEffect tira warning en SSR; en server caemos a useEffect
// (mismo truco que components/top-nav.tsx).
const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function AudienceHoverCard({
  audience,
  // Default 'es': la planilla del editor está hardcodeada en español (es UI
  // interna del planner). La vista previa sí pasa el idioma del cliente.
  lang = "es",
  className = "",
  children,
}: {
  audience: string | null | undefined;
  lang?: Language;
  className?: string;
  children: React.ReactNode;
}) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const cardRef = useRef<HTMLSpanElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = useState<Pos | null>(null);

  const text = (audience ?? "").trim();

  const show = () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const r = anchorRef.current?.getBoundingClientRect();
      if (!r) return;
      setPos({ top: r.bottom + GAP, left: r.left, adjusted: false });
    }, AUDIENCE_HOVER_DELAY_MS);
  };

  const hide = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setPos(null);
  };

  // Timer huérfano si la fila se desmonta con el hover en curso (pasa al
  // borrar un placement o al recargar el plan después de editar).
  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  // Corrección de borde: una sola pasada, ya con el cuadrito medido. Si no
  // entra abajo va arriba del ancla, y se clampea contra el borde derecho.
  useIsoLayoutEffect(() => {
    if (!pos || pos.adjusted) return;
    const card = cardRef.current?.getBoundingClientRect();
    const anchor = anchorRef.current?.getBoundingClientRect();
    if (!card || !anchor) return;
    let top = anchor.bottom + GAP;
    if (top + card.height > window.innerHeight - MARGIN) {
      const above = anchor.top - GAP - card.height;
      top =
        above >= MARGIN
          ? above
          : Math.max(MARGIN, window.innerHeight - MARGIN - card.height);
    }
    const maxLeft = Math.max(MARGIN, window.innerWidth - MARGIN - card.width);
    const left = Math.min(Math.max(MARGIN, anchor.left), maxLeft);
    setPos({ top, left, adjusted: true });
  }, [pos]);

  // Con el cuadrito abierto, cualquier cosa que mueva el ancla lo desancla:
  // lo cerramos en vez de recalcular.
  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("mousedown", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("mousedown", close);
    };
  }, [pos]);

  return (
    <span
      ref={anchorRef}
      onMouseEnter={show}
      onMouseLeave={hide}
      className={`inline-flex min-w-0 items-center gap-1 ${className}`}
    >
      {children}

      {/* Pista de que hay algo para ver, sólo cuando hay audiencia cargada. */}
      {text !== "" && (
        <Users
          size={11}
          strokeWidth={2}
          aria-hidden
          className="shrink-0 text-muted/70"
        />
      )}

      {pos && (
        <span
          ref={cardRef}
          role="tooltip"
          style={{
            top: pos.top,
            left: pos.left,
            visibility: pos.adjusted ? "visible" : "hidden",
          }}
          className="fixed z-50 w-max max-w-[22rem] pointer-events-none rounded-md border border-line bg-surface dark:bg-paper-2 px-3 py-2.5 shadow-lg animate-fade-in"
        >
          <span className="flex items-center gap-1.5">
            <Users size={11} strokeWidth={2} aria-hidden className="text-accent" />
            <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
              {t("common.audience", lang)}
            </span>
          </span>
          {text !== "" ? (
            <span className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-ink-2 line-clamp-10">
              {text}
            </span>
          ) : (
            <span className="mt-1 block text-xs italic text-muted">
              {lang === "es" ? "Sin audiencia cargada" : "No audience set"}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
