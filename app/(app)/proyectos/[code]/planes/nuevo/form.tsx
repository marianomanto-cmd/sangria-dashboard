"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { createPlan, duplicatePlan } from "@/app/actions/plans";
import type { SourcePlanOption } from "@/app/actions/plans";
import { formatUsd } from "@/lib/format";
import { Button } from "@/components/button";

const PRESETS = ["Awareness", "Consideration", "Performance", "Brand", "Promo"];

type Mode = "empty" | "duplicate";

export function NewPlanForm({
  projectId,
  projectCode,
  sourcePlans,
}: {
  projectId: string;
  projectCode: string;
  sourcePlans: SourcePlanOption[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("empty");
  const [name, setName] = useState("");
  const [sourcePlanId, setSourcePlanId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedSource = useMemo(
    () => sourcePlans.find((p) => p.planId === sourcePlanId) ?? null,
    [sourcePlans, sourcePlanId],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    setSubmitting(true);

    if (mode === "duplicate") {
      if (!sourcePlanId) {
        setError("Elegí un plan fuente para duplicar.");
        setSubmitting(false);
        return;
      }
      const r = await duplicatePlan({
        sourcePlanId,
        targetProjectId: projectId,
        newName: name.trim(),
      });
      if (!r.ok) {
        setError(r.error);
        setSubmitting(false);
        return;
      }
      router.push(`/proyectos/${projectCode}/planes/${r.planId}`);
      return;
    }

    const r = await createPlan({
      projectId,
      name: name.trim(),
    });
    if (!r.ok) {
      setError(r.error);
      setSubmitting(false);
      return;
    }
    router.push(`/proyectos/${projectCode}/planes/${r.planId}`);
  };

  const canDuplicate = sourcePlans.length > 0;

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-line bg-white dark:bg-paper-2 p-6 space-y-5"
    >
      {/* Selector de modo */}
      <div className="flex items-center border-b border-line -mt-2 -mx-2">
        <ModeTab
          active={mode === "empty"}
          onClick={() => setMode("empty")}
          label="Plan vacío"
        />
        <ModeTab
          active={mode === "duplicate"}
          onClick={() => canDuplicate && setMode("duplicate")}
          label={`Duplicar plan existente${canDuplicate ? ` (${sourcePlans.length})` : ""}`}
          disabled={!canDuplicate}
          disabledTitle="Este cliente todavía no tiene planes para duplicar."
        />
      </div>

      {mode === "duplicate" && (
        <div>
          <label className="block text-[11px] font-medium uppercase tracking-[0.08em] text-muted mb-1.5">
            Plan fuente
          </label>
          <select
            value={sourcePlanId}
            onChange={(e) => setSourcePlanId(e.target.value)}
            required={mode === "duplicate"}
            className="w-full rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft"
          >
            <option value="">— elegí un plan del cliente —</option>
            {sourcePlans.map((p) => (
              <option key={p.planId} value={p.planId}>
                {formatSourceOption(p)}
              </option>
            ))}
          </select>
          {selectedSource && <SourcePlanSummary plan={selectedSource} />}
          <p className="mt-2 text-[11px] text-muted">
            Se clona el plan entero (publishers, placements, fees) en estado{" "}
            <span className="font-mono">draft</span>. Los snapshots aprobados
            se quedan en el plan original.
          </p>
        </div>
      )}

      <div>
        <label className="block text-[11px] font-medium uppercase tracking-[0.08em] text-muted mb-1.5">
          Nombre del plan
          {mode === "duplicate" && (
            <span className="ml-1 normal-case tracking-normal text-muted/80 font-normal">
              (nuevo nombre — debe ser distinto si lo duplicás en el mismo proyecto)
            </span>
          )}
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={
            mode === "duplicate" && selectedSource
              ? `${selectedSource.planName} (copia)`
              : "Awareness"
          }
          required
          autoFocus
          className="w-full rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft"
        />
        {mode === "empty" && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setName(p)}
                className="text-xs text-muted hover:text-ink hover:bg-paper-2 border border-line rounded-md px-2 py-0.5"
              >
                {p}
              </button>
            ))}
          </div>
        )}
        {mode === "duplicate" && selectedSource && (
          <button
            type="button"
            onClick={() => setName(`${selectedSource.planName} (copia)`)}
            className="mt-2 text-xs text-muted hover:text-ink hover:bg-paper-2 border border-line rounded-md px-2 py-0.5"
          >
            usar &quot;{selectedSource.planName} (copia)&quot;
          </button>
        )}
        <p className="mt-2 text-[11px] text-muted">
          Identificador completo:{" "}
          <span className="font-mono text-ink-2">
            {projectCode}.{name || "<nombre>"}
          </span>
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button
          type="submit"
          size="lg"
          disabled={
            submitting ||
            !name.trim() ||
            (mode === "duplicate" && !sourcePlanId)
          }
        >
          {submitting
            ? mode === "duplicate"
              ? "Duplicando…"
              : "Creando…"
            : mode === "duplicate"
              ? "Duplicar y empezar a editar"
              : "Crear y empezar a editar"}
        </Button>
        <button
          type="button"
          onClick={() => router.push(`/proyectos/${projectCode}`)}
          className="text-sm text-muted hover:text-ink"
        >
          Cancelar
        </button>
      </div>

      {mode === "empty" && (
        <p className="text-[11px] text-muted border-t border-line-soft pt-3">
          El plan arranca en estado <span className="font-mono">draft</span>{" "}
          sin publishers ni placements. Las fechas del plan se calcularán
          automáticamente desde las fechas de los placements que cargues
          en el editor.
        </p>
      )}
    </form>
  );
}

