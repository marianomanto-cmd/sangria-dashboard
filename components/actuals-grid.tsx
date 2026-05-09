import type {
  ActualsPublisherGroup,
  ProjectActuals,
} from "@/db/queries/project-actuals";
import { formatPct, formatUsd, formatUsdCompact } from "@/lib/format";

const MONTH_LABELS_ES = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];

function formatMonthHeader(yyyymm: string): string {
  const idx = Number.parseInt(yyyymm.slice(5, 7), 10) - 1;
  return `${MONTH_LABELS_ES[idx] ?? yyyymm} ${yyyymm.slice(2, 4)}`;
}

export function ActualsGrid({ data }: { data: ProjectActuals }) {
  if (data.groups.length === 0) {
    return (
      <div className="rounded-lg border border-line border-dashed bg-paper-2 px-5 py-12 text-center">
        <p className="text-sm font-medium text-ink-2">Plan vacío</p>
        <p className="text-xs text-muted mt-1">
          El plan vigente no tiene líneas. Importá un Excel desde Fase 6.
        </p>
      </div>
    );
  }

  const totalConsumption =
    data.totalPlanned > 0 ? (data.totalReal / data.totalPlanned) * 100 : 0;

  return (
    <section className="rounded-lg border border-line bg-white overflow-hidden">
      <div className="px-5 py-3 border-b border-line flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Grilla de gastos reales</h2>
        <div className="flex items-center gap-4 text-[11px] uppercase tracking-[0.06em] font-medium text-muted">
          <span className="font-mono normal-case tracking-normal text-ink-2">
            {formatUsd(data.totalReal)}
            <span className="text-muted"> de </span>
            {formatUsd(data.totalPlanned)}
          </span>
          <span
            className={`font-mono normal-case tracking-normal ${
              totalConsumption > 100 ? "text-warn font-semibold" : "text-ink"
            }`}
          >
            {formatPct(totalConsumption, 0)}
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-paper">
            <tr className="text-[11px] uppercase tracking-[0.06em] text-muted">
              <th className="text-left font-medium px-5 py-2.5 sticky left-0 bg-paper z-10 min-w-[280px]">
                Publisher / Placement
              </th>
              {data.months.map((m) => (
                <th
                  key={m}
                  className="text-right font-medium px-3 py-2.5 min-w-[100px]"
                >
                  {formatMonthHeader(m)}
                </th>
              ))}
              <th className="text-right font-medium px-5 py-2.5 min-w-[100px]">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {data.groups.map((g) => (
              <PublisherRows key={g.publisher} group={g} months={data.months} />
            ))}
            <tr className="border-t-2 border-ink bg-paper-2">
              <td className="px-5 py-3 font-semibold sticky left-0 bg-paper-2 z-10">
                Total
              </td>
              {data.months.map((m) => {
                const realSum = data.groups.reduce(
                  (s, g) => s + g.totals[m].real,
                  0,
                );
                const plannedSum = data.groups.reduce(
                  (s, g) => s + g.totals[m].planned,
                  0,
                );
                const over = plannedSum > 0 && realSum > plannedSum * 1.01;
                return (
                  <td
                    key={m}
                    className={`px-3 py-3 text-right font-mono font-semibold tabular-nums ${
                      over ? "text-warn" : "text-ink"
                    }`}
                  >
                    {formatUsdCompact(realSum)}
                  </td>
                );
              })}
              <td className="px-5 py-3 text-right font-mono font-semibold tabular-nums text-ink">
                {formatUsd(data.totalReal)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="px-5 py-2.5 border-t border-line-soft text-[11px] text-muted">
        Los valores en{" "}
        <span className="text-warn font-medium">color warn</span> indican que el
        gasto real del mes superó la prorrata del plan para ese mes.
      </div>
    </section>
  );
}

function PublisherRows({
  group,
  months,
}: {
  group: ActualsPublisherGroup;
  months: string[];
}) {
  const consumption =
    group.totalPlanned > 0 ? (group.totalReal / group.totalPlanned) * 100 : 0;

  return (
    <>
      {/* Group header row */}
      <tr className="border-t-2 border-line bg-paper-2/60">
        <td className="px-5 py-2 sticky left-0 bg-paper-2/60 z-10">
          <span className="font-semibold text-ink">{group.publisher}</span>
          <span className="ml-2 text-xs text-muted font-normal">
            · {group.lines.length} placement{group.lines.length === 1 ? "" : "s"}
          </span>
        </td>
        {months.map((m) => (
          <Cell key={m} cell={group.totals[m]} bold />
        ))}
        <td
          className={`px-5 py-2 text-right font-mono font-semibold tabular-nums ${
            consumption > 100 ? "text-warn" : "text-ink"
          }`}
        >
          {formatUsdCompact(group.totalReal)}
        </td>
      </tr>
      {/* Line rows */}
      {group.lines.map((ln) => {
        const lineTotal = months.reduce((s, m) => s + ln.cells[m].real, 0);
        return (
          <tr
            key={ln.id}
            className="border-t border-line-soft hover:bg-paper-2 transition-colors"
          >
            <td className="px-5 py-2 pl-8 sticky left-0 bg-white z-10">
              <div className="text-[13px] text-ink-2">{ln.placementName}</div>
              {ln.audienceMarket && (
                <div className="text-[11px] text-muted truncate max-w-[280px]">
                  {ln.audienceMarket}
                </div>
              )}
            </td>
            {months.map((m) => (
              <Cell key={m} cell={ln.cells[m]} bold={false} />
            ))}
            <td className="px-5 py-2 text-right font-mono text-ink-2 tabular-nums text-[13px]">
              {lineTotal > 0 ? formatUsd(lineTotal) : "—"}
            </td>
          </tr>
        );
      })}
    </>
  );
}

function Cell({
  cell,
  bold,
}: {
  cell: { real: number; planned: number; over: boolean; hasActive: boolean };
  bold: boolean;
}) {
  if (!cell.hasActive && cell.real === 0) {
    return <td className="px-3 py-2 text-right font-mono text-stone-300">—</td>;
  }

  const value = cell.real > 0 ? formatUsdCompact(cell.real) : "0";
  const colorCls = cell.over ? "text-warn" : "text-ink-2";
  const weightCls = bold ? "font-semibold" : "";

  return (
    <td
      className={`px-3 py-2 text-right font-mono tabular-nums ${colorCls} ${weightCls}`}
      title={
        cell.planned > 0
          ? `Plan: ${formatUsd(cell.planned)}${cell.over ? " · superado" : ""}`
          : undefined
      }
    >
      {value}
    </td>
  );
}
