"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  Check,
  ChevronDown,
  CopyPlus,
  ExternalLink,
  Lock,
  Plus,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import {
  addTrafficAd,
  addTrafficAdset,
  removeTrafficAd,
  removeTrafficAdset,
  setTrafficAdLoaded,
  updateTrafficAd,
  updateTrafficAdset,
} from "@/app/actions/plan-traffic";
import type {
  PlanTrafficAd,
  PlanTrafficAdset,
  PlanTrafficPlacement,
} from "@/db/queries/plan-traffic";
import {
  findAdIssues,
  findAdsetIssues,
  findPlacementAdIssues,
  findPlacementAdsetIssues,
  computeTrafficProgress,
  isAdLoaded,
  type TrafficPlacement,
} from "@/lib/plan-traffic";
import { formatUsd } from "@/lib/format";
import { formatDate } from "@/lib/i18n";
import { useConfirm } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast";

// ════════════════════════════════════════════════════════════════════════════
// Editor de la ventana de Tráfico. Una tarjeta por placement del plan; dentro,
// los ADSETS que designa el media planner y, dentro de cada uno, los ADS que
// completa el AM/PM.
//
// Los dos niveles tienen permisos distintos, y la UI lo dice explícitamente:
// los adsets se editan sólo sobre el borrador (son parte de lo que se manda a
// firmar); los ads, en cualquier estado vivo del plan. Las barreras reales
// están en app/actions/plan-traffic.ts.
//
// Autosave en el blur, igual que el resto del editor del plan: nada de botón
// "guardar".
// ════════════════════════════════════════════════════════════════════════════

type StartTransition = ReturnType<typeof useTransition>[1];

export type AdTypeOption = {
  id: string;
  name: string;
  requiresDetail: boolean;
  enabled: boolean;
};

// Vista que consumen las reglas de lib/plan-traffic desde el cliente.
function asTrafficPlacement(row: PlanTrafficPlacement): TrafficPlacement {
  return {
    publisherName: row.publisherName,
    placementName: row.placementName,
    brief: row.brief
      ? { adsets: row.brief.adsets }
      : null,
  };
}

