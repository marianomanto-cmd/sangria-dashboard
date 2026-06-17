import Link from "next/link";
import type { MonthlyBillingEstimate } from "@/db/queries/dashboard";
import { formatUsd, formatUsdCompact } from "@/lib/format";
import { formatMonth, type Language, t } from "@/lib/i18n";

// Variación entre real y estimado, en %. Si la estimación es 0 devolvemos
// null para evitar dividir por cero / mostrar Infinity.
function variancePct(real: number, est: number): number | null {
  if (est === 0) return null;
  return ((real - est) / est) * 100;
}

function formatVariance(v: number | null): string {
  if (v == null) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

type Props = {
  estimates: MonthlyBillingEstimate[];
  // Mes anterior cerrado, para ver accuracy de la estimación vs lo realmente
  // facturado. Si no se pasa, no se muestra el card de comparación.
  previousMonth?: MonthlyBillingEstimate | null;
  // Cuando es true, no renderiza la tabla "por proyecto" — útil cuando ya
  // estamos viendo un solo proyecto. Se muestra solo el total del mes.
  hideProjectBreakdown?: boolean;
  lang?: Language;
};

export function BillingEstimateCard({
  estimates,
  previousMonth = null,
  hideProjectBreakdown = false,
  lang = "en",
}: Props) {
  if (estimates.length === 0 && !previousMonth) return null;

  return (
    <section className="mt-8">
      <header className="mb-3">
        <h2 className="text-sm font-semibold text-ink">
          {lang === "es"
            ? "Estimación de facturación"
            : "Billing estimate"}
        </h2>
        <p className="text-xs text-muted">
          {lang === "es"
            ? "Prorrateo lineal de placements (media) y fees de planes approved / ready_to_send sobre sus meses activos. Neto = bruto − ya facturado."
            : "Linear proration of placements (media) and fees from approved / ready_to_send plans across their active months. Net = gross − already invoiced."}
        </p>
      </header>

      {previousMonth && (
        <div className="mb-3">
          <PreviousMonthCard estimate={previousMonth} lang={lang} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {estimates.map((e) => (
          <EstimateMonthCard
            key={e.month}
            estimate={e}
            hideProjectBreakdown={hideProjectBreakdown}
            lang={lang}
          />
        ))}
      </div>
    </section>
  );
}

function PreviousMonthCard({
  estimate,
  lang,
}: {
  estimate: MonthlyBillingEstimate;
  lang: Language;
}) {
  const realMedia = estimate.alreadyBilledMediaUsd;
  const realFees = estimate.alreadyBilledFeesUsd;
  const real = estimate.alreadyBilledUsd;
  const estMedia = estimate.grossMediaUsd;
  const estFees = estimate.grossFeesUsd;
  const est = estimate.grossUsd;
  return (
    <div className="rounded-lg border border-line bg-white dark:bg-paper-2 overflow-hidden">
      <div className="px-5 py-3 border-b border-line-soft bg-paper-2/40 flex items-baseline justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
            {formatMonth(estimate.month, lang)} · {t("common.closed", lang)}
          </p>
          <p className="text-[10px] text-muted mt-0.5">
            {lang === "es"
              ? "Real facturado vs estimación recomputada con los planes actuales."
              : "Actual invoiced vs estimate recomputed against current plans."}
          </p>
        </div>
      </div>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-[0.06em] text-muted border-b border-line-soft">
            <th className="text-left font-medium px-5 py-1.5"></th>
            <th className="text-right font-medium px-5 py-1.5">
              {t("common.media", lang)}
            </th>
            <th className="text-right font-medium px-5 py-1.5">
              {t("common.fees", lang)}
            </th>
            <th className="text-right font-medium px-5 py-1.5">
              {t("common.total", lang)}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-line-soft">
            <td className="px-5 py-1.5 text-ink-2">{t("common.real", lang)}</td>
            <td className="px-5 py-1.5 text-right font-mono text-ink-2 tabular-nums">
              {formatUsdCompact(realMedia)}
            </td>
            <td className="px-5 py-1.5 text-right font-mono text-ink-2 tabular-nums">
              {formatUsdCompact(realFees)}
            </td>
            <td className="px-5 py-1.5 text-right font-mono font-semibold text-ink tabular-nums">
              {formatUsd(real)}
            </td>
          </tr>
          <tr className="border-b border-line-soft">
            <td className="px-5 py-1.5 text-muted">
              {t("common.estimated", lang)}
            </td>
            <td className="px-5 py-1.5 text-right font-mono text-muted tabular-nums">
              {formatUsdCompact(estMedia)}
            </td>
            <td className="px-5 py-1.5 text-right font-mono text-muted tabular-nums">
              {formatUsdCompact(estFees)}
            </td>
            <td className="px-5 py-1.5 text-right font-mono text-muted tabular-nums">
              {formatUsd(est)}
            </td>
          </tr>
          <tr>
            <td className="px-5 py-1.5 text-[11px] uppercase tracking-[0.06em] text-muted">
              {t("common.variance", lang)}
            </td>
            <td
              className={`px-5 py-1.5 text-right font-mono tabular-nums ${varianceColor(variancePct(realMedia, estMedia))}`}
            >
              {formatVariance(variancePct(realMedia, estMedia))}
            </td>
            <td
              className={`px-5 py-1.5 text-right font-mono tabular-nums ${varianceColor(variancePct(realFees, estFees))}`}
            >
              {formatVariance(variancePct(realFees, estFees))}
            </td>
            <td
              className={`px-5 py-1.5 text-right font-mono font-semibold tabular-nums ${varianceColor(variancePct(real, est))}`}
            >
              {formatVariance(variancePct(real, est))}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// Colorea la variación: verde si está dentro de ±5% (estimación sana), warn
// si entre 5% y 15%, danger si supera 15%. La dirección (over/under) no
// cambia el color — sólo la magnitud, porque ambas son señales a revisar.
function varianceColor(v: number | null): string {
  if (v == null) return "text-line";
  const abs = Math.abs(v);
  if (abs < 5) return "text-success";
  if (abs < 15) return "text-warn";
  return "text-danger";
}

function EstimateMonthCard({
  estimate,
  hideProjectBreakdown,
  lang,
}: {
  estimate: MonthlyBillingEstimate;
  hideProjectBreakdown: boolean;
  lang: Language;
}) {
  const hasData = estimate.byProject.length > 0;
  return (
    <div className="rounded-lg border border-line bg-white dark:bg-paper-2 overflow-hidden">
      <div className="px-5 py-3 border-b border-line-soft bg-paper-2/40">
        <div className="flex items-baseline justify-between">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
            {formatMonth(estimate.month, lang)}
          </p>
          <p className="font-mono text-lg font-semibold text-ink tabular-nums">
            {formatUsd(estimate.netUsd)}
          </p>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted">
          <span>
            {t("common.media", lang)}:{" "}
            <span className="font-mono text-ink-2">
              {formatUsdCompact(estimate.grossMediaUsd)}
            </span>
          </span>
          <span>
            {t("common.fees", lang)}:{" "}
            <span className="font-mono text-ink-2">
              {formatUsdCompact(estimate.grossFeesUsd)}
            </span>
          </span>
          <span>
            {t("common.gross", lang)}:{" "}
            <span className="font-mono text-ink-2">
              {formatUsdCompact(estimate.grossUsd)}
            </span>
          </span>
          <span>
            {t("common.alreadyInvoiced", lang)}:{" "}
            <span className="font-mono text-success">
              {formatUsdCompact(estimate.alreadyBilledUsd)}
            </span>
          </span>
        </div>
      </div>

      {!hasData ? (
        <div className="px-5 py-6 text-center text-xs text-muted">
          {lang === "es"
            ? "Sin planes activos este mes."
            : "No active plans this month."}
        </div>
      ) : hideProjectBreakdown ? null : (
        <>
          {/* Desktop: tabla. En mobile, tarjetas (abajo) para no forzar
              scroll horizontal. */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-[0.06em] text-muted">
                  <th className="text-left font-medium px-5 py-1.5">
                    {t("common.project", lang)}
                  </th>
                  <th className="text-right font-medium px-5 py-1.5">
                    {t("common.media", lang)}
                  </th>
                  <th className="text-right font-medium px-5 py-1.5">
                    {t("common.fees", lang)}
                  </th>
                  <th className="text-right font-medium px-5 py-1.5">
                    {t("common.invoiced", lang)}
                  </th>
                  <th className="text-right font-medium px-5 py-1.5">
                    {t("common.net", lang)}
                  </th>
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
                      {p.grossMediaUsd > 0 ? formatUsdCompact(p.grossMediaUsd) : "—"}
                    </td>
                    <td className="px-5 py-1.5 text-right font-mono text-ink-2 tabular-nums">
                      {p.grossFeesUsd > 0 ? formatUsdCompact(p.grossFeesUsd) : "—"}
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
          </div>

          {/* Mobile: tarjetas (sin scroll horizontal). */}
          <div className="lg:hidden divide-y divide-line-soft">
            {estimate.byProject.map((p) => (
              <Link
                key={p.projectId}
                href={`/proyectos/${p.projectCode}`}
                className="block px-4 py-3.5 hover:bg-paper-2 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-ink-2">{p.projectName}</span>
                  <span className="font-mono text-sm font-semibold text-ink tabular-nums shrink-0">
                    {formatUsdCompact(p.netUsd)}
                  </span>
                </div>
                <p className="font-mono text-[10px] text-muted mt-0.5">
                  {p.projectCode} · {p.clientName}
                </p>
                <div className="mt-2.5 grid grid-cols-3 gap-2">
                  <EstimateCardStat
                    label={t("common.media", lang)}
                    value={p.grossMediaUsd > 0 ? formatUsdCompact(p.grossMediaUsd) : "—"}
                  />
                  <EstimateCardStat
                    label={t("common.fees", lang)}
                    value={p.grossFeesUsd > 0 ? formatUsdCompact(p.grossFeesUsd) : "—"}
                  />
                  <EstimateCardStat
                    label={t("common.invoiced", lang)}
                    value={
                      p.alreadyBilledUsd > 0
                        ? formatUsdCompact(p.alreadyBilledUsd)
                        : "—"
                    }
                    valueClassName="text-success"
                  />
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function EstimateCardStat({
  label,
  value,
  valueClassName = "text-ink-2",
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
        {label}
      </p>
      <p className={`font-mono text-xs tabular-nums mt-0.5 ${valueClassName}`}>
        {value}
      </p>
    </div>
  );
}
