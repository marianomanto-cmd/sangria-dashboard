"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { CalendarReport } from "@/db/queries/reports";
import { getArgentineHolidaysForYears } from "@/lib/holidays-ar";
import { formatDate, shortMonthName, type Language } from "@/lib/i18n";

// ════════════════════════════════════════════════════════════════════════════
// Reporting Gantt — ventana de 60 días centrada en hoy (-30 / +30).
// Una fila por reporte "en curso" (delivery_date asignada, no delivered).
//
// Símbolos por fila:
//   ● gris  → closed_at (día en que el proyecto pasó a closed)
//   ■ violeta → delivery_date_assigned_at (día en que el manager asignó la
//                fecha de entrega; se re-escribe en cada cambio)
//   ◆ accent → delivery_date (target de entrega)
//   línea horizontal punteada entre ■ y ◆ (compromiso)
//   línea horizontal roja entre ◆ y hoy SI hoy > delivery_date (atraso)
//
// Línea vertical: hoy, punteada azul suave.
//
// Símbolos que caen fuera del rango -30/+30 se renderizan como flechita
// (◄ izquierda, ► derecha) en el borde, con tooltip con la fecha real.
// ════════════════════════════════════════════════════════════════════════════

const WINDOW_BEFORE_DAYS = 30;
const WINDOW_AFTER_DAYS = 30;
const TOTAL_DAYS = WINDOW_BEFORE_DAYS + WINDOW_AFTER_DAYS;

const ROW_H = 44;
const LABEL_W = 260;

const COLOR_CLOSED = "#9CA3AF";       // gris
const COLOR_ASSIGNED = "#7C3AED";     // violeta
const COLOR_TARGET = "#7a1f3d";       // accent
const COLOR_LATE = "#DC2626";         // rojo
const COLOR_TODAY = "#3B82F6";        // azul
const COLOR_WEEKEND_BG = "#F1F5F9";   // slate-100 — banda de fin de semana
const COLOR_DAY_TICK = "#E5E7EB";     // gray-200 — tick diario
const COLOR_WEEK_TICK = "#94A3B8";    // slate-400 — tick semanal (lunes)

