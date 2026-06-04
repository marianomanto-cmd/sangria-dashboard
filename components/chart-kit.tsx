"use client";

import { useEffect, useState } from "react";

// ════════════════════════════════════════════════════════════════════════════
// Chart kit compartido para todos los charts de recharts. Centraliza:
//   • useChartColors(): resuelve los design tokens (CSS vars) a strings
//     literales (recharts no acepta var() en fill/stroke) y re-pinta al
//     togglear el tema (observa la clase `dark` en <html>).
//   • tooltipStyle(): el mismo card de tooltip en todos lados.
//   • <ChartGradient>: defs de un linearGradient vertical/horizontal reusable.
// Antes este hook estaba duplicado en facturacion-chart y portal-charts.
// ════════════════════════════════════════════════════════════════════════════

export type ChartColors = {
  grid: string;
  axis: string;
  accent: string;
  accent2: string;
  ink: string;
  line: string;
  /** Serie "real" — accent en dark, ink en light (alto contraste). */
  real: string;
  /** Serie "proyectado/estimado" — gris suave. */
  projected: string;
  tooltipBorder: string;
  tooltipBg: string;
  tooltipText: string;
};

const FALLBACK: ChartColors = {
  grid: "#e7e5e4",
  axis: "#78716c",
  accent: "#7a1f3d",
  accent2: "#a8345f",
  ink: "#1c1917",
  line: "#d6d3d1",
  real: "#1c1917",
  projected: "#d6d3d1",
  tooltipBorder: "#d6d3d1",
  tooltipBg: "#ffffff",
  tooltipText: "#1c1917",
};

export function useChartColors(): ChartColors {
  const [colors, setColors] = useState<ChartColors>(FALLBACK);
  useEffect(() => {
    function read() {
      const cs = getComputedStyle(document.documentElement);
      const v = (n: string, f: string) => cs.getPropertyValue(n).trim() || f;
      const isDark = document.documentElement.classList.contains("dark");
      const accent = v("--color-accent", "#7a1f3d");
      setColors({
        grid: v("--color-line-soft", "#e7e5e4"),
        axis: v("--color-muted", "#78716c"),
        accent,
        accent2: v("--color-accent-2", "#a8345f"),
        ink: v("--color-ink", "#1c1917"),
        line: v("--color-line", "#d6d3d1"),
        real: isDark ? accent : v("--color-ink", "#1c1917"),
        projected: v("--color-line", "#d6d3d1"),
        tooltipBorder: v("--color-line", "#d6d3d1"),
        tooltipBg: isDark ? v("--color-paper-2", "#1c1917") : "#ffffff",
        tooltipText: v("--color-ink", "#1c1917"),
      });
    }
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => obs.disconnect();
  }, []);
  return colors;
}

// Card de tooltip consistente en todos los charts.
export function tooltipStyle(c: ChartColors): React.CSSProperties {
  return {
    borderRadius: 10,
    border: `1px solid ${c.tooltipBorder}`,
    backgroundColor: c.tooltipBg,
    color: c.tooltipText,
    fontSize: 12,
    fontFamily: "var(--font-sans)",
    boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
    padding: "8px 10px",
  };
}

// defs de un gradiente lineal reusable (para fills de barras/áreas).
export function ChartGradient({
  id,
  from,
  to,
  direction = "vertical",
  fromOpacity = 1,
  toOpacity = 1,
}: {
  id: string;
  from: string;
  to: string;
  direction?: "vertical" | "horizontal";
  fromOpacity?: number;
  toOpacity?: number;
}) {
  const coords =
    direction === "vertical"
      ? { x1: "0", y1: "0", x2: "0", y2: "1" }
      : { x1: "0", y1: "0", x2: "1", y2: "0" };
  return (
    <defs>
      <linearGradient id={id} {...coords}>
        <stop offset="0%" stopColor={from} stopOpacity={fromOpacity} />
        <stop offset="100%" stopColor={to} stopOpacity={toOpacity} />
      </linearGradient>
    </defs>
  );
}
