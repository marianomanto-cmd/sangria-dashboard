"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Activity,
  Banknote,
  CalendarClock,
  Check,
  ChevronRight,
  Receipt,
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

export function PendingBoard({
  pendings,
  lang,
}: {
  pendings: DashboardPendings;
  lang: Language;
}) {
  const { billings, tracking, reportsUpcoming, reportsOverdue, invoices } =
    pendings;
  const reportsCount = reportsUpcoming.length + reportsOverdue.length;
  const total =
    billings.length + tracking.length + reportsCount + invoices.length;

  const es = lang === "es";

  return (
    <section className="mt-6">
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

      <div className="space-y-3">
        <CollapsibleCard
          icon={Receipt}
          tone="warn"
          count={billings.length}
          title={es ? "Billing reports a completar" : "Billing reports to complete"}
          subtitle={
            es
              ? "Meses ya cerrados de campañas aprobadas sin billing"
              : "Closed months of approved campaigns without billing"
          }
          lang={lang}
        >
          {billings.map((b) => (
            <Row
              key={`${b.planId}:${b.month}`}
              href={`/proyectos/${b.projectCode}/planes/${b.planId}/billing`}
              primary={b.projectName}
              secondary={b.planName}
              right={
                <span className="font-mono text-warn">
                  {formatMonth(b.month, lang)}
                </span>
              }
            />
          ))}
        </CollapsibleCard>

        <CollapsibleCard
          icon={Activity}
          tone="warn"
          count={tracking.length}
          title={es ? "Tracking del día pendiente" : "Daily tracking pending"}
          subtitle={
            es
              ? "Campañas vigentes sin cierre de tracking hoy"
              : "In-flight campaigns not yet tracked today"
          }
          lang={lang}
        >
          {tracking.map((t) => (
            <Row
              key={t.planId}
              href={`/campaign-tracker/${t.planId}`}
              primary={t.projectName}
              secondary={t.planName}
              right={
                <span className="text-muted">
                  {t.lastCloseDate === null
                    ? es
                      ? "nunca trackeado"
                      : "never tracked"
                    : es
                      ? `último cierre ${formatDate(t.lastCloseDate, lang)} · ${t.daysSinceClose}d`
                      : `last close ${formatDate(t.lastCloseDate, lang)} · ${t.daysSinceClose}d`}
                </span>
              }
            />
          ))}
        </CollapsibleCard>

        <CollapsibleCard
          icon={CalendarClock}
          tone={reportsOverdue.length > 0 ? "danger" : "warn"}
          count={reportsCount}
          title={es ? "Entregas de reportes" : "Report deliveries"}
          subtitle={
            es
              ? "Reportes próximos a la fecha o ya vencidos"
              : "Reports near or past their delivery date"
          }
          lang={lang}
        >
          {reportsUpcoming.length > 0 && (
            <Subhead
              label={es ? "Próximos a entregar" : "Upcoming"}
              tone="warn"
            />
          )}
          {reportsUpcoming.map((r) => (
            <Row
              key={r.reportId}
              href="/reportes/calendario"
              primary={r.projectName}
              secondary={r.clientName}
              right={
                <span className="text-warn">
                  {formatDate(r.deliveryDate, lang)} · {dueLabel(r.daysUntil, es)}
                </span>
              }
            />
          ))}
          {reportsOverdue.length > 0 && (
            <Subhead
              label={es ? "Vencidos sin entregar" : "Overdue, not delivered"}
              tone="danger"
            />
          )}
          {reportsOverdue.map((r) => (
            <Row
              key={r.reportId}
              href="/reportes/calendario"
              primary={r.projectName}
              secondary={r.clientName}
              right={
                <span className="text-danger font-medium">
                  {formatDate(r.deliveryDate, lang)} · {dueLabel(r.daysUntil, es)}
                </span>
              }
            />
          ))}
        </CollapsibleCard>

        <CollapsibleCard
          icon={Banknote}
          tone={invoices.some((i) => i.overdue) ? "danger" : "warn"}
          count={invoices.length}
          title={es ? "Facturas impagas" : "Unpaid invoices"}
          subtitle={
            es
              ? "Billings pendientes de cobro (todo lo no pagado)"
              : "Billings awaiting payment (anything not paid)"
          }
          lang={lang}
        >
          {invoices.map((i) => (
            <Row
              key={i.billingId}
              href={`/proyectos/${i.projectCode}/planes/${i.planId}/billing`}
              primary={i.projectName}
              secondary={`${i.planName} · ${formatMonth(i.month, lang)} · ${billingStatusLabel(i.status, es)}${i.invoiceNumber ? ` · #${i.invoiceNumber}` : ""}`}
              right={
                <span className="flex flex-col items-end gap-0.5">
                  <span className="font-mono">{formatUsd(i.totalUsd)}</span>
                  {i.dueDate && (
                    <span
                      className={`text-[11px] ${i.overdue ? "text-danger font-medium" : "text-muted"}`}
                    >
                      {es ? "vence" : "due"} {formatDate(i.dueDate, lang)}
                    </span>
                  )}
                </span>
              }
            />
          ))}
        </CollapsibleCard>
      </div>
    </section>
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

function CollapsibleCard({
  icon: Icon,
  tone,
  count,
  title,
  subtitle,
  lang,
  children,
}: {
  icon: typeof Receipt;
  tone: Tone;
  count: number;
  title: string;
  subtitle: string;
  lang: Language;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const empty = count === 0;
  const es = lang === "es";

  return (
    <div className="rounded-lg border border-line bg-white dark:bg-paper-2 overflow-hidden">
      <button
        type="button"
        disabled={empty}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full px-5 py-3 flex items-center justify-between gap-3 text-left enabled:hover:bg-paper-2 transition-colors disabled:cursor-default"
      >
        <span className="flex items-center gap-3 min-w-0">
          <Icon
            size={16}
            strokeWidth={2}
            className={empty ? "text-muted" : TONE_ICON[tone]}
          />
          <span className="min-w-0">
            <span className="block text-sm font-semibold truncate">
              {title}
            </span>
            <span className="block text-[11px] text-muted truncate">
              {subtitle}
            </span>
          </span>
        </span>
        <span className="flex items-center gap-2.5 shrink-0">
          {empty ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-success-soft text-success px-2 py-0.5 text-[11px] font-medium">
              <Check size={12} strokeWidth={2.5} />
              {es ? "Al día" : "Clear"}
            </span>
          ) : (
            <>
              <span
                className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${TONE_BADGE[tone]}`}
              >
                {count}
              </span>
              <ChevronRight
                size={15}
                className={`text-muted transition-transform duration-200 ${open ? "rotate-90" : "rotate-0"}`}
              />
            </>
          )}
        </span>
      </button>
      {open && !empty && (
        <div className="border-t border-line divide-y divide-line-soft">
          {children}
        </div>
      )}
    </div>
  );
}

function Subhead({ label, tone }: { label: string; tone: Tone }) {
  return (
    <div className="px-5 py-1.5 bg-paper-2 text-[10px] uppercase tracking-[0.08em] font-semibold">
      <span className={TONE_ICON[tone]}>{label}</span>
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
      className="flex items-center justify-between gap-4 px-5 py-2.5 text-sm hover:bg-paper-2 transition-colors group"
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
