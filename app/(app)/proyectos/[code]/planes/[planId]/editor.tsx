"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  GripVertical,
  Plus,
  Receipt,
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
import type {
  markets as marketsTable,
  metricsCatalog as metricsTable,
} from "@/db/schema";
import { formatPct, formatUsd, formatUsdCompact } from "@/lib/format";

// Solo los campos que el editor consume — viene de listPublishersForClient.
type PublisherCatalog = {
  id: string;
  slug: string;
  name: string;
  enabled: boolean;
  agencyPaysDefault: boolean;
  sortOrder: number;
};
type Market = (typeof marketsTable.$inferSelect);
type MetricCatalog = (typeof metricsTable.$inferSelect);

// Mapeo cost_method → métrica principal slug del catálogo
const COST_METHOD_PRIMARY_METRIC: Record<string, string | null> = {
  dCPV: "views",
  CPV: "views",
  dCPM: "impressions",
  CPM: "impressions",
  dCPC: "clicks",
  CPC: "clicks",
  CPA: "conversions",
  Flat: null,
  Other: null,
};

// Par tarifa↔delivery para auto-cálculo bidireccional.
// delivery = (amount × multiplier) / rate
// rate     = (amount × multiplier) / delivery
// (CPM tiene multiplier=1000 porque es "por cada mil")
const COST_METHOD_PAIR: Record<
  string,
  { rate: string; delivery: string; multiplier: number } | null
