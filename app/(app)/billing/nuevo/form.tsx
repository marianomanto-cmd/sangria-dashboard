"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { generateBillingDraft } from "@/app/actions/billing";
import type { BillingCandidate } from "@/db/queries/billing";

type Status = "idle" | "submitting" | "error";

export function NuevoBillingForm({
  candidates,
}: {
  candidates: BillingCandidate[];
}) {
  const router = useRouter();

  // Initial state: primer proyecto + primer mes disponible.
  const initial = candidates[0]
    ? deriveAvailableMonths(candidates[0])
    : { months: [], firstAvailable: "" };

  const [projectId, setProjectId] = useState(candidates[0]?.projectId ?? "");
  const [month, setMonth] = useState<string>(initial.firstAvailable);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const selected = useMemo(
    () => candidates.find((c) => c.projectId === projectId) ?? null,
    [candidates, projectId],
  );

  const availableMonths = useMemo(() => {
    if (!selected) return [];
    const billed = new Set(selected.alreadyBilledMonths);
    return selected.monthsWithSpend.filter((m) => !billed.has(m));
  }, [selected]);

  const handleProjectChange = (newId: string) => {
    setProjectId(newId);
    const newCand = candidates.find((c) => c.projectId === newId);
    const billed = new Set(newCand?.alreadyBilledMonths ?? []);
    const available = (newCand?.monthsWithSpend ?? []).filter(
      (m) => !billed.has(m),
    );
    setMonth(available[0] ?? "");
  };

  const canSubmit = projectId !== "" && month !== "" && status !== "submitting";

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canSubmit) return;
    setStatus("submitting");
    setErrorMsg(null);
    const result = await generateBillingDraft(projectId, month);
    if (result.ok) {
      router.push(`/billing/${result.billingId}`);
    } else {
      setStatus("error");
      setErrorMsg(result.error);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-line bg-white p-6 max-w-2xl"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <Field label="Proyecto">
          <select
            value={projectId}
            onChange={(e) => handleProjectChange(e.target.value)}
            className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft"
            required
          >
            {candidates.map((c) => (
              <option key={c.projectId} value={c.projectId}>
                {c.projectName} — {c.clientName} · {c.budgetOriginName}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Mes">
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft disabled:opacity-50"
            disabled={availableMonths.length === 0}
            required
          >
            {availableMonths.length === 0 ? (
              <option value="">Sin meses disponibles</option>
            ) : (
              availableMonths.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))
            )}
          </select>
          {selected && selected.alreadyBilledMonths.length > 0 && (
            <p className="mt-1 text-[11px] text-muted">
              Ya facturados: {selected.alreadyBilledMonths.join(", ")}
            </p>
          )}
        </Field>
      </div>

      {selected && (
        <p className="mt-4 text-xs text-muted">
          {selected.projectCode} · {selected.clientName} ·{" "}
          {selected.budgetOriginName}
        </p>
      )}

      {errorMsg && (
        <div className="mt-4 rounded-md border border-danger bg-danger-soft px-3 py-2 text-xs text-danger">
          {errorMsg}
        </div>
      )}

      <div className="mt-6 flex items-center gap-3">
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex items-center gap-2 rounded-md bg-ink text-white px-4 py-2 text-sm font-medium hover:bg-ink-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {status === "submitting" ? "Generando…" : "Generar draft"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/billing")}
          className="text-sm text-muted hover:text-ink"
        >
          Cancelar
        </button>
      </div>

      <p className="mt-5 text-[11px] text-muted leading-relaxed border-t border-line-soft pt-3">
        Cada línea del draft se calcula como{" "}
        <span className="font-mono">amount_net = actual_spend</span> y{" "}
        <span className="font-mono">fee = amount_net × fee_pct/100</span>.
        Las líneas con spend = $0 se omiten. Después podés revisar y emitir.
      </p>
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

function deriveAvailableMonths(c: BillingCandidate): {
  months: string[];
  firstAvailable: string;
} {
  const billed = new Set(c.alreadyBilledMonths);
  const months = c.monthsWithSpend.filter((m) => !billed.has(m));
  return { months, firstAvailable: months[0] ?? "" };
}
