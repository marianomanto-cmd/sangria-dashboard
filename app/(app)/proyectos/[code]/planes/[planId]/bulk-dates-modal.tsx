"use client";

// ════════════════════════════════════════════════════════════════════════════
// Modal de cambio masivo de fechas — mueve el inicio y/o el fin de TODAS las
// líneas del plan de una sola vez. Antes había que abrir el inspector línea
// por línea: en un plan de 40 placements, 80 fechas a mano.
//
// El planner elige qué extremo cambiar (solo inicio, solo fin o ambos): cada
// fecha tiene su checkbox, y la que queda destildada NO se toca. No se pueden
// vaciar fechas desde acá — un placement sin fechas se cae del prorrateo
// mensual (lib/budget-split.ts), así que borrar en masa sería una forma
// silenciosa de perder plata del estimado.
//
// El modal muestra ANTES de aplicar: qué fechas tienen hoy las líneas, cómo
// quedan, y qué implica el cambio en el lifecycle (el plan es un borrador de
// la v(N+1): al aprobarlo hay que rehacer el QA antes de Live).
//
// Rango invertido: si se aplica un solo extremo puede quedar fin < inicio en
// algunas líneas. Se detecta acá para avisar con nombre y apellido antes de
// mandar; la barrera real está en `bulkUpdatePlacementDates`.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AlertTriangle, CalendarRange, X } from "lucide-react";
import { bulkUpdatePlacementDates } from "@/app/actions/plans";
import { Button } from "@/components/button";
import { useToast } from "@/components/toast";
import type { PlanDetail } from "@/db/queries/project-detail";
import { formatDate, type Language } from "@/lib/i18n";

