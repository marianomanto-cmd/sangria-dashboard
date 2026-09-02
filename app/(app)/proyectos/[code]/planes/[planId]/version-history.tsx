"use client";

// ════════════════════════════════════════════════════════════════════════════
// Historial de versiones del plan.
//
// Una fila por versión aprobada; cada una se despliega y muestra QUÉ cambió
// respecto de la versión anterior y CUÁNDO se aprobó, más el QA de esa versión
// (quién lo cerró y cuándo) y las descargas del Excel / PDF congelados.
//
// El diff se computa server-side desde los snapshots inmutables
// (lib/plan-version-diff.ts) — no del audit_log: el snapshot es exactamente lo
// que se aprobó, así que lo que se lee acá es lo que el cliente firmó.
//
// El diff se pide POR VERSIÓN, al desplegarla (`/api/plans/[planId]/version-diff`).
// Antes venía calculado para todas las versiones en el render de la página, lo
// que obligaba a leer el `snapshot_json` de TODAS: megabytes por una conexión
// del pooler en cada carga y en cada `router.refresh()` post-guardado, peor con
// cada versión nueva. Era lo que colgaba la página (incidente del 02/sep/2026).
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useState } from "react";
import {
  ChevronRight,
  Download,
  FileSpreadsheet,
  Minus,
  Pencil,
  Plus,
  ShieldCheck,
} from "lucide-react";
import type { PlanVersionSummary } from "@/db/queries/plan-qa";
import type {
  FeeChange,
  FieldChange,
  LineChange,
  PlanVersionDiff,
  PublisherChange,
} from "@/lib/plan-version-diff";
import { formatUsd } from "@/lib/format";
import { formatDate, type Language } from "@/lib/i18n";

type DiffState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; diff: PlanVersionDiff };