export function PlanTrafficEditor({
  planId,
  projectCode,
  clientSlug,
  planStatus,
  rows,
  adTypes,
}: {
  planId: string;
  projectCode: string;
  clientSlug: string;
  planStatus: string;
  rows: PlanTrafficPlacement[];
  adTypes: AdTypeOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const refresh = () => router.refresh();

  // Los adsets son parte del plan que se firma → sólo sobre el borrador.
  // Los ads son material operativo del AM/PM → cualquier estado vivo.
  const adsetsEditable = planStatus === "draft";
  const adsEditable = planStatus !== "archived";

  const placements = rows.map(asTrafficPlacement);
  const progress = computeTrafficProgress(placements);
  const adsetBlocking = placements.filter(
    (pl) => findPlacementAdsetIssues(pl).length > 0,
  ).length;
  const adBlocking = placements.filter(
    (pl) => findPlacementAdIssues(pl).length > 0,
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
          y volvé acá para armar los adsets.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Avance: los dos gates, separados, porque los miran roles distintos. */}
      <section className="rounded-lg border border-line bg-white dark:bg-paper-2 px-5 py-4">
        <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
          <GateBlock
            role="Media planner"
            title="Adsets"
            chips={[
              {
                label: "Placements con adsets",
                value: `${progress.placementsWithAdsets}/${progress.placements}`,
                done: progress.placementsWithAdsets === progress.placements,
              },
              {
                label: "Adsets completos",
                value: `${progress.adsetsComplete}/${progress.adsets}`,
                done: progress.adsets > 0 && progress.adsetsComplete === progress.adsets,
              },
            ]}
            note={
              adsetBlocking === 0
                ? "Adsets completos — el plan puede marcarse Listo para enviar."
                : `${adsetBlocking} placement${adsetBlocking === 1 ? "" : "s"} sin adsets completos: el plan no puede marcarse Listo para enviar.`
            }
            ok={adsetBlocking === 0}
          />
          <div className="w-px self-stretch bg-line hidden lg:block" />
          <GateBlock
            role="AM / PM"
            title="Ads"
            chips={[
              {
                label: "Ads completos",
                value: `${progress.adsComplete}/${progress.ads}`,
                done: progress.ads > 0 && progress.adsComplete === progress.ads,
              },
              {
                label: "Cargados en plataforma",
                value: `${progress.adsLoaded}/${progress.ads}`,
                done: progress.ads > 0 && progress.adsLoaded === progress.ads,
              },
            ]}
            note={
              adBlocking === 0 && progress.ads > 0
                ? "Ads completos — se puede cerrar el QA. Para Live, además marcalos todos como cargados."
                : `${adBlocking} placement${adBlocking === 1 ? "" : "s"} con ads sin completar: no se puede cerrar el QA.`
            }
            ok={adBlocking === 0 && progress.ads > 0}
          />
        </div>
      </section>

      {!adsetsEditable && planStatus !== "archived" && (
        <p className="flex items-center gap-2 rounded-md border border-line bg-paper/60 px-4 py-2 text-[11px] text-muted">
          <Lock size={12} className="shrink-0" />
          Los adsets están bloqueados porque el plan ya no es borrador (
          <span className="font-mono">{planStatus}</span>). Para cambiarlos, abrí
          una nueva versión desde el{" "}
          <Link
            href={`/proyectos/${projectCode}/planes/${planId}`}
            className="text-accent hover:underline"
          >
            editor del plan
          </Link>
          . Los ads se siguen editando normalmente.
        </p>
      )}

      {planStatus === "archived" && (
        <p className="text-xs text-muted">
          El plan está archivado: la sección Tráfico queda de sólo lectura.
        </p>
      )}

      {adTypes.length === 0 && (
        <p className="rounded-md border border-warn-soft bg-warn-soft/40 px-4 py-2 text-[11px] text-warn">
          Este cliente todavía no tiene tipos de ad en su catálogo, así que el
          desplegable va a estar vacío. Cargalos en{" "}
          <Link
            href={`/configuracion/clientes/${clientSlug}#tipos-de-ad`}
            className="underline"
          >
            Configuración → {clientSlug} → Tipos de ad
          </Link>
          .
        </p>
      )}

      {rows.map((row, i) => (
        <PlacementCard
          key={row.placementId}
          row={row}
          adsetIssues={findPlacementAdsetIssues(placements[i])}
          adIssues={findPlacementAdIssues(placements[i])}
          adTypes={adTypes}
          adsetsEditable={adsetsEditable}
          adsEditable={adsEditable}
          pending={pending}
          startTransition={startTransition}
          onChange={refresh}
        />
      ))}
    </div>
  );
}

// ── Bloque de avance de un gate ─────────────────────────────────────────────

function GateBlock({
  role,
  title,
  chips,
  note,
  ok,
}: {
  role: string;
  title: string;
  chips: { label: string; value: string; done: boolean }[];
  note: string;
  ok: boolean;
}) {
  return (
    <div className="flex-1 min-w-[280px]">
      <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted mb-2">
        {title} <span className="text-line">·</span> {role}
      </p>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {chips.map((c) => (
          <div key={c.label}>
            <p className="text-[10px] uppercase tracking-[0.06em] text-muted">
              {c.label}
            </p>
            <p
              className={`font-mono text-lg font-semibold tabular-nums ${
                c.done ? "text-success" : "text-ink"
              }`}
            >
              {c.value}
            </p>
          </div>
        ))}
      </div>
      <p
        className={`mt-2 text-[11px] ${ok ? "text-success font-medium" : "text-muted"}`}
      >
        {note}
      </p>
    </div>
  );
}

// ── Tarjeta de un placement ─────────────────────────────────────────────────

