"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  createPublisher,
  deletePublisher,
  updatePublisher,
} from "@/app/actions/publishers";
import type { publishers as publishersTable } from "@/db/schema";

type Pub = typeof publishersTable.$inferSelect;

export function PublishersAdmin({ initialRows }: { initialRows: Pub[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAgencyPays, setNewAgencyPays] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => router.refresh();

  const onCreate = async () => {
    if (!newName.trim()) return;
    setError(null);
    const r = await createPublisher({
      name: newName.trim(),
      agencyPaysDefault: newAgencyPays,
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setNewName("");
    setNewAgencyPays(true);
    setShowAddForm(false);
    refresh();
  };

  const onUpdate = (
    id: string,
    partial: Omit<Parameters<typeof updatePublisher>[0], "id">,
  ) => {
    startTransition(async () => {
      const r = await updatePublisher({ ...partial, id });
      if (!r.ok) alert(r.error);
      refresh();
    });
  };

  const onDelete = (p: Pub) => {
    if (!confirm(`¿Eliminar "${p.name}"? Si está en uso en algún plan, será imposible borrarlo (la app sugiere deshabilitarlo).`)) return;
    startTransition(async () => {
      const r = await deletePublisher(p.id);
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
              <th className="text-left font-medium px-5 py-2.5">Agencia paga</th>
              <th className="text-left font-medium px-5 py-2.5">Estado</th>
              <th className="text-left font-medium px-5 py-2.5">Creado</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody>
            {initialRows.map((p) => (
              <tr
                key={p.id}
                className="border-t border-line-soft hover:bg-paper-2 transition-colors"
              >
                <td className="px-5 py-2">
                  <input
                    type="text"
                    defaultValue={p.name}
                    disabled={pending}
                    onBlur={(e) =>
                      e.target.value !== p.name &&
                      onUpdate(p.id, { name: e.target.value })
                    }
                    className="font-medium bg-transparent border-b border-transparent hover:border-line focus:border-accent focus:outline-none px-1 -mx-1"
                  />
                </td>
                <td className="px-5 py-2 font-mono text-xs text-muted">{p.slug}</td>
                <td className="px-5 py-2">
                  <button
                    type="button"
                    onClick={() =>
                      onUpdate(p.id, { agencyPaysDefault: !p.agencyPaysDefault })
                    }
                    disabled={pending}
                    className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[11px] font-medium ${
                      p.agencyPaysDefault
                        ? "bg-success-soft text-success border-success-soft"
                        : "bg-paper-2 text-muted border-line"
                    }`}
                  >
                    {p.agencyPaysDefault ? "sí" : "cliente paga"}
                  </button>
                </td>
                <td className="px-5 py-2">
                  <button
                    type="button"
                    onClick={() => onUpdate(p.id, { enabled: !p.enabled })}
                    disabled={pending}
                    className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[11px] font-medium ${
                      p.enabled
                        ? "bg-success-soft text-success border-success-soft"
                        : "bg-paper-2 text-stone-400 border-line"
                    }`}
                  >
                    {p.enabled ? "habilitado" : "deshabilitado"}
                  </button>
                </td>
                <td className="px-5 py-2 font-mono text-[11px] text-muted">
                  {p.createdAt.toISOString().slice(0, 10)}
                </td>
                <td className="px-2 py-2 text-center">
                  <button
                    type="button"
                    onClick={() => onDelete(p)}
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
              Agregar publisher
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2 py-1.5">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nombre del publisher"
                autoFocus
                className="rounded-md border border-line bg-white px-2 py-1 text-sm focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft"
              />
              <label className="flex items-center gap-1.5 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={newAgencyPays}
                  onChange={(e) => setNewAgencyPays(e.target.checked)}
                />
                agencia paga
              </label>
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
      <p className="text-[11px] text-muted">
        Click en cualquier celda para editar. El slug se genera automáticamente al
        crear, no se puede cambiar después. Los publishers en uso no se pueden borrar
        — usá &quot;deshabilitado&quot; para esconderlos del editor de planes.
      </p>
    </div>
  );
}
