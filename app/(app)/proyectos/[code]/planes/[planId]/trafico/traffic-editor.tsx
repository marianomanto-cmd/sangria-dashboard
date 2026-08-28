"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  Check,
  ChevronDown,
  ExternalLink,
  Plus,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import {
  addTrafficAd,
  removeTrafficAd,
  setTrafficAdLoaded,
  updateTrafficAd,
  updateTrafficBrief,
} from "@/app/actions/plan-traffic";
import type { PlanTrafficAd, PlanTrafficPlacement } from "@/db/queries/plan-traffic";
import {
  adFormatLabel,
  computeTrafficProgress,
  findAdIssues,
  findPlacementTrafficIssues,
  isAdLoaded,
  TRAFFIC_AD_FORMATS,
  type TrafficPlacement,
} from "@/lib/plan-traffic";
import { formatUsd } from "@/lib/format";
import { useConfirm } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast";

// ════════════════════════════════════════════════════════════════════════════
// Editor de la ventana de Tráfico: una tarjeta por placement del plan, con su
// cantidad de adsets, la carpeta de archivos y sus anuncios.
//
// Autosave en el blur, igual que el resto del editor del plan: nada de botón
// "guardar". Cada anuncio tiene su propio "Cargado", que es el registro del
// trafficker de que ya lo montó en la plataforma.
// ════════════════════════════════════════════════════════════════════════════

type StartTransition = ReturnType<typeof useTransition>[1];

// Vista que consume la regla de lib/plan-traffic desde el cliente.
function asTrafficPlacement(row: PlanTrafficPlacement): TrafficPlacement {
  return {
    publisherName: row.publisherName,
    placementName: row.placementName,
    brief: row.brief
      ? {
          adsetsCount: row.brief.adsetsCount,
          trafficFolderUrl: row.brief.trafficFolderUrl,
          ads: row.brief.ads,
        }
      : null,
  };
}

export function PlanTrafficEditor({
  planId,
  projectCode,
  planStatus,
  rows,
  editable,
}: {
  planId: string;
  projectCode: string;
  planStatus: string;
  rows: PlanTrafficPlacement[];
  editable: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const refresh = () => router.refresh();

  const placements = rows.map(asTrafficPlacement);
  const progress = computeTrafficProgress(placements);
  // El paso a Live exige brief completo Y todos los anuncios cargados.
  const blocking = placements.filter(
    (pl) => findPlacementTrafficIssues(pl, true).length > 0,
  ).length;

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-paper-2/40 px-5 py-12 text-center">
        <p className="text-sm font-medium text-ink-2">
          El plan todavía no tiene placements
        </p>
        <p className="text-xs text-muted mt-1">
          Cargá los publishers y sus placements en el{" "}
          <Link
            href={`/proyectos/${projectCode}/planes/${planId}`}
            className="text-accent hover:underline"
          >
            editor del plan
          </Link>{" "}
          y volvé acá para briefear el tráfico.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Barra de avance: lo que mira el planner para saber si el plan puede ir
          a Live, y el trafficker para saber qué le queda por cargar. */}
      <section className="rounded-lg border border-line bg-white dark:bg-paper-2 px-5 py-4 flex flex-wrap items-center gap-x-8 gap-y-3">
        <ProgressChip
          label="Placements briefeados"
          value={`${progress.placementsComplete}/${progress.placements}`}
          done={progress.placementsComplete === progress.placements}
        />
        <ProgressChip
          label="Anuncios completos"
          value={`${progress.adsComplete}/${progress.ads}`}
          done={progress.ads > 0 && progress.adsComplete === progress.ads}
        />
        <ProgressChip
          label="Cargados en plataforma"
          value={`${progress.adsLoaded}/${progress.ads}`}
          done={progress.ads > 0 && progress.adsLoaded === progress.ads}
        />
        <p className="ml-auto text-[11px] text-muted max-w-[420px]">
          {blocking === 0 && progress.ads > 0 ? (
            <span className="text-success font-medium">
              Tráfico completo — el plan puede marcarse Live.
            </span>
          ) : (
            <>
              {blocking} placement{blocking === 1 ? "" : "s"} sin terminar
              (brief o carga). Mientras falte alguno, el plan{" "}
              <span className="font-medium">no puede marcarse Live</span>.
            </>
          )}
        </p>
      </section>

      {planStatus === "archived" && (
        <p className="text-xs text-muted">
          El plan está archivado: la sección Tráfico queda de sólo lectura.
        </p>
      )}

      {rows.map((row, i) => (
        <PlacementTrafficCard
          key={row.placementId}
          row={row}
          issues={findPlacementTrafficIssues(placements[i], true)}
          editable={editable}
          pending={pending}
          startTransition={startTransition}
          onChange={refresh}
        />
      ))}
    </div>
  );
}