function PlacementCard({
  row,
  adsetIssues,
  adIssues,
  adTypes,
  adsetsEditable,
  adsEditable,
  pending,
  startTransition,
  onChange,
}: {
  row: PlanTrafficPlacement;
  adsetIssues: string[];
  adIssues: string[];
  adTypes: AdTypeOption[];
  adsetsEditable: boolean;
  adsEditable: boolean;
  pending: boolean;
  startTransition: StartTransition;
  onChange: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(true);
  const adsets = row.brief?.adsets ?? [];
  const adsetsOk = adsetIssues.length === 0;
  const adsOk = adIssues.length === 0;

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    startTransition(async () => {
      const r = await fn();
      if (!r.ok && r.error) toast.error(r.error);
      onChange();
    });
  };

  return (
    <section className="rounded-lg border border-line bg-white dark:bg-paper-2 overflow-hidden">
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
            {adsets.length} adset{adsets.length === 1 ? "" : "s"}
          </span>
          <StatusPill ok={adsetsOk} label="Adsets" />
          <StatusPill ok={adsOk} label="Ads" />
        </span>
      </header>

      {open && (
        <div className="px-5 py-4 space-y-4">
          {!adsetsOk && <IssueList issues={adsetIssues} title="Adsets" />}

          {adsets.length === 0 ? (
            <div className="rounded border border-dashed border-line px-4 py-6 text-center text-xs text-muted">
              Sin adsets designados. El placement necesita al menos uno para que
              el plan pueda marcarse Listo para enviar.
            </div>
          ) : (
            <div className="space-y-3">
              {adsets.map((adset, i) => (
                <AdsetCard
                  key={adset.id}
                  adset={adset}
                  index={i}
                  placement={row}
                  adTypes={adTypes}
                  adsetsEditable={adsetsEditable}
                  adsEditable={adsEditable}
                  pending={pending}
                  startTransition={startTransition}
                  onChange={onChange}
                />
              ))}
            </div>
          )}

          {adsetsEditable && (
            <div className="flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={() =>
                  run(() => addTrafficAdset({ placementId: row.placementId }))
                }
                disabled={pending}
                className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink disabled:opacity-40"
              >
                <Plus size={12} strokeWidth={2.5} />
                Agregar adset
              </button>
              <button
                type="button"
                onClick={() =>
                  run(() =>
                    addTrafficAdset({
                      placementId: row.placementId,
                      copyFromPlacement: true,
                    }),
                  )
                }
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded border border-line px-2 py-1 text-[11px] font-medium text-ink-2 hover:border-accent hover:text-accent disabled:opacity-40"
                title="Crear un adset con la audiencia, el budget y las fechas de este placement"
              >
                <CopyPlus size={12} strokeWidth={2} />
                Adset del placement
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.06em] ${
        ok ? "bg-success-soft text-success" : "bg-warn-soft text-warn"
      }`}
    >
      {ok ? (
        <Check size={11} strokeWidth={2.5} />
      ) : (
        <TriangleAlert size={11} strokeWidth={2.5} />
      )}
      {label}
    </span>
  );
}

function IssueList({ issues, title }: { issues: string[]; title: string }) {
  return (
    <ul className="rounded border border-warn-soft bg-warn-soft/40 px-3 py-2 text-[11px] text-warn space-y-0.5">
      <li className="font-medium uppercase tracking-[0.06em] text-[10px] opacity-80">
        {title}
      </li>
      {issues.map((m, i) => (
        <li key={i}>· Falta {m}</li>
      ))}
    </ul>
  );
}

// ── Tarjeta de un adset (media planner) ─────────────────────────────────────

function AdsetCard({
  adset,
  index,
  placement,
  adTypes,
  adsetsEditable,
  adsEditable,
  pending,
  startTransition,
  onChange,
}: {
  adset: PlanTrafficAdset;
  index: number;
  placement: PlanTrafficPlacement;
  adTypes: AdTypeOption[];
  adsetsEditable: boolean;
  adsEditable: boolean;
  pending: boolean;
  startTransition: StartTransition;
  onChange: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const missing = findAdsetIssues(adset, index);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    startTransition(async () => {
      const r = await fn();
      if (!r.ok && r.error) toast.error(r.error);
      onChange();
    });
  };

  const save = (partial: Omit<Parameters<typeof updateTrafficAdset>[0], "adsetId">) =>
    run(() => updateTrafficAdset({ ...partial, adsetId: adset.id }));

  const onRemove = async () => {
    if (
      !(await confirm({
        title: `¿Eliminar el adset ${index + 1}?`,
        body:
          adset.ads.length > 0
            ? `Se van a borrar también sus ${adset.ads.length} ad${adset.ads.length === 1 ? "" : "s"}.`
            : undefined,
        confirmLabel: "Eliminar",
        danger: true,
      }))
    )
      return;
    run(() => removeTrafficAdset(adset.id));
  };

  return (
    <div
      className={`rounded-md border px-4 py-3 ${
        missing.length === 0 ? "border-line" : "border-warn-soft"
      } bg-paper/40`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-3">
        <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
          Adset {index + 1}
        </span>
        <span className="text-sm font-medium text-ink truncate max-w-[280px]">
          {adset.name || "(sin nombre)"}
        </span>
        {missing.length > 0 && (
          <span className="text-[11px] text-warn">
            {missing.length} campo{missing.length === 1 ? "" : "s"} sin completar
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {adsetsEditable && (
            <>
              <button
                type="button"
                onClick={() => save({ copyFromPlacement: true })}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded border border-line px-2 py-1 text-[11px] font-medium text-ink-2 hover:border-accent hover:text-accent disabled:opacity-40"
                title="Copiar nombre, audiencia, budget y fechas de la línea del plan"
              >
                <CopyPlus size={11} strokeWidth={2} />
                Del placement
              </button>
              <button
                type="button"
                onClick={onRemove}
                disabled={pending}
                className="text-muted hover:text-danger p-1 disabled:opacity-40"
                title="Eliminar adset"
              >
                <Trash2 size={13} />
              </button>
            </>
          )}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-5 gap-y-3">
        <Field label="Nombre del adset">
          <TextInput
            value={adset.name ?? ""}
            disabled={!adsetsEditable}
            placeholder={placement.placementName ?? "Nombre del adset"}
            onCommit={(v) => save({ name: v })}
          />
        </Field>
        <Field label="Pilar creativo">
          <TextInput
            value={adset.creativePillar ?? ""}
            disabled={!adsetsEditable}
            placeholder="Ej. Precio, Destino, Servicio…"
            onCommit={(v) => save({ creativePillar: v })}
          />
        </Field>
        <Field label="Audiencia" className="md:col-span-2">
          <TextInput
            value={adset.audience ?? ""}
            disabled={!adsetsEditable}
            placeholder={placement.audience ?? "Segmentación del adset"}
            onCommit={(v) => save({ audience: v })}
          />
        </Field>
        <Field label="Budget (USD)">
          <MoneyInput
            value={adset.budgetUsd}
            disabled={!adsetsEditable}
            onCommit={(v) => save({ budgetUsd: v })}
          />
        </Field>
        <Field label="Fechas">
          <div className="flex items-center gap-2">
            <DateInput
              value={adset.startDate}
              disabled={!adsetsEditable}
              onCommit={(v) => save({ startDate: v })}
            />
            <span className="text-line text-xs">→</span>
            <DateInput
              value={adset.endDate}
              disabled={!adsetsEditable}
              onCommit={(v) => save({ endDate: v })}
            />
          </div>
          <p className="text-[10px] text-muted mt-1">
            Placement: {formatDate(placement.startDate, "es")} →{" "}
            {formatDate(placement.endDate, "es")}
          </p>
        </Field>
      </div>

      {/* Ads del adset — los completa el AM/PM */}
      <div className="mt-4 pt-3 border-t border-line-soft space-y-2">
        <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
          Ads del adset{" "}
          <span className="text-line">·</span> {adset.ads.length}
        </p>

        {adset.ads.length === 0 ? (
          <p className="text-[11px] text-muted">
            Sin ads. El adset necesita al menos uno para poder cerrar el QA.
          </p>
        ) : (
          adset.ads.map((ad, j) => (
            <AdCard
              key={ad.id}
              ad={ad}
              adsetIndex={index}
              index={j}
              adTypes={adTypes}
              editable={adsEditable}
              pending={pending}
              startTransition={startTransition}
              onChange={onChange}
            />
          ))
        )}

        {adsEditable && (
          <button
            type="button"
            onClick={() => run(() => addTrafficAd({ adsetId: adset.id }))}
            disabled={pending}
            className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink disabled:opacity-40"
          >
            <Plus size={12} strokeWidth={2.5} />
            Agregar ad
          </button>
        )}
      </div>
    </div>
  );
}

// ── Tarjeta de un ad (AM/PM) ────────────────────────────────────────────────

function AdCard({
  ad,
  adsetIndex,
  index,
  adTypes,
  editable,
  pending,
  startTransition,
  onChange,
}: {
  ad: PlanTrafficAd;
  adsetIndex: number;
  index: number;
  adTypes: AdTypeOption[];
  editable: boolean;
  pending: boolean;
  startTransition: StartTransition;
  onChange: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const missing = findAdIssues(ad, `ad ${index + 1} del adset ${adsetIndex + 1}`);
  const loaded = isAdLoaded(ad);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    startTransition(async () => {
      const r = await fn();
      if (!r.ok && r.error) toast.error(r.error);
      onChange();
    });
  };

  const save = (partial: Omit<Parameters<typeof updateTrafficAd>[0], "adId">) =>
    run(() => updateTrafficAd({ ...partial, adId: ad.id }));

  const onRemove = async () => {
    if (
      !(await confirm({
        title: `¿Eliminar el ad ${index + 1}?`,
        confirmLabel: "Eliminar",
        danger: true,
      }))
    )
      return;
    run(() => removeTrafficAd(ad.id));
  };

  // El desplegable lista los tipos habilitados + el que el ad ya tenga (aunque
  // el cliente lo haya deshabilitado después: esconderlo haría que el ad se
  // viera vacío y el planner lo re-clasificara sin querer).
  const options = adTypes.filter((t) => t.enabled || t.id === ad.adTypeId);
  const selected = adTypes.find((t) => t.id === ad.adTypeId) ?? null;

  return (
    <div
      className={`rounded border px-3 py-2.5 ${
        loaded
          ? "border-success-soft bg-success-soft/20"
          : "border-line bg-white dark:bg-paper-2"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-2.5">
        <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
          Ad {index + 1}
        </span>
        <span className="text-xs text-ink-2">
          {selected
            ? selected.requiresDetail
              ? (ad.adTypeOther ?? "").trim() || selected.name
              : selected.name
            : ad.adTypeName ?? "— sin tipo —"}
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
            onClick={() =>
              run(() => setTrafficAdLoaded({ adId: ad.id, loaded: !loaded }))
            }
            disabled={!editable || pending || (!loaded && missing.length > 0)}
            title={
              !loaded && missing.length > 0
                ? "Completá el ad antes de marcarlo como cargado"
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
              title="Eliminar ad"
            >
              <Trash2 size={12} />
            </button>
          )}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-5 gap-y-3">
        <Field label="Tipo de ad">
          <div className="flex items-center gap-2">
            <select
              value={ad.adTypeId ?? ""}
              disabled={!editable}
              onChange={(e) => save({ adTypeId: e.target.value || null })}
              className="text-sm bg-transparent border-b border-line hover:border-ink-2 focus:border-accent focus:outline-none py-0.5 disabled:opacity-50"
            >
              <option value="">— elegir —</option>
              {options.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.enabled ? "" : " (deshabilitado)"}
                </option>
              ))}
            </select>
            {selected?.requiresDetail && (
              <TextInput
                value={ad.adTypeOther ?? ""}
                disabled={!editable}
                placeholder="¿Qué tipo de ad es?"
                onCommit={(v) => save({ adTypeOther: v })}
              />
            )}
          </div>
        </Field>

        <Field label="Link del creativo">
          <div className="flex items-center gap-2">
            <TextInput
              value={ad.creativeUrl ?? ""}
              disabled={!editable}
              placeholder="https://…"
              onCommit={(v) => save({ creativeUrl: v || null })}
            />
            {ad.creativeUrl && <OpenLink href={ad.creativeUrl} />}
          </div>
        </Field>

        <Field label="Título">
          <TextInput
            value={ad.headline ?? ""}
            disabled={!editable}
            placeholder="Título del ad"
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

        <Field label="URL">
          <div className="flex items-center gap-2">
            <TextInput
              value={ad.clickUrl ?? ""}
              disabled={!editable}
              placeholder="URL con tracking, la que va en la plataforma"
              onCommit={(v) => save({ clickUrl: v || null })}
            />
            {ad.clickUrl && <OpenLink href={ad.clickUrl} />}
          </div>
        </Field>

        <Field label="Landing">
          <div className="flex items-center gap-2">
            <TextInput
              value={ad.landingUrl ?? ""}
              disabled={!editable}
              placeholder="https://…"
              onCommit={(v) => save({ landingUrl: v || null })}
            />
            {ad.landingUrl && <OpenLink href={ad.landingUrl} />}
          </div>
        </Field>

        <Field label="Copy" className="md:col-span-2">
          <textarea
            key={ad.copy ?? ""}
            defaultValue={ad.copy ?? ""}
            disabled={!editable}
            rows={3}
            placeholder="Texto del ad tal cual va a la plataforma"
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

function OpenLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="shrink-0 inline-flex items-center gap-1 rounded border border-line px-2 py-1 text-[11px] text-ink-2 hover:border-accent hover:text-accent"
      title={href}
    >
      <ExternalLink size={11} strokeWidth={2} />
      Abrir
    </a>
  );
}

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

