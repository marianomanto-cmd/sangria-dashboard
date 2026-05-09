import Link from "next/link";
import type { MonthlyBillingEstimate } from "@/db/queries/dashboard";
import { formatUsd, formatUsdCompact } from "@/lib/format";

const MONTH_NAMES_ES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

function monthLabel(yyyymm: string): string {
  const [y, m] = yyyymm.split("-").map(Number);
  return `${MONTH_NAMES_ES[m - 1]} ${y}`;
}

type Props = {
  estimates: MonthlyBillingEstimate[];
  // Cuando es true, no renderiza la tabla "por proyecto" — útil cuando ya
  // estamos viendo un solo proyecto. Se muestra solo el total del mes.
  hideProjectBreakdown?: boolean;
};

export function BillingEstimateCard({
  estimates,
  hideProjectBreakdown = false,
}: Props) {
  if (estimates.length === 0) return null;

  return (
    <section className="mt-8">
      <header className="mb-3">
        <h2 className="text-sm font-semibold text-ink">
          Estimación de facturación
        </h2>
        <p className="text-xs text-muted">
          Prorrateo lineal de placements y fees de planes approved /
          ready_to_send sobre sus meses activos. Neto = bruto − ya facturado en
          el mes.
        </p>
      </header>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {estimates.map((e) => (
          <EstimateMonthCard
            key={e.month}
            estimate={e}
            hideProjectBreakdown={hideProjectBreakdown}
          />
        ))}
      </div>
    </section>
  );
}

function EstimateMonthCard({
  estimate,
  hideProjectBreakdown,
}: {
  estimate: MonthlyBillingEstimate;
  hideProjectBreakdown: boolean;
}) {
  const hasData = estimate.byProject.length > 0;
  return (
    <div className="rounded-lg border border-line bg-white overflow-hidden">
      <div className="px-5 py-3 border-b border-line-soft bg-paper-2/40">
        <div className="flex items-baseline justify-between">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
            {monthLabel(estimate.month)}
          </p>
          <p className="font-mono text-lg font-semibold text-ink tabular-nums">
            {formatUsd(estimate.netUsd)}
          </p>
        </div>
        <div className="mt-1 flex items-center gap-3 text-[11px] text-muted">
          <span>
            Bruto:{" "}
            <span className="font-mono text-ink-2">
              {formatUsdCompact(estimate.grossUsd)}
            </span>
          </span>
          <span>
            Ya facturado:{" "}
            <span className="font-mono text-success">
              {formatUsdCompact(estimate.alreadyBilledUsd)}
            </span>
          </span>
        </div>
      </div>

      {!hasData ? (
        <div className="px-5 py-6 text-center text-xs text-muted">
          Sin planes activos este mes.
        </div>
      ) : hideProjectBreakdown ? null : (
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.06em] text-muted">
              <th className="text-left font-medium px-5 py-1.5">Proyecto</th>
              <th className="text-right font-medium px-5 py-1.5">Bruto</th>
              <th className="text-right font-medium px-5 py-1.5">Facturado</th>
              <th className="text-right font-medium px-5 py-1.5">Neto</th>
            </tr>
          </thead>
          <tbody>
            {estimate.byProject.map((p) => (
              <tr key={p.projectId} className="border-t border-line-soft">
                <td className="px-5 py-1.5">
                  <Link
                    href={`/proyectos/${p.projectCode}`}
                    className="text-ink-2 hover:underline"
                  >
                    {p.projectName}
                  </Link>
                  <div className="font-mono text-[10px] text-muted">
                    {p.projectCode} · {p.clientName}
                  </div>
                </td>
                <td className="px-5 py-1.5 text-right font-mono text-ink-2 tabular-nums">
                  {formatUsdCompact(p.grossUsd)}
                </td>
                <td className="px-5 py-1.5 text-right font-mono text-success tabular-nums">
                  {p.alreadyBilledUsd > 0
                    ? formatUsdCompact(p.alreadyBilledUsd)
                    : "—"}
                </td>
                <td className="px-5 py-1.5 text-right font-mono font-semibold text-ink tabular-nums">
                  {formatUsdCompact(p.netUsd)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
