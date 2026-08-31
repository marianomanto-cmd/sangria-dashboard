"use client";

// ════════════════════════════════════════════════════════════════════════════
// Modal de QA DE PLANIFICACIÓN — el control del media planner antes de firma.
//
// Se abre al apretar "Marcar listo para enviar" (después de que readiness y el
// gate de adsets pasen) y muestra, agrupado por publisher, cada PLACEMENT con
// sus ADSETS anidados. Una casilla por cada uno: con todo tildado, el botón de
// abajo cierra el QA y hace el pase a `ready_to_send` en una sola acción.
//
// Es hermano de qa-modal.tsx (el QA de armado, del AM/PM) y comparte sus
// decisiones de diseño, por las mismas razones:
//   • No hay "marcar todas": tildar es el acto de controlar.
//   • Cada tilde se persiste solo (media_plan_planning_qa_checks) con quién y
//     cuándo → el progreso sobrevive a cerrar el modal. La UI es optimista y
//     revierte si el server rechaza.
//   • "Ir al primero pendiente" para no perderse en planes largos.
//   • La barrera real está en `completePlanningQa` + `transitionPlanStatus`.
//
// Lo que cambia respecto del otro: acá se tildan DOS tipos de cosa (la línea
// del plan y cada adset), así que la clave es `kind:id`, no el id solo.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ArrowDown, ClipboardCheck, Layers, X } from "lucide-react";
import {
  completePlanningQa,
  setPlanningQaCheck,
} from "@/app/actions/plan-planning-qa";
import { Button } from "@/components/button";
import { useToast } from "@/components/toast";
import type { PlanTrafficPlacement } from "@/db/queries/plan-traffic";
import type { PlanningQaCheck } from "@/db/queries/plan-planning-qa";
import { formatUsd } from "@/lib/format";
import { formatDate, type Language } from "@/lib/i18n";
import {
  buildPlanningQaItems,
  computePlanningQaProgress,
  planningQaKey,
  type PlanningQaItemKind,
} from "@/lib/plan-planning-qa";