function MoneyInput({
  value,
  onCommit,
  disabled,
}: {
  value: number | null;
  onCommit: (v: number | null) => void;
  disabled?: boolean;
}) {
  const display =
    value != null && value > 0
      ? value.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : "";
  return (
    <input
      key={display}
      type="text"
      inputMode="decimal"
      defaultValue={display}
      disabled={disabled}
      placeholder="0.00"
      onBlur={(e) => {
        const raw = e.target.value.trim();
        if (raw === "") {
          e.target.value = "";
          if (value != null) onCommit(null);
          return;
        }
        const n = Number.parseFloat(raw.replace(/[^0-9.]/g, ""));
        if (!Number.isFinite(n) || n < 0) {
          e.target.value = display;
          return;
        }
        e.target.value = n.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
        if (value == null || Math.abs(n - value) >= 0.005) onCommit(n);
      }}
      className="w-32 font-mono text-sm tabular-nums bg-transparent border-b border-line hover:border-ink-2 focus:border-accent focus:outline-none py-0.5 disabled:opacity-50"
    />
  );
}

function DateInput({
  value,
  onCommit,
  disabled,
}: {
  value: string | null;
  onCommit: (v: string | null) => void;
  disabled?: boolean;
}) {
  return (
    <input
      key={value ?? ""}
      type="date"
      defaultValue={value ?? ""}
      disabled={disabled}
      onBlur={(e) =>
        e.target.value !== (value ?? "") && onCommit(e.target.value || null)
      }
      className="font-mono text-xs bg-transparent border-b border-line hover:border-ink-2 focus:border-accent focus:outline-none py-0.5 disabled:opacity-50"
    />
  );
}