export function BulkDatesModal({
  detail,
  lang,
  onClose,
  onDone,
}: {
  detail: PlanDetail;
  lang: Language;
  onClose: () => void;
  // Se llama después de un cambio aplicado con éxito (el editor refresca).
  onDone: () => void;
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);

  const placements = useMemo(
    () => detail.publishers.flatMap((p) => p.placements),
    [detail.publishers],
  );

  // Estado del formulario: un checkbox + una fecha por extremo.
  const [applyStart, setApplyStart] = useState(true);
  const [applyEnd, setApplyEnd] = useState(true);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // ── a11y: Escape cierra, focus-trap, scroll-lock, foco inicial/restaurado ──
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
      return;
    }
    if (e.key === "Tab") {
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, input, [href], select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables || focusables.length === 0) return;
      const list = Array.from(focusables).filter((el) => !el.hasAttribute("disabled"));
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  // ── Estado actual de las fechas, para que el planner vea de dónde parte ──
  const currentStarts = summarize(placements.map((p) => p.startDate));
  const currentEnds = summarize(placements.map((p) => p.endDate));

  const nextStart = applyStart && startDate ? startDate : null;
  const nextEnd = applyEnd && endDate ? endDate : null;

  // ── Validación (espejo de la server action) ───────────────────────────────
  const nothingSelected = !applyStart && !applyEnd;
  const missingDate =
    (applyStart && !startDate) || (applyEnd && !endDate);
  const bothInverted = !!nextStart && !!nextEnd && nextEnd < nextStart;

  // Con un solo extremo aplicado, el otro queda como está en cada línea: hay
  // que chequear placement por placement que no quede fin < inicio.
  const wouldInvert = useMemo(() => {
    if (bothInverted) return [];
    if (!nextStart && !nextEnd) return [];
    return placements.filter((p) => {
      const s = nextStart ?? p.startDate;
      const e = nextEnd ?? p.endDate;
      return !!s && !!e && e < s;
    });
  }, [placements, nextStart, nextEnd, bothInverted]);

  // Cuántas líneas cambian de verdad (las que ya tienen la fecha destino no
  // cuentan) — es lo que dice el botón para que no haya sorpresas.
  const changing = placements.filter(
    (p) =>
      (nextStart !== null && p.startDate !== nextStart) ||
      (nextEnd !== null && p.endDate !== nextEnd),
  ).length;

  const blocked =
    nothingSelected ||
    missingDate ||
    bothInverted ||
    wouldInvert.length > 0 ||
    placements.length === 0;

  const onApply = () => {
    if (blocked) return;
    startTransition(async () => {
      const r = await bulkUpdatePlacementDates({
        planId: detail.plan.id,
        ...(nextStart ? { startDate: nextStart } : {}),
        ...(nextEnd ? { endDate: nextEnd } : {}),
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(
        r.updated === 0
          ? "Las líneas ya tenían esas fechas — no hubo cambios"
          : `Fechas actualizadas en ${r.updated} de ${r.total} placement${r.total === 1 ? "" : "s"}`,
      );
      onDone();
      onClose();
    });
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      onKeyDown={onKeyDown}
    >
      <div
        className="absolute inset-0 bg-ink/50 backdrop-blur-[2px] animate-fade-in"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-dates-title"
        className="relative w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-lg border border-line bg-white dark:bg-paper-2 shadow-[var(--shadow-card-hover)] animate-dialog-in"
      >
        {/* ── Header ───────────────────────────────────────────────────────── */}
        <div className="border-b border-line px-5 py-3.5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-[0.16em] uppercase text-accent">
              Fechas del plan
            </p>
            <h2
              id="bulk-dates-title"
              className="text-lg font-semibold text-ink mt-0.5"
            >
              Cambiar las fechas de todos los placements
            </h2>
            <p className="text-xs text-muted mt-0.5">
              Un solo cambio para las {placements.length} línea
              {placements.length === 1 ? "" : "s"} del plan. Elegí qué fecha
              mover: la que dejes destildada no se toca.
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

        <div className="px-5 py-4 space-y-4">
          {/* ── De dónde parte ────────────────────────────────────────────── */}
          <div className="rounded-md border border-line-soft bg-paper/60 px-4 py-3 grid grid-cols-2 gap-3">
            <Current label="Inicio actual" summary={currentStarts} lang={lang} />
            <Current label="Fin actual" summary={currentEnds} lang={lang} />
          </div>

          {/* ── Las dos fechas nuevas ─────────────────────────────────────── */}
          <DateRow
            id="bulk-start"
            label="Nueva fecha de inicio"
            checked={applyStart}
            onCheck={setApplyStart}
            value={startDate}
            onValue={setStartDate}
            disabled={pending}
          />
          <DateRow
            id="bulk-end"
            label="Nueva fecha de fin"
            checked={applyEnd}
            onCheck={setApplyEnd}
            value={endDate}
            onValue={setEndDate}
            disabled={pending}
            min={applyStart && startDate ? startDate : undefined}
          />

          {/* ── Avisos ───────────────────────────────────────────────────── */}
          {bothInverted && (
            <Warn>
              La fecha de fin ({formatDate(nextEnd, lang)}) es anterior a la de
              inicio ({formatDate(nextStart, lang)}).
            </Warn>
          )}

          {!bothInverted && wouldInvert.length > 0 && (
            <Warn>
              {nextStart ? (
                <>
                  Ese inicio queda <strong className="font-semibold">después</strong>{" "}
                  del fin de {wouldInvert.length} placement
                  {wouldInvert.length === 1 ? "" : "s"} ({names(wouldInvert)}).
                  Cambiá también la fecha de fin.
                </>
              ) : (
                <>
                  Ese fin queda <strong className="font-semibold">antes</strong>{" "}
                  del inicio de {wouldInvert.length} placement
                  {wouldInvert.length === 1 ? "" : "s"} ({names(wouldInvert)}).
                  Cambiá también la fecha de inicio.
                </>
              )}
            </Warn>
          )}

          {/* Qué implica el cambio. El período del plan y del proyecto se
              DERIVAN de estas fechas, y el prorrateo mensual del billing sale
              de acá: no es un cambio cosmético. */}
          <div className="rounded-md border border-info-soft bg-info-soft/50 px-4 py-3 text-xs text-ink-2 leading-relaxed">
            <p>
              El período del plan y del proyecto se derivan de estas fechas, y
              el prorrateo mensual del billing y de la estimación se recalcula
              con ellas.
            </p>
            {detail.plan.currentVersion > 0 && (
              <p className="mt-1.5">
                Estás editando el borrador de la{" "}
                <strong className="font-semibold text-ink">
                  v{detail.plan.currentVersion + 1}
                </strong>
                : al aprobarlo se congela una versión nueva y hay que{" "}
                <strong className="font-semibold text-ink">rehacer el QA</strong>{" "}
                antes de volver a marcar el plan Live.
              </p>
            )}
          </div>
        </div>

        {/* ── Footer ───────────────────────────────────────────────────────── */}
        <div className="border-t border-line px-5 py-3.5 flex items-center justify-between gap-3">
          <p className="text-xs text-muted">
            {placements.length === 0
              ? "El plan no tiene placements."
              : blocked
                ? nothingSelected
                  ? "Tildá al menos una fecha."
                  : missingDate
                    ? "Completá la fecha que vas a cambiar."
                    : "Corregí las fechas para poder aplicar."
                : changing === 0
                  ? "Las líneas ya tienen esas fechas."
                  : `Se actualizan ${changing} de ${placements.length} línea${placements.length === 1 ? "" : "s"}.`}
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button size="md" onClick={onApply} disabled={blocked || pending}>
              <CalendarRange size={14} strokeWidth={2} />
              {pending ? "Cambiando…" : "Cambiar"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Piezas ──────────────────────────────────────────────────────────────────

function DateRow({
  id,
  label,
  checked,
  onCheck,
  value,
  onValue,
  disabled,
  min,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheck: (v: boolean) => void;
  value: string;
  onValue: (v: string) => void;
  disabled: boolean;
  min?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <label
        htmlFor={id}
        className="flex items-center gap-2 text-sm font-medium text-ink flex-1 min-w-0 cursor-pointer"
      >
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onCheck(e.target.checked)}
          className="h-4 w-4 accent-[var(--color-accent)] cursor-pointer disabled:opacity-50"
        />
        <span className={checked ? "" : "text-muted"}>{label}</span>
      </label>
      <input
        type="date"
        value={value}
        min={min}
        disabled={disabled || !checked}
        onChange={(e) => onValue(e.target.value)}
        aria-label={label}
        className="w-44 rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-1.5 font-mono text-sm focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft disabled:opacity-40"
      />
    </div>
  );
}

function Current({
  label,
  summary,
  lang,
}: {
  label: string;
  summary: DateSummary;
  lang: Language;
}) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
        {label}
      </p>
      <p className="font-mono text-sm text-ink-2 mt-0.5">
        {summary.kind === "none" ? (
          <span className="text-muted">sin fechas</span>
        ) : summary.kind === "single" ? (
          formatDate(summary.min, lang)
        ) : (
          <>
            {formatDate(summary.min, lang)}
            <span className="text-line"> … </span>
            {formatDate(summary.max, lang)}
          </>
        )}
      </p>
      <p className="text-[10px] text-muted mt-0.5">
        {summary.kind === "none"
          ? `${summary.blanks} línea${summary.blanks === 1 ? "" : "s"} sin cargar`
          : summary.kind === "single"
            ? `todas las líneas${summary.blanks > 0 ? ` (${summary.blanks} sin cargar)` : ""}`
            : `${summary.distinct} fechas distintas${summary.blanks > 0 ? ` · ${summary.blanks} sin cargar` : ""}`}
      </p>
    </div>
  );
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-warn-soft bg-warn-soft/50 px-3.5 py-2.5 text-xs text-warn leading-relaxed"
    >
      <AlertTriangle size={14} strokeWidth={2} className="shrink-0 mt-0.5" />
      <span>{children}</span>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

type DateSummary =
  | { kind: "none"; min: null; max: null; distinct: 0; blanks: number }
  | { kind: "single"; min: string; max: string; distinct: 1; blanks: number }
  | { kind: "mixed"; min: string; max: string; distinct: number; blanks: number };

function summarize(dates: (string | null)[]): DateSummary {
  const set = [...new Set(dates.filter((d): d is string => !!d))].sort();
  const blanks = dates.length - dates.filter(Boolean).length;
  if (set.length === 0) return { kind: "none", min: null, max: null, distinct: 0, blanks };
  if (set.length === 1)
    return { kind: "single", min: set[0], max: set[0], distinct: 1, blanks };
  return {
    kind: "mixed",
    min: set[0],
    max: set[set.length - 1],
    distinct: set.length,
    blanks,
  };
}

function names(placements: { placementName: string }[]): string {
  const shown = placements
    .slice(0, 3)
    .map((p) => `“${p.placementName}”`)
    .join(", ");
  return placements.length > 3
    ? `${shown} y ${placements.length - 3} más`
    : shown;
}
