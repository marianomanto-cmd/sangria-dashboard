"use client";

import { useRef, useState } from "react";
import { formatMonth, type Language } from "@/lib/i18n";

// Dual-handle range slider sobre una lista ordenada de meses (YYYY-MM).
// Dos <input type="range"> superpuestos sobre el mismo track CSS; cada uno
// controla un handle. El "track activo" se pinta con un div absoluto entre
// las dos posiciones. El commit (onCommit) se dispara en onMouseUp /
// onTouchEnd / onKeyUp para no spamear navegación mientras se arrastra.
//
// El componente es self-contained: maneja su propio estado de drag con
// useState inicializado desde props. El parent debe usar `key` para
// resetear el slider cuando los committed values cambien externamente.

export function MonthRangeSlider({
  months,
  initialFromIdx,
  initialToIdx,
  lang,
  onCommit,
}: {
  months: string[];
  initialFromIdx: number;
  initialToIdx: number;
  lang: Language;
  onCommit: (f: number, t: number) => void;
}) {
  const max = months.length - 1;
  const [fromIdx, setFromIdx] = useState(initialFromIdx);
  const [toIdx, setToIdx] = useState(initialToIdx);

  const fromPct = max > 0 ? (fromIdx / max) * 100 : 0;
  const toPct = max > 0 ? (toIdx / max) * 100 : 100;

  // setFrom/setTo mantienen este ref en sync con state. El parent usa `key`
  // para remontar el componente cuando los committed values cambian de afuera,
  // así que el `useRef` inicial siempre arranca alineado con el state.
  const lastValuesRef = useRef({ from: fromIdx, to: toIdx });

  const commit = () => {
    onCommit(lastValuesRef.current.from, lastValuesRef.current.to);
  };

  const setFrom = (v: number) => {
    setFromIdx((prev) => {
      const clamped = Math.min(v, lastValuesRef.current.to);
      lastValuesRef.current.from = clamped;
      return clamped === prev ? prev : clamped;
    });
  };
  const setTo = (v: number) => {
    setToIdx((prev) => {
      const clamped = Math.max(v, lastValuesRef.current.from);
      lastValuesRef.current.to = clamped;
      return clamped === prev ? prev : clamped;
    });
  };

  return (
    <div>
      <div className="flex justify-between text-[11px] font-mono text-ink-2 mb-1.5 tabular-nums">
        <span>{formatMonth(months[fromIdx], lang)}</span>
        <span className="text-muted">→</span>
        <span>{formatMonth(months[toIdx], lang)}</span>
      </div>
      <div className="relative h-6">
        <div
          className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-1.5 rounded-full bg-line-soft"
          aria-hidden
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-accent"
          style={{
            left: `${fromPct}%`,
            width: `${Math.max(0, toPct - fromPct)}%`,
          }}
          aria-hidden
        />
        <input
          type="range"
          min={0}
          max={max}
          step={1}
          value={fromIdx}
          aria-label={lang === "es" ? "Desde" : "From"}
          onChange={(e) => setFrom(Number(e.target.value))}
          onMouseUp={commit}
          onTouchEnd={commit}
          onKeyUp={commit}
          className="month-slider-thumb absolute top-0 left-0 w-full h-6 pointer-events-none appearance-none bg-transparent"
        />
        <input
          type="range"
          min={0}
          max={max}
          step={1}
          value={toIdx}
          aria-label={lang === "es" ? "Hasta" : "To"}
          onChange={(e) => setTo(Number(e.target.value))}
          onMouseUp={commit}
          onTouchEnd={commit}
          onKeyUp={commit}
          className="month-slider-thumb absolute top-0 left-0 w-full h-6 pointer-events-none appearance-none bg-transparent"
        />
      </div>
    </div>
  );
}
