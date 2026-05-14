// Piezas presentacionales del Campaign Tracker. Son puras (sin estado ni
// efectos) así que se pueden usar tanto en server components (hub) como en
// client components (vista de carga).

import type { PaceStatus } from "@/lib/campaign-metrics";

// ── Pace badge ──────────────────────────────────────────────────────────────

const PACE_BADGE: Record<
  PaceStatus,
  { label: string; cls: string; dot: string }
> = {
  on_pace: {
    label: "on pace",
    cls: "bg-success-soft text-success border-success-soft",
    dot: "bg-success",
  },
  behind: {
    label: "atrasado",
    cls: "bg-warn-soft text-warn border-warn-soft",
    dot: "bg-warn",
  },
  over_pace: {
    label: "sobre-pace",
    cls: "bg-danger-soft text-danger border-danger-soft",
    dot: "bg-danger",
  },
};

export function PaceBadge({ status }: { status: PaceStatus }) {
  const s = PACE_BADGE[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[11px] font-medium ${s.cls}`}
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

// ── Barra de consumo con tick de pace ───────────────────────────────────────
// El relleno se colorea según el estado de pace; la marca vertical accent
// indica el pace esperado por las fechas del plan.

const FILL_BY_STATUS: Record<PaceStatus, string> = {
  on_pace: "bg-ink",
  behind: "bg-warn",
  over_pace: "bg-danger",
};

export function ConsumptionBar({
  progressPct,
  pacePct,
  status,
}: {
  progressPct: number;
  pacePct: number;
  status: PaceStatus;
}) {
  const fillW = Math.max(0, Math.min(progressPct, 100));
  const tickL = Math.max(0, Math.min(pacePct, 100));
  return (
    <div
      className="relative h-1.5 w-full rounded-full bg-paper-2 overflow-visible"
      title={`Consumo ${progressPct.toFixed(0)}% · pace esperado ${pacePct.toFixed(0)}%`}
    >
      <div
        className={`h-full rounded-full transition-[width] ${FILL_BY_STATUS[status]}`}
        style={{ width: `${fillW}%` }}
      />
      <div
        className="absolute -top-0.5 -bottom-0.5 w-[1.5px] bg-accent"
        style={{ left: `${tickL}%` }}
      />
    </div>
  );
}

// ── Goal bar por métrica (vista de carga) ───────────────────────────────────
// Barra fina con relleno por % del goal + tick de pace opcional. Para las
// métricas calculadas (sin tick) el color marca desvío del goal.

export function GoalBar({
  goalPct,
  pacePct,
  showPace,
}: {
  goalPct: number | null;
  pacePct?: number;
  showPace?: boolean;
}) {
  if (goalPct == null) {
    return <div className="h-2 w-full rounded-full bg-paper-2" />;
  }
  const fillW = Math.max(0, Math.min(goalPct, 100));
  const color =
    goalPct > 110 ? "bg-danger" : goalPct > 100 ? "bg-warn" : "bg-ink";
  const tickL =
    showPace && pacePct != null ? Math.max(0, Math.min(pacePct, 100)) : null;
  return (
    <div className="relative h-2 w-full rounded-full bg-paper-2 overflow-visible">
      <div
        className={`h-full rounded-full transition-[width] ${color}`}
        style={{ width: `${fillW}%` }}
      />
      {tickL != null && (
        <div
          className="absolute -top-0.5 -bottom-0.5 w-[1.5px] bg-ink/40"
          style={{ left: `${tickL}%` }}
        />
      )}
    </div>
  );
}

// ── Freshness dots ──────────────────────────────────────────────────────────
// 3 dots cuyo color indica qué tan reciente es la última carga.

function freshnessTone(lastUpdateAt: Date | null): ("ok" | "warn" | "bad")[] {
  if (!lastUpdateAt) return ["bad", "bad", "bad"];
  const hours = (Date.now() - lastUpdateAt.getTime()) / 3_600_000;
  if (hours < 24) return ["ok", "ok", "ok"];
  if (hours < 48) return ["ok", "ok", "warn"];
  if (hours < 72) return ["ok", "warn", "warn"];
  return ["warn", "bad", "bad"];
}

const DOT_CLS: Record<"ok" | "warn" | "bad", string> = {
  ok: "bg-success",
  warn: "bg-warn",
  bad: "bg-danger",
};

export function relativeUpdateLabel(lastUpdateAt: Date | null): string {
  if (!lastUpdateAt) return "sin carga";
  const ms = Date.now() - lastUpdateAt.getTime();
  const hours = ms / 3_600_000;
  if (hours < 1) return "recién";
  if (hours < 24) return `hace ${Math.floor(hours)}h`;
  return `hace ${Math.floor(hours / 24)}d`;
}

export function FreshnessDots({
  lastUpdateAt,
}: {
  lastUpdateAt: Date | null;
}) {
  const tones = freshnessTone(lastUpdateAt);
  return (
    <span
      className="inline-flex items-center gap-[3px]"
      title={
        lastUpdateAt
          ? `Última carga: ${lastUpdateAt.toLocaleString("es-AR")}`
          : "Sin carga registrada"
      }
    >
      {tones.map((tone, i) => (
        <span
          key={i}
          className={`inline-block h-[5px] w-[5px] rounded-full ${DOT_CLS[tone]}`}
        />
      ))}
    </span>
  );
}