> = {
  dCPV: { rate: "cpv", delivery: "views", multiplier: 1 },
  CPV: { rate: "cpv", delivery: "views", multiplier: 1 },
  dCPM: { rate: "cpm", delivery: "impressions", multiplier: 1000 },
  CPM: { rate: "cpm", delivery: "impressions", multiplier: 1000 },
  dCPC: { rate: "cpc", delivery: "clicks", multiplier: 1 },
  CPC: { rate: "cpc", delivery: "clicks", multiplier: 1 },
  CPA: { rate: "cpa", delivery: "conversions", multiplier: 1 },
  Flat: null,
  Other: null,
};
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
  allMarkets,
  allMetrics,
}: {
  detail: PlanDetail;
  allPublishers: PublisherCatalog[];
  allMarkets: Market[];
  allMetrics: MetricCatalog[];
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

  // Período del plan derivado de las fechas de los placements
  const allPlacements = detail.publishers.flatMap((p) => p.placements);
  const periodStart =
    allPlacements
      .map((p) => p.startDate)
      .filter((d): d is string => !!d)
      .sort()[0] ?? null;
  const periodEnd =
    allPlacements
      .map((p) => p.endDate)
      .filter((d): d is string => !!d)
      .sort()
      .pop() ?? null;

  // ─── Plan-level handlers ────────────────────────────────────────────
  const onChangePlanField = (field: "name" | "notesMd", value: string) => {
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

  const onAddFee = (
    feeType: "management" | "setup" | "reporting" | "custom" = "custom",
  ) => {
    const defaultName =
      feeType === "management"
        ? "Management Fee"
        : feeType === "setup"
          ? "Set Up Fee"
          : feeType === "reporting"
            ? "Reporting Fee"
            : "Nuevo fee";
    startTransition(async () => {
      await addFee({
        planId: detail.plan.id,
        feeType,
        name: defaultName,
        amountUsd: feeType === "management" ? undefined : 0,
        ratePct: feeType === "management" ? 15 : null,
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
          <a
            href={`/api/plans/${detail.plan.id}/export.xlsx`}
            className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper-2"
            title="Descargar plan en Excel"
          >
            <Download size={14} strokeWidth={2} />
            Excel
          </a>
          <a
            href={`/api/plans/${detail.plan.id}/export.pdf`}
            className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper-2"
            title="Descargar plan en PDF"
          >
            <FileText size={14} strokeWidth={2} />
            PDF
          </a>
          <Link
            href={`/proyectos/${detail.project.code}/planes/${detail.plan.id}/billing`}
            className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper-2"
          >
            <Receipt size={14} strokeWidth={2} />
            Billing del plan
          </Link>
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

      {/* Plan metadata strip — todas las fechas son derivadas de los placements */}
      <section className="rounded-lg border border-line bg-white px-5 py-4 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3">
        <Field label="Período (derivado)">
          <span className="font-mono text-sm text-ink-2">
            {periodStart ?? "—"}
            <span className="text-stone-300"> → </span>
            {periodEnd ?? "—"}
          </span>
          <p className="text-[10px] text-muted mt-0.5">
            min/max de los placements
          </p>
        </Field>
        <Field label="Total media + fees">
          <span className="font-mono text-sm font-semibold tabular-nums">
            {formatUsd(planTotal)}
          </span>
          <p className="text-[10px] text-muted mt-0.5">
            {formatUsdCompact(detail.totals.media)} +{" "}
            {formatUsdCompact(detail.totals.fees)} fees
          </p>
        </Field>
        <Field label="Placements">
          <span className="font-mono text-sm font-semibold tabular-nums">
            {allPlacements.length}
          </span>
          <p className="text-[10px] text-muted mt-0.5">
            {detail.publishers.length} publishers
          </p>
        </Field>
        <Field label="vs Project budget">
          {projectBudget > 0 ? (
            <>
              <span
                className={`font-mono text-sm font-semibold tabular-nums ${overBudget ? "text-warn" : "text-ink"}`}
              >
                {formatPct(coveragePct, 0)}
              </span>
              <p className="text-[10px] text-muted mt-0.5">
                de {formatUsdCompact(projectBudget)}
              </p>
            </>
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
            allMarkets={allMarkets}
            allMetrics={allMetrics}
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
                  <th className="text-right font-medium px-5 py-2">Rate %</th>
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
            <div className="border-t border-line-soft px-5 py-2 flex items-center gap-3 text-xs text-muted">
              <span>Agregar fee:</span>
              <button
                type="button"
                onClick={() => onAddFee("management")}
                disabled={pending || detail.fees.some((f) => f.feeType === "management")}
                className="inline-flex items-center gap-1 hover:text-ink disabled:opacity-30"
                title={
                  detail.fees.some((f) => f.feeType === "management")
                    ? "Ya hay un management fee en este plan"
                    : undefined
                }
              >
                <Plus size={11} strokeWidth={2.5} />
                Management
              </button>
              <button
                type="button"
                onClick={() => onAddFee("setup")}
                disabled={pending}
                className="inline-flex items-center gap-1 hover:text-ink"
              >
                <Plus size={11} strokeWidth={2.5} />
                Set Up
              </button>
              <button
                type="button"
                onClick={() => onAddFee("reporting")}
                disabled={pending}
                className="inline-flex items-center gap-1 hover:text-ink"
              >
                <Plus size={11} strokeWidth={2.5} />
                Reporting
              </button>
              <button
                type="button"
                onClick={() => onAddFee("custom")}
                disabled={pending}
                className="inline-flex items-center gap-1 hover:text-ink"
              >
                <Plus size={11} strokeWidth={2.5} />
                Custom
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
  allMarkets,
  allMetrics,
  onChange,
  startTransition,
}: {
  pub: PlanPublisherGroup;
  editable: boolean;
  allMarkets: Market[];
  allMetrics: MetricCatalog[];
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
                  allMarkets={allMarkets}
                  allMetrics={allMetrics}
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
  allMarkets,
  allMetrics,
  onChange,
  startTransition,
}: {
  placement: PlanPlacement;
  editable: boolean;
  allMarkets: Market[];
  allMetrics: MetricCatalog[];
  onChange: () => void;
  startTransition: ReturnType<typeof useTransition>[1];
}) {
  const [expanded, setExpanded] = useState(false);

  const update = (
    partial: Omit<Parameters<typeof updatePlacement>[0], "placementId">,
  ) => {
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
          <select
            value={placement.marketId ?? ""}
            disabled={!editable}
            onChange={(e) =>
              update({ marketId: e.target.value || null })
            }
            className="text-xs bg-transparent border-b border-transparent hover:border-line focus:border-accent focus:outline-none disabled:opacity-50 max-w-[180px]"
          >
            <option value="">— sin mercado —</option>
            {allMarkets.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
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
              allMetrics={allMetrics}
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
  allMetrics,
  update,
}: {
  placement: PlanPlacement;
  editable: boolean;
  allMetrics: MetricCatalog[];
  update: (
    partial: Omit<Parameters<typeof updatePlacement>[0], "placementId">,
  ) => void;
}) {
  // Métrica principal según el cost_method seleccionado
  const primarySlug = placement.costMethod
    ? COST_METHOD_PRIMARY_METRIC[placement.costMethod] ?? null
    : null;
  const primaryMetric = primarySlug
    ? allMetrics.find((m) => m.slug === primarySlug) ?? null
    : null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
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
        </div>

        <Field label="Audiencia">
          <textarea
            defaultValue={placement.audience ?? ""}
            disabled={!editable}
            rows={3}
            placeholder="25-44 viajeros frecuentes, lookalike de site visitors, retargeting, etc."
            onBlur={(e) =>
              e.target.value !== (placement.audience ?? "") &&
              update({ audience: e.target.value || null })
            }
            className="w-full text-sm bg-white border border-line rounded-md px-2 py-1.5 focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft disabled:opacity-50"
          />
        </Field>

        <Field label="Notas / formatos / detalles">
          <textarea
            defaultValue={placement.notesMd ?? ""}
            disabled={!editable}
            rows={3}
            placeholder="Formato: video vertical 15-30s, 3 versiones rotativas, etc."
            onBlur={(e) =>
              e.target.value !== (placement.notesMd ?? "") &&
              update({ notesMd: e.target.value || null })
            }
            className="w-full text-sm bg-white border border-line rounded-md px-2 py-1.5 focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft disabled:opacity-50"
          />
        </Field>
      </div>
      <div>
        {primaryMetric && placement.costMethod && (
          <PrincipalPairEditor
            costMethod={placement.costMethod}
            primaryMetricName={primaryMetric.name}
            primaryUnit={primaryMetric.unit}
            metricsJson={placement.metricsJson}
            amountUsd={placement.amountUsd}
            editable={editable}
            onCommit={(m) => update({ metricsJson: m })}
          />
        )}
        <MetricsEditor
          metrics={placement.metricsJson}
          allMetrics={allMetrics}
          amountUsd={placement.amountUsd}
          editable={editable}
          onCommit={(m) => update({ metricsJson: m })}
        />
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Editor del par tarifa↔delivery según el cost method del placement.
// El planner edita uno y la app recalcula el otro desde amount × multiplier.
// Se almacenan AMBOS valores en metrics_json para no perder data.
// ════════════════════════════════════════════════════════════════════════════

function PrincipalPairEditor({
  costMethod,
  primaryMetricName,
  primaryUnit,
  metricsJson,
  amountUsd,
  editable,
  onCommit,
}: {
  costMethod: string;
  primaryMetricName: string;
  primaryUnit: string | null;
  metricsJson: Record<string, number>;
  amountUsd: number;
  editable: boolean;
  onCommit: (next: Record<string, number>) => void;
}) {
  const pair = COST_METHOD_PAIR[costMethod];
  if (!pair) return null;

  const rateInJson = metricsJson[pair.rate];
  const deliveryInJson = metricsJson[pair.delivery];

  // Effective values: si una está cargada, computamos la otra; si no, ambas vacías.
  let effRate: number | null =
    typeof rateInJson === "number" && rateInJson > 0 ? rateInJson : null;
  let effDelivery: number | null =
    typeof deliveryInJson === "number" && deliveryInJson > 0
      ? deliveryInJson
      : null;

  if (effRate == null && effDelivery != null && amountUsd > 0) {
    effRate = (amountUsd * pair.multiplier) / effDelivery;
  }
  if (effDelivery == null && effRate != null && amountUsd > 0) {
    effDelivery = (amountUsd * pair.multiplier) / effRate;
  }

  // Detectar inconsistencia (si ambas vinieron del jsonb y la cuenta no cierra)
  const bothFromJson =
    typeof rateInJson === "number" &&
    rateInJson > 0 &&
    typeof deliveryInJson === "number" &&
    deliveryInJson > 0;
  let inconsistency: number | null = null;
  if (bothFromJson && amountUsd > 0) {
    const expectedDelivery = (amountUsd * pair.multiplier) / rateInJson;
    const diff = Math.abs(expectedDelivery - deliveryInJson) / expectedDelivery;
    if (diff > 0.005) inconsistency = diff;
  }

  const onChangeRate = (newRate: number) => {
    if (newRate <= 0) {
      const next = { ...metricsJson };
      delete next[pair.rate];
      delete next[pair.delivery];
      onCommit(next);
      return;
    }
    const newDelivery =
      amountUsd > 0 ? (amountUsd * pair.multiplier) / newRate : 0;
    onCommit({
      ...metricsJson,
      [pair.rate]: Number(newRate.toFixed(6)),
      [pair.delivery]: Math.round(newDelivery),
    });
  };

  const onChangeDelivery = (newDelivery: number) => {
    if (newDelivery <= 0) {
      const next = { ...metricsJson };
      delete next[pair.rate];
      delete next[pair.delivery];
      onCommit(next);
      return;
    }
    const newRate =
      amountUsd > 0 ? (amountUsd * pair.multiplier) / newDelivery : 0;
    onCommit({
      ...metricsJson,
      [pair.rate]: Number(newRate.toFixed(6)),
      [pair.delivery]: Math.round(newDelivery),
    });
  };

  return (
    <div className="mb-2 px-3 py-2 bg-accent-soft/40 border border-accent-soft rounded text-[11px] text-ink">
      <p className="mb-1.5">
        <span className="font-medium uppercase tracking-[0.06em] text-accent">
          Métrica principal por {costMethod}:
        </span>{" "}
        <span className="font-mono">{pair.delivery}</span>{" "}
        <span className="text-muted">({primaryMetricName})</span>
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] font-medium uppercase tracking-[0.06em] text-muted block mb-0.5">
            Tarifa ({pair.rate.toUpperCase()})
          </label>
          <RateInput
            value={effRate}
            disabled={!editable}
            onCommit={onChangeRate}
          />
        </div>
        <div>
          <label className="text-[10px] font-medium uppercase tracking-[0.06em] text-muted block mb-0.5">
            Delivery ({primaryUnit ?? pair.delivery})
          </label>
          <DeliveryInput
            value={effDelivery}
            disabled={!editable}
            onCommit={onChangeDelivery}
          />
        </div>
      </div>
      <p className="mt-1.5 text-[10px] text-muted">
        Editás uno y la app calcula el otro desde el monto del placement
        ({" "}
        <span className="font-mono">${amountUsd.toFixed(2)}</span>
        {pair.multiplier !== 1 && (
          <span className="font-mono"> × {pair.multiplier}</span>
        )}
        {" "}
        / X = Y).
      </p>
      {inconsistency !== null && (
        <p className="mt-1 text-[10px] text-warn">
          ⚠ Tarifa y delivery cargados no coinciden ({(inconsistency * 100).toFixed(1)}% de diferencia con el monto). Cambiá uno para realinear.
        </p>
      )}
    </div>
  );
}

function RateInput({
  value,
  disabled,
  onCommit,
}: {
  value: number | null;
  disabled: boolean;
  onCommit: (v: number) => void;
}) {
  // Tarifas suelen ser pequeñas (CPV $0.0028, CPM $5.20); 4 decimales por
  // defecto. Aceptamos que el planner ingrese hasta 6.
  const display = value != null ? formatRateDisplay(value) : "";
  return (
    <input
      key={display}
      type="text"
      inputMode="decimal"
      defaultValue={display}
      disabled={disabled}
      placeholder="0.0000"
      onBlur={(e) => {
        const v = Number.parseFloat(e.target.value.replace(/[^0-9.]/g, "")) || 0;
        if (value == null || Math.abs(v - value) >= 0.000001) onCommit(v);
      }}
      className="w-full font-mono text-sm tabular-nums bg-white border border-line rounded px-2 py-1 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:opacity-50"
    />
  );
}

function DeliveryInput({
  value,
  disabled,
  onCommit,
}: {
  value: number | null;
  disabled: boolean;
  onCommit: (v: number) => void;
}) {
  const display =
    value != null
      ? new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(value)
      : "";
  return (
    <input
      key={display}
      type="text"
      inputMode="numeric"
      defaultValue={display}
      disabled={disabled}
      placeholder="0"
      onBlur={(e) => {
        const v =
          Number.parseFloat(e.target.value.replace(/[^0-9.]/g, "")) || 0;
        if (value == null || Math.abs(v - value) >= 1) onCommit(v);
      }}
      className="w-full font-mono text-sm tabular-nums bg-white border border-line rounded px-2 py-1 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:opacity-50"
    />
  );
}

function formatRateDisplay(v: number): string {
  if (v >= 1) return v.toFixed(2);
  if (v >= 0.01) return v.toFixed(4);
  return v.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

// ════════════════════════════════════════════════════════════════════════════
// Editor de metrics_json: el planner elige métricas direct del catálogo,
// las calculated se computan automáticamente desde direct + amount.
// ════════════════════════════════════════════════════════════════════════════

function MetricsEditor({
  metrics,
  allMetrics,
  amountUsd,
  editable,
  onCommit,
}: {
  metrics: Record<string, number>;
  allMetrics: MetricCatalog[];
  amountUsd: number;
  editable: boolean;
  onCommit: (m: Record<string, number>) => void;
}) {
  // Solo guardamos las métricas direct. Calculated se derivan al render.
  const directMetrics = allMetrics.filter((m) => m.kind === "direct");
  const calculatedMetrics = allMetrics.filter((m) => m.kind === "calculated");
  const directBySlug = new Map(directMetrics.map((m) => [m.slug, m]));

  const [draft, setDraft] = useState<Array<{ slug: string; value: string }>>(
    Object.entries(metrics)
      .filter(([k]) => directBySlug.has(k))
      .map(([k, v]) => ({ slug: k, value: String(v) })),
  );

  const commit = (next: typeof draft) => {
    const obj: Record<string, number> = {};
    for (const { slug, value } of next) {
      const k = slug.trim();
      if (!k) continue;
      const v = Number.parseFloat(value);
      if (Number.isFinite(v)) obj[k] = v;
    }
    onCommit(obj);
  };

  const updateRow = (idx: number, partial: Partial<{ slug: string; value: string }>) => {
    const next = draft.map((r, i) => (i === idx ? { ...r, ...partial } : r));
    setDraft(next);
    commit(next);
  };

  const addRow = (slug = "") => {
    setDraft((d) => [...d, { slug, value: "" }]);
  };

  const removeRow = (idx: number) => {
    const next = draft.filter((_, i) => i !== idx);
    setDraft(next);
    commit(next);
  };

  // Slugs ya usados en el draft, para filtrar el dropdown
  const usedSlugs = new Set(draft.map((d) => d.slug).filter(Boolean));
  const availableMetrics = directMetrics.filter((m) => !usedSlugs.has(m.slug));

  // Cómputo de métricas calculadas desde el draft
  const directValues: Record<string, number> = {};
  for (const { slug, value } of draft) {
    const v = Number.parseFloat(value);
    if (slug && Number.isFinite(v)) directValues[slug] = v;
  }

  function evalCalculated(formula: string): number | null {
    // Soportamos fórmulas simples: "amount/views", "clicks/impressions",
    // "amount/impressions × 1000", "amount/conversions", "views/impressions".
    // Si hay un × N, multiplicamos al final.
    let f = formula.toLowerCase().replace(/\s+/g, "");
    let multiplier = 1;
    const xMatch = f.match(/×(\d+)/);
    if (xMatch) {
      multiplier = Number.parseInt(xMatch[1], 10);
      f = f.replace(/×\d+/, "");
    }
    const slashMatch = f.match(/^([a-z_]+)\/([a-z_]+)$/);
    if (!slashMatch) return null;
    const [, num, den] = slashMatch;
    const numerator = num === "amount" ? amountUsd : directValues[num];
    const denominator = den === "amount" ? amountUsd : directValues[den];
    if (
      numerator == null ||
      denominator == null ||
      !Number.isFinite(numerator) ||
      !Number.isFinite(denominator) ||
      denominator === 0
    )
      return null;
    return (numerator / denominator) * multiplier;
  }

  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted mb-2">
        Indicadores estimados
      </p>
      <div className="rounded-md border border-line bg-white">
        {draft.length === 0 && calculatedMetrics.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-muted">
            Sin indicadores cargados
          </div>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {draft.map((row, idx) => {
                const metric = directBySlug.get(row.slug);
                return (
                  <tr key={idx} className="border-b border-line-soft last:border-b-0">
                    <td className="px-2 py-1 w-[45%]">
                      <select
                        value={row.slug}
                        disabled={!editable}
                        onChange={(e) => updateRow(idx, { slug: e.target.value })}
                        className="w-full text-xs bg-transparent focus:outline-none disabled:opacity-50"
                      >
                        {row.slug && !metric && (
                          <option value={row.slug}>{row.slug} (no en catálogo)</option>
                        )}
                        <option value="">— elegir métrica —</option>
                        {availableMetrics
                          .concat(metric ? [metric] : [])
                          .sort((a, b) => a.sortOrder - b.sortOrder)
                          .map((m) => (
                            <option key={m.id} value={m.slug}>
                              {m.name} {m.unit ? `(${m.unit})` : ""}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={row.value}
                        placeholder="0"
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
                );
              })}
            </tbody>
          </table>
        )}
        {editable && (
          <div className="border-t border-line-soft px-2 py-1 flex items-center gap-2">
            <button
              type="button"
              onClick={() => addRow("")}
              className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-ink"
            >
              <Plus size={10} strokeWidth={2.5} />
              Agregar métrica
            </button>
            {availableMetrics.length > 0 && (
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    addRow(e.target.value);
                    e.target.value = "";
                  }
                }}
                className="text-[11px] bg-transparent text-muted hover:text-ink focus:outline-none"
              >
                <option value="">elegir del catálogo…</option>
                {availableMetrics.map((m) => (
                  <option key={m.id} value={m.slug}>
                    {m.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>

      {calculatedMetrics.length > 0 && (
        <div className="mt-2 rounded-md border border-line-soft bg-paper-2/40 px-3 py-2">
          <p className="text-[10px] uppercase tracking-[0.08em] font-medium text-muted mb-1">
            Métricas calculadas
          </p>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] font-mono">
            {calculatedMetrics.map((m) => {
              const v = m.formula ? evalCalculated(m.formula) : null;
              return (
                <li key={m.id} className="flex items-baseline justify-between gap-2">
                  <span className="text-muted truncate">{m.slug}</span>
                  <span
                    className={
                      v == null ? "text-stone-300" : "text-ink-2 tabular-nums"
                    }
                    title={m.formula ?? undefined}
                  >
                    {v == null
                      ? "—"
                      : m.unit === "%"
                        ? `${(v * 100).toFixed(2)}%`
                        : v < 1
                          ? `$${v.toFixed(4)}`
                          : `$${v.toFixed(2)}`}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
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
  const update = (
    partial: Omit<Parameters<typeof updateFee>[0], "feeId">,
  ) => {
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

  const isManagement = fee.feeType === "management";

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
        {isManagement ? (
          <RatePctInput
            value={fee.ratePct}
            disabled={!editable}
            onCommit={(v) => update({ ratePct: v })}
          />
        ) : (
          <span className="text-stone-300 text-xs font-mono">—</span>
        )}
      </td>
      <td className="px-5 py-1.5 text-right">
        {fee.isAutoComputed ? (
          <span
            className="font-mono text-ink-2 tabular-nums"
            title="Calculado automáticamente desde el rate y el total media del plan"
          >
            {formatUsd(fee.amountUsd)}
          </span>
        ) : (
          <NumberInput
            value={fee.amountUsd}
            onCommit={(v) => update({ amountUsd: v })}
            disabled={!editable}
            className="w-28 text-right font-mono"
          />
        )}
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

function RatePctInput({
  value,
  onCommit,
  disabled,
}: {
  value: number | null;
  onCommit: (v: number | null) => void;
  disabled?: boolean;
}) {
  const display = value != null && value > 0 ? value.toFixed(2) : "";
  return (
    <span className="inline-flex items-center gap-0.5 justify-end">
      <input
        key={display}
        type="text"
        inputMode="decimal"
        defaultValue={display}
        disabled={disabled}
        placeholder="—"
        onBlur={(e) => {
          const text = e.target.value.replace(/[^0-9.]/g, "");
          if (!text) {
            if (value != null) onCommit(null);
            return;
          }
          const v = Number.parseFloat(text);
          if (!Number.isFinite(v)) return;
          if (value == null || Math.abs(v - value) >= 0.01) onCommit(v);
        }}
        className="w-16 text-right tabular-nums font-mono bg-transparent border-b border-transparent hover:border-line focus:border-accent focus:outline-none px-1 disabled:opacity-50"
      />
      <span className="text-muted text-xs">%</span>
    </span>
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
