"use client";

// ════════════════════════════════════════════════════════════════════════════
// Modal de QA DE ARMADO — el control obligatorio entre "aprobado" y "live".
// Lo hace el AM/PM. El hermano de antes de la firma, que hace el media planner,
// es planning-qa-modal.tsx.
//
// Muestra el plan como lo muestra el Excel (mismas columnas, mismos grupos de
// publisher, mismos subtotales y el bloque de fees), con una casilla
// "Controlado" al final de CADA línea. El AM/PM va tildando a medida que
// verifica que la campaña esté armada en las plataformas tal cual el plan;
// recién con todas las líneas tildadas se habilita "QA realizado".
//
// Decisiones de diseño, todas apuntando a que no se pueda cerrar un QA que no
// se hizo:
//   • No hay "marcar todas": tildar es el acto de controlar.
//   • Cada tilde se persiste sola (media_plan_qa_checks) con quién y cuándo →
//     el progreso sobrevive a cerrar el modal y dos planners pueden repartirse
//     un plan largo. La UI es optimista y revierte si el server rechaza.
//   • El botón de cerrar el QA vive abajo, fijo, y dice cuántas líneas faltan.
//   • "Ir a la primera pendiente" para no perderse en planes de 80 líneas.
//   • La barrera real está en `completePlanQa` (app/actions/plan-qa.ts): re-
//     cuenta las líneas contra la base antes de cerrar.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ArrowDown, Check, RefreshCw, ShieldCheck, X } from "lucide-react";
import { completePlanQa, setPlanQaCheck } from "@/app/actions/plan-qa";
import { Button } from "@/components/button";
import { PlacementName } from "@/components/placement-name";
import { useToast } from "@/components/toast";
import type { PlanDetail } from "@/db/queries/project-detail";
import type { PlanQaCheck } from "@/db/queries/plan-qa";
import { formatUsd } from "@/lib/format";
import { formatDate, type Language } from "@/lib/i18n";
import {
  placementMetricValue,
  placementsPeriod,
  resolveMetricColumns,
  sumDirectMetrics,
  type MetricMeta,
} from "@/lib/plan-metrics";

type MetricCatalog = MetricMeta & { id: string };

