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
import { formatMonthShort, type Language, t } from "@/lib/i18n";
import type { MonthlyTotal } from "@/db/queries/dashboard";
import { ChartGradient, tooltipStyle, useChartColors } from "@/components/chart-kit";

export function FacturacionChart({
  data,
  lang = "en",
}: {
  data: MonthlyTotal[];
  lang?: Language;
}) {
  const fmt = (m: string) => formatMonthShort(m, lang);
  const c = useChartColors();
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
          <ChartGradient id="fc-real" from={c.accent2} to={c.real} />
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
            dataKey="projected"
            name={t("common.estimated", lang)}
            fill={c.projected}
            radius={[4, 4, 0, 0]}
          />
          <Bar
            dataKey="real"
            name={lang === "es" ? "Real" : "Real"}
            fill="url(#fc-real)"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
