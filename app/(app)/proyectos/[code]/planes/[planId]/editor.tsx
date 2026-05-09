"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  addFee,
  addPlacement,
  addPublisherToPlan,
  removeFee,
  removePlacement,
  removePublisherFromPlan,
  transitionPlanStatus,
  updateFee,
  updatePlacement,
  updatePlanMetadata,
  updatePlanPublisher,
} from "@/app/actions/plans";
import type {
  PlanDetail,
  PlanFee,
  PlanPlacement,
  PlanPublisherGroup,
} from "@/db/queries/project-detail";
import type { publishers } from "@/db/schema";
import { formatPct, formatUsd, formatUsdCompact } from "@/lib/format";

type PublisherCatalog = (typeof publishers.$inferSelect);
type CostMethod =
  | "dCPV"
  | "dCPC"
  | "dCPM"
  | "CPM"
  | "CPC"
  | "CPV"
  | "CPA"
  | "Flat"
  | "Other";
const COST_METHODS: CostMethod[] = [
  "dCPV", "dCPC", "dCPM", "CPM", "CPC", "CPV", "CPA", "Flat", "Other",
];

const STATUS_STYLE: Record<string, { label: string; cls: string; dot: string }> = {
  draft: { label: "draft", cls: "bg-paper-2 text-muted border-line", dot: "bg-muted" },
  ready_to_send: { label: "ready to send", cls: "bg-warn-soft text-warn border-warn-soft", dot: "bg-warn" },
  approved: { label: "approved", cls: "bg-success-soft text-success border-success-soft", dot: "bg-success" },
  archived: { label: "archived", cls: "bg-paper-2 text-stone-400 border-line", dot: "bg-stone-400" },
};

