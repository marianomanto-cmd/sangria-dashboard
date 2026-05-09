"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { createProject } from "@/app/actions/projects";

export function NewProjectForm({
  clients,
  origins,
  currentYear,
}: {
  clients: Array<{ id: string; name: string; prefix: string | null; slug: string }>;
  origins: Array<{ id: string; clientId: string; name: string }>;
  currentYear: number;
}) {
  const router = useRouter();
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [budgetOriginId, setBudgetOriginId] = useState("");
  const [shortId, setShortId] = useState("");
  const [name, setName] = useState("");
  const [totalGrossBudget, setTotalGrossBudget] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedClient = clients.find((c) => c.id === clientId);
  const clientPrefix = selectedClient?.prefix ?? selectedClient?.slug?.toUpperCase() ?? "X";

  const filteredOrigins = useMemo(
    () => origins.filter((o) => o.clientId === clientId),
    [origins, clientId],
  );

  // Auto-set first origin when client changes
  if (
    filteredOrigins.length > 0 &&
    !filteredOrigins.some((o) => o.id === budgetOriginId)
  ) {
    setBudgetOriginId(filteredOrigins[0].id);
  }

  const computedCode = useMemo(() => {
    const cleanId = shortId.trim().replace(/[^a-zA-Z0-9]/g, "");
    const cleanName = name.trim().replace(/[^a-zA-Z0-9]/g, "");
    if (!cleanId || !cleanName) return "";
    // Si shortId ya empieza con "m", la usamos tal cual; si no, le agregamos.
    const idPart = /^m/i.test(cleanId) ? cleanId : `m${cleanId}`;
    return `${clientPrefix}.${idPart}.${cleanName}`;
  }, [clientPrefix, shortId, name]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!computedCode) return;
    setError(null);
    setSubmitting(true);
    const r = await createProject({
      clientId,
      budgetOriginId,
      code: computedCode,
      name: name.trim(),
      totalGrossBudgetUsd: totalGrossBudget
        ? Number.parseFloat(totalGrossBudget)
        : undefined,
      startDate: startDate || null,
      endDate: endDate || null,
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
      className="rounded-lg border border-line bg-white p-6 max-w-3xl space-y-5"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <Field label="Cliente">
          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft"
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
            className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft"
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <Field label={`Identificador (m<id>)`}>
          <input
            type="text"
            value={shortId}
            onChange={(e) => setShortId(e.target.value)}
            placeholder={`m${currentYear}A01 o mCostaRica${currentYear}`}
            required
            className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm font-mono focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft"
          />
          <p className="mt-1 text-[11px] text-muted">
            Si no empieza con &quot;m&quot;, se le agrega automáticamente.
          </p>
        </Field>
        <Field label="Nombre del proyecto">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="CostaRica2026"
            required
            className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft"
          />
          <p className="mt-1 text-[11px] text-muted">
            Sin espacios ni caracteres especiales (se limpian automáticamente).
          </p>
        </Field>
      </div>

      <div className="rounded-md bg-paper-2 border border-line px-3 py-2 text-sm">
        <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted mb-1">
          Code resultante
        </p>
        <p className="font-mono">
          {computedCode || (
            <span className="text-stone-300">{clientPrefix}.m&lt;id&gt;.&lt;Nombre&gt;</span>
          )}
        </p>
      </div>

      <Field label="Total gross budget (USD)">
        <input
          type="text"
          inputMode="decimal"
          value={totalGrossBudget}
          onChange={(e) => setTotalGrossBudget(e.target.value.replace(/[^0-9.]/g, ""))}
          placeholder="300000"
          className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm font-mono focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft"
        />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <Field label="Período inicio">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft"
          />
        </Field>
        <Field label="Período fin">
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft"
          />
        </Field>
      </div>

      <Field label="Notas (opcional)">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft"
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
          disabled={submitting || !computedCode || !budgetOriginId}
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
