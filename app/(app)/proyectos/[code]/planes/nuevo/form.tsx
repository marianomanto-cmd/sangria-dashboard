"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createPlan } from "@/app/actions/plans";

const PRESETS = ["Awareness", "Consideration", "Performance", "Brand", "Promo"];

export function NewPlanForm({
  projectId,
  projectCode,
}: {
  projectId: string;
  projectCode: string;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    setSubmitting(true);
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

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-line bg-white dark:bg-paper-2 p-6 space-y-5"
    >
      <div>
        <label className="block text-[11px] font-medium uppercase tracking-[0.08em] text-muted mb-1.5">
          Nombre del plan
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Awareness"
          required
          autoFocus
          className="w-full rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft"
        />
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
        <p className="mt-2 text-[11px] text-muted">
          Identificador completo:{" "}
          <span className="font-mono text-ink-2">
            {projectCode}.{name || "<nombre>"}
          </span>
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={submitting || !name.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-ink text-white px-4 py-2 text-sm font-medium hover:bg-ink-2 transition-colors disabled:opacity-50"
        >
          {submitting ? "Creando…" : "Crear y empezar a editar"}
        </button>
        <button
          type="button"
          onClick={() => router.push(`/proyectos/${projectCode}`)}
          className="text-sm text-muted hover:text-ink"
        >
          Cancelar
        </button>
      </div>

      <p className="text-[11px] text-muted border-t border-line-soft pt-3">
        El plan arranca en estado <span className="font-mono">draft</span>{" "}
        sin publishers ni placements. Las fechas del plan se calcularán
        automáticamente desde las fechas de los placements que cargues
        en el editor.
      </p>
    </form>
  );
}