export function ReportingGantt({
  reports,
  lang,
  onAssignDate,
  onMarkDelivered,
}: {
  reports: CalendarReport[];
  lang: Language;
  onAssignDate: (reportId: string, current: string | null) => void;
  onMarkDelivered: (reportId: string) => void;
}) {
  // Ventana fija basada en "hoy" del cliente. Se calcula en render (client),
  // así si el usuario deja la pestaña abierta varios días y recarga, se
  // re-centra solo.
  const today = useMemo(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }, []);
  const windowStart = useMemo(() => addDays(today, -WINDOW_BEFORE_DAYS), [today]);
  const windowEnd = useMemo(() => addDays(today, WINDOW_AFTER_DAYS), [today]);

  // Markers de meses: el primer día de cada mes que cae dentro de la ventana.
  const monthMarkers = useMemo(() => {
    const out: { label: string; pct: number }[] = [];
    const c = new Date(windowStart.getFullYear(), windowStart.getMonth(), 1);
    while (c <= windowEnd) {
      const offset = daysBetween(windowStart, c);
      if (offset >= 0 && offset <= TOTAL_DAYS) {
        out.push({
          label: `${shortMonthName(c.getMonth(), lang)} ${String(c.getFullYear()).slice(2)}`,
          pct: (offset / TOTAL_DAYS) * 100,
        });
      }
      c.setMonth(c.getMonth() + 1);
    }
    return out;
  }, [windowStart, windowEnd, lang]);

  // Set de feriados argentinos para los años que cubre la ventana. La ventana
  // puede cruzar año (ej. Dec → Feb), por eso pedimos ambos endpoints.
  const holidaySet = useMemo(
    () =>
      getArgentineHolidaysForYears([
        windowStart.getFullYear(),
        windowEnd.getFullYear(),
      ]),
    [windowStart, windowEnd],
  );

  // Eje de días: para cada día de la ventana, dejamos un tick. Los lunes
  // ganan un tick más marcado + label "18 may" / "May 18". Sábados,
  // domingos y feriados AR se marcan como "off days" para pintar el fondo.
  const dayTicks = useMemo(() => {
    const out: {
      offset: number;
      isWeekend: boolean;
      isHoliday: boolean;
      isOff: boolean;
      isMonday: boolean;
      isFirstOfMonth: boolean;
      label?: string;
    }[] = [];
    for (let i = 0; i <= TOTAL_DAYS; i++) {
      const d = addDays(windowStart, i);
      const dow = d.getDay(); // 0=Sun, 1=Mon ... 6=Sat
      const isWeekend = dow === 0 || dow === 6;
      const isHoliday = holidaySet.has(toISO(d));
      const isMonday = dow === 1;
      const isFirstOfMonth = d.getDate() === 1;
      let label: string | undefined;
      if (isMonday) {
        const monthShort = shortMonthName(d.getMonth(), lang);
        label =
          lang === "es"
            ? `${d.getDate()} ${monthShort.toLowerCase()}`
            : `${monthShort} ${d.getDate()}`;
      }
      out.push({
        offset: i,
        isWeekend,
        isHoliday,
        isOff: isWeekend || isHoliday,
        isMonday,
        isFirstOfMonth,
        label,
      });
    }
    return out;
  }, [windowStart, lang, holidaySet]);

  // Pre-computamos los rangos contiguos de off-days (fin de semana o feriado
  // AR) como bandas en porcentaje. Un feriado entre semana queda como banda
  // aislada; un viernes feriado se une con el sábado+domingo en una banda
  // de 3 días.
  const offDayBands = useMemo(() => {
    const bands: { leftPct: number; widthPct: number }[] = [];
    let i = 0;
    while (i <= TOTAL_DAYS) {
      if (dayTicks[i]?.isOff) {
        const start = i;
        while (i <= TOTAL_DAYS && dayTicks[i]?.isOff) i++;
        const len = i - start;
        bands.push({
          leftPct: (start / TOTAL_DAYS) * 100,
          widthPct: (len / TOTAL_DAYS) * 100,
        });
      } else {
        i++;
      }
    }
    return bands;
  }, [dayTicks]);

  if (reports.length === 0) {
    return (
      <div className="rounded-lg border border-line border-dashed bg-paper-2 px-5 py-12 text-center text-sm text-muted">
        {lang === "es"
          ? "Sin reportes en curso. Asigná fechas a los proyectos cerrados de la tabla de arriba."
          : "No reports in progress. Assign delivery dates to the closed projects above."}
      </div>
    );
  }

  const todayPct = (WINDOW_BEFORE_DAYS / TOTAL_DAYS) * 100;

  return (
    <section className="rounded-lg border border-line bg-white dark:bg-paper-2 p-5">
      {/* Header eje — meses */}
      <div
        className="grid gap-3 mb-1"
        style={{ gridTemplateColumns: `${LABEL_W}px 1fr` }}
      >
        <div />
        <div className="relative h-5">
          {monthMarkers.map((m, i) => (
            <span
              key={i}
              className="absolute top-0 text-[10px] font-medium uppercase tracking-[0.06em] text-muted -translate-x-1/2"
              style={{ left: `${m.pct}%` }}
            >
              {m.label}
            </span>
          ))}
        </div>
      </div>

      {/* Header eje — días: ticks diarios + label en cada lunes */}
      <div
        className="grid gap-3 mb-2"
        style={{ gridTemplateColumns: `${LABEL_W}px 1fr` }}
      >
        <div />
        <div className="relative h-7">
          {/* bandas de fin de semana en el header (para que el eje también se vea sombrado) */}
          {offDayBands.map((b, i) => (
            <div
              key={`off-${i}`}
              className="absolute top-0 bottom-0"
              style={{
                left: `${b.leftPct}%`,
                width: `${b.widthPct}%`,
                background: COLOR_WEEKEND_BG,
              }}
              aria-hidden
            />
          ))}
          {/* ticks diarios */}
          {dayTicks.map((t) => (
            <div
              key={`tick-${t.offset}`}
              className="absolute top-0"
              style={{
                left: `${(t.offset / TOTAL_DAYS) * 100}%`,
                height: t.isMonday ? "10px" : "5px",
                borderLeft: `1px solid ${
                  t.isMonday ? COLOR_WEEK_TICK : COLOR_DAY_TICK
                }`,
                opacity: t.isMonday ? 1 : 0.7,
              }}
              aria-hidden
            />
          ))}
          {/* labels de lunes */}
          {dayTicks
            .filter((t) => t.label)
            .map((t) => (
              <span
                key={`label-${t.offset}`}
                className="absolute text-[10px] tabular-nums text-muted -translate-x-1/2"
                style={{
                  left: `${(t.offset / TOTAL_DAYS) * 100}%`,
                  top: "12px",
                }}
              >
                {t.label}
              </span>
            ))}
        </div>
      </div>

      {/* Filas */}
      <div className="flex flex-col gap-1">
        {reports.map((r) => (
          <GanttRow
            key={r.reportId}
            report={r}
            lang={lang}
            today={today}
            windowStart={windowStart}
            todayPct={todayPct}
            offDayBands={offDayBands}
            dayTicks={dayTicks}
            onAssignDate={() => onAssignDate(r.reportId, r.deliveryDate)}
            onMarkDelivered={() => onMarkDelivered(r.reportId)}
          />
        ))}
      </div>

      {/* Leyenda */}
      <div className="mt-5 border-t border-line pt-3 flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full"
            style={{ background: COLOR_CLOSED }}
          />
          {lang === "es" ? "Cierre del proyecto" : "Project closed"}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block w-2.5 h-2.5"
            style={{ background: COLOR_ASSIGNED }}
          />
          {lang === "es" ? "Asignación de fecha" : "Date assigned"}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block w-2.5 h-2.5 rotate-45"
            style={{ background: COLOR_TARGET }}
          />
          {lang === "es" ? "Fecha de entrega" : "Delivery date"}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-[2px] w-6"
            style={{ background: COLOR_LATE }}
          />
          {lang === "es" ? "Atraso" : "Delay"}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-[14px] w-[1px] border-l border-dashed"
            style={{ borderColor: COLOR_TODAY }}
          />
          {lang === "es" ? "Hoy" : "Today"}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block w-4 h-3 rounded-sm"
            style={{ background: COLOR_WEEKEND_BG }}
          />
          {lang === "es"
            ? "Fin de semana o feriado AR"
            : "Weekend or AR holiday"}
        </span>
      </div>
    </section>
  );
}

