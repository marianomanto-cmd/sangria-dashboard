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

export function FacturacionChart({
  data,
  lang = "en",
}: {
  data: MonthlyTotal[];
  lang?: Language;
}) {
  const fmt = (m: string) => formatMonthShort(m, lang);
  return (
    <div className="rounded-lg border border-line bg-white p-5">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold">
            {lang === "es" ? "Inversión mensual" : "Monthly investment"}
          </h2>
          <p className="text-[11px] mt-0.5 uppercase tracking-[0.08em] text-muted">
            {lang === "es" ? "real vs proyectado" : "real vs projected"}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-line" />
            {lang === "es" ? "Proyectado" : "Projected"}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-ink" />
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
          <CartesianGrid stroke="#e7e5e4" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="month"
            tickFormatter={fmt}
            stroke="#78716c"
            tickLine={false}
            axisLine={false}
            style={{ fontSize: 11, fontFamily: "var(--font-sans)" }}
          />
          <YAxis
            tickFormatter={formatUsdCompact}
            stroke="#78716c"
            tickLine={false}
            axisLine={false}
            width={60}
            style={{ fontSize: 11, fontFamily: "var(--font-mono)" }}
          />
          <Tooltip
            cursor={{ fill: "#f5f5f4" }}
            contentStyle={{
              borderRadius: 8,
              border: "1px solid #d6d3d1",
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
            fill="#d6d3d1"
            radius={[2, 2, 0, 0]}
          />
          <Bar
            dataKey="real"
            name={lang === "es" ? "Real" : "Real"}
            fill="#1c1917"
            radius={[2, 2, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
