"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { deleteProject, updateProject } from "@/app/actions/projects";
import { Button } from "@/components/button";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-dialog";

type Origin = { id: string; name: string };

export function ProjectEditPanel({
  projectId,
  name,
  budgetOriginId,
  totalGrossBudgetUsd,
  startDate,
  notesMd,
  budgetOrigins,
}: {
  projectId: string;
  name: string;
  budgetOriginId: string;
  totalGrossBudgetUsd: string | null;
  startDate: string | null;
  notesMd: string | null;
  budgetOrigins: Origin[];
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    name,
    budgetOriginId,
    totalGrossBudget: totalGrossBudgetUsd ?? "",
    startDate: startDate ?? "",
    notes: notesMd ?? "",
  });

  const reset = () => {
    setDraft({
      name,
      budgetOriginId,
      totalGrossBudget: totalGrossBudgetUsd ?? "",
      startDate: startDate ?? "",
      notes: notesMd ?? "",
    });
    setError(null);
  };

  const onSave = async () => {
    if (!draft.name.trim()) {
      setError("Nombre requerido");
      return;
    }
    setError(null);
    setPending(true);
    const r = await updateProject({
      projectId,
      name: draft.name.trim(),
      budgetOriginId: draft.budgetOriginId,
      totalGrossBudgetUsd: draft.totalGrossBudget
        ? Number.parseFloat(draft.totalGrossBudget)
        : null,
      startDate: draft.startDate || null,
      notesMd: draft.notes || null,
    });
    setPending(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setOpen(false);
    toast.success("Proyecto actualizado");
    router.refresh();
  };

  const onDelete = async () => {
    if (
      !(await confirm({
        title: "¿Eliminar este proyecto?",
        body:
          "Se borran TODOS sus planes, placements, fees, billings, snapshots y " +
          "reportes asociados. Esta acción no se puede deshacer.",
        confirmLabel: "Eliminar proyecto",
        danger: true,
      }))
    )
      return;
    setPending(true);
    const r = await deleteProject({ projectId });
    if (!r.ok) {
      setPending(false);
      toast.error(r.error);
      return;
    }
    router.push("/proyectos");
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-1.5 text-sm font-medium text-ink-2 hover:border-ink-2 hover:text-ink transition-colors"
      >
        <Pencil size={14} />
        Editar proyecto
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-white dark:bg-paper-2 p-5 w-full space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Nombre del proyecto">
          <input
            type="text"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="w-full rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft"
          />
        </Field>
        <Field label="Budget Origin">
          <select
            value={draft.budgetOriginId}
            onChange={(e) =>
              setDraft({ ...draft, budgetOriginId: e.target.value })
            }
            className="w-full rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft"
          >
            {budgetOrigins.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Total gross budget (USD)">
          <input
            type="text"
            inputMode="decimal"
            value={draft.totalGrossBudget}
            onChange={(e) =>
              setDraft({
                ...draft,
                totalGrossBudget: e.target.value.replace(/[^0-9.]/g, ""),
              })
            }
            placeholder="300000"
            className="w-full rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-2 text-sm font-mono focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft"
          />
        </Field>
        <Field label="Fecha estimada de inicio">
          <input
            type="date"
            value={draft.startDate}
            onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}
            className="w-full rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft"
          />
        </Field>
      </div>
      <Field label="Notas">
        <textarea
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          rows={3}
          className="w-full rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft"
        />
      </Field>

      {error && (
        <div className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-line-soft pt-4">
        <div className="flex items-center gap-3">
          <Button size="lg" onClick={onSave} disabled={pending}>
            {pending ? "Guardando…" : "Guardar cambios"}
          </Button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              reset();
            }}
            disabled={pending}
            className="text-sm text-muted hover:text-ink"
          >
            Cancelar
          </button>
        </div>
        <button
          type="button"
          onClick={onDelete}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md border border-danger bg-white dark:bg-paper-2 px-3 py-2 text-sm font-medium text-danger hover:bg-danger-soft transition-colors disabled:opacity-50"
        >
          <Trash2 size={14} />
          Eliminar proyecto
        </button>
      </div>
    </div>
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
      <label className="block text-[11px] font-medium uppercase tracking-[0.08em] text-muted mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}
