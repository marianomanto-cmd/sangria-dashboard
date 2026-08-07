"use client";

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
import { formatMonthShort, type Language } from "@/lib/i18n";
import type { CreativeMonthTotal } from "@/db/queries/creative";
import {
  ChartGradient,
  tooltipStyle,
  useChartColors,
} from "@/components/chart-kit";

// Totales de facturación creative por mes, apilados cobrado vs pendiente.
// Mismo look que FacturacionChart (chart-kit compartido, dark-aware).
export function CreativeChart({
  data,
  lang = "es",
}: {
  data: CreativeMonthTotal[];
  lang?: Language;
}) {
  const c = useChartColors();
  const fmt = (m: string) => formatMonthShort(m, lang);

  return (
    <div className="rounded-lg border border-line bg-white dark:bg-paper-2 p-5">
      <div className="flex items-baseline justify-between mb-4 gap-4 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-ink">
            {lang === "es" ? "Facturación por mes" : "Billing by month"}
          </h2>
          <p className="text-[11px] mt-0.5 uppercase tracking-[0.08em] text-muted">
            {lang === "es" ? "cobrado vs pendiente" : "paid vs pending"}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm"
              style={{ backgroundColor: c.projected }}
            />
            {lang === "es" ? "Pendiente" : "Pending"}
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm"
              style={{ backgroundColor: c.real }}
            />
            {lang === "es" ? "Cobrado" : "Paid"}
          </span>
        </div>
      </div>

      {data.length === 0 ? (
        <p className="text-sm text-muted py-10 text-center">
          {lang === "es" ? "Sin datos para graficar." : "No data to chart."}
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart
            data={data}
            margin={{ top: 4, right: 8, left: 0, bottom: 4 }}
            barCategoryGap="28%"
          >
            <ChartGradient id="cre-paid" from={c.accent2} to={c.real} />
            <CartesianGrid
              stroke={c.grid}
              strokeDasharray="2 4"
              vertical={false}
              opacity={0.6}
            />
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
              cursor={{ fill: c.grid, opacity: 0.25 }}
              contentStyle={tooltipStyle(c)}
              labelFormatter={(label) => fmt(String(label))}
              formatter={(value, name) => [formatUsdCompact(Number(value)), name]}
            />
            <Bar
              stackId="a"
              dataKey="paid"
              name={lang === "es" ? "Cobrado" : "Paid"}
              fill="url(#cre-paid)"
              radius={[0, 0, 0, 0]}
            />
            <Bar
              stackId="a"
              dataKey="invoiced"
              name={lang === "es" ? "Pendiente" : "Pending"}
              fill={c.projected}
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
