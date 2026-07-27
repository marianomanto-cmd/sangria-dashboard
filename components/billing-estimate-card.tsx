"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type {
  MonthlyBillingEstimate,
  PlanBillingProjection,
  ProjectBillingProjection,
  ProjectBillingReconciliation,
} from "@/db/queries/dashboard";
import { formatUsd, formatUsdCompact } from "@/lib/format";
import { formatMonth, formatMonthShort, type Language, t } from "@/lib/i18n";
import { PlanStatusBadge } from "@/components/plan-status-badge";
import { BillingStatusBadge } from "@/components/billing-status-badge";

type ByProjectRow = MonthlyBillingEstimate["byProject"][number];

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
  // Portal: proyección de facturación por proyecto (planes + meses restantes),
  // keyed por projectId. Cuando se pasa, cada fila de proyecto se vuelve
  // DESPLEGABLE in situ: al expandir muestra el billing de cada plan (total /
  // facturado / falta facturar) y lo que falta facturar prorrateado por cada
  // mes que le queda al plan. Si no se pasa (vista interna), las filas siguen
  // siendo links al detalle del proyecto, sin despliegue.
  projectionsById?: Record<string, ProjectBillingProjection>;
  // Mes actual (YYYY-MM), server-computed. Cada mes de `estimates` anterior a
  // éste se considera CERRADO y su card muestra el FACTURADO REAL como número
  // principal (en vez del neto a facturar, que para un mes cerrado es ~0).
  currentMonth?: string;
  // Portal: conciliación "facturado vs total del plan" por proyecto. Cuando se
  // pasa, se dibuja debajo de las cards una sección de bullets con el semáforo
  // del facturado (verde = coincide, azul = falta, rojo = se pasó) y la razón
  // del gap (típicamente media que paga el cliente directo).
  reconciliation?: ProjectBillingReconciliation[];
};

export function BillingEstimateCard({
  estimates,
  previousMonth = null,
  hideProjectBreakdown = false,
  lang = "en",
  projectionsById,
  currentMonth = "",
  reconciliation,
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
            ? "Prorrateo lineal de placements (media) y fees de planes approved / ready_to_send sobre sus meses activos. Falta facturar = bruto − ya facturado."
            : "Linear proration of placements (media) and fees from approved / ready_to_send plans across their active months. Left to invoice = gross − already invoiced."}
        </p>
        {projectionsById && !hideProjectBreakdown && (
          <p className="text-xs text-muted mt-1">
            {lang === "es"
              ? "Tocá un proyecto para ver el billing de cada plan y lo que falta facturar, prorrateado por cada mes restante."
              : "Tap a project to see each plan's billing and what's left to invoice, prorated across each remaining month."}
          </p>
        )}
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
            projectionsById={projectionsById}
            isPast={currentMonth !== "" && e.month < currentMonth}
          />
        ))}
      </div>

      {reconciliation && reconciliation.length > 0 && (
        <BillingReconciliationBullets
          reconciliation={reconciliation}
          lang={lang}
        />
      )}
    </section>
  );
}

// ── Conciliación: facturado vs total del plan ────────────────────────────────
// Debajo de las cards, un bullet por proyecto con el semáforo del facturado y la
// razón del gap. "Total del plan" = presupuesto COMPLETO (toda la media —incl. la
// que paga el cliente directo— + fees). Verde = el facturado coincide con ese
// total · azul = le falta · rojo = se pasó. La causa típica del "le falta" es que
// el plan tiene media que paga el cliente directo (YT/Google), que la agencia no
// factura — se aclara nombrando esos publishers.
type ReconStatus = "match" | "short" | "over";

function reconStatus(r: ProjectBillingReconciliation): ReconStatus {
  const tol = Math.max(1, r.planTotalUsd * 0.005);
  const diff = r.planTotalUsd - r.billedUsd;
  if (diff > tol) return "short";
  if (diff < -tol) return "over";
  return "match";
}