export function PlanQaModal({
  detail,
  allMetrics,
  initialChecks,
  lang,
  onClose,
}: {
  detail: PlanDetail;
  allMetrics: MetricCatalog[];
  initialChecks: PlanQaCheck[];
  lang: Language;
  // Cerrar el modal refresca la página (lo hace el editor): así el progreso
  // guardado vuelve fresco de la base la próxima vez que se abre.
  onClose: () => void;
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(initialChecks.map((c) => c.placementId)),
  );
  const [saving, setSaving] = useState<Set<string>>(() => new Set());
  const [notes, setNotes] = useState("");
  // Cuántas líneas tiene tildadas el SERVER según la última respuesta. Si es
  // más que las que muestra esta pantalla, hay otro planner controlando el
  // mismo plan en paralelo y conviene refrescar.
  const [serverChecked, setServerChecked] = useState<number | null>(null);

  const allPlacements = useMemo(
    () => detail.publishers.flatMap((p) => p.placements),
    [detail.publishers],
  );
  const total = allPlacements.length;
  const done = allPlacements.filter((p) => checked.has(p.id)).length;
  const missing = total - done;
  const complete = total > 0 && missing === 0;
  const pct = total > 0 ? (done / total) * 100 : 0;

  // Columnas de métricas: exactamente las que arma el Excel.
  const metricColumns = useMemo(
    () => resolveMetricColumns(allMetrics, allPlacements),
    [allMetrics, allPlacements],
  );
  const directSlugs = useMemo(
    () => metricColumns.filter((m) => m.kind === "direct").map((m) => m.slug),
    [metricColumns],
  );

  const period = placementsPeriod(allPlacements);
  const metricTotals = useMemo(
    () => sumDirectMetrics(allPlacements, directSlugs),
    [allPlacements, directSlugs],
  );

  // ── a11y del modal: Escape cierra, scroll-lock, foco inicial y restaurado ──
  useEffect(() => {
    lastFocused.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeBtnRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      lastFocused.current?.focus?.();
    };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  // Tilde optimista + persistencia. Si el server rechaza, se revierte y se
  // avisa: nunca queda una línea "controlada" en pantalla que no lo esté en la
  // base (sería exactamente el error humano que este modal viene a evitar).
  const toggle = async (placementId: string, next: boolean) => {
    setChecked((prev) => {
      const s = new Set(prev);
      if (next) s.add(placementId);
      else s.delete(placementId);
      return s;
    });
    setSaving((prev) => new Set(prev).add(placementId));

    const r = await setPlanQaCheck({
      planId: detail.plan.id,
      placementId,
      checked: next,
    });

    setSaving((prev) => {
      const s = new Set(prev);
      s.delete(placementId);
      return s;
    });

    if (!r.ok) {
      setChecked((prev) => {
        const s = new Set(prev);
        if (next) s.delete(placementId);
        else s.add(placementId);
        return s;
      });
      toast.error(r.error);
      return;
    }
    setServerChecked(r.checkedCount);
  };

  const scrollToFirstPending = () => {
    const first = allPlacements.find((p) => !checked.has(p.id));
    if (!first) return;
    const el = scrollRef.current?.querySelector(`[data-qa-row="${first.id}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    (
      scrollRef.current?.querySelector(
        `[data-qa-check="${first.id}"]`,
      ) as HTMLInputElement | null
    )?.focus();
  };

  const onComplete = () => {
    startTransition(async () => {
      const r = await completePlanQa({ planId: detail.plan.id, notes });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(
        `QA realizado · v${detail.plan.currentVersion} · ${total} línea${total === 1 ? "" : "s"} controladas`,
      );
      onClose();
    });
  };

  const colCount = 8 + metricColumns.length + 1; // base + métricas + control

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-5"
      onKeyDown={onKeyDown}
    >
      <div
        className="absolute inset-0 bg-ink/50 backdrop-blur-[2px] animate-fade-in"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-qa-title"
        className="relative w-full max-w-[1500px] max-h-[94vh] flex flex-col rounded-lg border border-line bg-white dark:bg-paper-2 shadow-[var(--shadow-card-hover)] animate-dialog-in overflow-hidden"
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="shrink-0 border-b border-line px-5 py-3.5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold tracking-[0.16em] uppercase text-accent">
                QA del plan · v{detail.plan.currentVersion}
              </p>
              <h2
                id="plan-qa-title"
                className="text-lg font-semibold text-ink mt-0.5 truncate"
              >
                {detail.project.code}.{detail.plan.name}
              </h2>
              <p className="text-xs text-muted mt-0.5">
                Controlá que la campaña esté armada en las plataformas tal cual
                estas líneas. Tildá <strong className="font-medium text-ink-2">Controlado</strong>{" "}
                en cada una: con todas tildadas se habilita “QA realizado”.
              </p>
            </div>
            <button
              ref={closeBtnRef}
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-md p-1.5 text-muted hover:text-ink hover:bg-paper-2"
              aria-label="Cerrar"
            >
              <X size={16} strokeWidth={2} />
            </button>
          </div>

          {/* Metadata + progreso */}
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
            <Meta label="Período">
              {formatDate(period.start, lang)}
              <span className="text-line"> → </span>
              {formatDate(period.end, lang)}
            </Meta>
            <Meta label="Budget origin">{detail.budgetOrigin.name}</Meta>
            <Meta label="Media">{formatUsd(detail.totals.media)}</Meta>
            <Meta label="Fees">{formatUsd(detail.totals.fees)}</Meta>
            <Meta label="Total">{formatUsd(detail.totals.grand)}</Meta>
            <div className="ml-auto flex items-center gap-2.5">
              <div
                className="h-1.5 w-32 rounded-full bg-line overflow-hidden"
                role="progressbar"
                aria-valuenow={done}
                aria-valuemin={0}
                aria-valuemax={total}
                aria-label="Líneas controladas"
              >
                <div
                  className={`h-full rounded-full transition-all ${complete ? "bg-success" : "bg-accent"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span
                className={`font-mono tabular-nums font-semibold ${complete ? "text-success" : "text-ink"}`}
              >
                {done}/{total}
              </span>
            </div>
          </div>
        </div>

        {/* ── Preview tipo Excel + casillas ──────────────────────────────── */}
        <div ref={scrollRef} className="flex-1 overflow-auto">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-accent text-white">
                <Th className="text-left min-w-[220px]">Publisher / Placement</Th>
                <Th className="text-left min-w-[120px]">Mercado</Th>
                <Th className="text-left whitespace-nowrap">Inicio</Th>
                <Th className="text-left whitespace-nowrap">Fin</Th>
                <Th className="text-left min-w-[180px]">Audiencia</Th>
                <Th className="text-left min-w-[180px]">Notas / formatos</Th>
                <Th className="text-left whitespace-nowrap">Cost method</Th>
                <Th className="text-right whitespace-nowrap">Inversión</Th>
                {metricColumns.map((m) => (
                  <Th key={m.slug} className="text-right whitespace-nowrap">
                    {m.name}
                  </Th>
                ))}
                <Th className="text-center whitespace-nowrap sticky right-0 bg-accent shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.35)]">
                  Controlado
                </Th>
              </tr>
            </thead>
            <tbody>
              {detail.publishers.map((pub) => {
                const subtotals = sumDirectMetrics(pub.placements, directSlugs);
                const pubDone = pub.placements.filter((p) =>
                  checked.has(p.id),
                ).length;
                return (
                  <PublisherBlock
                    key={pub.id}
                    name={pub.publisherName}
                    placementsTotalUsd={pub.placementsTotalUsd}
                    lineCount={pub.placements.length}
                    doneCount={pubDone}
                    metricColumns={metricColumns}
                    subtotals={subtotals}
                  >
                    {pub.placements.map((pl) => {
                      const isChecked = checked.has(pl.id);
                      return (
                        <tr
                          key={pl.id}
                          data-qa-row={pl.id}
                          className={`border-b border-line-soft transition-colors ${
                            isChecked
                              ? "bg-success-soft/50"
                              : "hover:bg-paper-2/60"
                          }`}
                        >
                          <Td className="pl-6">
                            <PlacementName name={pl.placementName} />
                          </Td>
                          <Td>{pl.marketName ?? "—"}</Td>
                          <Td className="font-mono whitespace-nowrap">
                            {formatDate(pl.startDate, lang)}
                          </Td>
                          <Td className="font-mono whitespace-nowrap">
                            {formatDate(pl.endDate, lang)}
                          </Td>
                          <Td className="text-ink-2">{pl.audience ?? "—"}</Td>
                          <Td className="text-ink-2">{pl.notesMd ?? "—"}</Td>
                          <Td className="font-mono">{pl.costMethod ?? "—"}</Td>
                          <Td className="text-right font-mono tabular-nums">
                            {formatUsd(pl.amountUsd)}
                          </Td>
                          {metricColumns.map((m) => {
                            const v = placementMetricValue(m, pl);
                            return (
                              <Td
                                key={m.slug}
                                className="text-right font-mono tabular-nums"
                              >
                                {v == null
                                  ? "—"
                                  : v.toLocaleString("en-US", {
                                      maximumFractionDigits:
                                        m.kind === "calculated" ? 2 : 0,
                                    })}
                              </Td>
                            );
                          })}
                          <td
                            className={`px-3 py-1.5 text-center sticky right-0 border-l border-line ${
                              isChecked
                                ? "bg-success-soft"
                                : "bg-white dark:bg-paper-2"
                            }`}
                          >
                            <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                data-qa-check={pl.id}
                                checked={isChecked}
                                disabled={saving.has(pl.id) || pending}
                                onChange={(e) => toggle(pl.id, e.target.checked)}
                                className="h-4 w-4 accent-[var(--color-success)] cursor-pointer disabled:opacity-50"
                                aria-label={`Controlado — ${pub.publisherName} · ${pl.placementName}`}
                              />
                              <span
                                className={`text-[10px] uppercase tracking-[0.06em] ${
                                  isChecked ? "text-success font-semibold" : "text-muted"
                                }`}
                              >
                                {isChecked ? "OK" : "pendiente"}
                              </span>
                            </label>
                          </td>
                        </tr>
                      );
                    })}
                    {pub.placements.length === 0 && (
                      <tr className="border-b border-line-soft">
                        <Td className="pl-6 text-muted italic" colSpan={colCount}>
                          Este publisher no tiene placements.
                        </Td>
                      </tr>
                    )}
                  </PublisherBlock>
                );
              })}

              {/* Total media */}
              <tr className="bg-accent-soft font-semibold text-ink border-y border-line">
                <Td className="uppercase tracking-[0.06em] text-[10px]">
                  Total media
                </Td>
                <Td colSpan={6} />
                <Td className="text-right font-mono tabular-nums">
                  {formatUsd(detail.totals.media)}
                </Td>
                {metricColumns.map((m) => (
                  <Td key={m.slug} className="text-right font-mono tabular-nums">
                    {m.kind === "direct"
                      ? (metricTotals[m.slug] ?? 0).toLocaleString("en-US")
                      : "—"}
                  </Td>
                ))}
                <Td className="sticky right-0 bg-accent-soft border-l border-line" />
              </tr>

              {/* Fees — contexto: no se tildan, no se arman en plataforma */}
              {detail.fees.length > 0 && (
                <>
                  <tr className="bg-paper-2 border-y border-line">
                    <Td
                      colSpan={colCount}
                      className="uppercase tracking-[0.06em] text-[10px] font-semibold text-muted"
                    >
                      Fees · referencia (no se controlan en plataforma)
                    </Td>
                  </tr>
                  {detail.fees.map((f) => (
                    <tr key={f.id} className="border-b border-line-soft">
                      <Td className="pl-6">{f.name}</Td>
                      <Td colSpan={5} className="text-muted">
                        {f.notes ?? ""}
                      </Td>
                      <Td className="font-mono">
                        {f.ratePct != null ? `${f.ratePct}%` : ""}
                      </Td>
                      <Td className="text-right font-mono tabular-nums">
                        {formatUsd(f.amountUsd)}
                      </Td>
                      {metricColumns.map((m) => (
                        <Td key={m.slug} />
                      ))}
                      <Td className="sticky right-0 bg-white dark:bg-paper-2 border-l border-line" />
                    </tr>
                  ))}
                </>
              )}

              {/* Grand total */}
              <tr className="bg-ink text-white font-semibold">
                <Td className="uppercase tracking-[0.06em] text-[10px]">
                  Total media + fees
                </Td>
                <Td colSpan={6} />
                <Td className="text-right font-mono tabular-nums">
                  {formatUsd(detail.totals.grand)}
                </Td>
                {metricColumns.map((m) => (
                  <Td key={m.slug} />
                ))}
                <Td className="sticky right-0 bg-ink border-l border-ink-2" />
              </tr>
            </tbody>
          </table>
        </div>

        {/* ── Footer: cierre del QA ──────────────────────────────────────── */}
        <div className="shrink-0 border-t border-line px-5 py-3.5 bg-paper-2/60">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex-1 min-w-[240px]">
              <label
                htmlFor="qa-notes"
                className="block text-[10px] font-medium uppercase tracking-[0.08em] text-muted mb-1"
              >
                Observaciones del QA (opcional)
              </label>
              <input
                id="qa-notes"
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ej: creativos pendientes de swap en Meta, resto OK"
                className="w-full rounded-md border border-line bg-white dark:bg-paper px-3 py-1.5 text-sm text-ink placeholder:text-muted/70"
              />
            </div>

            <div className="flex items-center gap-3">
              {serverChecked != null && serverChecked > done && (
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex items-center gap-1 text-xs text-info hover:underline underline-offset-2"
                  title="Otro usuario está controlando este mismo plan. Cerrá y volvé a abrir el QA para ver su progreso."
                >
                  <RefreshCw size={12} strokeWidth={2} />
                  Otro usuario controló {serverChecked - done} línea
                  {serverChecked - done === 1 ? "" : "s"} · actualizar
                </button>
              )}
              {!complete && (
                <>
                  <span className="text-xs text-warn font-medium">
                    Faltan {missing} línea{missing === 1 ? "" : "s"} por
                    controlar
                  </span>
                  <button
                    type="button"
                    onClick={scrollToFirstPending}
                    className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink underline-offset-2 hover:underline"
                  >
                    <ArrowDown size={12} strokeWidth={2} />
                    Ir a la primera pendiente
                  </button>
                </>
              )}
              <Button variant="secondary" onClick={onClose} disabled={pending}>
                Cerrar
              </Button>
              <button
                type="button"
                onClick={onComplete}
                disabled={!complete || pending}
                title={
                  complete
                    ? "Cerrar el QA: el plan pasa a QA realizado y se habilita marcarlo Live"
                    : `Tildá las ${missing} línea${missing === 1 ? "" : "s"} que faltan para habilitar el cierre del QA`
                }
                className="inline-flex items-center gap-1.5 rounded-md bg-success text-white px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {complete ? (
                  <Check size={15} strokeWidth={2.5} />
                ) : (
                  <ShieldCheck size={15} strokeWidth={2} />
                )}
                QA realizado
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Bits ────────────────────────────────────────────────────────────────────

function PublisherBlock({
  name,
  placementsTotalUsd,
  lineCount,
  doneCount,
  metricColumns,
  subtotals,
  children,
}: {
  name: string;
  placementsTotalUsd: number;
  lineCount: number;
  doneCount: number;
  metricColumns: MetricMeta[];
  subtotals: Record<string, number>;
  children: React.ReactNode;
}) {
  const allDone = lineCount > 0 && doneCount === lineCount;
  return (
    <>
      <tr className="bg-paper-2 border-y border-line">
        <Td className="font-semibold text-[13px] text-ink">
          <span className="inline-flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-accent" />
            {name}
          </span>
        </Td>
        <Td colSpan={5} className="text-muted">
          {lineCount} placement{lineCount === 1 ? "" : "s"}
        </Td>
        <Td className="text-[10px] uppercase tracking-[0.06em] text-muted">
          subtotal
        </Td>
        <Td className="text-right font-mono tabular-nums font-semibold">
          {formatUsd(placementsTotalUsd)}
        </Td>
        {metricColumns.map((m) => (
          <Td key={m.slug} className="text-right font-mono tabular-nums text-muted">
            {m.kind === "direct"
              ? (subtotals[m.slug] ?? 0).toLocaleString("en-US")
              : ""}
          </Td>
        ))}
        <Td className="text-center sticky right-0 bg-paper-2 border-l border-line">
          <span
            className={`font-mono text-[10px] font-semibold ${allDone ? "text-success" : "text-muted"}`}
          >
            {doneCount}/{lineCount}
          </span>
        </Td>
      </tr>
      {children}
    </>
  );
}

function Th({
  children,
  className = "",
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.06em] ${className}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
  colSpan,
}: {
  children?: React.ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td colSpan={colSpan} className={`px-3 py-1.5 align-top ${className}`}>
      {children}
    </td>
  );
}

function Meta({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.06em] text-muted">
        {label}
      </span>
      <span className="font-mono text-ink-2">{children}</span>
    </span>
  );
}
