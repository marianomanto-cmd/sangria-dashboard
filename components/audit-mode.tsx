"use client";

import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Eye, Lock } from "lucide-react";
import { AUDIT_HINTS, GENERIC_AUDIT_HINT, type AuditHint } from "@/lib/audit-hints";

// ════════════════════════════════════════════════════════════════════════════
// Modo auditoría en la UI.
//
// Una sesión de auditoría (o un usuario con rol Viewer) ve la app completa
// pero no puede cambiar nada. Que el botón no haga nada sería peor que no
// tenerlo: acá cada control que escribe queda desactivado Y explica, al pasar
// el mouse, QUÉ cambio haría y A QUÉ ÁREAS afecta.
//
// ── Cómo se marca un control ────────────────────────────────────────────────
// Con un atributo, no envolviéndolo en un componente:
//
//     <Button data-audit-hint="approvePlan">Aprobar</Button>
//
// El valor es el nombre de la server action que dispara. `lib/audit-hints.ts`
// mapea ese nombre a { title, what, affects }. Se eligió un atributo y no un
// wrapper porque son ~200 controles repartidos por toda la app: un atributo es
// una edición de una línea, no toca el árbol de React y no puede romper el
// layout de nada.
//
// ── Por qué un solo listener global ─────────────────────────────────────────
// `AuditHintLayer` se monta UNA vez en el layout y escucha en document con
// captura. Ventajas: cero costo por control, funciona con controles que se
// montan después (modales, filas nuevas), y el bloqueo del click ocurre ANTES
// que cualquier onClick de React — así la action nunca se llega a invocar.
//
// ── El fallback importa ─────────────────────────────────────────────────────
// Si un control quedó marcado pero sin entrada en el registro, se muestra el
// cuadrito genérico. Y si un control que escribe quedó SIN marcar, igual no
// pasa nada: el proxy rechaza el POST (lib/audit-session.ts) y la action tiene
// su propio `assertCanWrite()`. La marca es para explicar, no para proteger.
// ════════════════════════════════════════════════════════════════════════════

export type AuditModeValue = {
  readOnly: boolean;
  reason: "audit" | "viewer" | null;
};

const AuditModeContext = createContext<AuditModeValue>({
  readOnly: false,
  reason: null,
});

export function useAuditMode(): AuditModeValue {
  return useContext(AuditModeContext);
}

export function AuditModeProvider({
  value,
  children,
}: {
  value: AuditModeValue;
  children: React.ReactNode;
}) {
  return (
    <AuditModeContext.Provider value={value}>
      {children}
    </AuditModeContext.Provider>
  );
}

// ── El cuadrito ─────────────────────────────────────────────────────────────

const GAP = 8; // separación entre el ancla y el cuadrito
const MARGIN = 8; // margen mínimo contra los bordes del viewport
const CARD_W = 300;
// Corto a propósito: el objetivo es que aparezca casi al toque de apuntar al
// botón. El hover card de audiencia espera 2s porque la planilla se recorre
// con el mouse todo el tiempo; acá el control ya está desactivado y lo único
// que queda por hacer es leer el porqué.
const SHOW_DELAY_MS = 180;

type Anchored = { hint: AuditHint; top: number; left: number; ready: boolean };

function resolveHint(key: string): AuditHint {
  return AUDIT_HINTS[key] ?? GENERIC_AUDIT_HINT;
}

