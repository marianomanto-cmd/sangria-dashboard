"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatUsdCompact } from "@/lib/format";
import { formatMonthShort, type Language, t } from "@/lib/i18n";
import type { MonthlyTotal } from "@/db/queries/dashboard";

// Recharts no acepta CSS vars en `fill`/`stroke` por su pipeline interno
// (re-renderiza el SVG con strings literales). Por eso resolvemos los
// tokens vía getComputedStyle y observamos cambios de la clase `dark` en
// <html> para re-renderizar cuando cambia el tema.
function useThemeColors() {
  const [colors, setColors] = useState({
    grid: "#e7e5e4",
    axis: "#78716c",
    projected: "#d6d3d1",
    real: "#1c1917",
    tooltipBorder: "#d6d3d1",
    tooltipBg: "#ffffff",
    tooltipText: "#1c1917",
  });

  useEffect(() => {
    function read() {
      const cs = getComputedStyle(document.documentElement);
      const v = (n: string, f: string) => cs.getPropertyValue(n).trim() || f;
      const isDark = document.documentElement.classList.contains("dark");
      setColors({
        grid: v("--color-line-soft", "#e7e5e4"),
        axis: v("--color-muted", "#78716c"),
        projected: v("--color-line", "#d6d3d1"),
        real: isDark
          ? v("--color-accent", "#d4658e")
          : v("--color-ink", "#1c1917"),
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

export function FacturacionChart({
  data,
  lang = "en",
}: {
  data: MonthlyTotal[];
  lang?: Language;
}) {
  const fmt = (m: string) => formatMonthShort(m, lang);
  const c = useThemeColors();
  return (
    <div className="rounded-lg border border-line bg-white dark:bg-paper-2 p-5">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-ink">
            {lang === "es" ? "Inversión mensual" : "Monthly investment"}
          </h2>
          <p className="text-[11px] mt-0.5 uppercase tracking-[0.08em] text-muted">
            {lang === "es" ? "real vs proyectado" : "real vs projected"}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm"
              style={{ backgroundColor: c.projected }}
            />
            {lang === "es" ? "Proyectado" : "Projected"}
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm"
              style={{ backgroundColor: c.real }}
            />
            {lang === "es" ? "Real" : "Real"}
          </span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <BarChart
          data={data}
          margin={{ top: 4, right: 8, left: 0, bottom: 4 }}
          barCategoryGap="28%"
        >
          <CartesianGrid stroke={c.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="month"
            tickFormatter={fmt}
            stroke={c.axis}
            tickLine={false}
            axisLine={false}
            style={{ fontSize: 11, fontFamily: "var(--font-sans)" }}
          />
          <YAxis
            tickFormatter={formatUsdCompact}
            stroke={c.axis}
            tickLine={false}
            axisLine={false}
            width={60}
            style={{ fontSize: 11, fontFamily: "var(--font-mono)" }}
          />
          <Tooltip
            cursor={{ fill: c.grid, opacity: 0.3 }}
            contentStyle={{
              borderRadius: 8,
              border: `1px solid ${c.tooltipBorder}`,
              backgroundColor: c.tooltipBg,
              color: c.tooltipText,
              fontSize: 12,
              fontFamily: "var(--font-sans)",
            }}
            labelFormatter={(label) => fmt(String(label))}
            formatter={(value, name) => [
              formatUsdCompact(Number(value)),
              name,
            ]}
          />
          <Bar
            dataKey="projected"
            name={t("common.estimated", lang)}
            fill={c.projected}
            radius={[2, 2, 0, 0]}
          />
          <Bar
            dataKey="real"
            name={lang === "es" ? "Real" : "Real"}
            fill={c.real}
            radius={[2, 2, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
