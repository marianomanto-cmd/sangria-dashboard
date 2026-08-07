"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatUsd, formatUsdCompact } from "@/lib/format";
import { formatMonthShort, type Language } from "@/lib/i18n";
import {
  ChartGradient,
  tooltipStyle,
  useChartColors,
} from "@/components/chart-kit";

// LabelList tipa el formatter con RenderableText (puede venir undefined), no
// con number. Normalizamos acá en vez de castear en cada LabelList.
function moneyLabel(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? formatUsdCompact(n) : "";
}

export type MediaFeeMonth = {
  month: string;
  media: number;
  fee: number;
  total: number;
};

// Facturación del período FILTRADO: una columna por mes con medios y fees
// apilados dentro, etiqueta de dato en cada segmento y los subtotales sumados
// abajo a la derecha. Los datos salen de las mismas filas que muestra la tabla
// de /billing, así el gráfico y la tabla nunca se desincronizan.
export function BillingMediaFeeChart({
  data,
  lang = "es",
}: {
  data: MediaFeeMonth[];
  lang?: Language;
}) {
  const c = useChartColors();
  const fmt = (m: string) => formatMonthShort(m, lang);

  const totalMedia = data.reduce((a, d) => a + d.media, 0);
  const totalFee = data.reduce((a, d) => a + d.fee, 0);
  const total = totalMedia + totalFee;

  // Con muchos meses las etiquetas se pisan; a partir de 14 columnas las
  // apagamos y el detalle queda en el tooltip.
  const showLabels = data.length <= 14;

  return (
    <div className="rounded-lg border border-line bg-white dark:bg-paper-2 p-5 mb-5">
      <div className="flex items-baseline justify-between mb-4 gap-4 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-ink">
            {lang === "es" ? "Facturación del período" : "Billing for the period"}
          </h2>
          <p className="text-[11px] mt-0.5 uppercase tracking-[0.08em] text-muted">
            {lang === "es" ? "medios + fees por mes" : "media + fees by month"}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm"
              style={{ backgroundColor: c.real }}
            />
            {lang === "es" ? "Medios" : "Media"}
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm"
              style={{ backgroundColor: c.projected }}
            />
            Fees
          </span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <BarChart
          data={data}
          margin={{ top: 18, right: 8, left: 0, bottom: 4 }}
          barCategoryGap="26%"
        >
          <ChartGradient id="bmf-media" from={c.accent2} to={c.real} />
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
            width={64}
            style={{ fontSize: 11, fontFamily: "var(--font-mono)" }}
          />
          <Tooltip
            cursor={{ fill: c.grid, opacity: 0.25 }}
            contentStyle={tooltipStyle(c)}
            labelFormatter={(label) => fmt(String(label))}
            formatter={(value, name) => [formatUsd(Number(value)), name]}
          />
          <Bar
            stackId="m"
            dataKey="media"
            name={lang === "es" ? "Medios" : "Media"}
            fill="url(#bmf-media)"
          >
            {showLabels && (
              <LabelList
                dataKey="media"
                position="center"
                formatter={moneyLabel}
                style={{
                  fontSize: 10,
                  fontFamily: "var(--font-mono)",
                  fill: "#fff",
                  fontWeight: 600,
                }}
              />
            )}
          </Bar>
          <Bar
            stackId="m"
            dataKey="fee"
            name="Fees"
            fill={c.projected}
            radius={[4, 4, 0, 0]}
          >
            {showLabels && (
              <>
                <LabelList
                  dataKey="fee"
                  position="center"
                  formatter={moneyLabel}
                  style={{
                    fontSize: 10,
                    fontFamily: "var(--font-mono)",
                    fill: c.ink,
                    fontWeight: 600,
                  }}
                />
                <LabelList
                  dataKey="total"
                  position="top"
                  formatter={moneyLabel}
                  style={{
                    fontSize: 10,
                    fontFamily: "var(--font-mono)",
                    fill: c.axis,
                  }}
                />
              </>
            )}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Subtotales sumados, abajo a la derecha del gráfico. */}
      <div className="mt-3 pt-3 border-t border-line flex justify-end">
        <dl className="flex items-end gap-6 text-right">
          <Sub label={lang === "es" ? "Medios" : "Media"} value={totalMedia} />
          <Sub label="Fees" value={totalFee} muted />
          <Sub label="Total" value={total} strong />
        </dl>
      </div>
    </div>
  );
}

function Sub({
  label,
  value,
  muted,
  strong,
}: {
  label: string;
  value: number;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <div>
      <dt className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
        {label}
      </dt>
      <dd
        className={`font-mono tabular-nums ${
          strong
            ? "text-base font-semibold text-ink"
            : muted
              ? "text-sm text-muted"
              : "text-sm text-ink-2"
        }`}
      >
        {formatUsd(value)}
      </dd>
    </div>
  );
}