export function AuditHintLayer({ readOnly }: { readOnly: boolean }) {
  const [shown, setShown] = useState<Anchored | null>(null);
  // Se prende cuando el servidor rechazó una escritura que la UI no llegó a
  // frenar (control sin `data-audit-hint`).
  const [blocked, setBlocked] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    anchorRef.current = null;
    setShown(null);
  }, []);

  const showFor = useCallback((el: HTMLElement, immediate: boolean) => {
    const key = el.getAttribute("data-audit-hint") ?? "";
    const place = () => {
      const r = el.getBoundingClientRect();
      anchorRef.current = el;
      setShown({
        hint: resolveHint(key),
        top: r.bottom + GAP,
        left: r.left,
        ready: false,
      });
    };
    if (timer.current) clearTimeout(timer.current);
    if (immediate) place();
    else timer.current = setTimeout(place, SHOW_DELAY_MS);
  }, []);

  // Corrección de borde: se mide el cuadrito ya renderizado (invisible) y se
  // reubica si se sale del viewport. Misma técnica que audience-hover-card.
  useEffect(() => {
    if (!shown || shown.ready) return;
    const el = cardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let { top, left } = shown;
    if (left + r.width > window.innerWidth - MARGIN) {
      left = Math.max(MARGIN, window.innerWidth - r.width - MARGIN);
    }
    if (top + r.height > window.innerHeight - MARGIN) {
      const anchor = anchorRef.current?.getBoundingClientRect();
      top = anchor
        ? Math.max(MARGIN, anchor.top - r.height - GAP)
        : Math.max(MARGIN, window.innerHeight - r.height - MARGIN);
    }
    setShown({ ...shown, top, left, ready: true });
  }, [shown]);

  useEffect(() => {
    if (!readOnly) return;

    const hinted = (t: EventTarget | null): HTMLElement | null => {
      if (!(t instanceof Element)) return null;
      return t.closest<HTMLElement>("[data-audit-hint]");
    };

    const onOver = (e: MouseEvent) => {
      const el = hinted(e.target);
      if (!el) {
        if (anchorRef.current) hide();
        return;
      }
      if (el === anchorRef.current) return;
      showFor(el, false);
    };

    const onFocusIn = (e: FocusEvent) => {
      const el = hinted(e.target);
      if (el) showFor(el, true);
    };

    // CAPTURA: corre antes que cualquier handler de React, así la server
    // action ni se llama. Al bloquear también mostramos el cuadrito al toque,
    // para que el click no se sienta como que la app se colgó.
    const block = (e: Event) => {
      const el = hinted(e.target);
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      if ("stopImmediatePropagation" in e) e.stopImmediatePropagation();
      showFor(el, true);
    };

    // Un form entero puede quedar marcado: ahí se corta el submit aunque el
    // botón que lo dispara no esté marcado.
    const onSubmit = (e: Event) => {
      const el = hinted(e.target);
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      showFor(el, true);
    };

    // Los campos con autosave (el "Real" del campaign tracker, las celdas de
    // la planilla del plan, las hojas auxiliares) NO se disparan con un click:
    // guardan solos al tipear, con debounce. Bloquear el click no alcanza —
    // hay que cortar la edición.
    //
    // `beforeinput` es el que se puede cancelar y cubre tipear, borrar, cortar
    // y pegar; `keydown` queda para las teclas que no generan beforeinput
    // (Backspace en algunos motores, y Enter en un select). Se dejan pasar las
    // de navegación y copiado, para que igual se pueda leer y copiar el valor.
    const NAV_KEYS = new Set([
      "Tab", "Escape", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
      "Home", "End", "PageUp", "PageDown", "Shift", "Control", "Alt", "Meta",
    ]);
    const editable = (t: EventTarget | null): HTMLElement | null => {
      if (!(t instanceof HTMLElement)) return null;
      const tag = t.tagName;
      if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") return null;
      return hinted(t);
    };
    const blockEdit = (e: Event) => {
      const el = editable(e.target);
      if (!el) return;
      if (e.type === "keydown") {
        const ke = e as KeyboardEvent;
        if (NAV_KEYS.has(ke.key) || ke.ctrlKey || ke.metaKey) return;
      }
      e.preventDefault();
      e.stopPropagation();
      showFor(el, true);
    };

    // Red de seguridad: si un control que escribe quedó SIN marcar, el click
    // sale, el proxy lo rechaza con 403 y el fetch de la server action tira.
    // Sin esto el usuario vería el error boundary de Next y parecería que la
    // app se rompió, cuando en realidad el sistema hizo exactamente lo suyo.
    const onRejection = () => setBlocked(true);
    window.addEventListener("unhandledrejection", onRejection);

    document.addEventListener("mouseover", onOver, true);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("click", block, true);
    document.addEventListener("submit", onSubmit, true);
    for (const ev of ["beforeinput", "keydown", "paste", "cut", "drop"]) {
      document.addEventListener(ev, blockEdit, true);
    }
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);

    return () => {
      window.removeEventListener("unhandledrejection", onRejection);
      document.removeEventListener("mouseover", onOver, true);
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("click", block, true);
      document.removeEventListener("submit", onSubmit, true);
      for (const ev of ["beforeinput", "keydown", "paste", "cut", "drop"]) {
        document.removeEventListener(ev, blockEdit, true);
      }
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [readOnly, showFor, hide]);

  // El aviso se cierra solo: es informativo, no requiere acción.
  useEffect(() => {
    if (!blocked) return;
    const t = setTimeout(() => setBlocked(false), 6000);
    return () => clearTimeout(t);
  }, [blocked]);

  if (!readOnly) return null;

  return (
    <>
      {blocked && (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[95] rounded-md border border-line bg-white dark:bg-paper-2 shadow-lg px-4 py-2.5 text-xs text-ink"
        >
          <span className="font-medium">Vista de auditoría:</span> ese cambio no
          se aplicó. La sesión es de solo lectura.
        </div>
      )}
      {shown && <HintCard ref={cardRef} shown={shown} />}
    </>
  );
}