function BillingReconciliationBullets({
  reconciliation,
  lang,
}: {
  reconciliation: ProjectBillingReconciliation[];
  lang: Language;
}) {
  const rows = reconciliation.filter((r) => r.planTotalUsd > 0);
  if (rows.length === 0) return null;
  const es = lang === "es";

  return (
    <section className="mt-4 rounded-lg border border-line bg-white dark:bg-paper-2 px-5 py-4">
      <h3 className="text-xs font-semibold text-ink">
        {es
          ? "Facturado vs total del plan"
          : "Invoiced vs plan total"}
      </h3>
      <p className="text-[11px] text-muted mt-0.5 mb-3">
        {es
          ? "El total del plan es el presupuesto completo (toda la media + fees). Cuando el facturado no llega, casi siempre es porque el plan tiene medios que paga el cliente directo (ej. YouTube/Google): la agencia cobra el fee sobre esa inversión pero no factura el medio."
          : "Plan total is the full budget (all media + fees). When invoiced falls short it's usually because the plan has media the client pays directly (e.g. YouTube/Google): the agency charges the fee on that spend but doesn't invoice the media itself."}
      </p>
      <ul className="space-y-2">
        {rows.map((r) => (
          <ReconciliationBullet key={r.projectId} r={r} es={es} />
        ))}
      </ul>
    </section>
  );
}