function GanttRow({
  report,
  lang,
  today,
  windowStart,
  todayPct,
  offDayBands,
  dayTicks,
  onAssignDate,
  onMarkDelivered,
}: {
  report: CalendarReport;
  lang: Language;
  today: Date;
  windowStart: Date;
  todayPct: number;
  offDayBands: { leftPct: number; widthPct: number }[];
  dayTicks: {
    offset: number;
    isWeekend: boolean;
    isMonday: boolean;
    isFirstOfMonth: boolean;
    label?: string;
  }[];
  onAssignDate: () => void;
  onMarkDelivered: () => void;
}) {
  const closedAtDay = startOfDay(new Date(report.closedAt));
  const assignedAtDay = report.deliveryDateAssignedAt
    ? startOfDay(new Date(report.deliveryDateAssignedAt))
    : null;
  const deliveryDay = report.deliveryDate
    ? parseISODate(report.deliveryDate)
    : null;

  const closedOffset = daysBetween(windowStart, closedAtDay);
  const assignedOffset =
    assignedAtDay !== null ? daysBetween(windowStart, assignedAtDay) : null;
  const deliveryOffset =
    deliveryDay !== null ? daysBetween(windowStart, deliveryDay) : null;

  const closedPos = clampToWindow(closedOffset);
  const assignedPos =
    assignedOffset !== null ? clampToWindow(assignedOffset) : null;
  const deliveryPos =
    deliveryOffset !== null ? clampToWindow(deliveryOffset) : null;

  // El query ya filtra deliveredAt IS NULL, así que basta con comparar fechas.
  const isLate = deliveryDay !== null && today > deliveryDay;

  return (
    <div
      className="grid gap-3 items-center hover:bg-paper-2 rounded px-1 -mx-1 transition-colors"
      style={{ gridTemplateColumns: `${LABEL_W}px 1fr`, minHeight: ROW_H }}
    >
      {/* Label column */}
      <div className="min-w-0 py-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <Link
            href={`/proyectos/${report.projectCode}`}
            className="text-sm font-medium text-ink hover:text-accent truncate"
            title={report.projectName}
          >
            {report.projectName}
          </Link>
          {isLate && (
            <span className="inline-flex items-center text-[10px] font-semibold uppercase tracking-[0.06em] text-danger">
              {lang === "es" ? "atrasado" : "late"}
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted truncate">
          {report.clientName}
          <span className="text-line"> · </span>
          <span className="font-mono">{report.projectCode}</span>
        </p>
        <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5 text-[10px] text-muted">
          <span>
            {lang === "es" ? "Cierre" : "Closed"}: {formatDate(report.closedAt.slice(0, 10), lang)}
          </span>
          <span>
            {lang === "es" ? "Entrega" : "Delivery"}:{" "}
            {report.deliveryDate ? formatDate(report.deliveryDate, lang) : "—"}
          </span>
        </div>
        <div className="flex gap-1.5 mt-1">
          <button
            type="button"
            onClick={onAssignDate}
            className="text-[10px] font-medium uppercase tracking-[0.06em] text-muted hover:text-ink underline-offset-2 hover:underline"
          >
            {lang === "es" ? "Editar fecha" : "Edit date"}
          </button>
          <span className="text-line">·</span>
          <button
            type="button"
            onClick={onMarkDelivered}
            className="text-[10px] font-medium uppercase tracking-[0.06em] text-success hover:text-success underline-offset-2 hover:underline"
          >
            {lang === "es" ? "Entregado" : "Delivered"}
          </button>
        </div>
      </div>

      {/* Track */}
      <div className="relative overflow-hidden" style={{ height: ROW_H }}>
        {/* bandas de fin de semana (atrás de todo) */}
        {offDayBands.map((b, i) => (
          <div
            key={`off-${i}`}
            className="absolute top-0 bottom-0"
            style={{
              left: `${b.leftPct}%`,
              width: `${b.widthPct}%`,
              background: COLOR_WEEKEND_BG,
            }}
            aria-hidden
          />
        ))}
        {/* ticks de lunes (verticales suaves, encima de los weekend bands) */}
        {dayTicks
          .filter((t) => t.isMonday)
          .map((t) => (
            <div
              key={`mon-${t.offset}`}
              className="absolute top-0 bottom-0"
              style={{
                left: `${(t.offset / TOTAL_DAYS) * 100}%`,
                borderLeft: `1px solid ${COLOR_DAY_TICK}`,
                opacity: 0.7,
              }}
              aria-hidden
            />
          ))}
        {/* base line */}
        <div
          className="absolute left-0 right-0 top-1/2 -translate-y-1/2 border-t border-line-soft"
          aria-hidden
        />
        {/* hoy */}
        <div
          className="absolute top-1 bottom-1 border-l border-dashed"
          style={{ left: `${todayPct}%`, borderColor: COLOR_TODAY, opacity: 0.6 }}
          aria-hidden
        />

        {/* línea de compromiso (assigned → delivery) */}
        {assignedPos && deliveryPos && assignedPos.kind === "in" && deliveryPos.kind === "in" && (
          <div
            className="absolute top-1/2 -translate-y-1/2 border-t border-dashed"
            style={{
              left: `${Math.min(assignedPos.pct, deliveryPos.pct)}%`,
              width: `${Math.abs(deliveryPos.pct - assignedPos.pct)}%`,
              borderColor: COLOR_ASSIGNED,
              opacity: 0.5,
            }}
            aria-hidden
          />
        )}

        {/* línea de atraso (delivery → today) */}
        {isLate && deliveryPos && deliveryPos.kind === "in" && (
          <div
            className="absolute top-1/2 -translate-y-1/2 h-[2px]"
            style={{
              left: `${Math.min(deliveryPos.pct, todayPct)}%`,
              width: `${Math.abs(todayPct - deliveryPos.pct)}%`,
              background: COLOR_LATE,
            }}
            aria-hidden
          />
        )}

        {/* closed marker */}
        <Marker
          pos={closedPos}
          shape="circle"
          color={COLOR_CLOSED}
          title={`${lang === "es" ? "Cierre" : "Closed"}: ${formatDate(report.closedAt.slice(0, 10), lang)}`}
        />

        {/* assigned marker */}
        {assignedPos && (
          <Marker
            pos={assignedPos}
            shape="square"
            color={COLOR_ASSIGNED}
            title={`${lang === "es" ? "Asignada el" : "Assigned on"}: ${formatDate(
              (report.deliveryDateAssignedAt ?? "").slice(0, 10),
              lang,
            )}`}
          />
        )}

        {/* delivery marker */}
        {deliveryPos && (
          <Marker
            pos={deliveryPos}
            shape="diamond"
            color={isLate ? COLOR_LATE : COLOR_TARGET}
            title={`${lang === "es" ? "Entrega prevista" : "Delivery target"}: ${formatDate(
              report.deliveryDate ?? "",
              lang,
            )}`}
          />
        )}
      </div>
    </div>
  );
}

type Pos = { kind: "in"; pct: number } | { kind: "left" } | { kind: "right" };

function Marker({
  pos,
  shape,
  color,
  title,
}: {
  pos: Pos;
  shape: "circle" | "square" | "diamond";
  color: string;
  title: string;
}) {
  const size = 12;
  const common = {
    width: size,
    height: size,
    background: color,
  };
  const wrapStyle: React.CSSProperties = {
    position: "absolute",
    top: "50%",
    transform: "translate(-50%, -50%)",
  };

  if (pos.kind === "left") {
    return (
      <span
        title={title}
        className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-0 text-[10px] font-bold"
        style={{ color }}
      >
        ◄
      </span>
    );
  }
  if (pos.kind === "right") {
    return (
      <span
        title={title}
        className="absolute right-0 top-1/2 -translate-y-1/2 text-[10px] font-bold"
        style={{ color }}
      >
        ►
      </span>
    );
  }

  return (
    <span
      title={title}
      style={{ ...wrapStyle, left: `${pos.pct}%` }}
      className="inline-block"
    >
      <span
        aria-hidden
        className={
          shape === "circle"
            ? "block rounded-full"
            : shape === "square"
              ? "block"
              : "block rotate-45"
        }
        style={common}
      />
    </span>
  );
}

// ───── helpers ──────────────────────────────────────────────────────────────

function clampToWindow(dayOffset: number): Pos {
  if (dayOffset < 0) return { kind: "left" };
  if (dayOffset > TOTAL_DAYS) return { kind: "right" };
  return { kind: "in", pct: (dayOffset / TOTAL_DAYS) * 100 };
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseISODate(iso: string): Date | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(
    Number.parseInt(m[1], 10),
    Number.parseInt(m[2], 10) - 1,
    Number.parseInt(m[3], 10),
  );
}

