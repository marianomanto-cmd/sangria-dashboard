"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Activity,
  Banknote,
  CalendarClock,
  Check,
  Receipt,
  TriangleAlert,
} from "lucide-react";
import type { DashboardPendings } from "@/db/queries/pendings";
import { formatUsd } from "@/lib/format";
import { formatDate, formatMonth, type Language } from "@/lib/i18n";

type Tone = "warn" | "danger";

const TONE_BADGE: Record<Tone, string> = {
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
};

const TONE_ICON: Record<Tone, string> = {
  warn: "text-warn",
  danger: "text-danger",
};

// Cuántos ítems se muestran inline en cada card antes del "+N más".
const PREVIEW = 3;

export function PendingBoard({
  pendings,
  lang,
}: {
  pendings: DashboardPendings;
  lang: Language;
}) {
  const { billings, tracking, reportsUpcoming, reportsOverdue, invoices } =
    pendings;
  const es = lang === "es";
  const reportsCount = reportsUpcoming.length + reportsOverdue.length;
  const total =
    billings.length + tracking.length + reportsCount + invoices.length;
  const overdueInvoices = invoices.filter((i) => i.overdue).length;

  const billingRows: ReactNode[] = billings.map((b) => (
    <Row
      key={`${b.planId}:${b.month}`}
      href={`/proyectos/${b.projectCode}/planes/${b.planId}/billing`}
      primary={b.projectName}
      secondary={b.planName}
      right={
        <span className="font-mono text-warn">{formatMonth(b.month, lang)}</span>
      }
    />
  ));

  const trackingRows: ReactNode[] = tracking.map((t) => (
    <Row
      key={t.planId}
      href={`/campaign-tracker/${t.planId}`}
      primary={t.projectName}
      secondary={t.planName}
      right={
        <span className="text-muted text-[11px]">
          {t.lastCloseDate === null
            ? es
              ? "nunca"
              : "never"
            : es
              ? `hace ${t.daysSinceClose}d`
              : `${t.daysSinceClose}d ago`}
        </span>
      }
    />
  ));

  // Reportes: vencidos primero (danger), luego próximos (warn).
  const reportRows: ReactNode[] = [
    ...reportsOverdue.map((r) => (
      <Row
        key={r.reportId}
        href="/reportes/calendario"
        primary={r.projectName}
        secondary={r.clientName}
        right={
          <span className="text-danger font-medium text-[11px]">
            {dueLabel(r.daysUntil, es)}
          </span>
        }
      />
    )),
    ...reportsUpcoming.map((r) => (
      <Row
        key={r.reportId}
        href="/reportes/calendario"
        primary={r.projectName}
        secondary={r.clientName}
        right={
          <span className="text-warn text-[11px]">
            {dueLabel(r.daysUntil, es)}
          </span>
        }
      />
    )),
  ];

  const invoiceRows: ReactNode[] = invoices.map((i) => (
    <Row
      key={i.billingId}
      href={`/proyectos/${i.projectCode}/planes/${i.planId}/billing`}
      primary={i.projectName}
      secondary={`${formatMonth(i.month, lang)} · ${billingStatusLabel(i.status, es)}${i.invoiceNumber ? ` · #${i.invoiceNumber}` : ""}`}
      right={
        <span className="flex flex-col items-end gap-0.5">
          <span className="font-mono">{formatUsd(i.totalUsd)}</span>
          {i.dueDate && (
            <span
              className={`text-[11px] ${i.overdue ? "text-danger font-medium" : "text-muted"}`}
            >
              {es ? "vence " : "due "}
              {formatDate(i.dueDate, lang)}
            </span>
          )}
        </span>
      }
    />
  ));

  return (
    <section className="mt-6">
      <AlertBar
        es={es}
        overdueReports={reportsOverdue.length}
        overdueInvoices={overdueInvoices}
      />

      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">
          {es ? "Pendientes" : "Pending tasks"}
        </h2>
        <span className="text-[11px] uppercase tracking-[0.08em] text-muted font-medium">
          {total === 0
            ? es
              ? "Todo al día"
              : "All clear"
            : `${total} ${es ? (total === 1 ? "pendiente" : "pendientes") : total === 1 ? "item" : "items"}`}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Card
          icon={Receipt}
          tone="warn"
          title={es ? "Billing reports a completar" : "Billing reports to complete"}
          subtitle={es ? "Meses cerrados sin billing" : "Closed months without billing"}
          rows={billingRows}
          lang={lang}
        />
        <Card
          icon={Activity}
          tone="warn"
          title={es ? "Tracking del día" : "Daily tracking"}
          subtitle={
            es ? "Campañas vigentes sin cierre hoy" : "In-flight, not tracked today"
          }
          rows={trackingRows}
          lang={lang}
        />
        <Card
          icon={CalendarClock}
          tone={reportsOverdue.length > 0 ? "danger" : "warn"}
          title={es ? "Entregas de reportes" : "Report deliveries"}
          subtitle={es ? "Próximos o vencidos" : "Upcoming or overdue"}
          rows={reportRows}
          lang={lang}
        />
        <Card
          icon={Banknote}
          tone={overdueInvoices > 0 ? "danger" : "warn"}
          title={es ? "Facturas impagas" : "Unpaid invoices"}
          subtitle={es ? "Billings sin cobrar" : "Billings awaiting payment"}
          rows={invoiceRows}
          lang={lang}
        />
      </div>
    </section>
  );
}

// Barra de alerta: sólo aparece si hay algo VENCIDO (reportes o facturas).
function AlertBar({
  es,
  overdueReports,
  overdueInvoices,
}: {
  es: boolean;
  overdueReports: number;
  overdueInvoices: number;
}) {
  if (overdueReports === 0 && overdueInvoices === 0) return null;
  const segments: ReactNode[] = [];
  if (overdueReports > 0) {
    segments.push(
      <Link
        key="r"
        href="/reportes/calendario"
        className="underline underline-offset-2 hover:opacity-80"
      >
        {overdueReports}{" "}
        {es
          ? overdueReports === 1
            ? "reporte vencido"
            : "reportes vencidos"
          : overdueReports === 1
            ? "overdue report"
            : "overdue reports"}
      </Link>,
    );
  }
  if (overdueInvoices > 0) {
    segments.push(
      <Link
        key="i"
        href="/billing"
        className="underline underline-offset-2 hover:opacity-80"
      >
        {overdueInvoices}{" "}
        {es
          ? overdueInvoices === 1
            ? "factura vencida"
            : "facturas vencidas"
          : overdueInvoices === 1
            ? "overdue invoice"
            : "overdue invoices"}
      </Link>,
    );
  }
  return (
    <div className="mb-4 flex items-center gap-2.5 rounded-lg border border-danger bg-danger-soft px-4 py-2.5 text-sm text-danger">
      <TriangleAlert size={16} strokeWidth={2.2} className="shrink-0" />
      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-medium">
        {segments.map((seg, idx) => (
          <span key={idx} className="flex items-center gap-2">
            {idx > 0 && <span className="opacity-50">·</span>}
            {seg}
          </span>
        ))}
      </span>
    </div>
  );
}

function Card({
  icon: Icon,
  tone,
  title,
  subtitle,
  rows,
  lang,
}: {
  icon: typeof Receipt;
  tone: Tone;
  title: string;
  subtitle: string;
  rows: ReactNode[];
  lang: Language;
}) {
  const [expanded, setExpanded] = useState(false);
  const es = lang === "es";
  const count = rows.length;
  const empty = count === 0;
  const shown = expanded ? rows : rows.slice(0, PREVIEW);
  const extra = count - shown.length;

  return (
    <div className="rounded-lg border border-line bg-white dark:bg-paper-2 overflow-hidden flex flex-col">
      <div className="px-4 py-3 flex items-center justify-between gap-3 border-b border-line">
        <span className="flex items-center gap-2.5 min-w-0">
          <Icon
            size={16}
            strokeWidth={2}
            className={empty ? "text-muted" : TONE_ICON[tone]}
          />
          <span className="min-w-0">
            <span className="block text-sm font-semibold truncate">{title}</span>
            <span className="block text-[11px] text-muted truncate">
              {subtitle}
            </span>
          </span>
        </span>
        {empty ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-success-soft text-success px-2 py-0.5 text-[11px] font-medium shrink-0">
            <Check size={12} strokeWidth={2.5} />
            {es ? "Al día" : "Clear"}
          </span>
        ) : (
          <span
            className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums shrink-0 ${TONE_BADGE[tone]}`}
          >
            {count}
          </span>
        )}
      </div>
      {!empty && (
        <div className="divide-y divide-line-soft">
          {shown}
          {extra > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="w-full px-4 py-2 text-left text-[11px] font-medium text-accent hover:bg-paper-2 transition-colors"
            >
              + {extra} {es ? "más" : "more"}
            </button>
          )}
          {expanded && count > PREVIEW && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="w-full px-4 py-2 text-left text-[11px] font-medium text-muted hover:bg-paper-2 transition-colors"
            >
              {es ? "ver menos" : "show less"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Row({
  href,
  primary,
  secondary,
  right,
}: {
  href: string;
  primary: string;
  secondary?: string;
  right: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-3 px-4 py-2 text-sm hover:bg-paper-2 transition-colors group"
    >
      <span className="min-w-0">
        <span className="block font-medium text-ink truncate group-hover:text-accent">
          {primary}
        </span>
        {secondary && (
          <span className="block text-[11px] text-muted truncate">
            {secondary}
          </span>
        )}
      </span>
      <span className="shrink-0 text-right text-xs">{right}</span>
    </Link>
  );
}

function billingStatusLabel(status: string, es: boolean): string {
  const map: Record<string, { es: string; en: string }> = {
    draft: { es: "borrador", en: "draft" },
    ready: { es: "listo", en: "ready" },
    sent: { es: "enviado", en: "sent" },
    invoiced: { es: "facturado", en: "invoiced" },
  };
  const entry = map[status];
  return entry ? (es ? entry.es : entry.en) : status;
}

function dueLabel(daysUntil: number, es: boolean): string {
  if (daysUntil < 0) {
    const n = -daysUntil;
    return es ? `vencido hace ${n}d` : `${n}d overdue`;
  }
  if (daysUntil === 0) return es ? "hoy" : "today";
  if (daysUntil === 1) return es ? "mañana" : "tomorrow";
  return es ? `en ${daysUntil}d` : `in ${daysUntil}d`;
}
