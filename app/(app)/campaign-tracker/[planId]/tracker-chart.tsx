"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type ChartDatum = {
  name: string;
  pct: number;
};

// Barras horizontales: una por placement. Cada barra apila consumo real,
// restante para goal y exceso (>100%). La línea vertical accent marca el
// pace esperado por las fechas del plan; la línea punteada, la meta (100%).
export function TrackerChart({
  data,
  pacePct,
}: {
  data: ChartDatum[];
  pacePct: number;
}) {
  const rows = data.map((d) => ({
    name: d.name,
    pct: d.pct,
    consumed: Math.min(d.pct, 100),
    remaining: Math.max(0, 100 - d.pct),
    overflow: Math.max(0, d.pct - 100),
  }));

  const height = Math.max(200, rows.length * 38 + 48);

  if (rows.length === 0) {
    return (
      <p className="text-xs text-muted py-8 text-center">
        Sin placements para graficar.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={rows}
        layout="vertical"
        margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
        barCategoryGap="28%"
      >
        <CartesianGrid stroke="#e7e5e4" strokeDasharray="3 3" horizontal={false} />
        <XAxis
          type="number"
          domain={[0, 110]}
          tickFormatter={(v) => `${v}%`}
          stroke="#78716c"
          tickLine={false}
          axisLine={false}
          style={{ fontSize: 11, fontFamily: "var(--font-mono)" }}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={200}
          stroke="#78716c"
          tickLine={false}
          axisLine={false}
          style={{ fontSize: 12, fontFamily: "var(--font-sans)" }}
        />
        <Tooltip
          cursor={{ fill: "#f5f5f4" }}
          contentStyle={{
            borderRadius: 8,
            border: "1px solid #d6d3d1",
            fontSize: 12,
            fontFamily: "var(--font-sans)",
          }}
          formatter={(value, name) => {
            if (name === "remaining") return [`${Number(value).toFixed(0)}%`, "Restante"];
            if (name === "overflow") return [`${Number(value).toFixed(0)}%`, "Exceso"];
            return [`${Number(value).toFixed(0)}%`, "Consumido"];
          }}
        />
        <Bar dataKey="consumed" stackId="a" radius={[2, 0, 0, 2]}>
          {rows.map((r, i) => (
            <Cell key={i} fill={r.pct > 100 ? "#b91c1c" : "#1c1917"} />
          ))}
        </Bar>
        <Bar dataKey="remaining" stackId="a" fill="#f5f5f4" />
        <Bar dataKey="overflow" stackId="a" fill="#b91c1c" radius={[0, 2, 2, 0]} />
        <ReferenceLine
          x={Math.max(0, Math.min(pacePct, 110))}
          stroke="#7a1f3d"
          strokeWidth={1.5}
          label={{
            value: `pace ${pacePct.toFixed(0)}%`,
            position: "top",
            fill: "#7a1f3d",
            fontSize: 10,
          }}
        />
        <ReferenceLine x={100} stroke="#78716c" strokeDasharray="4 3" />
      </BarChart>
    </ResponsiveContainer>
  );
}