export function PlanEditor({
  detail,
  allPublishers,
}: {
  detail: PlanDetail;
  allPublishers: PublisherCatalog[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const editable = detail.plan.status === "draft";

  const refresh = () => router.refresh();

  const usedPublisherIds = new Set(detail.publishers.map((p) => p.publisherId));
  const availablePublishers = allPublishers.filter((p) => !usedPublisherIds.has(p.id));

  const projectBudget = Number.parseFloat(detail.project.totalGrossBudgetUsd ?? "0");
  const planTotal = detail.totals.grand;
  const coveragePct = projectBudget > 0 ? (planTotal / projectBudget) * 100 : 0;
  const overBudget = coveragePct > 100;

  // ─── Plan-level handlers ────────────────────────────────────────────
  const onChangePlanField = (field: "name" | "periodStart" | "periodEnd" | "notesMd", value: string) => {
    startTransition(async () => {
      await updatePlanMetadata({ planId: detail.plan.id, [field]: value });
      refresh();
    });
  };

  const onMarkReady = () => {
    startTransition(async () => {
      const r = await transitionPlanStatus({ planId: detail.plan.id, to: "ready_to_send" });
      if (!r.ok) alert(r.error);
      refresh();
    });
  };

  const onBackToDraft = () => {
    startTransition(async () => {
      const r = await transitionPlanStatus({ planId: detail.plan.id, to: "draft" });
      if (!r.ok) alert(r.error);
      refresh();
    });
  };

  const onApprove = () => {
    if (!confirm(`¿Aprobar el plan ${detail.plan.name} (v${detail.plan.currentVersion + 1})?\n\nEsto crea un snapshot inmutable y bloquea ediciones futuras hasta que vuelvas al draft.`)) return;
    startTransition(async () => {
      const r = await transitionPlanStatus({ planId: detail.plan.id, to: "approved" });
      if (!r.ok) alert(r.error);
      refresh();
    });
  };

  const onAddPublisher = (publisherId: string) => {
    startTransition(async () => {
      await addPublisherToPlan({ planId: detail.plan.id, publisherId });
      refresh();
    });
  };

  const onAddFee = () => {
    startTransition(async () => {
      await addFee({
        planId: detail.plan.id,
        feeType: "custom",
        name: "Nuevo fee",
        amountUsd: 0,
      });
      refresh();
    });
  };

  const status = STATUS_STYLE[detail.plan.status] ?? STATUS_STYLE.draft;

  return (
    <div className={`space-y-5 ${pending ? "opacity-90" : ""}`}>
      {/* Header */}
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold tracking-[0.16em] uppercase text-accent">
            Plan de Medios
          </p>
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            {editable ? (
              <input
                type="text"
                defaultValue={detail.plan.name}
                onBlur={(e) =>
                  e.target.value !== detail.plan.name &&
                  onChangePlanField("name", e.target.value)
                }
                className="text-3xl font-semibold tracking-tight bg-transparent border-b border-transparent hover:border-line focus:border-accent focus:outline-none px-1 -mx-1"
              />
            ) : (
              <h1 className="text-3xl font-semibold tracking-tight">
                {detail.plan.name}
              </h1>
            )}
            <span
              className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[11px] font-medium ${status.cls}`}
            >
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${status.dot}`} />
              {status.label}
            </span>
            {detail.plan.currentVersion > 0 && (
              <span className="font-mono text-xs text-muted">
                v{detail.plan.currentVersion}
              </span>
            )}
          </div>
          <p className="text-sm text-muted mt-1 font-mono">
            {detail.project.code}.{detail.plan.name}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {detail.plan.status === "draft" && (
            <button
              type="button"
              onClick={onMarkReady}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-md bg-ink text-white px-3 py-1.5 text-sm font-medium hover:bg-ink-2 disabled:opacity-50"
            >
              Marcar listo para enviar
            </button>
          )}
          {detail.plan.status === "ready_to_send" && (
            <>
              <button
                type="button"
                onClick={onBackToDraft}
                disabled={pending}
                className="text-sm text-muted hover:text-ink px-3 py-1.5 disabled:opacity-50"
              >
                Volver a draft
              </button>
              <button
                type="button"
                onClick={onApprove}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-md bg-success text-white px-3 py-1.5 text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                Aprobar (firmado)
              </button>
            </>
          )}
          {detail.plan.status === "approved" && (
            <button
              type="button"
              onClick={onBackToDraft}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper-2 disabled:opacity-50"
            >
              Editar (nueva versión)
            </button>
          )}
        </div>
      </header>

      {/* Plan metadata strip */}
      <section className="rounded-lg border border-line bg-white px-5 py-4 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3">
        <Field label="Período inicio">
          <input
            type="date"
            defaultValue={detail.plan.periodStart ?? ""}
            disabled={!editable}
            onBlur={(e) =>
              e.target.value !== (detail.plan.periodStart ?? "") &&
              onChangePlanField("periodStart", e.target.value)
            }
            className="font-mono text-sm bg-transparent border-b border-transparent hover:border-line focus:border-accent focus:outline-none disabled:opacity-50"
          />
        </Field>
        <Field label="Período fin">
          <input
            type="date"
            defaultValue={detail.plan.periodEnd ?? ""}
            disabled={!editable}
            onBlur={(e) =>
              e.target.value !== (detail.plan.periodEnd ?? "") &&
              onChangePlanField("periodEnd", e.target.value)
            }
            className="font-mono text-sm bg-transparent border-b border-transparent hover:border-line focus:border-accent focus:outline-none disabled:opacity-50"
          />
        </Field>
        <Field label="Total media + fees">
          <span className="font-mono text-sm font-semibold tabular-nums">
            {formatUsd(planTotal)}
            <span className="text-muted text-xs font-normal ml-1">
              ({formatUsdCompact(detail.totals.media)} + {formatUsdCompact(detail.totals.fees)} fees)
            </span>
          </span>
        </Field>
        <Field label="vs Project budget">
          {projectBudget > 0 ? (
            <span
              className={`font-mono text-sm font-semibold tabular-nums ${overBudget ? "text-warn" : "text-ink"}`}
            >
              {formatPct(coveragePct, 0)}
              <span className="text-muted text-xs font-normal ml-1">
                de {formatUsdCompact(projectBudget)}
              </span>
            </span>
          ) : (
            <span className="text-sm text-muted">—</span>
          )}
        </Field>
      </section>

      {/* Notes */}
      {(editable || detail.plan.notesMd) && (
        <section className="rounded-lg border border-line bg-white px-5 py-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted mb-2">
            Notas del plan
          </p>
          <textarea
            defaultValue={detail.plan.notesMd ?? ""}
            disabled={!editable}
            placeholder={editable ? "Audiencia general, contexto, objetivos…" : ""}
            rows={2}
            onBlur={(e) =>
              e.target.value !== (detail.plan.notesMd ?? "") &&
              onChangePlanField("notesMd", e.target.value)
            }
            className="w-full text-sm bg-transparent resize-vertical focus:outline-none disabled:opacity-50 disabled:resize-none"
          />
        </section>
      )}

      {/* Publishers + placements */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold flex items-baseline justify-between">
          <span>
            Publishers
            <span className="ml-2 text-xs font-normal text-muted">
              ({detail.publishers.length} · {detail.publishers.reduce((s, p) => s + p.placements.length, 0)} placements)
            </span>
          </span>
          <span className="text-[11px] uppercase tracking-[0.08em] text-muted font-medium">
            Total media: {formatUsd(detail.totals.media)}
          </span>
        </h2>

        {detail.publishers.map((pub) => (
          <PublisherSection
            key={pub.id}
            pub={pub}
            editable={editable}
            onChange={refresh}
            startTransition={startTransition}
          />
        ))}

        {editable && availablePublishers.length > 0 && (
          <AddPublisherDropdown
            publishers={availablePublishers}
            onSelect={onAddPublisher}
            disabled={pending}
          />
        )}
      </section>

      {/* Fees */}
      <section>
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="text-sm font-semibold">
            Fees
            <span className="ml-2 text-xs font-normal text-muted">
              ({detail.fees.length})
            </span>
          </h2>
          <span className="text-[11px] uppercase tracking-[0.08em] text-muted font-medium">
            Total fees: {formatUsd(detail.totals.fees)}
          </span>
        </div>

        <div className="rounded-lg border border-line bg-white overflow-hidden">
          {detail.fees.length === 0 ? (
            <div className="px-5 py-8 text-center text-xs text-muted">
              Sin fees cargados.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-paper">
                <tr className="text-[11px] uppercase tracking-[0.06em] text-muted">
                  <th className="text-left font-medium px-5 py-2">Tipo</th>
                  <th className="text-left font-medium px-5 py-2">Nombre</th>
                  <th className="text-right font-medium px-5 py-2">Monto</th>
                  <th className="text-left font-medium px-5 py-2">Notas</th>
                  {editable && <th className="w-10"></th>}
                </tr>
              </thead>
              <tbody>
                {detail.fees.map((f) => (
                  <FeeRow
                    key={f.id}
                    fee={f}
                    editable={editable}
                    onChange={refresh}
                    startTransition={startTransition}
                  />
                ))}
              </tbody>
            </table>
          )}
          {editable && (
            <div className="border-t border-line-soft px-5 py-2">
              <button
                type="button"
                onClick={onAddFee}
                disabled={pending}
                className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink transition-colors disabled:opacity-50"
              >
                <Plus size={12} strokeWidth={2.5} />
                Agregar fee
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Snapshots */}
      {detail.snapshots.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2">Snapshots de aprobación</h2>
          <ul className="rounded-lg border border-line bg-white divide-y divide-line-soft">
            {detail.snapshots.map((s) => (
              <li key={s.id} className="px-5 py-2.5 flex items-center gap-3 text-sm">
                <span className="font-mono text-ink-2">v{s.versionNumber}</span>
                <span className="font-mono text-xs text-muted">
                  {s.approvedAt.toISOString().slice(0, 10)}
                </span>
                {s.notes && (
                  <span className="text-muted text-xs flex-1 truncate">
                    {s.notes}
                  </span>
                )}
                {s.signedPdfUrl ? (
                  <a
                    href={s.signedPdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent text-xs hover:underline"
                  >
                    PDF firmado
                  </a>
                ) : (
                  <span className="text-stone-300 text-xs">sin PDF</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Publisher section
// ════════════════════════════════════════════════════════════════════════════

function PublisherSection({
  pub,
  editable,
  onChange,
  startTransition,
}: {
  pub: PlanPublisherGroup;
  editable: boolean;
  onChange: () => void;
  startTransition: ReturnType<typeof useTransition>[1];
}) {
  const balance = pub.totalPlannedUsd - pub.placementsTotalUsd;
  const balanced = Math.abs(balance) < 0.01;

  const onUpdateTotal = (newTotal: number) => {
    startTransition(async () => {
      await updatePlanPublisher({ mppId: pub.id, totalPlannedUsd: newTotal });
      onChange();
    });
  };

  const onAddPlacement = () => {
    startTransition(async () => {
      await addPlacement({
        mppId: pub.id,
        placementName: "Nuevo placement",
        amountUsd: 0,
      });
      onChange();
    });
  };

  const onRemovePub = () => {
    if (!confirm(`¿Eliminar ${pub.publisherName} y todos sus ${pub.placements.length} placements?`)) return;
    startTransition(async () => {
      await removePublisherFromPlan(pub.id);
      onChange();
    });
  };

  return (
    <details
      open
      className="group rounded-lg border border-line bg-white overflow-hidden"
    >
      <summary className="flex items-center gap-3 px-5 py-3 cursor-pointer list-none [&::-webkit-details-marker]:hidden hover:bg-paper-2/50">
        <ChevronDown size={14} strokeWidth={2} className="text-muted shrink-0 transition-transform -rotate-90 group-open:rotate-0" />
        <span className="font-semibold text-ink flex-1">
          {pub.publisherName}
          {!pub.agencyPays && (
            <span className="ml-2 text-[10px] font-normal text-muted bg-paper-2 border border-line px-1.5 py-0.5 rounded">
              cliente paga directo
            </span>
          )}
        </span>
        <span className="text-xs text-muted">
          {pub.placements.length} placement{pub.placements.length === 1 ? "" : "s"}
        </span>
        <NumberInput
          value={pub.totalPlannedUsd}
          onCommit={onUpdateTotal}
          disabled={!editable}
          className="w-32 text-right font-mono font-semibold"
        />
        {editable && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              onRemovePub();
            }}
            className="text-muted hover:text-danger p-1 -mr-2"
            title="Eliminar publisher"
          >
            <Trash2 size={14} />
          </button>
        )}
      </summary>

      {!balanced && (
        <div className="border-t border-warn-soft bg-warn-soft/40 px-5 py-1.5 text-[11px] text-warn font-medium">
          {balance > 0
            ? `Faltan ${formatUsd(balance)} para llegar al total del publisher`
            : `Hay ${formatUsd(-balance)} de más en los placements vs el total del publisher`}
        </div>
      )}

      <div className="border-t border-line-soft">
        {pub.placements.length === 0 ? (
          <div className="px-5 py-6 text-center text-xs text-muted">
            Sin placements cargados todavía.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-paper">
              <tr className="text-[10px] uppercase tracking-[0.06em] text-muted">
                <th className="w-6"></th>
                <th className="text-left font-medium px-3 py-2">Placement</th>
                <th className="text-left font-medium px-3 py-2">Mercado</th>
                <th className="text-left font-medium px-3 py-2">Cost method</th>
                <th className="text-right font-medium px-3 py-2">Monto</th>
                {editable && <th className="w-10"></th>}
              </tr>
            </thead>
            <tbody>
              {pub.placements.map((pl) => (
                <PlacementRow
                  key={pl.id}
                  placement={pl}
                  editable={editable}
                  onChange={onChange}
                  startTransition={startTransition}
                />
              ))}
            </tbody>
          </table>
        )}
        {editable && (
          <div className="border-t border-line-soft px-5 py-2">
            <button
              type="button"
              onClick={onAddPlacement}
              className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink"
            >
              <Plus size={12} strokeWidth={2.5} />
              Agregar placement
            </button>
          </div>
        )}
      </div>
    </details>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Placement row con expandible para campos avanzados
// ════════════════════════════════════════════════════════════════════════════

function PlacementRow({
  placement,
  editable,
  onChange,
  startTransition,
}: {
  placement: PlanPlacement;
  editable: boolean;
  onChange: () => void;
  startTransition: ReturnType<typeof useTransition>[1];
}) {
  const [expanded, setExpanded] = useState(false);

  const update = (partial: Parameters<typeof updatePlacement>[0]) => {
    startTransition(async () => {
      await updatePlacement({ ...partial, placementId: placement.id });
      onChange();
    });
  };

  const onRemove = () => {
    if (!confirm(`¿Eliminar el placement "${placement.placementName}"?`)) return;
    startTransition(async () => {
      await removePlacement(placement.id);
      onChange();
    });
  };

  return (
    <>
      <tr className="border-t border-line-soft hover:bg-paper-2/40">
        <td className="px-2 py-1.5 text-center">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="text-muted hover:text-ink"
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        </td>
        <td className="px-3 py-1.5">
          <TextInput
            value={placement.placementName}
            onCommit={(v) => update({ placementName: v })}
            disabled={!editable}
            className="w-full"
          />
        </td>
        <td className="px-3 py-1.5">
          <TextInput
            value={placement.market ?? ""}
            onCommit={(v) => update({ market: v || null })}
            disabled={!editable}
            placeholder="—"
            className="w-full text-ink-2"
          />
        </td>
        <td className="px-3 py-1.5">
          <select
            value={placement.costMethod ?? ""}
            disabled={!editable}
            onChange={(e) =>
              update({ costMethod: (e.target.value || null) as CostMethod | null })
            }
            className="text-xs font-mono bg-transparent border-b border-transparent hover:border-line focus:border-accent focus:outline-none disabled:opacity-50"
          >
            <option value="">—</option>
            {COST_METHODS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </td>
        <td className="px-3 py-1.5 text-right">
          <NumberInput
            value={placement.amountUsd}
            onCommit={(v) => update({ amountUsd: v })}
            disabled={!editable}
            className="w-28 text-right font-mono"
          />
        </td>
        {editable && (
          <td className="px-2 py-1.5 text-center">
            <button
              type="button"
              onClick={onRemove}
              className="text-muted hover:text-danger p-1"
              title="Eliminar"
            >
              <Trash2 size={12} />
            </button>
          </td>
        )}
      </tr>
      {expanded && (
        <tr className="bg-paper-2/30">
          <td colSpan={editable ? 6 : 5} className="px-5 py-3">
            <PlacementDetails
              placement={placement}
              editable={editable}
              update={update}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function PlacementDetails({
  placement,
  editable,
  update,
}: {
  placement: PlanPlacement;
  editable: boolean;
  update: (partial: Parameters<typeof updatePlacement>[0]) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="space-y-3">
        <Field label="Fecha inicio">
          <input
            type="date"
            defaultValue={placement.startDate ?? ""}
            disabled={!editable}
            onBlur={(e) =>
              e.target.value !== (placement.startDate ?? "") &&
              update({ startDate: e.target.value || null })
            }
            className="font-mono text-sm bg-transparent border-b border-transparent hover:border-line focus:border-accent focus:outline-none disabled:opacity-50"
          />
        </Field>
        <Field label="Fecha fin">
          <input
            type="date"
            defaultValue={placement.endDate ?? ""}
            disabled={!editable}
            onBlur={(e) =>
              e.target.value !== (placement.endDate ?? "") &&
              update({ endDate: e.target.value || null })
            }
            className="font-mono text-sm bg-transparent border-b border-transparent hover:border-line focus:border-accent focus:outline-none disabled:opacity-50"
          />
        </Field>
        <Field label="Notas / audiencia / formatos">
          <textarea
            defaultValue={placement.notesMd ?? ""}
            disabled={!editable}
            rows={4}
            placeholder="Audiencia: 25-44 viajeros frecuentes&#10;Formato: video vertical 15-30s&#10;..."
            onBlur={(e) =>
              e.target.value !== (placement.notesMd ?? "") &&
              update({ notesMd: e.target.value || null })
            }
            className="w-full text-sm bg-white border border-line rounded-md px-2 py-1.5 focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft disabled:opacity-50"
          />
        </Field>
      </div>
      <MetricsEditor
        metrics={placement.metricsJson}
        editable={editable}
        onCommit={(m) => update({ metricsJson: m })}
      />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Editor de metrics_json (key-value flexible)
// ════════════════════════════════════════════════════════════════════════════

function MetricsEditor({
  metrics,
  editable,
  onCommit,
}: {
  metrics: Record<string, number>;
  editable: boolean;
  onCommit: (m: Record<string, number>) => void;
}) {
  const [draft, setDraft] = useState<Array<{ key: string; value: string }>>(
    Object.entries(metrics).map(([k, v]) => ({ key: k, value: String(v) })),
  );

  const commit = (next: typeof draft) => {
    const obj: Record<string, number> = {};
    for (const { key, value } of next) {
      const k = key.trim();
      if (!k) continue;
      const v = Number.parseFloat(value);
      if (Number.isFinite(v)) obj[k] = v;
    }
    onCommit(obj);
  };

  const updateRow = (idx: number, partial: Partial<{ key: string; value: string }>) => {
    const next = draft.map((r, i) => (i === idx ? { ...r, ...partial } : r));
    setDraft(next);
    commit(next);
  };

  const addRow = () => {
    setDraft((d) => [...d, { key: "", value: "" }]);
  };

  const removeRow = (idx: number) => {
    const next = draft.filter((_, i) => i !== idx);
    setDraft(next);
    commit(next);
  };

  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted mb-2">
        Indicadores (cpc, ctr, est_imp, etc.)
      </p>
      <div className="rounded-md border border-line bg-white">
        {draft.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-muted">
            Sin indicadores cargados
          </div>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {draft.map((row, idx) => (
                <tr key={idx} className="border-b border-line-soft last:border-b-0">
                  <td className="px-2 py-1 w-[40%]">
                    <input
                      type="text"
                      value={row.key}
                      placeholder="cpc"
                      disabled={!editable}
                      onChange={(e) =>
                        updateRow(idx, { key: e.target.value })
                      }
                      className="w-full font-mono text-xs bg-transparent focus:outline-none disabled:opacity-50"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={row.value}
                      placeholder="0.012"
                      disabled={!editable}
                      onChange={(e) =>
                        updateRow(idx, { value: e.target.value })
                      }
                      className="w-full font-mono text-xs bg-transparent text-right focus:outline-none disabled:opacity-50"
                    />
                  </td>
                  {editable && (
                    <td className="w-8 text-center">
                      <button
                        type="button"
                        onClick={() => removeRow(idx)}
                        className="text-muted hover:text-danger p-1"
                      >
                        <X size={11} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {editable && (
          <div className="border-t border-line-soft px-2 py-1">
            <button
              type="button"
              onClick={addRow}
              className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-ink"
            >
              <Plus size={10} strokeWidth={2.5} />
              Agregar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Fee row
// ════════════════════════════════════════════════════════════════════════════

function FeeRow({
  fee,
  editable,
  onChange,
  startTransition,
}: {
  fee: PlanFee;
  editable: boolean;
  onChange: () => void;
  startTransition: ReturnType<typeof useTransition>[1];
}) {
  const update = (partial: Parameters<typeof updateFee>[0]) => {
    startTransition(async () => {
      await updateFee({ ...partial, feeId: fee.id });
      onChange();
    });
  };

  const onRemove = () => {
    if (!confirm(`¿Eliminar el fee "${fee.name}"?`)) return;
    startTransition(async () => {
      await removeFee(fee.id);
      onChange();
    });
  };

  return (
    <tr className="border-t border-line-soft hover:bg-paper-2/40">
      <td className="px-5 py-1.5 text-xs font-mono text-muted uppercase">
        {fee.feeType}
      </td>
      <td className="px-5 py-1.5">
        <TextInput
          value={fee.name}
          onCommit={(v) => update({ name: v })}
          disabled={!editable}
          className="w-full text-ink"
        />
      </td>
      <td className="px-5 py-1.5 text-right">
        <NumberInput
          value={fee.amountUsd}
          onCommit={(v) => update({ amountUsd: v })}
          disabled={!editable}
          className="w-28 text-right font-mono"
        />
      </td>
      <td className="px-5 py-1.5">
        <TextInput
          value={fee.notes ?? ""}
          onCommit={(v) => update({ notes: v || null })}
          disabled={!editable}
          placeholder="—"
          className="w-full text-xs text-muted"
        />
      </td>
      {editable && (
        <td className="px-2 py-1.5 text-center">
          <button
            type="button"
            onClick={onRemove}
            className="text-muted hover:text-danger p-1"
          >
            <Trash2 size={12} />
          </button>
        </td>
      )}
    </tr>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Inputs
// ════════════════════════════════════════════════════════════════════════════

function TextInput({
  value,
  onCommit,
  disabled,
  className = "",
  placeholder,
}: {
  value: string;
  onCommit: (v: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      defaultValue={value}
      disabled={disabled}
      placeholder={placeholder}
      onBlur={(e) => e.target.value !== value && onCommit(e.target.value)}
      className={`bg-transparent border-b border-transparent hover:border-line focus:border-accent focus:outline-none px-1 -mx-1 disabled:opacity-50 ${className}`}
    />
  );
}

function NumberInput({
  value,
  onCommit,
  disabled,
  className = "",
}: {
  value: number;
  onCommit: (v: number) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <input
      type="text"
      inputMode="decimal"
      defaultValue={value > 0 ? value.toFixed(2) : ""}
      disabled={disabled}
      placeholder="0"
      onBlur={(e) => {
        const v = Number.parseFloat(e.target.value.replace(/[^0-9.]/g, "")) || 0;
        if (Math.abs(v - value) >= 0.01) onCommit(v);
      }}
      className={`tabular-nums bg-transparent border-b border-transparent hover:border-line focus:border-accent focus:outline-none px-1 disabled:opacity-50 ${className}`}
    />
  );
}

function AddPublisherDropdown({
  publishers,
  onSelect,
  disabled,
}: {
  publishers: PublisherCatalog[];
  onSelect: (id: string) => void;
  disabled: boolean;
}) {
  return (
    <select
      defaultValue=""
      onChange={(e) => {
        if (e.target.value) {
          onSelect(e.target.value);
          e.target.value = "";
        }
      }}
      disabled={disabled}
      className="rounded-md border border-line bg-white px-3 py-2 text-sm text-muted hover:border-ink-2 focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft cursor-pointer disabled:opacity-50"
    >
      <option value="">+ Agregar publisher…</option>
      {publishers.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
          {!p.agencyPaysDefault ? "  (cliente paga directo)" : ""}
        </option>
      ))}
    </select>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
        {label}
      </dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}

// Suppress unused
void GripVertical;
