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
// ════════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import {
  ChevronRight,
  Download,
  FileSpreadsheet,
  Minus,
  Pencil,
  Plus,
  ShieldCheck,
} from "lucide-react";
import type { PlanVersionEntry } from "@/db/queries/plan-qa";
import type {
  FeeChange,
  FieldChange,
  LineChange,
  PublisherChange,
} from "@/lib/plan-version-diff";
import { formatUsd } from "@/lib/format";
import { formatDate, type Language } from "@/lib/i18n";

export function PlanVersionHistory({
  planId,
  entries,
  lang,
}: {
  planId: string;
  entries: PlanVersionEntry[];
  lang: Language;
}) {
  // La versión más reciente arranca abierta: es la que se mira el 90% de las
  // veces ("¿qué cambió en la última?").
  const [open, setOpen] = useState<Set<number>>(
    () => new Set(entries.length > 0 ? [entries[0].versionNumber] : []),
  );

  if (entries.length === 0) return null;

  const toggle = (v: number) =>
    setOpen((prev) => {
      const s = new Set(prev);
      if (s.has(v)) s.delete(v);
      else s.add(v);
      return s;
    });

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
                  <ChangeSummary entry={entry} />
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

              {isOpen && <VersionDetail entry={entry} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Resumen de una línea: "+3 líneas · 2 modificadas · −1" o "versión inicial".
function ChangeSummary({ entry }: { entry: PlanVersionEntry }) {
  const { diff } = entry;
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

function QaChip({ entry, lang }: { entry: PlanVersionEntry; lang: Language }) {
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

function VersionDetail({ entry }: { entry: PlanVersionEntry }) {
  const { diff } = entry;

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
