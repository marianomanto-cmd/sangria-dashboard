"use client";

import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatUsd, formatUsdCompact } from "@/lib/format";
import { formatMonthShort, type Language } from "@/lib/i18n";
import type { MonthlyTotal } from "@/db/queries/dashboard";
import {
  ChartGradient,
  tooltipStyle,
  useChartColors,
} from "@/components/chart-kit";

// ─── Inversión por publisher (barras horizontales: planeado vs real) ──────────

export function SpendByPublisherChart({
  data,
  lang = "es",
  topN = 8,
}: {
  data: { name: string; planned: number; real: number }[];
  lang?: Language;
  topN?: number;
}) {
  const c = useChartColors();

  // Top N por (planeado+real) + el resto agrupado en "Otros".
  const sorted = [...data].sort(
    (a, b) => b.planned + b.real - (a.planned + a.real),
  );
  const head = sorted.slice(0, topN);
  const rest = sorted.slice(topN);
  const restPlanned = rest.reduce((s, r) => s + r.planned, 0);
  const restReal = rest.reduce((s, r) => s + r.real, 0);
  const rows =
    restPlanned > 0 || restReal > 0
      ? [
          ...head,
          {
            name: lang === "es" ? "Otros" : "Other",
            planned: restPlanned,
            real: restReal,
          },
        ]
      : head;

  const plannedLabel = lang === "es" ? "Planeado" : "Planned";
  const realLabel = lang === "es" ? "Real" : "Real";

  return (
    <div className="rounded-lg border border-line bg-white dark:bg-paper-2 p-5">
      <h2 className="text-sm font-semibold text-ink mb-1">
        {lang === "es" ? "Inversión por publisher" : "Spend by publisher"}
      </h2>
      <p className="text-[11px] uppercase tracking-[0.08em] text-muted mb-4">
        {lang === "es" ? "planeado vs real" : "planned vs real"}
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted py-8 text-center">
          {lang === "es" ? "Sin datos aún." : "No data yet."}
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(180, rows.length * 46)}>
          <BarChart
            data={rows}
            layout="vertical"
            margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
            barCategoryGap="26%"
            barGap={2}
          >
            <ChartGradient
              id="pub-real"
              from={c.accent}
              to={c.accent2}
              direction="horizontal"
            />
            <CartesianGrid stroke={c.grid} strokeDasharray="2 4" horizontal={false} opacity={0.6} />
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
              cursor={{ fill: c.grid, opacity: 0.25 }}
              contentStyle={tooltipStyle(c)}
              formatter={(value, name) => [formatUsd(Number(value)), String(name)]}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, paddingTop: 6 }}
              iconType="circle"
              iconSize={8}
            />
            <Bar dataKey="planned" name={plannedLabel} fill={c.projected} radius={[0, 4, 4, 0]} />
            <Bar dataKey="real" name={realLabel} fill="url(#pub-real)" radius={[0, 4, 4, 0]} />
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
  const c = useChartColors();
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
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: c.accent }} />
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
          <ComposedChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
            <ChartGradient
              id="cum-real"
              from={c.accent}
              to={c.accent}
              fromOpacity={0.22}
              toOpacity={0.01}
            />
            <CartesianGrid stroke={c.grid} strokeDasharray="2 4" vertical={false} opacity={0.6} />
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
              contentStyle={tooltipStyle(c)}
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
              name="projected"
              stroke={c.line}
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
            />
            <Area
              type="monotone"
              dataKey="real"
              name="real"
              stroke={c.accent}
              strokeWidth={2.5}
              fill="url(#cum-real)"
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