export function PlanVersionHistory({
  planId,
  entries,
  initialDiff = null,
  lang,
}: {
  planId: string;
  entries: PlanVersionSummary[];
  // Diff de la versión más reciente, ya resuelto en el server: es la que arranca
  // abierta, así que viene con la página en vez de pedirse aparte. Son 2
  // snapshots, no los de todo el plan.
  initialDiff?: PlanVersionDiff | null;
  lang: Language;
}) {
  // La versión más reciente arranca abierta: es la que se mira el 90% de las
  // veces ("¿qué cambió en la última?"). Su diff se pide al montar; el de las
  // demás, recién al desplegarlas.
  const [open, setOpen] = useState<Set<number>>(
    () => new Set(entries.length > 0 ? [entries[0].versionNumber] : []),
  );
  const [diffs, setDiffs] = useState<Map<number, DiffState>>(() => {
    const m = new Map<number, DiffState>();
    if (initialDiff && entries.length > 0) {
      m.set(entries[0].versionNumber, { status: "ready", diff: initialDiff });
    }
    return m;
  });

  const loadDiff = useCallback(
    async (version: number) => {
      let alreadyRequested = false;
      setDiffs((prev) => {
        if (prev.has(version)) {
          alreadyRequested = true;
          return prev;
        }
        return new Map(prev).set(version, { status: "loading" });
      });
      if (alreadyRequested) return;

      try {
        const res = await fetch(
          `/api/plans/${planId}/version-diff?version=${version}`,
        );
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { diff: PlanVersionDiff };
        setDiffs((prev) =>
          new Map(prev).set(version, { status: "ready", diff: body.diff }),
        );
      } catch {
        setDiffs((prev) => new Map(prev).set(version, { status: "error" }));
      }
    },
    [planId],
  );

  if (entries.length === 0) return null;

  const toggle = (v: number) => {
    setOpen((prev) => {
      const s = new Set(prev);
      if (s.has(v)) s.delete(v);
      else s.add(v);
      return s;
    });
    void loadDiff(v);
  };

  // Reintento explícito: borra el estado de error para que loadDiff vuelva a pedir.
  const retryDiff = (v: number) => {
    setDiffs((prev) => {
      const m = new Map(prev);
      m.delete(v);
      return m;
    });
    void loadDiff(v);
  };

  return (
    <section>
      <h2 className="text-sm font-semibold mb-2">Historial de versiones</h2>
      <p className="text-xs text-muted mb-2">
        Cada versión aprobada se despliega para ver qué cambió respecto de la
        anterior, y se puede descargar tal como se aprobó (Excel o PDF) sin
        afectar al plan vigente.
      </p>
      <ul className="rounded-lg border border-line bg-white dark:bg-paper-2 divide-y divide-line-soft overflow-hidden">
        {entries.map((entry) => {
          const isOpen = open.has(entry.versionNumber);
          return (
            <li key={entry.versionNumber}>
              <div className="flex items-center gap-3 px-4 py-2.5 text-sm flex-wrap">
                <button
                  type="button"
                  onClick={() => toggle(entry.versionNumber)}
                  aria-expanded={isOpen}
                  className="flex items-center gap-2 min-w-0 flex-1 text-left hover:text-accent"
                >
                  <ChevronRight
                    size={14}
                    strokeWidth={2.5}
                    className={`shrink-0 text-muted transition-transform ${isOpen ? "rotate-90" : ""}`}
                  />
                  <span className="font-mono font-semibold text-ink-2 shrink-0">
                    v{entry.versionNumber}
                  </span>
                  <span className="font-mono text-xs text-muted shrink-0">
                    {formatDate(
                      entry.approvedAt.toISOString().slice(0, 10),
                      lang,
                    )}
                  </span>
                  <ChangeSummary state={diffs.get(entry.versionNumber)} />
                </button>

                <QaChip entry={entry} lang={lang} />

                <span className="flex items-center gap-3 shrink-0">
                  <a
                    href={`/api/plans/${planId}/export.xlsx?v=${entry.versionNumber}`}
                    className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent"
                    title={`Descargar el Excel del plan tal como se aprobó en v${entry.versionNumber}`}
                  >
                    <FileSpreadsheet size={13} />
                    Excel
                  </a>
                  <a
                    href={`/api/plans/${planId}/export.pdf?v=${entry.versionNumber}`}
                    className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent"
                    title={`Descargar el PDF del plan tal como se aprobó en v${entry.versionNumber}`}
                  >
                    <Download size={13} />
                    PDF
                  </a>
                  {entry.signedPdfUrl ? (
                    <a
                      href={entry.signedPdfUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent text-xs hover:underline"
                    >
                      PDF firmado
                    </a>
                  ) : (
                    <span className="text-line text-xs">sin PDF firmado</span>
                  )}
                </span>
              </div>

              {isOpen && (
                <VersionDetail
                  entry={entry}
                  state={diffs.get(entry.versionNumber)}
                  onRetry={() => retryDiff(entry.versionNumber)}
                />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Resumen de una línea: "+3 líneas · 2 modificadas · −1" o "versión inicial".
function ChangeSummary({ state }: { state?: DiffState }) {
  if (!state || state.status === "loading") {
    return <span className="text-xs text-muted truncate">calculando cambios…</span>;
  }
  if (state.status === "error") {
    return <span className="text-xs text-muted truncate">—</span>;
  }
  const { diff } = state;
  if (diff.isInitial) {
    return (
      <span className="text-xs text-muted truncate">
        versión inicial · {diff.counts.linesAfter} línea
        {diff.counts.linesAfter === 1 ? "" : "s"} ·{" "}
        {formatUsd(diff.totals.grandAfter)}
      </span>
    );
  }
  if (diff.changeCount === 0) {
    return (
      <span className="text-xs text-muted truncate">
        sin cambios en las líneas (re-aprobación)
      </span>
    );
  }
  const bits: string[] = [];
  if (diff.counts.added) bits.push(`+${diff.counts.added}`);
  if (diff.counts.changed) bits.push(`${diff.counts.changed} modificada${diff.counts.changed === 1 ? "" : "s"}`);
  if (diff.counts.removed) bits.push(`−${diff.counts.removed}`);
  if (diff.fees.length) bits.push(`${diff.fees.length} fee${diff.fees.length === 1 ? "" : "s"}`);
  const delta = diff.totals.grandAfter - diff.totals.grandBefore;
  return (
    <span className="text-xs text-muted truncate">
      {bits.join(" · ")}
      {Math.round(delta) !== 0 && (
        <span className={delta > 0 ? "text-warn ml-1.5" : "text-info ml-1.5"}>
          ({delta > 0 ? "+" : "−"}
          {formatUsd(Math.abs(delta))})
        </span>
      )}
    </span>
  );
}

function QaChip({ entry, lang }: { entry: PlanVersionSummary; lang: Language }) {
  const qa = entry.qa;
  if (!qa?.completedAt) {
    return (
      <span
        className="shrink-0 inline-flex items-center gap-1 rounded-sm border border-line bg-paper-2 px-1.5 py-0.5 text-[10px] text-muted"
        title="Esta versión no tiene el QA cerrado"
      >
        <ShieldCheck size={11} strokeWidth={2} />
        sin QA
      </span>
    );
  }
  return (
    <span
      className="shrink-0 inline-flex items-center gap-1 rounded-sm border border-success-soft bg-success-soft px-1.5 py-0.5 text-[10px] font-medium text-success"
      title={`QA cerrado por ${qa.completedByEmail ?? "—"} · ${qa.checkedCount} línea(s) controladas`}
    >
      <ShieldCheck size={11} strokeWidth={2.5} />
      QA {formatDate(qa.completedAt.toISOString().slice(0, 10), lang)}
    </span>
  );
}

// ── Detalle desplegado ──────────────────────────────────────────────────────

function VersionDetail({
  entry,
  state,
  onRetry,
}: {
  entry: PlanVersionSummary;
  state?: DiffState;
  onRetry: () => void;
}) {
  if (!state || state.status === "loading") {
    return (
      <div className="border-t border-line-soft bg-paper-2/40 px-4 py-3.5 text-xs text-muted">
        Cargando los cambios de esta versión…
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="border-t border-line-soft bg-paper-2/40 px-4 py-3.5 text-xs text-muted flex items-center gap-2">
        <span>No se pudieron cargar los cambios de esta versión.</span>
        <button
          type="button"
          onClick={onRetry}
          className="text-accent hover:underline font-medium"
        >
          Reintentar
        </button>
      </div>
    );
  }
  const { diff } = state;

  return (
    <div className="border-t border-line-soft bg-paper-2/40 px-4 py-3.5 space-y-3">
      {/* Totales de la versión */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 text-xs">
        <Total
          label="Media"
          before={diff.isInitial ? null : diff.totals.mediaBefore}
          after={diff.totals.mediaAfter}
        />
        <Total
          label="Fees"
          before={diff.isInitial ? null : diff.totals.feesBefore}
          after={diff.totals.feesAfter}
        />
        <Total
          label="Total"
          before={diff.isInitial ? null : diff.totals.grandBefore}
          after={diff.totals.grandAfter}
          strong
        />
        <span className="text-muted">
          {diff.counts.linesAfter} línea
          {diff.counts.linesAfter === 1 ? "" : "s"}
        </span>
        {entry.notes && (
          <span className="text-muted italic">“{entry.notes}”</span>
        )}
      </div>

      {entry.qa?.completedAt && (
        <p className="text-[11px] text-muted">
          <ShieldCheck
            size={11}
            strokeWidth={2}
            className="inline-block mr-1 -mt-px text-success"
          />
          QA cerrado por{" "}
          <span className="text-ink-2 font-medium">
            {entry.qa.completedByEmail ?? "—"}
          </span>{" "}
          · {entry.qa.checkedCount} línea
          {entry.qa.checkedCount === 1 ? "" : "s"} controladas
          {entry.qa.notes && <> · “{entry.qa.notes}”</>}
        </p>
      )}

      {diff.isInitial ? (
        <p className="text-xs text-muted">
          Primera versión aprobada del plan — no hay una anterior con la cual
          comparar. El contenido exacto está en el Excel / PDF de v
          {entry.versionNumber}.
        </p>
      ) : diff.changeCount === 0 ? (
        <p className="text-xs text-muted">
          Esta versión se aprobó sin cambios respecto de la anterior (mismo
          contenido, nueva firma).
        </p>
      ) : (
        <div className="space-y-3">
          {diff.planFields.length > 0 && (
            <Group title="Plan">
              {diff.planFields.map((f, i) => (
                <li key={i} className="px-3 py-1.5">
                  <FieldRow field={f} />
                </li>
              ))}
            </Group>
          )}

          {diff.publishers.length > 0 && (
            <Group title="Publishers">
              {diff.publishers.map((p, i) => (
                <li key={i} className="px-3 py-1.5">
                  <PublisherRow change={p} />
                </li>
              ))}
            </Group>
          )}

          {diff.lines.length > 0 && (
            <Group title="Líneas del plan">
              {diff.lines.map((l, i) => (
                <li key={i} className="px-3 py-1.5">
                  <LineRow change={l} />
                </li>
              ))}
            </Group>
          )}

          {diff.fees.length > 0 && (
            <Group title="Fees">
              {diff.fees.map((f, i) => (
                <li key={i} className="px-3 py-1.5">
                  <FeeRow change={f} />
                </li>
              ))}
            </Group>
          )}
        </div>
      )}
    </div>
  );
}

const KIND_STYLE = {
  added: { icon: Plus, cls: "text-success", label: "agregada" },
  removed: { icon: Minus, cls: "text-danger", label: "eliminada" },
  changed: { icon: Pencil, cls: "text-warn", label: "modificada" },
} as const;

function KindTag({ kind }: { kind: "added" | "removed" | "changed" }) {
  const { icon: Icon, cls } = KIND_STYLE[kind];
  return (
    <Icon size={12} strokeWidth={2.5} className={`shrink-0 mt-0.5 ${cls}`} />
  );
}

function LineRow({ change }: { change: LineChange }) {
  return (
    <div className="flex items-start gap-2">
      <KindTag kind={change.kind} />
      <div className="min-w-0 flex-1">
        <p className="text-xs">
          <span className="text-muted">{change.publisherName}</span>
          <span className="text-line mx-1">·</span>
          <span className="font-medium text-ink">{change.placementName}</span>
          {change.kind === "added" && change.amountAfter != null && (
            <span className="ml-2 font-mono text-success">
              {formatUsd(change.amountAfter)}
            </span>
          )}
          {change.kind === "removed" && change.amountBefore != null && (
            <span className="ml-2 font-mono text-danger line-through">
              {formatUsd(change.amountBefore)}
            </span>
          )}
        </p>
        {change.fields.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {change.fields.map((f, i) => (
              <li key={i}>
                <FieldRow field={f} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PublisherRow({ change }: { change: PublisherChange }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <KindTag kind={change.kind} />
      <span className="font-medium text-ink">{change.publisherName}</span>
      <span className="text-muted">
        {change.kind === "added" && (
          <>total {formatUsd(change.totalAfter ?? 0)}</>
        )}
        {change.kind === "removed" && (
          <>bloque eliminado (total {formatUsd(change.totalBefore ?? 0)})</>
        )}
        {change.kind === "changed" && (
          <>
            total{" "}
            <span className="font-mono line-through">
              {formatUsd(change.totalBefore ?? 0)}
            </span>{" "}
            <span className="text-line">→</span>{" "}
            <span className="font-mono text-ink-2">
              {formatUsd(change.totalAfter ?? 0)}
            </span>
          </>
        )}
      </span>
    </div>
  );
}

function FeeRow({ change }: { change: FeeChange }) {
  return (
    <div className="flex items-start gap-2">
      <KindTag kind={change.kind} />
      <div className="min-w-0 flex-1">
        <p className="text-xs">
          <span className="font-medium text-ink">{change.name}</span>
          {change.kind === "added" && change.amountAfter != null && (
            <span className="ml-2 font-mono text-success">
              {formatUsd(change.amountAfter)}
            </span>
          )}
          {change.kind === "removed" && change.amountBefore != null && (
            <span className="ml-2 font-mono text-danger line-through">
              {formatUsd(change.amountBefore)}
            </span>
          )}
        </p>
        {change.fields.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {change.fields.map((f, i) => (
              <li key={i}>
                <FieldRow field={f} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function FieldRow({ field }: { field: FieldChange }) {
  return (
    <span className="text-[11px] text-muted">
      <span className="text-ink-2">{field.label}:</span>{" "}
      <span className="line-through decoration-danger/50">{field.before}</span>{" "}
      <span className="text-line">→</span>{" "}
      <span className="text-ink font-medium">{field.after}</span>
    </span>
  );
}

function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted mb-1">
        {title}
      </p>
      <ul className="rounded-md border border-line bg-white dark:bg-paper-2 divide-y divide-line-soft">
        {children}
      </ul>
    </div>
  );
}

function Total({
  label,
  before,
  after,
  strong = false,
}: {
  label: string;
  before: number | null;
  after: number;
  strong?: boolean;
}) {
  const changed = before != null && Math.round(before) !== Math.round(after);
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.06em] text-muted">
        {label}
      </span>
      {changed && (
        <>
          <span className="font-mono text-muted line-through">
            {formatUsd(before)}
          </span>
          <span className="text-line">→</span>
        </>
      )}
      <span
        className={`font-mono tabular-nums ${strong ? "font-semibold text-ink" : "text-ink-2"}`}
      >
        {formatUsd(after)}
      </span>
    </span>
  );
}
