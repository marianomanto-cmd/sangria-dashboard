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
import type { MonthlyTotal } from "@/db/queries/dashboard";

const MONTH_NAMES = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];

function formatMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split("-");
  const idx = Math.max(0, Math.min(11, Number.parseInt(m, 10) - 1));
  return `${MONTH_NAMES[idx]} ${y.slice(2)}`;
}

export function FacturacionChart({ data }: { data: MonthlyTotal[] }) {
  return (
    <div className="rounded-lg border border-line bg-white p-5">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold">Inversión mensual</h2>
          <p className="text-[11px] mt-0.5 uppercase tracking-[0.08em] text-muted">
            real vs proyectado
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-line" />
            Proyectado
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-ink" />
            Real
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
            tickFormatter={formatMonth}
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
            labelFormatter={formatMonth}
            formatter={(value: number, name) => [formatUsdCompact(value), name]}
          />
          <Bar dataKey="projected" name="Proyectado" fill="#d6d3d1" radius={[2, 2, 0, 0]} />
          <Bar dataKey="real" name="Real" fill="#1c1917" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