function ModeTab({
  active,
  onClick,
  label,
  disabled,
  disabledTitle,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
  disabledTitle?: string;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={disabled ? disabledTitle : undefined}
      data-active={active}
      className="px-4 py-2.5 text-[13px] font-medium text-muted data-[active=true]:text-ink data-[active=true]:border-b-2 data-[active=true]:border-accent -mb-px disabled:opacity-40 disabled:cursor-not-allowed hover:text-ink data-[active=true]:hover:text-ink transition-colors"
    >
      {label}
    </button>
  );
}

// "Awareness Q1 · Lufthansa Brand AR · (AR, MX) (Meta, Google) · $50,000"
// El parens 1 son los mercados; el parens 2 los publishers; al final, el
// total media del plan. El status va como sufijo si no es draft, para que
// el planner sepa si está copiando un plan aprobado o uno todavía vacío.
function formatSourceOption(p: SourcePlanOption): string {
  const markets = p.markets.length > 0 ? ` (${p.markets.join(", ")})` : " (—)";
  const pubs =
    p.publishers.length > 0 ? ` (${p.publishers.join(", ")})` : " (sin publishers)";
  const total = p.totalMediaUsd > 0 ? ` · ${formatUsd(p.totalMediaUsd)}` : "";
  const statusTag = p.status !== "draft" ? ` [${p.status}]` : "";
  return `${p.planName} · ${p.projectName}${markets}${pubs}${total}${statusTag}`;
}

function SourcePlanSummary({ plan }: { plan: SourcePlanOption }) {
  return (
    <div className="mt-2 rounded-md border border-line-soft bg-paper-2/40 px-3 py-2 text-[11.5px] space-y-1">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="font-medium text-ink">{plan.planName}</span>
        <span className="text-muted">·</span>
        <span className="text-ink-2">{plan.projectName}</span>
        <span className="font-mono text-[10px] text-muted">
          {plan.projectCode}
        </span>
        {plan.status !== "draft" && (
          <span className="inline-flex items-center rounded-sm border border-line bg-paper-2 px-1.5 py-0 text-[10px] font-medium text-muted">
            {plan.status}
          </span>
        )}
      </div>
      <div className="flex items-center gap-4 text-muted">
        <span>
          Mercados:{" "}
          <span className="text-ink-2 font-medium">
            {plan.markets.length > 0 ? plan.markets.join(", ") : "—"}
          </span>
        </span>
        <span>
          Publishers:{" "}
          <span className="text-ink-2 font-medium">
            {plan.publishers.length > 0
              ? plan.publishers.join(", ")
              : "sin publishers"}
          </span>
        </span>
        <span className="ml-auto font-mono text-ink-2 font-semibold tabular-nums">
          {plan.totalMediaUsd > 0 ? formatUsd(plan.totalMediaUsd) : "—"}
        </span>
      </div>
    </div>
  );
}