export function PlanningQaModal({
  planId,
  planName,
  projectCode,
  nextVersion,
  rows,
  initialChecks,
  lang,
  onClose,
  onDone,
}: {
  planId: string;
  planName: string;
  projectCode: string;
  // La versión que este draft va a ser al aprobarse (current + 1).
  nextVersion: number;
  // Los placements del plan con sus adsets — la misma lectura que alimenta la
  // ventana de Tráfico, así el planner ve exactamente lo que cargó.
  rows: PlanTrafficPlacement[];
  initialChecks: PlanningQaCheck[];
  lang: Language;
  onClose: () => void;
  // Se llama cuando el QA se cerró y el plan YA pasó a ready_to_send.
  onDone: () => void;
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(initialChecks.map((c) => planningQaKey(c.itemKind, c.itemId))),
  );
  const [saving, setSaving] = useState<Set<string>>(() => new Set());
  const [notes, setNotes] = useState("");

  // Los ítems, con la MISMA función que usa el server para contarlos.
  const items = useMemo(
    () =>
      buildPlanningQaItems(
        rows.map((r) => ({
          placementId: r.placementId,
          publisherName: r.publisherName,
          placementName: r.placementName,
          adsets: (r.brief?.adsets ?? []).map((a) => ({ id: a.id, name: a.name })),
        })),
      ),
    [rows],
  );

  const progress = useMemo(
    () => computePlanningQaProgress(items, checked),
    [items, checked],
  );

  // Dónde va el rótulo del publisher: en la primera fila de cada bloque. Se
  // precomputa en vez de llevar un `let` mutado durante el render — las filas
  // ya vienen ordenadas por publisher desde getPlanTraffic.
  const showPublisherAt = useMemo(() => {
    const flags = new Set<string>();
    let last: string | null = null;
    for (const r of rows) {
      if (r.publisherName !== last) flags.add(r.placementId);
      last = r.publisherName;
    }
    return flags;
  }, [rows]);
  const pct = progress.total > 0 ? (progress.checked / progress.total) * 100 : 0;

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
  // avisa: nunca queda algo "controlado" en pantalla que no lo esté en la base
  // (sería exactamente el error humano que este modal viene a evitar).
  const toggle = async (
    kind: PlanningQaItemKind,
    id: string,
    next: boolean,
  ) => {
    const key = planningQaKey(kind, id);
    setChecked((prev) => {
      const s = new Set(prev);
      if (next) s.add(key);
      else s.delete(key);
      return s;
    });
    setSaving((prev) => new Set(prev).add(key));

    const r = await setPlanningQaCheck({
      planId,
      itemKind: kind,
      itemId: id,
      checked: next,
    });

    setSaving((prev) => {
      const s = new Set(prev);
      s.delete(key);
      return s;
    });

    if (!r.ok) {
      setChecked((prev) => {
        const s = new Set(prev);
        if (next) s.delete(key);
        else s.add(key);
        return s;
      });
      toast.error(r.error);
    }
  };

  const scrollToFirstPending = () => {
    const first = items.find((i) => !checked.has(planningQaKey(i.kind, i.id)));
    if (!first) return;
    const key = planningQaKey(first.kind, first.id);
    scrollRef.current
      ?.querySelector(`[data-pqa-row="${key}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    (
      scrollRef.current?.querySelector(
        `[data-pqa-check="${key}"]`,
      ) as HTMLInputElement | null
    )?.focus();
  };

  const onComplete = () => {
    startTransition(async () => {
      const r = await completePlanningQa({ planId, notes });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(
        `QA de planificación hecho · ${progress.placements} placement${
          progress.placements === 1 ? "" : "s"
        } y ${progress.adsets} adset${
          progress.adsets === 1 ? "" : "s"
        } controlados · plan listo para enviar`,
      );
      onDone();
    });
  };

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
        aria-labelledby="planning-qa-title"
        className="relative w-full max-w-[1280px] max-h-[94vh] flex flex-col rounded-lg border border-line bg-white dark:bg-paper-2 shadow-[var(--shadow-card-hover)] animate-dialog-in overflow-hidden"
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="shrink-0 border-b border-line px-5 py-3.5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold tracking-[0.16em] uppercase text-accent">
                QA de planificación · v{nextVersion}
              </p>
              <h2
                id="planning-qa-title"
                className="text-lg font-semibold text-ink mt-0.5 truncate"
              >
                {projectCode}.{planName}
              </h2>
              <p className="text-xs text-muted mt-0.5">
                Repasá lo que cargaste antes de congelar el plan y mandarlo a
                firma. Tildá cada{" "}
                <strong className="font-medium text-ink-2">placement</strong> y
                cada <strong className="font-medium text-ink-2">adset</strong>:
                con todo tildado, el plan queda listo para enviar.
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

          {/* Progreso, separado por tipo: son dos cosas distintas de mirar. */}
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
            <Meta label="Placements">
              <span className="font-mono tabular-nums">
                {progress.placementsChecked}/{progress.placements}
              </span>
            </Meta>
            <Meta label="Adsets">
              <span className="font-mono tabular-nums">
                {progress.adsetsChecked}/{progress.adsets}
              </span>
            </Meta>
            <div className="ml-auto flex items-center gap-2.5">
              <div
                className="h-1.5 w-32 rounded-full bg-line overflow-hidden"
                role="progressbar"
                aria-valuenow={progress.checked}
                aria-valuemin={0}
                aria-valuemax={progress.total}
                aria-label="Ítems controlados"
              >
                <div
                  className={`h-full rounded-full transition-all ${
                    progress.complete ? "bg-success" : "bg-accent"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span
                className={`font-mono tabular-nums font-semibold ${
                  progress.complete ? "text-success" : "text-ink"
                }`}
              >
                {progress.checked}/{progress.total}
              </span>
            </div>
          </div>
        </div>

        {/* ── Lista: placement con sus adsets anidados ───────────────────── */}
        <div ref={scrollRef} className="flex-1 overflow-auto px-5 py-4">
          <div className="flex flex-col gap-3">
            {rows.map((row) => {
              const plKey = planningQaKey("placement", row.placementId);
              const plChecked = checked.has(plKey);
              const adsets = row.brief?.adsets ?? [];
              const showPublisher = showPublisherAt.has(row.placementId);

              return (
                <div key={row.placementId}>
                  {showPublisher && (
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted mt-2 mb-1.5">
                      {row.publisherName}
                    </p>
                  )}
                  <div
                    className={`rounded-lg border transition-colors ${
                      plChecked
                        ? "border-success/40 bg-success-soft/40"
                        : "border-line bg-paper/40"
                    }`}
                  >
                    {/* Línea del plan */}
                    <div
                      data-pqa-row={plKey}
                      className="flex items-start gap-3 px-4 py-3"
                    >
                      <CheckBox
                        dataKey={plKey}
                        checked={plChecked}
                        disabled={saving.has(plKey) || pending}
                        onChange={(v) => toggle("placement", row.placementId, v)}
                        label={`Controlado — ${row.publisherName} · ${
                          row.placementName ?? "placement sin nombre"
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-ink">
                          {(row.placementName ?? "").trim() || (
                            <span className="italic text-muted">
                              (placement sin nombre)
                            </span>
                          )}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
                          <Fact label="Mercado">{row.marketName ?? "—"}</Fact>
                          <Fact label="Monto">{formatUsd(row.amountUsd)}</Fact>
                          <Fact label="Método">{row.costMethod ?? "—"}</Fact>
                          <Fact label="Fechas">
                            {formatDate(row.startDate, lang)}
                            <span className="text-line"> → </span>
                            {formatDate(row.endDate, lang)}
                          </Fact>
                          {row.audience && (
                            <Fact label="Audiencia">{row.audience}</Fact>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Adsets del placement */}
                    {adsets.length > 0 && (
                      <div className="border-t border-line-soft/70 pl-4">
                        {adsets.map((a, i) => {
                          const key = planningQaKey("adset", a.id);
                          const isChecked = checked.has(key);
                          return (
                            <div
                              key={a.id}
                              data-pqa-row={key}
                              className={`flex items-start gap-3 border-l-2 pl-4 pr-4 py-2.5 ${
                                isChecked
                                  ? "border-success/50 bg-success-soft/30"
                                  : "border-line"
                              } ${i > 0 ? "border-t border-t-line-soft/70" : ""}`}
                            >
                              <CheckBox
                                dataKey={key}
                                checked={isChecked}
                                disabled={saving.has(key) || pending}
                                onChange={(v) => toggle("adset", a.id, v)}
                                label={`Controlado — adset ${i + 1} de ${
                                  row.placementName ?? "placement sin nombre"
                                }`}
                              />
                              <div className="min-w-0 flex-1">
                                <p className="text-[13px] font-medium text-ink-2 flex items-center gap-1.5">
                                  <Layers
                                    size={12}
                                    strokeWidth={2}
                                    className="text-muted shrink-0"
                                  />
                                  {(a.name ?? "").trim() || `Adset ${i + 1}`}
                                </p>
                                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
                                  <Fact label="Audiencia">
                                    {a.audience ?? "—"}
                                  </Fact>
                                  <Fact label="Budget">
                                    {a.budgetUsd == null
                                      ? "—"
                                      : formatUsd(a.budgetUsd)}
                                  </Fact>
                                  <Fact label="Pilar">
                                    {a.creativePillar ?? "—"}
                                  </Fact>
                                  <Fact label="Fechas">
                                    {formatDate(a.startDate, lang)}
                                    <span className="text-line"> → </span>
                                    {formatDate(a.endDate, lang)}
                                  </Fact>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Footer: cierre del QA + pase ───────────────────────────────── */}
        <div className="shrink-0 border-t border-line px-5 py-3.5 bg-paper-2/60">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex-1 min-w-[240px]">
              <label
                htmlFor="planning-qa-notes"
                className="block text-[10px] font-medium uppercase tracking-[0.08em] text-muted mb-1"
              >
                Observaciones del QA (opcional)
              </label>
              <input
                id="planning-qa-notes"
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ej: fechas confirmadas con el cliente, budget de Meta a revisar en la v2"
                className="w-full rounded-md border border-line bg-white dark:bg-paper px-3 py-1.5 text-sm text-ink placeholder:text-muted/70"
              />
            </div>
            <div className="flex items-center gap-3">
              {!progress.complete && (
                <button
                  type="button"
                  onClick={scrollToFirstPending}
                  className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink px-2 py-1.5"
                >
                  <ArrowDown size={13} strokeWidth={2} />
                  Ir al primero pendiente
                </button>
              )}
              <span
                className={`text-xs ${
                  progress.complete ? "text-success font-medium" : "text-muted"
                }`}
              >
                {progress.complete
                  ? "Todo controlado"
                  : `Faltan ${progress.missing}`}
              </span>
              <Button
                onClick={onComplete}
                disabled={!progress.complete || pending}
              >
                <ClipboardCheck size={14} strokeWidth={2} />
                Marcar listo para enviar
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Piezas ──────────────────────────────────────────────────────────────────

function CheckBox({
  dataKey,
  checked,
  disabled,
  onChange,
  label,
}: {
  dataKey: string;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <input
      type="checkbox"
      data-pqa-check={dataKey}
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      aria-label={label}
      className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-success)] cursor-pointer disabled:opacity-50"
    />
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <span>
      <span className="uppercase tracking-[0.08em] text-[9.5px] text-muted/80">
        {label}
      </span>{" "}
      <span className="text-ink-2">{children}</span>
    </span>
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
    <span className="flex items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.08em] text-muted">
        {label}
      </span>
      <span className="text-ink-2">{children}</span>
    </span>
  );
}