function ProgressChip({
  label,
  value,
  done,
}: {
  label: string;
  value: string;
  done: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
        {label}
      </p>
      <p
        className={`font-mono text-lg font-semibold tabular-nums ${
          done ? "text-success" : "text-ink"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

// ── Tarjeta de un placement ─────────────────────────────────────────────────

function PlacementTrafficCard({
  row,
  issues,
  editable,
  pending,
  startTransition,
  onChange,
}: {
  row: PlanTrafficPlacement;
  issues: string[];
  editable: boolean;
  pending: boolean;
  startTransition: StartTransition;
  onChange: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(true);
  const complete = issues.length === 0;
  const ads = row.brief?.ads ?? [];

  const saveBrief = (partial: {
    adsetsCount?: number;
    trafficFolderUrl?: string | null;
  }) => {
    startTransition(async () => {
      const r = await updateTrafficBrief({
        placementId: row.placementId,
        ...partial,
      });
      if (!r.ok) toast.error(r.error);
      onChange();
    });
  };

  const onAddAd = () => {
    startTransition(async () => {
      const r = await addTrafficAd({ placementId: row.placementId });
      if (!r.ok) toast.error(r.error);
      onChange();
    });
  };

  return (
    <section className="rounded-lg border border-line bg-white dark:bg-paper-2 overflow-hidden">
      {/* Cabecera: la línea del plan tal cual, para que el trafficker sepa qué
          está armando sin volver al editor. */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3 border-b border-line-soft bg-paper/60">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 min-w-0 text-left"
          aria-expanded={open}
        >
          <ChevronDown
            size={14}
            className={`text-muted shrink-0 transition-transform ${open ? "" : "-rotate-90"}`}
          />
          <span className="min-w-0">
            <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted block">
              {row.publisherName}
              {row.marketName ? ` · ${row.marketName}` : ""}
            </span>
            <span className="text-sm font-semibold text-ink block truncate">
              {row.placementName || "(placement sin nombre)"}
            </span>
          </span>
        </button>

        <span className="font-mono text-xs text-muted tabular-nums">
          {formatUsd(row.amountUsd)}
          {row.costMethod ? ` · ${row.costMethod}` : ""}
        </span>

        <span className="ml-auto flex items-center gap-2 shrink-0">
          <span className="text-[11px] text-muted">
            {ads.length} anuncio{ads.length === 1 ? "" : "s"}
          </span>
          {complete ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.06em] text-success">
              <Check size={11} strokeWidth={2.5} />
              Listo
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-warn-soft px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.06em] text-warn">
              <TriangleAlert size={11} strokeWidth={2.5} />
              Incompleto
            </span>
          )}
        </span>
      </header>

      {open && (
        <div className="px-5 py-4 space-y-4">
          {!complete && (
            <ul className="rounded border border-warn-soft bg-warn-soft/40 px-3 py-2 text-[11px] text-warn space-y-0.5">
              {issues.map((m, i) => (
                <li key={i}>· Falta {m}</li>
              ))}
            </ul>
          )}

          {/* Nivel placement: cuántos adsets y dónde están los archivos */}
          <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-4">
            <Field label="Cantidad de adsets">
              <IntInput
                value={row.brief?.adsetsCount ?? 0}
                disabled={!editable}
                onCommit={(v) => saveBrief({ adsetsCount: v })}
              />
            </Field>
            <Field label="Carpeta de tráfico">
              <div className="flex items-center gap-2">
                <TextInput
                  value={row.brief?.trafficFolderUrl ?? ""}
                  disabled={!editable}
                  placeholder="https://drive.google.com/…"
                  onCommit={(v) => saveBrief({ trafficFolderUrl: v || null })}
                />
                {row.brief?.trafficFolderUrl && (
                  <a
                    href={row.brief.trafficFolderUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 inline-flex items-center gap-1 rounded border border-line px-2 py-1 text-[11px] text-ink-2 hover:border-accent hover:text-accent"
                    title={row.brief.trafficFolderUrl}
                  >
                    <ExternalLink size={11} strokeWidth={2} />
                    Abrir
                  </a>
                )}
              </div>
            </Field>
          </div>

          {/* Anuncios */}
          <div className="space-y-3">
            {ads.length === 0 ? (
              <div className="rounded border border-dashed border-line px-4 py-6 text-center text-xs text-muted">
                Sin anuncios cargados. Agregá uno por cada creatividad distinta
                que el trafficker tenga que armar.
              </div>
            ) : (
              ads.map((ad, i) => (
                <AdCard
                  key={ad.id}
                  ad={ad}
                  index={i}
                  editable={editable}
                  pending={pending}
                  startTransition={startTransition}
                  onChange={onChange}
                />
              ))
            )}

            {editable && (
              <button
                type="button"
                onClick={onAddAd}
                disabled={pending}
                className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink disabled:opacity-40"
              >
                <Plus size={12} strokeWidth={2.5} />
                Agregar anuncio
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// ── Tarjeta de un anuncio ───────────────────────────────────────────────────

function AdCard({
  ad,
  index,
  editable,
  pending,
  startTransition,
  onChange,
}: {
  ad: PlanTrafficAd;
  index: number;
  editable: boolean;
  pending: boolean;
  startTransition: StartTransition;
  onChange: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const missing = findAdIssues(ad, index);
  const loaded = isAdLoaded(ad);

  const save = (partial: Omit<Parameters<typeof updateTrafficAd>[0], "adId">) => {
    startTransition(async () => {
      const r = await updateTrafficAd({ ...partial, adId: ad.id });
      if (!r.ok) toast.error(r.error);
      onChange();
    });
  };

  const onToggleLoaded = () => {
    startTransition(async () => {
      const r = await setTrafficAdLoaded({ adId: ad.id, loaded: !loaded });
      if (!r.ok) toast.error(r.error);
      onChange();
    });
  };

  const onRemove = async () => {
    if (
      !(await confirm({
        title: `¿Eliminar el anuncio ${index + 1}?`,
        confirmLabel: "Eliminar",
        danger: true,
      }))
    )
      return;
    startTransition(async () => {
      const r = await removeTrafficAd(ad.id);
      if (!r.ok) toast.error(r.error);
      onChange();
    });
  };

  return (
    <div
      className={`rounded-md border px-4 py-3 ${
        loaded ? "border-success-soft bg-success-soft/20" : "border-line bg-paper/40"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-3">
        <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
          Anuncio {index + 1}
        </span>
        <span className="text-xs text-ink-2">
          {adFormatLabel(ad.adFormat, ad.adFormatOther)}
        </span>

        <span className="ml-auto flex items-center gap-2">
          {loaded ? (
            <span
              className="text-[11px] text-success"
              title={
                ad.loadedAt
                  ? `Cargado el ${new Date(ad.loadedAt).toLocaleString("es-AR")}`
                  : undefined
              }
            >
              Cargado{ad.loadedByEmail ? ` por ${ad.loadedByEmail}` : ""}
            </span>
          ) : (
            missing.length > 0 && (
              <span className="text-[11px] text-warn">
                {missing.length} campo{missing.length === 1 ? "" : "s"} sin
                completar
              </span>
            )
          )}
          <button
            type="button"
            onClick={onToggleLoaded}
            disabled={!editable || pending || (!loaded && missing.length > 0)}
            title={
              !loaded && missing.length > 0
                ? "Completá el anuncio antes de marcarlo como cargado"
                : loaded
                  ? "Desmarcar (vuelve a quedar pendiente de carga)"
                  : "Registrar que ya lo cargaste en la plataforma"
            }
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-40 disabled:pointer-events-none ${
              loaded
                ? "border border-line text-muted hover:text-ink"
                : "bg-success text-white hover:opacity-90"
            }`}
          >
            <Check size={12} strokeWidth={2.5} />
            {loaded ? "Desmarcar" : "Marcar cargado"}
          </button>
          {editable && (
            <button
              type="button"
              onClick={onRemove}
              disabled={pending}
              className="text-muted hover:text-danger p-1 disabled:opacity-40"
              title="Eliminar anuncio"
            >
              <Trash2 size={13} />
            </button>
          )}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-5 gap-y-3">
        <Field label="Tipo de anuncio">
          <div className="flex items-center gap-2">
            <select
              value={ad.adFormat ?? ""}
              disabled={!editable}
              onChange={(e) => save({ adFormat: e.target.value || null })}
              className="text-sm bg-transparent border-b border-line hover:border-ink-2 focus:border-accent focus:outline-none py-0.5 disabled:opacity-50"
            >
              <option value="">— elegir —</option>
              {TRAFFIC_AD_FORMATS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
            {ad.adFormat === "other" && (
              <TextInput
                value={ad.adFormatOther ?? ""}
                disabled={!editable}
                placeholder="¿Qué tipo de anuncio es?"
                onCommit={(v) => save({ adFormatOther: v })}
              />
            )}
          </div>
        </Field>

        <Field label="CTA">
          <TextInput
            value={ad.cta ?? ""}
            disabled={!editable}
            placeholder="Reservá ahora, Más información…"
            onCommit={(v) => save({ cta: v })}
          />
        </Field>

        <Field label="Título">
          <TextInput
            value={ad.headline ?? ""}
            disabled={!editable}
            placeholder="Título del anuncio"
            onCommit={(v) => save({ headline: v })}
          />
        </Field>

        <Field label="Subtítulo">
          <TextInput
            value={ad.subheadline ?? ""}
            disabled={!editable}
            placeholder="Subtítulo / descripción corta"
            onCommit={(v) => save({ subheadline: v })}
          />
        </Field>

        <Field label="Landing page" className="md:col-span-2">
          <div className="flex items-center gap-2">
            <TextInput
              value={ad.landingUrl ?? ""}
              disabled={!editable}
              placeholder="https://…"
              onCommit={(v) => save({ landingUrl: v || null })}
            />
            {ad.landingUrl && (
              <a
                href={ad.landingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 inline-flex items-center gap-1 rounded border border-line px-2 py-1 text-[11px] text-ink-2 hover:border-accent hover:text-accent"
                title={ad.landingUrl}
              >
                <ExternalLink size={11} strokeWidth={2} />
                Abrir
              </a>
            )}
          </div>
        </Field>

        <Field label="Copy" className="md:col-span-2">
          <textarea
            key={ad.copy ?? ""}
            defaultValue={ad.copy ?? ""}
            disabled={!editable}
            rows={3}
            placeholder="Texto del anuncio tal cual va a la plataforma"
            onBlur={(e) =>
              e.target.value !== (ad.copy ?? "") && save({ copy: e.target.value })
            }
            className="w-full text-sm bg-white dark:bg-paper-2 border border-line rounded px-2 py-1.5 resize-vertical focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:opacity-50 disabled:resize-none"
          />
        </Field>
      </div>
    </div>
  );
}

// ── Inputs ──────────────────────────────────────────────────────────────────

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted mb-1">
        {label}
      </p>
      {children}
    </div>
  );
}

// No controlado + commit en el blur, igual que el editor del plan: una edición
// en curso nunca la pisa el re-render de una server action.
function TextInput({
  value,
  onCommit,
  disabled,
  placeholder,
}: {
  value: string;
  onCommit: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <input
      key={value}
      type="text"
      defaultValue={value}
      disabled={disabled}
      placeholder={placeholder}
      onBlur={(e) => e.target.value !== value && onCommit(e.target.value)}
      className="w-full min-w-0 text-sm bg-transparent border-b border-line hover:border-ink-2 focus:border-accent focus:outline-none py-0.5 disabled:opacity-50"
    />
  );
}

function IntInput({
  value,
  onCommit,
  disabled,
}: {
  value: number;
  onCommit: (v: number) => void;
  disabled?: boolean;
}) {
  const display = value > 0 ? String(value) : "";
  return (
    <input
      key={display}
      type="text"
      inputMode="numeric"
      defaultValue={display}
      disabled={disabled}
      placeholder="0"
      onBlur={(e) => {
        const raw = e.target.value.trim();
        const n = raw === "" ? 0 : Number.parseInt(raw.replace(/[^0-9]/g, ""), 10);
        const next = Number.isFinite(n) && n >= 0 ? n : 0;
        e.target.value = next > 0 ? String(next) : "";
        if (next !== value) onCommit(next);
      }}
      className="w-24 font-mono text-sm tabular-nums bg-transparent border-b border-line hover:border-ink-2 focus:border-accent focus:outline-none py-0.5 disabled:opacity-50"
    />
  );
}
