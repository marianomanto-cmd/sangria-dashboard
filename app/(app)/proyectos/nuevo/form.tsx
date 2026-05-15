"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createProject } from "@/app/actions/projects";

export function NewProjectForm({
  clients,
  origins,
}: {
  clients: Array<{ id: string; name: string }>;
  origins: Array<{ id: string; clientId: string; name: string }>;
}) {
  const router = useRouter();
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [budgetOriginId, setBudgetOriginId] = useState("");
  const [name, setName] = useState("");
  const [totalGrossBudget, setTotalGrossBudget] = useState("");
  const [startDate, setStartDate] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const filteredOrigins = useMemo(
    () => origins.filter((o) => o.clientId === clientId),
    [origins, clientId],
  );

  // Auto-set first origin when client changes
  useEffect(() => {
    if (
      filteredOrigins.length > 0 &&
      !filteredOrigins.some((o) => o.id === budgetOriginId)
    ) {
      setBudgetOriginId(filteredOrigins[0].id);
    }
  }, [filteredOrigins, budgetOriginId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    setSubmitting(true);
    const r = await createProject({
      clientId,
      budgetOriginId,
      name: name.trim(),
      totalGrossBudgetUsd: totalGrossBudget
        ? Number.parseFloat(totalGrossBudget)
        : undefined,
      startDate: startDate || null,
      notesMd: notes || null,
    });
    if (!r.ok) {
      setError(r.error);
      setSubmitting(false);
      return;
    }
    router.push(`/proyectos/${r.code}`);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-line bg-white dark:bg-paper-2 p-6 max-w-3xl space-y-5"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <Field label="Cliente">
          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="w-full rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft"
            required
          >
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Budget Origin">
          <select
            value={budgetOriginId}
            onChange={(e) => setBudgetOriginId(e.target.value)}
            className="w-full rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft"
            required
            disabled={filteredOrigins.length === 0}
          >
            {filteredOrigins.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
            {filteredOrigins.length === 0 && (
              <option value="">Sin orígenes para este cliente</option>
            )}
          </select>
        </Field>
      </div>

      <Field label="Nombre del proyecto">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Costa Rica 2026"
          required
          className="w-full rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft"
        />
      </Field>

      <Field label="Total gross budget (USD)">
        <input
          type="text"
          inputMode="decimal"
          value={totalGrossBudget}
          onChange={(e) => setTotalGrossBudget(e.target.value.replace(/[^0-9.]/g, ""))}
          placeholder="300000"
          className="w-full rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-2 text-sm font-mono focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft"
        />
      </Field>

      <Field label="Fecha estimada de inicio (opcional)">
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="w-full sm:w-1/2 rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft"
        />
        <p className="mt-1 text-[11px] text-muted">
          La fecha de finalización del proyecto se calcula automáticamente
          desde el placement con la fecha más lejana entre todos los planes.
        </p>
      </Field>

      <Field label="Notas (opcional)">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="w-full rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft"
        />
      </Field>

      {error && (
        <div className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3 border-t border-line-soft pt-4">
        <button
          type="submit"
          disabled={submitting || !name.trim() || !budgetOriginId}
          className="inline-flex items-center gap-1.5 rounded-md bg-ink text-white px-4 py-2 text-sm font-medium hover:bg-ink-2 transition-colors disabled:opacity-50"
        >
          {submitting ? "Creando…" : "Crear proyecto"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/proyectos")}
          className="text-sm text-muted hover:text-ink"
        >
          Cancelar
        </button>
      </div>
    </form>
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
