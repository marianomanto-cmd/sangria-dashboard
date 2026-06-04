"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatUsd, formatUsdCompact } from "@/lib/format";
import { formatMonthShort, type Language } from "@/lib/i18n";
import type { MonthlyTotal } from "@/db/queries/dashboard";

// Recharts no acepta CSS vars en fill/stroke (re-renderiza el SVG con strings
// literales), así que resolvemos los tokens vía getComputedStyle y observamos
// la clase `dark` del <html> para re-pintar al cambiar el tema. Mismo patrón
// que components/facturacion-chart.tsx.
function useThemeColors() {
  const [c, setC] = useState({
    grid: "#e7e5e4",
    axis: "#78716c",
    accent: "#7a1f3d",
    accent2: "#a8345f",
    ink: "#1c1917",
    line: "#d6d3d1",
    tooltipBorder: "#d6d3d1",
    tooltipBg: "#ffffff",
    tooltipText: "#1c1917",
  });
  useEffect(() => {
    function read() {
      const cs = getComputedStyle(document.documentElement);
      const v = (n: string, f: string) => cs.getPropertyValue(n).trim() || f;
      const isDark = document.documentElement.classList.contains("dark");
      setC({
        grid: v("--color-line-soft", "#e7e5e4"),
        axis: v("--color-muted", "#78716c"),
        accent: v("--color-accent", "#7a1f3d"),
        accent2: v("--color-accent-2", "#a8345f"),
        ink: isDark ? v("--color-accent", "#d4658e") : v("--color-ink", "#1c1917"),
        line: v("--color-line", "#d6d3d1"),
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
  return c;
}

// ─── Inversión por publisher (barras horizontales, top N) ─────────────────────

export function SpendByPublisherChart({
  data,
  lang = "es",
  topN = 8,
}: {
  data: { name: string; value: number }[];
  lang?: Language;
  topN?: number;
}) {
  const c = useThemeColors();

  // Top N + agrupamos el resto en "Otros" para no estirar el eje.
  const sorted = [...data].sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, topN);
  const rest = sorted.slice(topN);
  const restSum = rest.reduce((s, r) => s + r.value, 0);
  const rows =
    restSum > 0
      ? [...head, { name: lang === "es" ? "Otros" : "Other", value: restSum }]
      : head;

  const palette = [c.accent, c.accent2];

  return (
    <div className="rounded-lg border border-line bg-white dark:bg-paper-2 p-5">
      <h2 className="text-sm font-semibold text-ink mb-1">
        {lang === "es" ? "Inversión por publisher" : "Spend by publisher"}
      </h2>
      <p className="text-[11px] uppercase tracking-[0.08em] text-muted mb-4">
        {lang === "es" ? "consumo real acumulado" : "accumulated real spend"}
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted py-8 text-center">
          {lang === "es" ? "Sin consumo cargado aún." : "No spend loaded yet."}
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(160, rows.length * 34)}>
          <BarChart
            data={rows}
            layout="vertical"
            margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
            barCategoryGap="22%"
          >
            <CartesianGrid stroke={c.grid} strokeDasharray="3 3" horizontal={false} />
            <XAxis
              type="number"
              tickFormatter={formatUsdCompact}
              stroke={c.axis}
              tickLine={false}
              axisLine={false}
              style={{ fontSize: 11, fontFamily: "var(--font-mono)" }}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={120}
              stroke={c.axis}
              tickLine={false}
              axisLine={false}
              style={{ fontSize: 11, fontFamily: "var(--font-sans)" }}
            />
            <Tooltip
              cursor={{ fill: c.grid, opacity: 0.3 }}
              contentStyle={{
                borderRadius: 8,
                border: `1px solid ${c.tooltipBorder}`,
                backgroundColor: c.tooltipBg,
                color: c.tooltipText,
                fontSize: 12,
              }}
              formatter={(value) => [
                formatUsd(Number(value)),
                lang === "es" ? "Inversión" : "Spend",
              ]}
            />
            <Bar dataKey="value" radius={[0, 4, 4, 0]}>
              {rows.map((_, i) => (
                <Cell key={i} fill={palette[i % palette.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ─── Facturado acumulado vs estimado (línea, YTD) ─────────────────────────────

export function CumulativeBillingChart({
  monthly,
  lang = "es",
}: {
  monthly: MonthlyTotal[];
  lang?: Language;
}) {
  const c = useThemeColors();
  const fmt = (m: string) => formatMonthShort(m, lang);

  // Acumulado corrido de real y proyectado sobre los meses ordenados.
  const ordered = [...monthly].sort((a, b) => a.month.localeCompare(b.month));
  const data = ordered.reduce<
    { month: string; real: number; projected: number }[]
  >((acc, m) => {
    const prev = acc[acc.length - 1];
    acc.push({
      month: m.month,
      real: (prev?.real ?? 0) + m.real,
      projected: (prev?.projected ?? 0) + m.projected,
    });
    return acc;
  }, []);

  return (
    <div className="rounded-lg border border-line bg-white dark:bg-paper-2 p-5">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-ink">
            {lang === "es"
              ? "Facturado acumulado vs estimado"
              : "Cumulative invoiced vs estimate"}
          </h2>
          <p className="text-[11px] mt-0.5 uppercase tracking-[0.08em] text-muted">
            {lang === "es" ? "corrido del año" : "year to date"}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: c.line }} />
            {lang === "es" ? "Estimado" : "Estimate"}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: c.ink }} />
            {lang === "es" ? "Facturado" : "Invoiced"}
          </span>
        </div>
      </div>
      {data.length === 0 ? (
        <p className="text-sm text-muted py-8 text-center">
          {lang === "es" ? "Sin datos en el período." : "No data for the period."}
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
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
              contentStyle={{
                borderRadius: 8,
                border: `1px solid ${c.tooltipBorder}`,
                backgroundColor: c.tooltipBg,
                color: c.tooltipText,
                fontSize: 12,
              }}
              labelFormatter={(m) => fmt(String(m))}
              formatter={(value, name) => [
                formatUsd(Number(value)),
                String(name) === "real"
                  ? lang === "es"
                    ? "Facturado"
                    : "Invoiced"
                  : lang === "es"
                    ? "Estimado"
                    : "Estimate",
              ]}
            />
            <Line
              type="monotone"
              dataKey="projected"
              stroke={c.line}
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="real"
              stroke={c.ink}
              strokeWidth={2.5}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
