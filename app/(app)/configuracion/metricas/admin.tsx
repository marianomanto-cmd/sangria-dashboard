"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  createMetric,
  deleteMetric,
  updateMetric,
} from "@/app/actions/metrics";
import type { metricsCatalog as metricsTable } from "@/db/schema";

type Metric = typeof metricsTable.$inferSelect;

export function MetricsAdmin({ initialRows }: { initialRows: Metric[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<"direct" | "calculated">("direct");
  const [newUnit, setNewUnit] = useState("");
  const [newFormula, setNewFormula] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = () => router.refresh();

  const onCreate = async () => {
    if (!newName.trim()) return;
    setError(null);
    const r = await createMetric({
      name: newName.trim(),
      kind: newKind,
      unit: newUnit.trim() || null,
      formula: newKind === "calculated" ? newFormula.trim() || null : null,
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setNewName("");
    setNewKind("direct");
    setNewUnit("");
    setNewFormula("");
    setShowAddForm(false);
    refresh();
  };

  const onUpdate = (id: string, partial: Parameters<typeof updateMetric>[0]) => {
    startTransition(async () => {
      const r = await updateMetric({ ...partial, id });
      if (!r.ok) alert(r.error);
      refresh();
    });
  };

  const onDelete = (m: Metric) => {
    if (
      !confirm(
        `¿Eliminar "${m.name}"? Si está usada en placements, los valores guardados con su slug seguirán en la jsonb pero no se mostrarán en la UI.`,
      )
    )
      return;
    startTransition(async () => {
      const r = await deleteMetric(m.id);
      if (!r.ok) alert(r.error);
      refresh();
    });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-line bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-paper">
            <tr className="text-[11px] uppercase tracking-[0.06em] text-muted">
              <th className="text-left font-medium px-5 py-2.5">Nombre</th>
              <th className="text-left font-medium px-5 py-2.5">Slug</th>
              <th className="text-left font-medium px-5 py-2.5">Tipo</th>
              <th className="text-left font-medium px-5 py-2.5">Unidad</th>
              <th className="text-left font-medium px-5 py-2.5">Fórmula</th>
              <th className="text-left font-medium px-5 py-2.5">Estado</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody>
            {initialRows.map((m) => (
              <tr
                key={m.id}
                className="border-t border-line-soft hover:bg-paper-2 transition-colors"
              >
                <td className="px-5 py-2">
                  <input
                    type="text"
                    defaultValue={m.name}
                    disabled={pending}
                    onBlur={(e) =>
                      e.target.value !== m.name &&
                      onUpdate(m.id, { name: e.target.value })
                    }
                    className="font-medium bg-transparent border-b border-transparent hover:border-line focus:border-accent focus:outline-none px-1 -mx-1"
                  />
                </td>
                <td className="px-5 py-2 font-mono text-xs text-muted">{m.slug}</td>
                <td className="px-5 py-2">
                  <span
                    className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] ${
                      m.kind === "direct"
                        ? "bg-info-soft text-info border-info-soft"
                        : "bg-accent-soft text-accent border-accent-soft"
                    }`}
                  >
                    {m.kind}
                  </span>
                </td>
                <td className="px-5 py-2">
                  <input
                    type="text"
                    defaultValue={m.unit ?? ""}
                    disabled={pending}
                    placeholder="—"
                    onBlur={(e) =>
                      e.target.value !== (m.unit ?? "") &&
                      onUpdate(m.id, { unit: e.target.value || null })
                    }
                    className="font-mono text-xs bg-transparent border-b border-transparent hover:border-line focus:border-accent focus:outline-none w-16"
                  />
                </td>
                <td className="px-5 py-2">
                  <input
                    type="text"
                    defaultValue={m.formula ?? ""}
                    disabled={pending || m.kind === "direct"}
                    placeholder={m.kind === "direct" ? "(direct)" : "amount/views"}
                    onBlur={(e) =>
                      e.target.value !== (m.formula ?? "") &&
                      onUpdate(m.id, { formula: e.target.value || null })
                    }
                    className="font-mono text-xs bg-transparent border-b border-transparent hover:border-line focus:border-accent focus:outline-none disabled:opacity-50 w-40"
                  />
                </td>
                <td className="px-5 py-2">
                  <button
                    type="button"
                    onClick={() => onUpdate(m.id, { enabled: !m.enabled })}
                    disabled={pending}
                    className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[11px] font-medium ${
                      m.enabled
                        ? "bg-success-soft text-success border-success-soft"
                        : "bg-paper-2 text-stone-400 border-line"
                    }`}
                  >
                    {m.enabled ? "habilitado" : "deshabilitado"}
                  </button>
                </td>
                <td className="px-2 py-2 text-center">
                  <button
                    type="button"
                    onClick={() => onDelete(m)}
                    disabled={pending}
                    className="text-muted hover:text-danger p-1 disabled:opacity-50"
                    title="Eliminar"
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t border-line-soft px-5 py-2">
          {!showAddForm ? (
            <button
              type="button"
              onClick={() => setShowAddForm(true)}
              className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink"
            >
              <Plus size={12} strokeWidth={2.5} />
              Agregar métrica
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2 py-1.5">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nombre"
                autoFocus
                className="rounded-md border border-line bg-white px-2 py-1 text-sm focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft"
              />
              <select
                value={newKind}
                onChange={(e) => setNewKind(e.target.value as "direct" | "calculated")}
                className="rounded-md border border-line bg-white px-2 py-1 text-xs focus:border-accent focus:outline-none"
              >
                <option value="direct">direct</option>
                <option value="calculated">calculated</option>
              </select>
              <input
                type="text"
                value={newUnit}
                onChange={(e) => setNewUnit(e.target.value)}
                placeholder="Unidad (imp, %, $)"
                className="rounded-md border border-line bg-white px-2 py-1 text-xs font-mono focus:border-accent focus:outline-none w-32"
              />
              {newKind === "calculated" && (
                <input
                  type="text"
                  value={newFormula}
                  onChange={(e) => setNewFormula(e.target.value)}
                  placeholder="Fórmula: amount/views"
                  className="rounded-md border border-line bg-white px-2 py-1 text-xs font-mono focus:border-accent focus:outline-none w-44"
                />
              )}
              <button
                type="button"
                onClick={onCreate}
                className="rounded-md bg-ink text-white px-3 py-1 text-xs font-medium hover:bg-ink-2"
              >
                Crear
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddForm(false);
                  setNewName("");
                  setNewUnit("");
                  setNewFormula("");
                  setError(null);
                }}
                className="text-xs text-muted hover:text-ink"
              >
                Cancelar
              </button>
              {error && <span className="text-xs text-danger">{error}</span>}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-md bg-paper-2/50 border border-line-soft px-4 py-3 text-[11px] text-muted leading-relaxed">
        <p className="mb-1">
          <strong className="text-ink-2">Direct:</strong> métricas que el
          planner ingresa manualmente (impressions, clicks, views, conversions,
          followers, etc.).
        </p>
        <p>
          <strong className="text-ink-2">Calculated:</strong> se derivan en
          runtime con fórmula. Tokens soportados:{" "}
          <code className="font-mono">amount</code> (monto del placement) +
          slugs de cualquier métrica direct (clicks, views, impressions, etc).
          Operadores: <code className="font-mono">/</code> y{" "}
          <code className="font-mono">×N</code>. Ej:{" "}
          <code className="font-mono">amount/clicks</code>,{" "}
          <code className="font-mono">amount/impressions × 1000</code>,{" "}
          <code className="font-mono">clicks/impressions</code>.
        </p>
      </div>
    </div>
  );
}