const HintCard = forwardRef<HTMLDivElement, { shown: Anchored }>(
  function HintCard({ shown }, cardRef) {
  return (
    <div
      ref={cardRef}
      role="tooltip"
      style={{
        position: "fixed",
        top: shown.top,
        left: shown.left,
        width: CARD_W,
        pointerEvents: "none",
        opacity: shown.ready ? 1 : 0,
        zIndex: 90,
      }}
      className="rounded-md border border-line bg-white dark:bg-paper-2 shadow-lg p-3 text-left"
    >
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-accent">
        <Lock size={11} strokeWidth={2.5} />
        No se aplica · solo lectura
      </p>
      <p className="mt-1.5 text-sm font-medium text-ink leading-snug">
        {shown.hint.title}
      </p>
      {shown.hint.what && (
        <p className="mt-1 text-xs text-muted leading-relaxed">
          {shown.hint.what}
        </p>
      )}
      {shown.hint.affects.length > 0 && (
        <>
          <p className="mt-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
            A qué afecta
          </p>
          <ul className="mt-1 space-y-0.5">
            {shown.hint.affects.map((a: string) => (
              <li key={a} className="text-xs text-ink-2 leading-snug flex gap-1.5">
                <span className="text-accent" aria-hidden>
                  ·
                </span>
                <span>{a}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
});

// ── La cinta de arriba ──────────────────────────────────────────────────────
// Que la vista es de solo lectura tiene que estar dicho, no deducido de que
// los botones estén apagados.
export function AuditModeBanner({ reason }: { reason: "audit" | "viewer" }) {
  return (
    <div className="flex items-center gap-2 border-b border-line bg-paper-2 px-4 py-1.5 text-xs text-ink-2">
      <Eye size={13} strokeWidth={2} className="text-accent shrink-0" />
      <span>
        {reason === "audit" ? (
          <>
            <span className="font-medium text-ink">Vista de auditoría</span> ·
            solo lectura. Los controles que harían un cambio están desactivados:
            pasá el mouse por encima para ver qué haría cada uno y a qué áreas
            afecta.
          </>
        ) : (
          <>
            <span className="font-medium text-ink">Rol Viewer</span> · solo
            lectura. Pasá el mouse por un control desactivado para ver qué
            cambio haría.
          </>
        )}
      </span>
    </div>
  );
}
