"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PlanBillingProgress } from "@/db/queries/billing";
import { formatUsd, formatUsdCompact } from "@/lib/format";
import { formatMonthShort } from "@/lib/i18n";
import { tooltipStyle, useChartColors } from "@/components/chart-kit";

// ════════════════════════════════════════════════════════════════════════════
// Avance de facturación del plan — "dónde estoy parado".
//
// Muestra lo FACTURADO (medios + fee, emitido = invoiced/paid) contra el TOTAL
// del plan, en tres lecturas complementarias:
//   • KPIs + hero %  → el número instantáneo (facturado de total, % y falta).
//   • Barra segmentada medios | fee | falta  → composición vs total de un vistazo.
//   • Burn-up (área apilada acumulada por mes) con línea de referencia del total
//     → cómo se fue facturando en el tiempo y cuánto falta para el total.
//
// Colores: medios = accent, fee = accent-2 (par categórico validado CVD del
// tema). Identidad reforzada por leyenda + labels (no solo color).
// ════════════════════════════════════════════════════════════════════════════

export function PlanBillingProgressCard({
  progress,
  planMonths,
}: {
  progress: PlanBillingProgress;
  planMonths: string[]; // meses del plan (YYYY-MM, asc) para el eje del burn-up
}) {
  const c = useChartColors();

  const {
    totalMediaUsd,
    totalFeesUsd,
    totalUsd,
    invoicedMediaUsd,
    invoicedFeesUsd,
    pendingMediaUsd,
    pendingFeesUsd,
  } = progress;

  const facturado = invoicedMediaUsd + invoicedFeesUsd;
  const pending = pendingMediaUsd + pendingFeesUsd;
  const falta = Math.max(0, totalUsd - facturado);
  const hasTotal = totalUsd > 0;
  // % facturado. Sin total (plan sin presupuesto) no hay % — evitamos un "0%"
  // engañoso al lado de un facturado > 0.
  const pct = hasTotal ? (facturado / totalUsd) * 100 : null;

  // Barra segmentada: el "100%" es el total del plan; si se facturó de MÁS
  // (over-billing), el 100% pasa a ser lo facturado, así los segmentos llenan la
  // barra sin desbordar. medios | fee | (falta = lo que queda del track).
  const barBase = Math.max(totalUsd, facturado) || 1;
  const mediaW = (invoicedMediaUsd / barBase) * 100;
  const feeW = (invoicedFeesUsd / barBase) * 100;

  // Serie acumulada del burn-up. Eje = UNIÓN de los meses del plan y los meses
  // con billing: un billing emitido cuyo mes quedó fuera del período derivado
  // (p.ej. placements editados después de facturar) igual tiene que sumar, para
  // que el tope del área matchee el KPI "Facturado". Acumulamos lo EMITIDO.
  const byMonth = new Map(progress.months.map((m) => [m.month, m]));
  const axisMonths = Array.from(
    new Set([...planMonths, ...progress.months.map((m) => m.month)]),
  ).sort();
  const data = axisMonths.reduce<
    { month: string; media: number; fees: number; total: number }[]
  >((acc, month) => {
    const prev = acc[acc.length - 1];
    const b = byMonth.get(month);
    const media = (prev?.media ?? 0) + (b?.emitted ? b.mediaUsd : 0);
    const fees = (prev?.fees ?? 0) + (b?.emitted ? b.feesUsd : 0);
    acc.push({ month, media, fees, total: media + fees });
    return acc;
  }, []);
  const maxCum = data.length ? data[data.length - 1].total : 0;
  const domainMax = Math.max(totalUsd, maxCum) * 1.08 || 1;
  // Mostramos el chart si hay algo para graficar (presupuesto o facturado).
  const hasChart = axisMonths.length > 0 && (hasTotal || facturado > 0);

  return (
    <section className="rounded-lg border border-line bg-white dark:bg-paper-2 p-5 mb-6">
      <header className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div>
          <h2 className="text-sm font-semibold text-ink">
            Avance de facturación
          </h2>
          <p className="text-[11px] uppercase tracking-[0.08em] text-muted mt-0.5">
            Facturado (medios + fee) vs total del plan
          </p>
        </div>
        <Legend c={c} />
      </header>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <Kpi label="Total del plan" value={formatUsd(totalUsd)}>
          <span className="text-muted">
            Medios{" "}
            <span className="font-mono text-ink-2">
              {formatUsdCompact(totalMediaUsd)}
            </span>{" "}
            · Fee{" "}
            <span className="font-mono text-ink-2">
              {formatUsdCompact(totalFeesUsd)}
            </span>
          </span>
        </Kpi>
        <Kpi
          label="Facturado"
          value={formatUsd(facturado)}
          badge={pct != null ? `${pct.toFixed(0)}%` : undefined}
        >
          <span className="text-muted">
            Medios{" "}
            <span className="font-mono" style={{ color: c.accent }}>
              {formatUsdCompact(invoicedMediaUsd)}
            </span>{" "}
            · Fee{" "}
            <span className="font-mono" style={{ color: c.accent2 }}>
              {formatUsdCompact(invoicedFeesUsd)}
            </span>
          </span>
        </Kpi>
        <Kpi label="Falta facturar" value={formatUsd(falta)}>
          {pending > 0 ? (
            <span className="text-muted">
              <span className="font-mono text-ink-2">
                {formatUsdCompact(pending)}
              </span>{" "}
              ya cargado sin emitir
            </span>
          ) : (
            <span className="text-muted">del total del plan</span>
          )}
        </Kpi>
      </div>

      {/* Barra segmentada: facturado medios | fee | falta (vs total) */}
      <div
        className="flex h-2.5 w-full rounded-full overflow-hidden bg-paper mb-5"
        style={{ gap: 2 }}
        role="img"
        aria-label={
          pct != null
            ? `Facturado ${pct.toFixed(0)}% del total del plan`
            : `Facturado ${formatUsd(facturado)}`
        }
      >
        {mediaW > 0 && (
          <div style={{ width: `${mediaW}%`, backgroundColor: c.accent }} />
        )}
        {feeW > 0 && (
          <div style={{ width: `${feeW}%`, backgroundColor: c.accent2 }} />
        )}
        <div className="flex-1" />
      </div>

      {/* Burn-up: acumulado facturado por mes vs línea del total */}
      {!hasChart ? (
        <p className="text-xs text-muted text-center py-6">
          {!hasTotal
            ? "El plan todavía no tiene presupuesto cargado."
            : "El plan no tiene meses para graficar."}
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart
            data={data}
            margin={{ top: 16, right: 16, left: 0, bottom: 4 }}
          >
            <CartesianGrid
              stroke={c.grid}
              strokeDasharray="2 4"
              vertical={false}
              opacity={0.6}
            />
            <XAxis
              dataKey="month"
              tickFormatter={(m) => formatMonthShort(String(m), "es")}
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
              domain={[0, domainMax]}
              style={{ fontSize: 11, fontFamily: "var(--font-mono)" }}
            />
            <Tooltip
              contentStyle={tooltipStyle(c)}
              labelFormatter={(m) => formatMonthShort(String(m), "es")}
              formatter={(value, name) => {
                const label =
                  name === "media"
                    ? "Medios (acum.)"
                    : name === "fees"
                      ? "Fee (acum.)"
                      : String(name);
                return [formatUsd(Number(value)), label];
              }}
            />
            {hasTotal && (
              <ReferenceLine
                y={totalUsd}
                stroke={c.axis}
                strokeDasharray="5 4"
                strokeWidth={2}
                label={{
                  value: `Total ${formatUsdCompact(totalUsd)}`,
                  position: "insideTopRight",
                  fill: c.axis,
                  fontSize: 11,
                }}
              />
            )}
            <Area
              type="monotone"
              dataKey="media"
              name="media"
              stackId="cum"
              stroke={c.accent}
              strokeWidth={2}
              fill={c.accent}
              fillOpacity={0.9}
              dot={false}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="fees"
              name="fees"
              stackId="cum"
              stroke={c.accent2}
              strokeWidth={2}
              fill={c.accent2}
              fillOpacity={0.9}
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </section>
  );
}

function Legend({ c }: { c: ReturnType<typeof useChartColors> }) {
  return (
    <div className="flex items-center gap-3 text-xs text-muted">
      <span className="flex items-center gap-1.5">
        <span
          className="inline-block w-2.5 h-2.5 rounded-sm"
          style={{ backgroundColor: c.accent }}
        />
        Medios
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="inline-block w-2.5 h-2.5 rounded-sm"
          style={{ backgroundColor: c.accent2 }}
        />
        Fee
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="inline-block w-4 border-t-2 border-dashed"
          style={{ borderColor: c.axis }}
        />
        Total
      </span>
    </div>
  );
}

function Kpi({
  label,
  value,
  badge,
  children,
}: {
  label: string;
  value: string;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-line-soft bg-paper px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
          {label}
        </p>
        {badge && (
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent tabular-nums">
            {badge}
          </span>
        )}
      </div>
      <p className="font-mono text-xl font-semibold tabular-nums mt-1 text-ink">
        {value}
      </p>
      <p className="text-[11px] mt-1">{children}</p>
    </div>
  );
}