function ReconciliationBullet({
  r,
  es,
}: {
  r: ProjectBillingReconciliation;
  es: boolean;
}) {
  const status = reconStatus(r);
  const gap = r.planTotalUsd - r.billedUsd;
  const tol = Math.max(1, r.planTotalUsd * 0.005);

  // Color del semáforo: verde coincide · azul falta · rojo se pasó.
  const dotColor =
    status === "match"
      ? "bg-success"
      : status === "short"
        ? "bg-info"
        : "bg-danger";
  const billedColor =
    status === "match"
      ? "text-success"
      : status === "short"
        ? "text-info"
        : "text-danger";

  const pubs = r.clientPaidPublishers.join(", ");
  const clientPaidSignificant = r.clientPaidMediaUsd > tol;
  // Parte del gap que NO es media client-pays → facturación realmente pendiente.
  const billablePending = gap - r.clientPaidMediaUsd;

  return (
    <li className="flex items-start gap-2 text-[12px] leading-relaxed">
      <span
        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dotColor}`}
        aria-hidden
      />
      <span className="text-ink-2">
        <span className="font-medium text-ink">{r.projectName}</span>
        {": "}
        <span className={`font-mono font-semibold tabular-nums ${billedColor}`}>
          {formatUsd(r.billedUsd)}
        </span>{" "}
        {es ? "de" : "of"}{" "}
        <span className="font-mono tabular-nums text-ink-2">
          {formatUsd(r.planTotalUsd)}
        </span>{" "}
        {es ? "del plan" : "plan total"}
        {status === "match" && (
          <span className="text-success">
            {" "}
            · {es ? "coincide, facturado al 100%" : "matches, fully invoiced"}
          </span>
        )}
        {status === "over" && (
          <span className="text-danger">
            {" · "}
            {es
              ? `se pasó ${formatUsd(-gap)} — revisar`
              : `over by ${formatUsd(-gap)} — review`}
          </span>
        )}
        {status === "short" && (
          <>
            {" · "}
            <span className="text-info">
              {es ? "faltan" : "short by"} {formatUsd(gap)}
            </span>
            {clientPaidSignificant && (
              <>
                {" — "}
                {es ? (
                  <>
                    {formatUsd(r.clientPaidMediaUsd)} es media que paga el
                    cliente directo
                    {pubs ? ` (${pubs})` : ""} y la agencia no factura
                    {billablePending > tol
                      ? `; quedan ${formatUsd(billablePending)} por facturar.`
                      : "."}
                  </>
                ) : (
                  <>
                    {formatUsd(r.clientPaidMediaUsd)} is media the client pays
                    directly
                    {pubs ? ` (${pubs})` : ""}, not invoiced by the agency
                    {billablePending > tol
                      ? `; ${formatUsd(billablePending)} still to invoice.`
                      : "."}
                  </>
                )}
              </>
            )}
            {!clientPaidSignificant && (
              <>
                {" — "}
                {es ? "pendiente de facturar." : "still to invoice."}
              </>
            )}
          </>
        )}
      </span>
    </li>
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
  projectionsById,
  isPast = false,
}: {
  estimate: MonthlyBillingEstimate;
  hideProjectBreakdown: boolean;
  lang: Language;
  projectionsById?: Record<string, ProjectBillingProjection>;
  // Mes ya cerrado (anterior al actual): la card lidera con el FACTURADO REAL.
  isPast?: boolean;
}) {
  const hasData = estimate.byProject.length > 0;
  const portalMode = !!projectionsById;
  return (
    <div className="rounded-lg border border-line bg-white dark:bg-paper-2 overflow-hidden">
      <div className="px-5 py-3 border-b border-line-soft bg-paper-2/40">
        <div className="flex items-baseline justify-between">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
            {formatMonth(estimate.month, lang)}
            {isPast && <> · {t("common.closed", lang)}</>}
          </p>
          <p className="font-mono text-lg font-semibold text-ink tabular-nums">
            {formatUsd(isPast ? estimate.alreadyBilledUsd : estimate.netUsd)}
          </p>
        </div>
        {isPast ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted">
            <span className="text-ink-2 font-medium">
              {lang === "es" ? "Facturado real" : "Actual invoiced"}
            </span>
            <span>
              {t("common.media", lang)}:{" "}
              <span className="font-mono text-success">
                {formatUsdCompact(estimate.alreadyBilledMediaUsd)}
              </span>
            </span>
            <span>
              {t("common.fees", lang)}:{" "}
              <span className="font-mono text-success">
                {formatUsdCompact(estimate.alreadyBilledFeesUsd)}
              </span>
            </span>
            <span>
              {t("common.estimated", lang)}:{" "}
              <span className="font-mono text-ink-2">
                {formatUsdCompact(estimate.grossUsd)}
              </span>
            </span>
          </div>
        ) : (
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
        )}
      </div>

      {!hasData ? (
        <div className="px-5 py-6 text-center text-xs text-muted">
          {isPast
            ? lang === "es"
              ? "Sin facturación este mes."
              : "No invoicing this month."
            : lang === "es"
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
                    {t("common.leftToInvoice", lang)}
                  </th>
                </tr>
              </thead>
              <tbody>
                {estimate.byProject.map((p) => (
                  <EstimateRowDesktop
                    key={p.projectId}
                    p={p}
                    projection={projectionsById?.[p.projectId]}
                    portalMode={portalMode}
                    lang={lang}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: tarjetas (sin scroll horizontal). */}
          <div className="lg:hidden divide-y divide-line-soft">
            {estimate.byProject.map((p) => (
              <EstimateCardMobile
                key={p.projectId}
                p={p}
                projection={projectionsById?.[p.projectId]}
                portalMode={portalMode}
                lang={lang}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Fila de proyecto (desktop) ───────────────────────────────────────────────
// Cuando hay proyección, la fila entera actúa como botón de despliegue (chevron
// que rota + hover + teclado + aria-expanded) y al abrir inserta una fila de
// detalle a todo el ancho con el billing de cada plan. Sin proyección, queda
// como antes: link al detalle (vista interna) o texto plano (portal).
function EstimateRowDesktop({
  p,
  projection,
  portalMode,
  lang,
}: {
  p: ByProjectRow;
  projection?: ProjectBillingProjection;
  portalMode: boolean;
  lang: Language;
}) {
  const [open, setOpen] = useState(false);
  const valueCells = (
    <>
      <td className="px-5 py-1.5 text-right font-mono text-ink-2 tabular-nums">
        {p.grossMediaUsd > 0 ? formatUsdCompact(p.grossMediaUsd) : "—"}
      </td>
      <td className="px-5 py-1.5 text-right font-mono text-ink-2 tabular-nums">
        {p.grossFeesUsd > 0 ? formatUsdCompact(p.grossFeesUsd) : "—"}
      </td>
      <td className="px-5 py-1.5 text-right font-mono text-success tabular-nums">
        {p.alreadyBilledUsd > 0 ? formatUsdCompact(p.alreadyBilledUsd) : "—"}
      </td>
      <td className="px-5 py-1.5 text-right font-mono font-semibold text-ink tabular-nums">
        {formatUsdCompact(p.netUsd)}
      </td>
    </>
  );

  if (projection) {
    return (
      <>
        <tr
          role="button"
          tabIndex={0}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setOpen((o) => !o);
            }
          }}
          className="border-t border-line-soft cursor-pointer hover:bg-paper-2 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent transition-colors"
        >
          <td className="px-5 py-1.5">
            <div className="flex items-center gap-1.5">
              <ChevronRight
                size={13}
                aria-hidden
                className={`shrink-0 text-muted transition-transform ${open ? "rotate-90" : ""}`}
              />
              <div>
                <span className="text-ink-2">{p.projectName}</span>
                <div className="font-mono text-[10px] text-muted">
                  {p.projectCode} · {p.clientName}
                </div>
              </div>
            </div>
          </td>
          {valueCells}
        </tr>
        {open && (
          <tr className="bg-paper-2/40">
            <td colSpan={5} className="px-5 py-3 border-t border-line-soft">
              <ProjectProjectionDetail projection={projection} lang={lang} />
            </td>
          </tr>
        )}
      </>
    );
  }

  return (
    <tr className="border-t border-line-soft">
      <td className="px-5 py-1.5">
        {portalMode ? (
          <>
            <span className="text-ink-2">{p.projectName}</span>
            <div className="font-mono text-[10px] text-muted">
              {p.projectCode} · {p.clientName}
            </div>
          </>
        ) : (
          <Link
            href={`/proyectos/${p.projectCode}`}
            className="text-ink-2 hover:underline"
          >
            {p.projectName}
            <div className="font-mono text-[10px] text-muted">
              {p.projectCode} · {p.clientName}
            </div>
          </Link>
        )}
      </td>
      {valueCells}
    </tr>
  );
}

// ── Tarjeta de proyecto (mobile) ─────────────────────────────────────────────
function EstimateCardMobile({
  p,
  projection,
  portalMode,
  lang,
}: {
  p: ByProjectRow;
  projection?: ProjectBillingProjection;
  portalMode: boolean;
  lang: Language;
}) {
  const [open, setOpen] = useState(false);
  const expandable = !!projection;

  const head = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {expandable && (
            <ChevronRight
              size={15}
              aria-hidden
              className={`shrink-0 text-muted transition-transform ${open ? "rotate-90" : ""}`}
            />
          )}
          <span className="text-ink-2">{p.projectName}</span>
        </div>
        <div className="flex flex-col items-end shrink-0">
          <span className="text-[9px] uppercase tracking-[0.06em] text-muted">
            {t("common.leftToInvoice", lang)}
          </span>
          <span className="font-mono text-sm font-semibold text-ink tabular-nums">
            {formatUsdCompact(p.netUsd)}
          </span>
        </div>
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
            p.alreadyBilledUsd > 0 ? formatUsdCompact(p.alreadyBilledUsd) : "—"
          }
          valueClassName="text-success"
        />
      </div>
    </>
  );

  if (expandable) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="w-full text-left px-4 py-3.5 hover:bg-paper-2 transition-colors"
        >
          {head}
        </button>
        {open && (
          <div className="px-4 pb-4 pt-1 bg-paper-2/40">
            <ProjectProjectionDetail projection={projection} lang={lang} />
          </div>
        )}
      </div>
    );
  }

  if (portalMode) {
    return <div className="px-4 py-3.5">{head}</div>;
  }

  return (
    <Link
      href={`/proyectos/${p.projectCode}`}
      className="block px-4 py-3.5 hover:bg-paper-2 transition-colors"
    >
      {head}
    </Link>
  );
}

// ── Detalle desplegado: billing por plan + proyección por mes ────────────────
function ProjectProjectionDetail({
  projection,
  lang,
}: {
  projection: ProjectBillingProjection;
  lang: Language;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted mb-2">
        {lang === "es"
          ? "Facturación restante por plan"
          : "Remaining billing by plan"}
      </p>
      <div className="space-y-2.5">
        {projection.plans.map((plan) => (
          <PlanBillingBlock key={plan.planId} plan={plan} lang={lang} />
        ))}
      </div>
    </div>
  );
}

function PlanBillingBlock({
  plan,
  lang,
}: {
  plan: PlanBillingProjection;
  lang: Language;
}) {
  // Escala de las barras: el mes más alto llena la barra; el resto, proporcional.
  const maxMonth = plan.months.reduce((m, x) => Math.max(m, x.projectedUsd), 0);
  return (
    <div className="rounded-md border border-line-soft bg-white dark:bg-paper-2 p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium text-ink text-[13px]">{plan.planName}</span>
        <PlanStatusBadge status={plan.status} size="sm" />
        <span className="text-[11px] text-muted">
          {plan.periodStart && plan.periodEnd
            ? `${formatMonthShort(plan.periodStart.slice(0, 7), lang)} – ${formatMonthShort(plan.periodEnd.slice(0, 7), lang)}`
            : "—"}
        </span>
      </div>

      {/* Billing del plan: total a facturar / ya facturado / falta facturar. */}
      <div className="mt-2 grid grid-cols-3 gap-2">
        <MiniStat label={lang === "es" ? "Total" : "Total"} value={formatUsd(plan.grossUsd)} />
        <MiniStat
          label={lang === "es" ? "Facturado" : "Invoiced"}
          value={formatUsd(plan.billedUsd)}
          valueClassName="text-success"
        />
        <MiniStat
          label={lang === "es" ? "Falta facturar" : "Left to invoice"}
          value={formatUsd(plan.remainingUsd)}
          valueClassName="text-ink font-semibold"
        />
      </div>

      {/* Histórico de facturas emitidas: número + mes + valor de cada una. La
          suma reconcilia exacto con "Facturado". */}
      {plan.invoices.length > 0 && (
        <div className="mt-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted mb-1.5">
            {lang === "es" ? "Facturas emitidas" : "Issued invoices"}
          </p>
          <div className="space-y-1">
            {plan.invoices.map((inv) => (
              <div
                key={`${inv.invoiceNumber}-${inv.month}`}
                className="flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-[11px] text-ink-2 truncate">
                    {inv.invoiceNumber}
                  </span>
                  <span className="text-[10px] text-muted shrink-0">
                    {formatMonthShort(inv.month, lang)}
                  </span>
                  <span className="shrink-0">
                    <BillingStatusBadge status={inv.status} lang={lang} size="sm" />
                  </span>
                </div>
                <span className="font-mono text-[11px] text-ink tabular-nums shrink-0">
                  {formatUsd(inv.totalUsd)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Proyección de lo que falta, prorrateada por cada mes restante: barra
          por mes con el monto a la derecha (etiquetado directo). */}
      <div className="mt-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted mb-1.5">
          {lang === "es"
            ? "Proyección por mes restante"
            : "Projection per remaining month"}
        </p>
        {plan.months.length === 0 ? (
          <p className="text-[11px] text-muted">
            {lang === "es"
              ? "Sin saldo pendiente de facturar."
              : "Nothing left to invoice."}
          </p>
        ) : (
          <div className="space-y-1">
            {plan.months.map((m) => (
              <div key={m.month} className="flex items-center gap-2">
                <span className="w-14 shrink-0 text-[11px] text-muted tabular-nums">
                  {formatMonthShort(m.month, lang)}
                </span>
                <div className="flex-1 h-2 rounded-full bg-line overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2"
                    style={{
                      width: `${maxMonth > 0 ? Math.max(3, (m.projectedUsd / maxMonth) * 100) : 0}%`,
                    }}
                  />
                </div>
                <span className="w-16 shrink-0 text-right font-mono text-[11px] text-ink tabular-nums">
                  {formatUsdCompact(m.projectedUsd)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MiniStat({
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
