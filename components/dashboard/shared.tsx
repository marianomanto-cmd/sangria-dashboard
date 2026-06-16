import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buildHrefWithClient } from "@/lib/client-filter";
import { formatUsdCompact } from "@/lib/format";
import { formatMonth, type Language } from "@/lib/i18n";
import type { DashboardPendings } from "@/db/queries/pendings";
import type { DashboardProjects } from "@/db/queries/dashboard";

// ════════════════════════════════════════════════════════════════════════════
// Helpers + primitivos compartidos por las 3 vistas del dashboard.
// ════════════════════════════════════════════════════════════════════════════

export type Tone = "warn" | "danger" | "success";

// Una fila de pendiente ya normalizada para render: tono, cliente, título,
// meta y el HREF real a su detalle (mapeo del handoff).
export type PendingEntry = {
  key: string;
  tone: Tone;
  client: string;
  title: string;
  meta: string;
  amount?: string;
  href: string;
};

export type GroupedPendings = {
  billings: PendingEntry[];
  tracking: PendingEntry[];
  reports: PendingEntry[];
  invoices: PendingEntry[];
};

// Normaliza `DashboardPendings` → entradas con su link de detalle. Las rutas
// salen del mapeo confirmado del handoff (todas existen en app/(app)/...).
export function groupPendings(p: DashboardPendings, lang: Language): GroupedPendings {
  const es = lang === "es";

  const billings: PendingEntry[] = p.billings.map((b) => ({
    key: `bill-${b.planId}-${b.month}`,
    tone: "warn",
    client: b.clientName,
    title: b.planName,
    meta: formatMonth(b.month, lang),
    href: `/proyectos/${b.projectCode}/planes/${b.planId}/billing`,
  }));

  const tracking: PendingEntry[] = p.tracking.map((t) => ({
    key: `trk-${t.planId}`,
    tone: "warn",
    client: t.clientName,
    title: t.planName,
    meta:
      t.lastCloseDate == null
        ? es
          ? "sin tracking"
          : "never tracked"
        : es
          ? `hace ${t.daysSinceClose}d`
          : `${t.daysSinceClose}d ago`,
    href: `/campaign-tracker/${t.planId}`,
  }));

  const reports: PendingEntry[] = [
    ...p.reportsOverdue.map<PendingEntry>((r) => ({
      key: `rep-${r.reportId}`,
      tone: "danger",
      client: r.clientName,
      title: r.projectName,
      meta: es ? `vencido hace ${-r.daysUntil}d` : `${-r.daysUntil}d overdue`,
      href: buildHrefWithClient("/reportes/generador", r.clientSlug),
    })),
    ...p.reportsUpcoming.map<PendingEntry>((r) => ({
      key: `rep-${r.reportId}`,
      tone: "warn",
      client: r.clientName,
      title: r.projectName,
      meta:
        r.daysUntil === 0
          ? es
            ? "hoy"
            : "today"
          : es
            ? `en ${r.daysUntil}d`
            : `in ${r.daysUntil}d`,
      href: buildHrefWithClient("/reportes/calendario", r.clientSlug),
    })),
  ];

  const invoices: PendingEntry[] = p.invoices.map((i) => ({
    key: `inv-${i.billingId}`,
    tone: i.overdue ? "danger" : "warn",
    client: i.clientName,
    title: i.planName,
    meta: i.overdue
      ? es
        ? `${formatMonth(i.month, lang)} · vencida`
        : `${formatMonth(i.month, lang)} · overdue`
      : formatMonth(i.month, lang),
    amount: formatUsdCompact(i.totalUsd),
    href: buildHrefWithClient("/billing", i.clientSlug),
  }));

  return { billings, tracking, reports, invoices };
}

