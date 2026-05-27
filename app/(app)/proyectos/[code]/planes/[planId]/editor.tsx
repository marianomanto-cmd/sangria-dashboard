"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  Copy,
  Download,
  FileText,
  Plus,
  Receipt,
  Scale,
  Trash2,
  X,
} from "lucide-react";
import {
  addFee,
  addPlacement,
  addPublisherToPlan,
  duplicatePlacement,
  duplicatePlanPublisher,
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
import {
  evalNumberInput,
  formatAmountInput,
  formatIntInput,
  formatPct,
  formatUsd,
  formatUsdCompact,
} from "@/lib/format";
import {
  COST_METHOD_PRIMARY_METRIC,
  COST_METHOD_PAIR,
  COST_METHODS,
  DIRECT_METRIC_RATES,
  type CostMethod,
} from "@/lib/cost-methods";
import { formatDate, type Language } from "@/lib/i18n";

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
type UpdatePlacementPartial = Omit<
  Parameters<typeof updatePlacement>[0],
  "placementId"
>;
type StartTransition = ReturnType<typeof useTransition>[1];

const STATUS_STYLE: Record<string, { label: string; cls: string; dot: string }> = {
  draft: { label: "draft", cls: "bg-paper-2 text-muted border-line", dot: "bg-muted" },
  ready_to_send: { label: "ready to send", cls: "bg-warn-soft text-warn border-warn-soft", dot: "bg-warn" },
  approved: { label: "approved", cls: "bg-success-soft text-success border-success-soft", dot: "bg-success" },
  archived: { label: "archived", cls: "bg-paper-2 text-muted border-line", dot: "bg-muted" },
};

export function PlanEditor({
  detail,
  allPublishers,
  allMarkets,
  allMetrics,
  lang = "en",
}: {
  detail: PlanDetail;
  allPublishers: PublisherCatalog[];
  allMarkets: Market[];
  allMetrics: MetricCatalog[];
  lang?: Language;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const editable = detail.plan.status === "draft";

  const refresh = () => router.refresh();

  const availablePublishers = allPublishers;

  const projectBudget = Number.parseFloat(detail.project.totalGrossBudgetUsd ?? "0");
  const planTotal = detail.totals.grand;
  const coveragePct = projectBudget > 0 ? (planTotal / projectBudget) * 100 : 0;
  const overBudget = coveragePct > 100;

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
            className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper-2"
            title="Descargar plan en Excel"
          >
            <Download size={14} strokeWidth={2} />
            Excel
          </a>
          <a
            href={`/api/plans/${detail.plan.id}/export.pdf`}
            className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper-2"
            title="Descargar plan en PDF"
          >
            <FileText size={14} strokeWidth={2} />
            PDF
          </a>
          <Link
            href={`/proyectos/${detail.project.code}/planes/${detail.plan.id}/billing`}
            className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper-2"
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
              className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper-2 disabled:opacity-50"
            >
              Editar (nueva versión)
            </button>
          )}
        </div>
      </header>

      {/* Plan metadata strip — todas las fechas son derivadas de los placements */}
      <section className="rounded-lg border border-line bg-white dark:bg-paper-2 px-5 py-4 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3">
        <Field label={lang === "es" ? "Período (derivado)" : "Period (derived)"}>
          <span className="font-mono text-sm text-ink-2">
            {formatDate(periodStart, lang)}
            <span className="text-line"> → </span>
            {formatDate(periodEnd, lang)}
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
        <section className="rounded-lg border border-line bg-white dark:bg-paper-2 px-5 py-4">
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

      {/* Workspace: planilla de placements (izq) + inspector (der) */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold flex items-baseline justify-between">
          <span>
            Publishers
            <span className="ml-2 text-xs font-normal text-muted">
              ({detail.publishers.length} · {allPlacements.length} placements)
            </span>
          </span>
          <span className="text-[11px] uppercase tracking-[0.08em] text-muted font-medium">
            Total media: {formatUsd(detail.totals.media)}
          </span>
        </h2>

        <PlanWorkspace
          detail={detail}
          editable={editable}
          allMarkets={allMarkets}
          allMetrics={allMetrics}
          onChange={refresh}
          startTransition={startTransition}
          availablePublishers={availablePublishers}
          onAddPublisher={onAddPublisher}
          pending={pending}
        />
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

        <div className="rounded-lg border border-line bg-white dark:bg-paper-2 overflow-hidden">
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
          <ul className="rounded-lg border border-line bg-white dark:bg-paper-2 divide-y divide-line-soft">
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
                  <span className="text-line text-xs">sin PDF</span>
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
// Workspace: planilla (izquierda) + inspector del placement seleccionado (der).
// La selección vive acá; sobrevive a router.refresh() porque el componente no
// se desmonta. Si el placement seleccionado se borra, el inspector muestra el
// placeholder.
// ════════════════════════════════════════════════════════════════════════════

function PlanWorkspace({
  detail,
  editable,
  allMarkets,
  allMetrics,
  onChange,
  startTransition,
  availablePublishers,
  onAddPublisher,
  pending,
}: {
  detail: PlanDetail;
  editable: boolean;
  allMarkets: Market[];
  allMetrics: MetricCatalog[];
  onChange: () => void;
  startTransition: StartTransition;
  availablePublishers: PublisherCatalog[];
  onAddPublisher: (id: string) => void;
  pending: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const allPlacements = detail.publishers.flatMap((p) => p.placements);
  const selected = allPlacements.find((p) => p.id === selectedId) ?? null;

  const updateSelected = (partial: UpdatePlacementPartial) => {
    if (!selected) return;
    startTransition(async () => {
      await updatePlacement({ ...partial, placementId: selected.id });
      onChange();
    });
  };

  const grand = detail.totals.grand;
  const projectBudget = Number.parseFloat(
    detail.project.totalGrossBudgetUsd ?? "0",
  );
  const coveragePct = projectBudget > 0 ? (grand / projectBudget) * 100 : 0;

  return (
    <div>
      <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-md border border-line bg-white/95 dark:bg-paper-2/95 backdrop-blur px-4 py-2 text-xs">
        <TotalChip label="Media" value={formatUsd(detail.totals.media)} />
        <TotalChip label="Fees" value={formatUsd(detail.totals.fees)} />
        <TotalChip label="Total" value={formatUsd(grand)} strong />
        {projectBudget > 0 && (
          <TotalChip
            label="Cobertura"
            value={formatPct(coveragePct, 0)}
            warn={coveragePct > 100}
          />
        )}
        <span className="ml-auto text-[11px] text-muted">
          {allPlacements.length} placements · {detail.publishers.length} publishers
        </span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_440px] gap-3 items-start">
      {/* Planilla */}
      <div className="space-y-3 min-w-0">
        {detail.publishers.map((pub) => (
          <PublisherGroup
            key={pub.id}
            pub={pub}
            editable={editable}
            allMarkets={allMarkets}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onChange={onChange}
            startTransition={startTransition}
          />
        ))}

        {detail.publishers.length === 0 && (
          <div className="rounded-lg border border-dashed border-line px-5 py-8 text-center text-xs text-muted">
            Todavía no hay publishers en este plan.
          </div>
        )}

        {editable && availablePublishers.length > 0 && (
          <AddPublisherDropdown
            publishers={availablePublishers}
            onSelect={onAddPublisher}
            disabled={pending}
          />
        )}
      </div>

      {/* Inspector */}
      <div className="lg:sticky lg:top-4">
        {selected ? (
          <PlacementInspector
            key={selected.id}
            placement={selected}
            editable={editable}
            allMetrics={allMetrics}
            update={updateSelected}
          />
        ) : (
          <div className="rounded-lg border border-dashed border-line bg-paper-2/40 px-5 py-10 text-center">
            <p className="text-sm font-medium text-muted">
              Seleccioná un placement
            </p>
            <p className="text-xs text-muted mt-1">
              Hacé clic en una fila para ver y editar fechas, audiencia,
              métricas y notas acá.
            </p>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Grupo de publisher: cabecera (total, balance, dup/remove) + filas de
// placements. Sin acordeón: todo visible, una sola superficie.
// ════════════════════════════════════════════════════════════════════════════

function PublisherGroup({
  pub,
  editable,
  allMarkets,
  selectedId,
  onSelect,
  onChange,
  startTransition,
}: {
  pub: PlanPublisherGroup;
  editable: boolean;
  allMarkets: Market[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onChange: () => void;
  startTransition: StartTransition;
}) {
  const balance = pub.totalPlannedUsd - pub.placementsTotalUsd;
  const balanced = Math.abs(balance) < 0.01;

  const onUpdateTotal = (newTotal: number) => {
    startTransition(async () => {
      await updatePlanPublisher({ mppId: pub.id, totalPlannedUsd: newTotal });
      onChange();
    });
  };

  const onBalance = () => {
    startTransition(async () => {
      await updatePlanPublisher({
        mppId: pub.id,
        totalPlannedUsd: pub.placementsTotalUsd,
      });
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

  const onDuplicatePub = () => {
    startTransition(async () => {
      const r = await duplicatePlanPublisher(pub.id);
      if (!r.ok) alert(r.error);
      onChange();
    });
  };

  return (
    <div className="rounded-lg border border-line border-l-2 border-l-accent bg-white dark:bg-paper-2 overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-line bg-paper-2">
        <span className="inline-block h-2 w-2 rounded-full bg-accent shrink-0" />
        <span className="text-[15px] font-semibold text-ink flex-1 min-w-0 truncate">
          {pub.publisherName}
          {!pub.agencyPays && (
            <span className="ml-2 text-[10px] font-normal text-muted bg-white dark:bg-paper border border-line px-1.5 py-0.5 rounded">
              cliente paga directo
            </span>
          )}
        </span>
        <span className="text-xs text-muted shrink-0">
          {pub.placements.length} placement{pub.placements.length === 1 ? "" : "s"}
        </span>
        <span className="flex items-center gap-1.5 shrink-0 text-xs">
          <span className="text-[10px] uppercase tracking-[0.06em] text-muted">
            subtotal
          </span>
          <span
            className={`font-mono tabular-nums ${balanced ? "text-muted" : "text-warn"}`}
          >
            {formatUsd(pub.placementsTotalUsd)}
          </span>
          <span className="text-line">/</span>
          <span className="text-[10px] uppercase tracking-[0.06em] text-muted">
            total
          </span>
          <NumberInput
            value={pub.totalPlannedUsd}
            onCommit={onUpdateTotal}
            disabled={!editable}
            className="w-32 text-right font-mono font-semibold"
          />
        </span>
        {editable && (
          <>
            <button
              type="button"
              onClick={onDuplicatePub}
              className="text-muted hover:text-ink p-1 shrink-0"
              title="Duplicar publisher (con todos sus placements)"
            >
              <Copy size={14} />
            </button>
            <button
              type="button"
              onClick={onRemovePub}
              className="text-muted hover:text-danger p-1 -mr-1 shrink-0"
              title="Eliminar publisher"
            >
              <Trash2 size={14} />
            </button>
          </>
        )}
      </div>

      {!balanced && (
        <div className="flex items-center gap-2 border-b border-warn-soft bg-warn-soft/40 px-4 py-1.5 text-[11px] text-warn font-medium">
          <span className="flex-1">
            {balance > 0
              ? `Faltan ${formatUsd(balance)} para llegar al total del publisher`
              : `Hay ${formatUsd(-balance)} de más en los placements vs el total`}
          </span>
          {editable && (
            <button
              type="button"
              onClick={onBalance}
              className="inline-flex items-center gap-1 rounded border border-warn/40 px-1.5 py-0.5 hover:bg-warn-soft"
              title="Poner el total del publisher igual a la suma de placements"
            >
              <Scale size={11} strokeWidth={2} />
              Balancear
            </button>
          )}
        </div>
      )}

      {pub.placements.length === 0 ? (
        <div className="px-4 py-5 text-center text-xs text-muted">
          Sin placements cargados todavía.
        </div>
      ) : (
        <table
          className="w-full text-xs"
          onKeyDown={(e) => moveGridFocus(e, onAddPlacement)}
        >
          <thead className="bg-paper">
            <tr className="text-[10px] uppercase tracking-[0.06em] text-muted">
              <th className="text-left font-medium pl-5 pr-2 py-1.5">Placement</th>
              <th className="text-left font-medium px-2 py-1.5">Mercado</th>
              <th className="text-left font-medium px-2 py-1.5">Método</th>
              <th className="text-right font-medium px-2 py-1.5">Monto</th>
              <th className="text-right font-medium px-2 py-1.5">Tarifa</th>
              <th className="text-right font-medium px-2 py-1.5">Delivery</th>
              {editable && <th className="w-12"></th>}
            </tr>
          </thead>
          <tbody>
            {pub.placements.map((pl) => (
              <PlacementGridRow
                key={pl.id}
                placement={pl}
                editable={editable}
                allMarkets={allMarkets}
                selected={pl.id === selectedId}
                onSelect={onSelect}
                onChange={onChange}
                startTransition={startTransition}
              />
            ))}
          </tbody>
        </table>
      )}

      {editable && (
        <div className="border-t border-line-soft px-4 py-2">
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
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Fila de la planilla: campos esenciales inline (nombre, mercado, método,
// monto, tarifa⇄delivery de la métrica principal). Click selecciona la fila
// para el inspector.
// ════════════════════════════════════════════════════════════════════════════

function PlacementGridRow({
  placement,
  editable,
  allMarkets,
  selected,
  onSelect,
  onChange,
  startTransition,
}: {
  placement: PlanPlacement;
  editable: boolean;
  allMarkets: Market[];
  selected: boolean;
  onSelect: (id: string) => void;
  onChange: () => void;
  startTransition: StartTransition;
}) {
  const update = (partial: UpdatePlacementPartial) => {
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

  const onDuplicate = () => {
    startTransition(async () => {
      const r = await duplicatePlacement(placement.id);
      if (!r.ok) alert(r.error);
      onChange();
    });
  };

  const pair = placement.costMethod ? COST_METHOD_PAIR[placement.costMethod] : undefined;
  const eff = placement.costMethod
    ? effectivePair(placement.metricsJson, placement.costMethod, placement.amountUsd)
    : null;

  return (
    <tr
      onClick={() => onSelect(placement.id)}
      className={`border-t border-line-soft cursor-pointer ${
        selected ? "bg-accent-soft/50" : "hover:bg-paper-2/40"
      }`}
    >
      <td className="pl-5 pr-2 py-1">
        <TextInput
          value={placement.placementName}
          onCommit={(v) => update({ placementName: v })}
          disabled={!editable}
          className="w-full"
        />
      </td>
      <td className="px-2 py-1">
        <select
          value={placement.marketId ?? ""}
          disabled={!editable}
          onChange={(e) => update({ marketId: e.target.value || null })}
          className="text-xs bg-transparent border-b border-transparent hover:border-line focus:border-accent focus:outline-none disabled:opacity-50 max-w-[130px]"
        >
          <option value="">— sin mercado —</option>
          {allMarkets.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-1">
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
      <td className="px-2 py-1 text-right">
        <NumberInput
          value={placement.amountUsd}
          onCommit={(v) => update({ amountUsd: v })}
          disabled={!editable}
          className="w-32 text-right font-mono"
        />
      </td>
      <td className="px-2 py-1 text-right">
        {pair ? (
          <RateInput
            value={eff?.rate ?? null}
            disabled={!editable}
            className="w-24 text-right"
            onCommit={(v) =>
              update({
                metricsJson: applyPrimaryPairChange(
                  placement.metricsJson,
                  placement.costMethod as string,
                  placement.amountUsd,
                  "rate",
                  v,
                ),
              })
            }
          />
        ) : (
          <span className="text-line">—</span>
        )}
      </td>
      <td className="px-2 py-1 text-right">
        {pair ? (
          <DeliveryInput
            value={eff?.delivery ?? null}
            disabled={!editable}
            className="w-28 text-right"
            onCommit={(v) =>
              update({
                metricsJson: applyPrimaryPairChange(
                  placement.metricsJson,
                  placement.costMethod as string,
                  placement.amountUsd,
                  "delivery",
                  v,
                ),
              })
            }
          />
        ) : (
          <span className="text-line">—</span>
        )}
      </td>
      {editable && (
        <td className="px-1 py-1 text-center whitespace-nowrap">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDuplicate();
            }}
            className="text-muted hover:text-ink p-1"
            title="Duplicar placement"
          >
            <Copy size={12} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="text-muted hover:text-danger p-1"
            title="Eliminar"
          >
            <Trash2 size={12} />
          </button>
        </td>
      )}
    </tr>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Inspector: detalle completo del placement seleccionado (fechas, audiencia,
// métrica principal, métricas secundarias, notas). Reusa PrincipalPairEditor y
// MetricsEditor. Se monta con key={placement.id} → su estado interno se resetea
// al cambiar de placement.
// ════════════════════════════════════════════════════════════════════════════

function PlacementInspector({
  placement,
  editable,
  allMetrics,
  update,
}: {
  placement: PlanPlacement;
  editable: boolean;
  allMetrics: MetricCatalog[];
  update: (partial: UpdatePlacementPartial) => void;
}) {
  const primarySlug = placement.costMethod
    ? COST_METHOD_PRIMARY_METRIC[placement.costMethod] ?? null
    : null;
  const primaryMetric = primarySlug
    ? allMetrics.find((m) => m.slug === primarySlug) ?? null
    : null;

  return (
    <div className="rounded-lg border border-line bg-white dark:bg-paper-2 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-line-soft bg-paper/60">
        <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
          Placement
        </p>
        <p className="text-sm font-semibold text-ink truncate">
          {placement.placementName || "—"}
        </p>
      </div>

      <div className="px-4 py-3 space-y-3">
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
            placeholder="25-44 viajeros frecuentes, lookalike, retargeting, etc."
            onBlur={(e) =>
              e.target.value !== (placement.audience ?? "") &&
              update({ audience: e.target.value || null })
            }
            className="w-full text-sm leading-relaxed bg-white dark:bg-paper-2 border border-line rounded-md px-2.5 py-2 resize-y min-h-[4.5rem] focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft disabled:opacity-50 disabled:resize-none"
          />
        </Field>

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
          primaryMetricSlug={primarySlug}
          onCommit={(m) => update({ metricsJson: m })}
        />

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
            className="w-full text-sm leading-relaxed bg-white dark:bg-paper-2 border border-line rounded-md px-2.5 py-2 resize-y min-h-[4.5rem] focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft disabled:opacity-50 disabled:resize-none"
          />
        </Field>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Helpers tarifa↔delivery de la métrica principal (compartidos por la planilla
// y el PrincipalPairEditor). El planner edita uno y se recalcula el otro desde
// amount × multiplier; se guardan AMBOS en metrics_json.
// ════════════════════════════════════════════════════════════════════════════

function effectivePair(
  metricsJson: Record<string, number>,
  costMethod: string,
  amountUsd: number,
): { rate: number | null; delivery: number | null } | null {
  const pair = COST_METHOD_PAIR[costMethod];
  if (!pair) return null;
  const rateInJson = metricsJson[pair.rate];
  const deliveryInJson = metricsJson[pair.delivery];
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
  return { rate: effRate, delivery: effDelivery };
}

function applyPrimaryPairChange(
  metricsJson: Record<string, number>,
  costMethod: string,
  amountUsd: number,
  field: "rate" | "delivery",
  newValue: number,
): Record<string, number> {
  const pair = COST_METHOD_PAIR[costMethod];
  if (!pair) return metricsJson;
  if (newValue <= 0) {
    const next = { ...metricsJson };
    delete next[pair.rate];
    delete next[pair.delivery];
    return next;
  }
  if (field === "rate") {
    const newDelivery = amountUsd > 0 ? (amountUsd * pair.multiplier) / newValue : 0;
    return {
      ...metricsJson,
      [pair.rate]: Number(newValue.toFixed(6)),
      [pair.delivery]: Math.round(newDelivery),
    };
  }
  const newRate = amountUsd > 0 ? (amountUsd * pair.multiplier) / newValue : 0;
  return {
    ...metricsJson,
    [pair.rate]: Number(newRate.toFixed(6)),
    [pair.delivery]: Math.round(newValue),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Editor del par tarifa↔delivery según el cost method del placement.
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
  const eff = effectivePair(metricsJson, costMethod, amountUsd);
  const effRate = eff?.rate ?? null;
  const effDelivery = eff?.delivery ?? null;

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

  const onChangeRate = (v: number) =>
    onCommit(applyPrimaryPairChange(metricsJson, costMethod, amountUsd, "rate", v));
  const onChangeDelivery = (v: number) =>
    onCommit(
      applyPrimaryPairChange(metricsJson, costMethod, amountUsd, "delivery", v),
    );

  return (
    <div className="px-3 py-2 bg-accent-soft/40 border border-accent-soft rounded text-[11px] text-ink">
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
          <RateInput value={effRate} disabled={!editable} onCommit={onChangeRate} />
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
        Editás uno y la app calcula el otro desde el monto del placement (
        <span className="font-mono">${amountUsd.toFixed(2)}</span>
        {pair.multiplier !== 1 && (
          <span className="font-mono"> × {pair.multiplier}</span>
        )}{" "}
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
  className = "w-full",
}: {
  value: number | null;
  disabled: boolean;
  onCommit: (v: number) => void;
  className?: string;
}) {
  const display = value != null ? formatRateDisplay(value) : "";
  const commit = (el: HTMLInputElement) => {
    const raw = el.value.trim();
    let v: number;
    if (raw === "") {
      v = 0;
    } else {
      const parsed = evalNumberInput(raw);
      if (!Number.isFinite(parsed)) {
        el.value = display;
        return;
      }
      v = parsed;
    }
    el.value = formatRateDisplay(v);
    if (value == null || Math.abs(v - value) >= 0.000001) onCommit(v);
  };
  return (
    <input
      key={display}
      type="text"
      inputMode="decimal"
      defaultValue={display}
      disabled={disabled}
      placeholder="0.0000"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      onBlur={(e) => commit(e.currentTarget)}
      className={`${className} font-mono text-sm tabular-nums bg-white dark:bg-paper-2 border border-line rounded px-2 py-1 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:opacity-50`}
    />
  );
}

function DeliveryInput({
  value,
  disabled,
  onCommit,
  className = "w-full",
}: {
  value: number | null;
  disabled: boolean;
  onCommit: (v: number) => void;
  className?: string;
}) {
  const display = value != null ? formatIntInput(value) : "";
  const commit = (el: HTMLInputElement) => {
    const raw = el.value.trim();
    let v: number;
    if (raw === "") {
      v = 0;
    } else {
      const parsed = evalNumberInput(raw);
      if (!Number.isFinite(parsed)) {
        el.value = display;
        return;
      }
      v = parsed;
    }
    el.value = v !== 0 ? formatIntInput(v) : "";
    if (value == null || Math.abs(v - value) >= 1) onCommit(v);
  };
  return (
    <input
      key={display}
      type="text"
      inputMode="numeric"
      defaultValue={display}
      disabled={disabled}
      placeholder="0"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      onBlur={(e) => commit(e.currentTarget)}
      className={`${className} font-mono text-sm tabular-nums bg-white dark:bg-paper-2 border border-line rounded px-2 py-1 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:opacity-50`}
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
  primaryMetricSlug,
  onCommit,
}: {
  metrics: Record<string, number>;
  allMetrics: MetricCatalog[];
  amountUsd: number;
  editable: boolean;
  primaryMetricSlug: string | null;
  onCommit: (m: Record<string, number>) => void;
}) {
  const directMetrics = allMetrics.filter((m) => m.kind === "direct");
  const calculatedMetrics = allMetrics.filter((m) => m.kind === "calculated");
  const directBySlug = new Map(directMetrics.map((m) => [m.slug, m]));

  const [draft, setDraft] = useState<
    Array<{ slug: string; delivery: string; rate: string }>
  >(
    Object.entries(metrics)
      .filter(([k]) => directBySlug.has(k) && k !== primaryMetricSlug)
      .map(([k, v]) => {
        const pair = DIRECT_METRIC_RATES[k];
        const rateVal = pair ? metrics[pair.rate] : undefined;
        return {
          slug: k,
          delivery: String(v),
          rate:
            typeof rateVal === "number" && Number.isFinite(rateVal)
              ? String(rateVal)
              : "",
        };
      }),
  );

  const commit = (next: typeof draft) => {
    const obj: Record<string, number> = {};

    if (primaryMetricSlug) {
      const pd = metrics[primaryMetricSlug];
      if (typeof pd === "number" && Number.isFinite(pd)) {
        obj[primaryMetricSlug] = pd;
      }
      const primaryPair = DIRECT_METRIC_RATES[primaryMetricSlug];
      if (primaryPair) {
        const pr = metrics[primaryPair.rate];
        if (typeof pr === "number" && Number.isFinite(pr)) {
          obj[primaryPair.rate] = pr;
        }
      }
    }

    for (const { slug, delivery, rate } of next) {
      const k = slug.trim();
      if (!k) continue;
      if (k === primaryMetricSlug) continue;
      const d = Number.parseFloat(delivery);
      if (Number.isFinite(d)) obj[k] = d;
      const pair = DIRECT_METRIC_RATES[k];
      if (pair) {
        const r = Number.parseFloat(rate);
        if (Number.isFinite(r) && r > 0) obj[pair.rate] = Number(r.toFixed(6));
      }
    }
    onCommit(obj);
  };

  const onChangeRate = (idx: number, newRate: number) => {
    const row = draft[idx];
    const pair = DIRECT_METRIC_RATES[row.slug];
    const next = draft.map((r, i) => {
      if (i !== idx) return r;
      if (newRate <= 0) return { ...r, rate: "", delivery: "" };
      const newDelivery =
        pair && amountUsd > 0 ? (amountUsd * pair.multiplier) / newRate : 0;
      return {
        ...r,
        rate: String(Number(newRate.toFixed(6))),
        delivery: pair ? String(Math.round(newDelivery)) : r.delivery,
      };
    });
    setDraft(next);
    commit(next);
  };

  const onChangeDelivery = (idx: number, newDelivery: number) => {
    const row = draft[idx];
    const pair = DIRECT_METRIC_RATES[row.slug];
    const next = draft.map((r, i) => {
      if (i !== idx) return r;
      if (newDelivery <= 0) return { ...r, rate: "", delivery: "" };
      const newRate =
        pair && amountUsd > 0 ? (amountUsd * pair.multiplier) / newDelivery : 0;
      return {
        ...r,
        delivery: String(Math.round(newDelivery)),
        rate: pair ? String(Number(newRate.toFixed(6))) : r.rate,
      };
    });
    setDraft(next);
    commit(next);
  };

  const updateRow = (
    idx: number,
    partial: Partial<{ slug: string; delivery: string; rate: string }>,
  ) => {
    const next = draft.map((r, i) => (i === idx ? { ...r, ...partial } : r));
    setDraft(next);
    commit(next);
  };

  const addRow = (slug = "") => {
    setDraft((d) => [...d, { slug, delivery: "", rate: "" }]);
  };

  const removeRow = (idx: number) => {
    const next = draft.filter((_, i) => i !== idx);
    setDraft(next);
    commit(next);
  };

  const usedSlugs = new Set(draft.map((d) => d.slug).filter(Boolean));
  if (primaryMetricSlug) usedSlugs.add(primaryMetricSlug);
  const availableMetrics = directMetrics.filter((m) => !usedSlugs.has(m.slug));

  const directValues: Record<string, number> = {};
  if (primaryMetricSlug) {
    const v = metrics[primaryMetricSlug];
    if (typeof v === "number" && Number.isFinite(v)) directValues[primaryMetricSlug] = v;
  }
  for (const { slug, delivery } of draft) {
    const v = Number.parseFloat(delivery);
    if (slug && Number.isFinite(v)) directValues[slug] = v;
  }

  function evalCalculated(formula: string): number | null {
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
      <div className="rounded-md border border-line bg-white dark:bg-paper-2">
        {draft.length === 0 && calculatedMetrics.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-muted">
            Sin indicadores cargados
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line-soft text-[10px] font-medium uppercase tracking-[0.06em] text-muted">
                <th className="px-2 py-1.5 text-left">Métrica</th>
                <th className="px-2 py-1.5 text-right w-[26%]">Tarifa</th>
                <th className="px-2 py-1.5 text-right w-[26%]">Delivery</th>
                {editable && <th className="w-8" aria-label="acciones" />}
              </tr>
            </thead>
            <tbody>
              {draft.map((row, idx) => {
                const metric = directBySlug.get(row.slug);
                const pair = row.slug ? DIRECT_METRIC_RATES[row.slug] : undefined;
                const rateNum = Number.parseFloat(row.rate);
                const deliveryNum = Number.parseFloat(row.delivery);
                const hasRate = Number.isFinite(rateNum) && rateNum > 0;
                const hasDelivery = Number.isFinite(deliveryNum) && deliveryNum > 0;
                let effRate: number | null = hasRate ? rateNum : null;
                let effDelivery: number | null = hasDelivery ? deliveryNum : null;
                if (pair && effRate == null && effDelivery != null && amountUsd > 0) {
                  effRate = (amountUsd * pair.multiplier) / effDelivery;
                }
                if (pair && effDelivery == null && effRate != null && amountUsd > 0) {
                  effDelivery = (amountUsd * pair.multiplier) / effRate;
                }
                return (
                  <tr key={idx} className="border-b border-line-soft last:border-b-0">
                    <td className="px-2 py-1">
                      <select
                        value={row.slug}
                        disabled={!editable}
                        onChange={(e) => updateRow(idx, { slug: e.target.value, rate: "", delivery: "" })}
                        className="w-full text-sm bg-transparent focus:outline-none disabled:opacity-50"
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
                      {pair ? (
                        <RateInput
                          value={effRate}
                          disabled={!editable}
                          onCommit={(v) => onChangeRate(idx, v)}
                        />
                      ) : (
                        <span className="block text-right text-[11px] text-line">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      <DeliveryInput
                        value={effDelivery}
                        disabled={!editable}
                        onCommit={(v) => onChangeDelivery(idx, v)}
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
                      v == null ? "text-line" : "text-ink-2 tabular-nums"
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
  startTransition: StartTransition;
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
          <span className="text-line text-xs font-mono">—</span>
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
            className="w-36 text-right font-mono"
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
      onClick={(e) => e.stopPropagation()}
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
  const display = value > 0 ? formatAmountInput(value) : "";
  const commit = (el: HTMLInputElement) => {
    const raw = el.value.trim();
    let v: number;
    if (raw === "") {
      v = 0;
    } else {
      const parsed = evalNumberInput(raw);
      if (!Number.isFinite(parsed)) {
        el.value = display; // fórmula inválida → restaura el valor previo
        return;
      }
      v = parsed;
    }
    el.value = v > 0 ? formatAmountInput(v) : "";
    if (Math.abs(v - value) >= 0.01) onCommit(v);
  };
  return (
    <input
      key={display}
      type="text"
      inputMode="decimal"
      defaultValue={display}
      disabled={disabled}
      placeholder="0"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      onBlur={(e) => commit(e.currentTarget)}
      className={`tabular-nums font-mono text-sm bg-white dark:bg-paper-2 border border-line rounded px-2 py-1 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:opacity-50 ${className}`}
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
  const commit = (el: HTMLInputElement) => {
    if (el.value.trim() === "") {
      el.value = "";
      if (value != null) onCommit(null);
      return;
    }
    const v = evalNumberInput(el.value);
    if (!Number.isFinite(v)) {
      el.value = display; // fórmula inválida → restaura el valor previo
      return;
    }
    el.value = v > 0 ? v.toFixed(2) : "";
    if (value == null || Math.abs(v - value) >= 0.01) onCommit(v);
  };
  return (
    <span className="inline-flex items-center gap-0.5 justify-end">
      <input
        key={display}
        type="text"
        inputMode="decimal"
        defaultValue={display}
        disabled={disabled}
        placeholder="—"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        onBlur={(e) => commit(e.currentTarget)}
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
      className="rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-2 text-sm text-muted hover:border-ink-2 focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft cursor-pointer disabled:opacity-50"
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

function TotalChip({
  label,
  value,
  strong,
  warn,
}: {
  label: string;
  value: string;
  strong?: boolean;
  warn?: boolean;
}) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.06em] text-muted">
        {label}
      </span>
      <span
        className={`font-mono tabular-nums ${
          warn ? "text-warn" : strong ? "text-ink font-semibold" : "text-ink-2"
        }`}
      >
        {value}
      </span>
    </span>
  );
}

// Navegación tipo planilla: Enter mueve a la misma columna en la fila de abajo
// (Shift+Enter, arriba); Enter en la última fila agrega un placement. Sólo
// actúa sobre <input> para no romper la selección nativa de los <select>.
function moveGridFocus(
  e: React.KeyboardEvent<HTMLTableElement>,
  onAddRow: () => void,
) {
  if (e.key !== "Enter") return;
  const el = e.target;
  if (!(el instanceof HTMLInputElement)) return;
  const td = el.closest("td");
  const tr = el.closest("tr");
  if (!td || !tr) return;
  e.preventDefault();
  const colIndex = td.cellIndex;
  const sib = e.shiftKey ? tr.previousElementSibling : tr.nextElementSibling;
  if (sib instanceof HTMLTableRowElement) {
    const cell = sib.cells[colIndex];
    const focusable =
      cell?.querySelector<HTMLInputElement>("input") ??
      sib.querySelector<HTMLInputElement>("input");
    if (focusable) {
      el.blur();
      focusable.focus();
      focusable.select();
    }
    return;
  }
  if (!e.shiftKey) {
    el.blur();
    onAddRow();
  }
}