export function flattenPendings(g: GroupedPendings): PendingEntry[] {
  // Orden por urgencia: vencidos (danger) primero.
  const all = [...g.reports, ...g.invoices, ...g.billings, ...g.tracking];
  return all.sort((a, b) => (a.tone === "danger" ? 0 : 1) - (b.tone === "danger" ? 0 : 1));
}

const TONE_DOT: Record<Tone, string> = {
  warn: "bg-warn",
  danger: "bg-danger",
  success: "bg-success",
};

export function StatusDot({ tone }: { tone: Tone }) {
  return (
    <span
      aria-hidden
      className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${TONE_DOT[tone]}`}
    />
  );
}

// Botón-icono → (abre el detalle del pendiente). Hit area ≥ 26px, focus-visible
// global (accent). Hover: bg accent / texto blanco.
export function OpenLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-lg border border-line text-muted hover:bg-accent hover:border-accent hover:text-white transition-colors"
    >
      <ArrowRight size={14} strokeWidth={2.2} />
    </Link>
  );
}

// Fila de pendiente reutilizable (usada en Cuentas y Ejecutivo).
export function PendingRow({ entry, lang }: { entry: PendingEntry; lang: Language }) {
  const es = lang === "es";
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3.5 py-2.5 hover:bg-paper-2 transition-colors">
      <StatusDot tone={entry.tone} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[11px] uppercase tracking-wide text-muted truncate">
            {entry.client}
          </span>
          {entry.amount && (
            <span className="font-mono text-xs text-ink-2 ml-auto">{entry.amount}</span>
          )}
        </div>
        <p className="text-sm text-ink truncate">{entry.title}</p>
        <p className="text-[11px] text-muted truncate">{entry.meta}</p>
      </div>
      <OpenLink href={entry.href} label={es ? `Abrir ${entry.title}` : `Open ${entry.title}`} />
    </div>
  );
}

// ── Clientes derivados de los proyectos (para Cuentas / Ejecutivo) ────────────

export type ClientAgg = {
  slug: string;
  name: string;
  mark: string;
  projectCount: number;
  billedUsd: number;
  pipelineUsd: number;
  consumptionPct: number;
  spark: number[];
};

function markOf(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return "—";
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function deriveClients(projects: DashboardProjects): ClientAgg[] {
  const map = new Map<string, ClientAgg>();
  const nMonths = projects.monthLabels.length;
  for (const r of projects.rows) {
    let c = map.get(r.clientSlug);
    if (!c) {
      c = {
        slug: r.clientSlug,
        name: r.clientName,
        mark: markOf(r.clientName),
        projectCount: 0,
        billedUsd: 0,
        pipelineUsd: 0,
        consumptionPct: 0,
        spark: Array.from({ length: nMonths }, () => 0),
      };
      map.set(r.clientSlug, c);
    }
    c.projectCount += 1;
    c.billedUsd += r.spentUsd;
    c.pipelineUsd += r.totalBudgetUsd;
    r.monthlySpend.forEach((v, i) => {
      if (i < c!.spark.length) c!.spark[i] += v;
    });
  }
  const arr = Array.from(map.values());
  for (const c of arr) {
    c.consumptionPct = c.pipelineUsd > 0 ? (c.billedUsd / c.pipelineUsd) * 100 : 0;
  }
  return arr.sort((a, b) => b.billedUsd - a.billedUsd);
}

// ── Mini-barras (sparkline con divs, sin recharts) ───────────────────────────
export function MiniBars({
  values,
  className = "",
  barClass = "bg-accent/70",
}: {
  values: number[];
  className?: string;
  barClass?: string;
}) {
  const max = Math.max(1, ...values);
  return (
    <div className={`flex items-end gap-[3px] h-10 ${className}`}>
      {values.map((v, i) => (
        <span
          key={i}
          className={`flex-1 rounded-sm origin-bottom ${barClass}`}
          style={{ height: `${Math.max(6, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

// Eyebrow uppercase (label de sección, Archivo-ish via tracking).
export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-accent">
      {children}
    </p>
  );
}
