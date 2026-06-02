"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/button";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-dialog";
import {
  createMarket,
  deleteMarket,
  updateMarket,
} from "@/app/actions/markets";
import {
  createMetric,
  deleteMetric,
  updateMetric,
} from "@/app/actions/metrics";
import {
  createBudgetOrigin,
  deleteBudgetOrigin,
  updateBudgetOrigin,
} from "@/app/actions/budget-origins";
import {
  createPublisher,
  deletePublisher,
  updatePublisher,
} from "@/app/actions/publishers";
import type {
  budgetOrigins as budgetOriginsTable,
  markets as marketsTable,
  metricsCatalog as metricsTable,
} from "@/db/schema";

type PublisherRow = {
  publisherId: string;
  publisherName: string;
  publisherSlug: string;
  enabled: boolean;
  agencyPays: boolean;
};

type Metric = typeof metricsTable.$inferSelect;
type Market = typeof marketsTable.$inferSelect;
type BudgetOrigin = typeof budgetOriginsTable.$inferSelect;

export function ClientConfigSections({
  clientId,
  clientSlug,
  clientName,
  publishers,
  metrics,
  markets,
  budgetOrigins,
}: {
  clientId: string;
  clientSlug: string;
  clientName: string;
  publishers: PublisherRow[];
  metrics: Metric[];
  markets: Market[];
  budgetOrigins: BudgetOrigin[];
}) {
  return (
    <div className="space-y-8">
      <PublishersSection
        clientId={clientId}
        clientSlug={clientSlug}
        rows={publishers}
      />
      <MetricsSection
        clientId={clientId}
        clientSlug={clientSlug}
        rows={metrics}
      />
      <MarketsSection
        clientId={clientId}
        clientSlug={clientSlug}
        rows={markets}
      />
      <BudgetOriginsSection
        clientId={clientId}
        clientSlug={clientSlug}
        rows={budgetOrigins}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Publishers per-cliente. Mismo patrón que Mercados/Métricas: cada cliente
// tiene su propia lista. Acá se crean, renombran, habilitan/deshabilitan,
// se define agencia/cliente paga, y se borran (si no están en uso en planes).
// ────────────────────────────────────────────────────────────────────────────

function PublishersSection({
  clientId,
  clientSlug,
  rows,
}: {
  clientId: string;
  clientSlug: string;
  rows: PublisherRow[];
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({ name: "", slug: "", agencyPays: true });
  const [error, setError] = useState<string | null>(null);

  const onCreate = () => {
    if (!draft.name.trim()) {
      setError("Nombre requerido");
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await createPublisher({
        clientId,
        clientSlug,
        name: draft.name.trim(),
        slug: draft.slug.trim() || undefined,
        agencyPays: draft.agencyPays,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setDraft({ name: "", slug: "", agencyPays: true });
      setShowAdd(false);
      router.refresh();
    });
  };

  const onUpdate = (
    id: string,
    partial: { name?: string; agencyPays?: boolean; enabled?: boolean },
  ) => {
    startTransition(async () => {
      const r = await updatePublisher({ id, clientSlug, ...partial });
      if (!r.ok) toast.error(r.error);
      router.refresh();
    });
  };

  const onDelete = async (id: string, name: string) => {
    if (!(await confirm({ title: `¿Eliminar el publisher "${name}"?`, confirmLabel: "Eliminar", danger: true }))) return;
    startTransition(async () => {
      const r = await deletePublisher({ id, clientSlug });
      if (!r.ok) toast.error(r.error);
      router.refresh();
    });
  };

  return (
    <section id="publishers">
      <header className="mb-3 flex items-baseline justify-between">
        <h2 className="text-base font-semibold">Publishers</h2>
        <button
          type="button"
          onClick={() => setShowAdd((s) => !s)}
          className={buttonVariants({ size: "xs" })}
        >
          <Plus size={12} />
          Nuevo publisher
        </button>
      </header>
      <p className="text-xs text-muted mb-3 max-w-2xl">
        Cada cliente tiene su propia lista de publishers. Definí si la agencia
        paga directo o el cliente le paga al publisher (afecta facturación; el
        tracking aplica igual). Podés deshabilitar los que el cliente dejó de
        usar — los que estén en uso en algún plan no se pueden borrar.
      </p>
      {showAdd && (
        <div className="rounded-lg border border-line bg-paper-2 p-4 mb-3 space-y-2">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
            <input
              type="text"
              placeholder="Nombre (ej. YouTube)"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="rounded-md border border-line bg-white dark:bg-paper-2 px-2 py-1.5"
            />
            <input
              type="text"
              placeholder="slug (opcional, ej. youtube)"
              value={draft.slug}
              onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
              className="rounded-md border border-line bg-white dark:bg-paper-2 px-2 py-1.5 font-mono"
            />
            <select
              value={draft.agencyPays ? "agency" : "client"}
              onChange={(e) =>
                setDraft({ ...draft, agencyPays: e.target.value === "agency" })
              }
              className="rounded-md border border-line bg-white dark:bg-paper-2 px-2 py-1.5"
            >
              <option value="agency">Agencia paga</option>
              <option value="client">Cliente paga directo</option>
            </select>
          </div>
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={onCreate} disabled={pending}>
              Crear
            </Button>
            <button
              type="button"
              onClick={() => {
                setShowAdd(false);
                setError(null);
              }}
              className="rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-1.5 text-xs text-muted hover:text-ink"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
      <div className="rounded-lg border border-line bg-white dark:bg-paper-2 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-paper">
            <tr className="text-[11px] uppercase tracking-[0.06em] text-muted">
              <th className="text-left font-medium px-5 py-2.5">Publisher</th>
              <th className="text-left font-medium px-5 py-2.5">Slug</th>
              <th className="text-left font-medium px-5 py-2.5">Habilitado</th>
              <th className="text-left font-medium px-5 py-2.5">Pago</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-xs text-muted italic">
                  Sin publishers. Agregá el primero con el botón de arriba.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.publisherId}
                  className="border-t border-line-soft hover:bg-paper-2/50"
                >
                  <td className="px-5 py-2">
                    <input
                      type="text"
                      defaultValue={r.publisherName}
                      disabled={pending}
                      onBlur={(e) =>
                        e.target.value !== r.publisherName &&
                        onUpdate(r.publisherId, { name: e.target.value })
                      }
                      className="w-full bg-transparent text-ink focus:outline-none focus:bg-white dark:focus:bg-paper-2 dark:bg-paper-2 focus:ring-1 focus:ring-accent rounded-sm px-1"
                    />
                  </td>
                  <td className="px-5 py-2 font-mono text-xs text-muted">
                    {r.publisherSlug}
                  </td>
                  <td className="px-5 py-2">
                    <label className="inline-flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={r.enabled}
                        disabled={pending}
                        onChange={(e) =>
                          onUpdate(r.publisherId, { enabled: e.target.checked })
                        }
                      />
                      <span className="text-muted">{r.enabled ? "Sí" : "No"}</span>
                    </label>
                  </td>
                  <td className="px-5 py-2">
                    <select
                      value={r.agencyPays ? "agency" : "client"}
                      disabled={pending}
                      onChange={(e) =>
                        onUpdate(r.publisherId, {
                          agencyPays: e.target.value === "agency",
                        })
                      }
                      className="rounded-md border border-line bg-white dark:bg-paper-2 px-2 py-1 text-xs disabled:opacity-50"
                    >
                      <option value="agency">Agencia paga</option>
                      <option value="client">Cliente paga directo</option>
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      onClick={() => onDelete(r.publisherId, r.publisherName)}
                      disabled={pending}
                      className="text-muted hover:text-danger p-1"
                      aria-label="Eliminar"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Métricas per-cliente. Permite crear conversiones custom, renombrar y
// deshabilitar las existentes. Cada cliente tiene su lista propia.
// ────────────────────────────────────────────────────────────────────────────

function MetricsSection({
  clientId,
  clientSlug,
  rows,
}: {
  clientId: string;
  clientSlug: string;
  rows: Metric[];
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState<{
    name: string;
    slug: string;
    kind: "direct" | "calculated";
    unit: string;
    formula: string;
  }>({ name: "", slug: "", kind: "direct", unit: "", formula: "" });
  const [error, setError] = useState<string | null>(null);

  const onCreate = () => {
    if (!draft.name.trim()) {
      setError("Nombre requerido");
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await createMetric({
        clientId,
        clientSlug,
        name: draft.name.trim(),
        slug: draft.slug.trim() || undefined,
        kind: draft.kind,
        unit: draft.unit.trim() || null,
        formula: draft.kind === "calculated" ? draft.formula.trim() || null : null,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setDraft({ name: "", slug: "", kind: "direct", unit: "", formula: "" });
      setShowAdd(false);
      router.refresh();
    });
  };

  const onUpdate = (
    id: string,
    partial: { name?: string; unit?: string | null; formula?: string | null; enabled?: boolean },
  ) => {
    startTransition(async () => {
      const r = await updateMetric({ id, clientSlug, ...partial });
      if (!r.ok) toast.error(r.error);
      router.refresh();
    });
  };

  const onDelete = async (id: string, name: string) => {
    if (!(await confirm({ title: `¿Eliminar la métrica "${name}"?`, confirmLabel: "Eliminar", danger: true }))) return;
    startTransition(async () => {
      const r = await deleteMetric({ id, clientSlug });
      if (!r.ok) toast.error(r.error);
      router.refresh();
    });
  };

  return (
    <section id="metricas">
      <header className="mb-3 flex items-baseline justify-between">
        <h2 className="text-base font-semibold">Métricas e indicadores</h2>
        <button
          type="button"
          onClick={() => setShowAdd((s) => !s)}
          className={buttonVariants({ size: "xs" })}
        >
          <Plus size={12} />
          Nueva métrica
        </button>
      </header>
      <p className="text-xs text-muted mb-3 max-w-2xl">
        Direct = el planner ingresa el valor. Calculated = se deriva con una
        fórmula a partir de directs + amount (ej. CTR = clicks / impressions).
        Acá podés crear conversiones custom (ej. "Solicitudes de tarjeta").
      </p>
      {showAdd && (
        <div className="rounded-lg border border-line bg-paper-2 p-4 mb-3 space-y-2">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
            <input
              type="text"
              placeholder="Nombre"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="rounded-md border border-line bg-white dark:bg-paper-2 px-2 py-1.5 col-span-2"
            />
            <input
              type="text"
              placeholder="slug (opcional)"
              value={draft.slug}
              onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
              className="rounded-md border border-line bg-white dark:bg-paper-2 px-2 py-1.5 font-mono"
            />
            <select
              value={draft.kind}
              onChange={(e) =>
                setDraft({ ...draft, kind: e.target.value as "direct" | "calculated" })
              }
              className="rounded-md border border-line bg-white dark:bg-paper-2 px-2 py-1.5"
            >
              <option value="direct">direct</option>
              <option value="calculated">calculated</option>
            </select>
            <input
              type="text"
              placeholder="unit (imp, %, $, …)"
              value={draft.unit}
              onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
              className="rounded-md border border-line bg-white dark:bg-paper-2 px-2 py-1.5"
            />
          </div>
          {draft.kind === "calculated" && (
            <input
              type="text"
              placeholder="Fórmula (ej. amount / clicks o clicks / impressions)"
              value={draft.formula}
              onChange={(e) => setDraft({ ...draft, formula: e.target.value })}
              className="w-full rounded-md border border-line bg-white dark:bg-paper-2 px-2 py-1.5 text-xs font-mono"
            />
          )}
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={onCreate} disabled={pending}>
              Crear
            </Button>
            <button
              type="button"
              onClick={() => {
                setShowAdd(false);
                setError(null);
              }}
              className="rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-1.5 text-xs text-muted hover:text-ink"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
      <div className="rounded-lg border border-line bg-white dark:bg-paper-2 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-paper">
            <tr className="text-[11px] uppercase tracking-[0.06em] text-muted">
              <th className="text-left font-medium px-5 py-2.5">Nombre</th>
              <th className="text-left font-medium px-5 py-2.5">Slug</th>
              <th className="text-left font-medium px-5 py-2.5">Kind</th>
              <th className="text-left font-medium px-5 py-2.5">Unit</th>
              <th className="text-left font-medium px-5 py-2.5">Fórmula</th>
              <th className="text-left font-medium px-5 py-2.5">Habilitada</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-5 py-8 text-center text-xs text-muted italic">
                  Sin métricas. Agregá la primera con el botón de arriba.
                </td>
              </tr>
            ) : (
              rows.map((m) => (
                <tr
                  key={m.id}
                  className="border-t border-line-soft hover:bg-paper-2/50"
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
                      className="w-full bg-transparent text-ink focus:outline-none focus:bg-white dark:focus:bg-paper-2 dark:bg-paper-2 focus:ring-1 focus:ring-accent rounded-sm px-1"
                    />
                  </td>
                  <td className="px-5 py-2 font-mono text-xs text-muted">{m.slug}</td>
                  <td className="px-5 py-2 font-mono text-xs text-muted">{m.kind}</td>
                  <td className="px-5 py-2 font-mono text-xs text-muted">{m.unit ?? "—"}</td>
                  <td className="px-5 py-2">
                    {m.kind === "calculated" ? (
                      <input
                        type="text"
                        defaultValue={m.formula ?? ""}
                        disabled={pending}
                        onBlur={(e) =>
                          e.target.value !== (m.formula ?? "") &&
                          onUpdate(m.id, { formula: e.target.value || null })
                        }
                        className="w-full bg-transparent text-xs font-mono text-ink focus:outline-none focus:bg-white dark:focus:bg-paper-2 dark:bg-paper-2 focus:ring-1 focus:ring-accent rounded-sm px-1"
                      />
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-5 py-2">
                    <input
                      type="checkbox"
                      checked={m.enabled}
                      disabled={pending}
                      onChange={(e) => onUpdate(m.id, { enabled: e.target.checked })}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      onClick={() => onDelete(m.id, m.name)}
                      disabled={pending}
                      className="text-muted hover:text-danger p-1"
                      aria-label="Eliminar"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Mercados per-cliente. Misma idea que métricas: cada cliente tiene la suya.
// ────────────────────────────────────────────────────────────────────────────

function MarketsSection({
  clientId,
  clientSlug,
  rows,
}: {
  clientId: string;
  clientSlug: string;
  rows: Market[];
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({ name: "", slug: "" });
  const [error, setError] = useState<string | null>(null);

  const onCreate = () => {
    if (!draft.name.trim()) {
      setError("Nombre requerido");
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await createMarket({
        clientId,
        clientSlug,
        name: draft.name.trim(),
        slug: draft.slug.trim() || undefined,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setDraft({ name: "", slug: "" });
      setShowAdd(false);
      router.refresh();
    });
  };

  const onUpdate = (id: string, partial: { name?: string; enabled?: boolean }) => {
    startTransition(async () => {
      const r = await updateMarket({ id, clientSlug, ...partial });
      if (!r.ok) toast.error(r.error);
      router.refresh();
    });
  };

  const onDelete = async (id: string, name: string) => {
    if (!(await confirm({ title: `¿Eliminar el mercado "${name}"?`, confirmLabel: "Eliminar", danger: true }))) return;
    startTransition(async () => {
      const r = await deleteMarket({ id, clientSlug });
      if (!r.ok) toast.error(r.error);
      router.refresh();
    });
  };

  return (
    <section id="mercados">
      <header className="mb-3 flex items-baseline justify-between">
        <h2 className="text-base font-semibold">Mercados</h2>
        <button
          type="button"
          onClick={() => setShowAdd((s) => !s)}
          className={buttonVariants({ size: "xs" })}
        >
          <Plus size={12} />
          Nuevo mercado
        </button>
      </header>
      <p className="text-xs text-muted mb-3 max-w-2xl">
        Puede incluir países individuales (Costa Rica, Argentina) o
        agrupaciones (Centroamérica, LATAM). Cada cliente tiene su propia
        lista — podés deshabilitar los que no usa o renombrar.
      </p>
      {showAdd && (
        <div className="rounded-lg border border-line bg-paper-2 p-4 mb-3 space-y-2">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <input
              type="text"
              placeholder="Nombre (ej. Brasil)"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="rounded-md border border-line bg-white dark:bg-paper-2 px-2 py-1.5"
            />
            <input
              type="text"
              placeholder="slug (opcional, ej. brasil)"
              value={draft.slug}
              onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
              className="rounded-md border border-line bg-white dark:bg-paper-2 px-2 py-1.5 font-mono"
            />
          </div>
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={onCreate} disabled={pending}>
              Crear
            </Button>
            <button
              type="button"
              onClick={() => {
                setShowAdd(false);
                setError(null);
              }}
              className="rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-1.5 text-xs text-muted hover:text-ink"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
      <div className="rounded-lg border border-line bg-white dark:bg-paper-2 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-paper">
            <tr className="text-[11px] uppercase tracking-[0.06em] text-muted">
              <th className="text-left font-medium px-5 py-2.5">Nombre</th>
              <th className="text-left font-medium px-5 py-2.5">Slug</th>
              <th className="text-left font-medium px-5 py-2.5">Habilitado</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-xs text-muted italic">
                  Sin mercados. Agregá el primero con el botón de arriba.
                </td>
              </tr>
            ) : (
              rows.map((m) => (
                <tr
                  key={m.id}
                  className="border-t border-line-soft hover:bg-paper-2/50"
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
                      className="w-full bg-transparent text-ink focus:outline-none focus:bg-white dark:focus:bg-paper-2 dark:bg-paper-2 focus:ring-1 focus:ring-accent rounded-sm px-1"
                    />
                  </td>
                  <td className="px-5 py-2 font-mono text-xs text-muted">{m.slug}</td>
                  <td className="px-5 py-2">
                    <input
                      type="checkbox"
                      checked={m.enabled}
                      disabled={pending}
                      onChange={(e) => onUpdate(m.id, { enabled: e.target.checked })}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      onClick={() => onDelete(m.id, m.name)}
                      disabled={pending}
                      className="text-muted hover:text-danger p-1"
                      aria-label="Eliminar"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Budget origins per-cliente (centros de costo / fuentes de presupuesto).
// Un proyecto pertenece a UN budget origin — por eso no se puede eliminar uno
// que tenga proyectos asociados (FK restrict; el action lo chequea).
// ────────────────────────────────────────────────────────────────────────────

// Paleta fija para budget origins: 10 colores distinguibles (shades ~700) que
// andan bien en claro/oscuro. El planner elige de acá en vez de tipear un hex.
const BUDGET_ORIGIN_COLORS: { name: string; hex: string }[] = [
  { name: "Rojo", hex: "#b91c1c" },
  { name: "Naranja", hex: "#c2410c" },
  { name: "Ámbar", hex: "#b45309" },
  { name: "Verde", hex: "#15803d" },
  { name: "Teal", hex: "#0f766e" },
  { name: "Azul", hex: "#0369a1" },
  { name: "Índigo", hex: "#4338ca" },
  { name: "Violeta", hex: "#7e22ce" },
  { name: "Rosa", hex: "#be185d" },
  { name: "Piedra", hex: "#57534e" },
];

function ColorSelect({
  value,
  onChange,
  disabled,
}: {
  value: string | null;
  onChange: (hex: string | null) => void;
  disabled?: boolean;
}) {
  const inPalette = value
    ? BUDGET_ORIGIN_COLORS.some(
        (c) => c.hex.toLowerCase() === value.toLowerCase(),
      )
    : true;
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className="inline-block h-4 w-4 rounded-sm border border-line shrink-0"
        style={{ background: value ?? "transparent" }}
      />
      <select
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || null)}
        className="rounded-md border border-line bg-white dark:bg-paper-2 px-2 py-1 text-xs disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-accent"
      >
        <option value="">Sin color</option>
        {!inPalette && value && (
          <option value={value}>Personalizado ({value})</option>
        )}
        {BUDGET_ORIGIN_COLORS.map((c) => (
          <option key={c.hex} value={c.hex}>
            {c.name}
          </option>
        ))}
      </select>
    </span>
  );
}

function BudgetOriginsSection({
  clientId,
  clientSlug,
  rows,
}: {
  clientId: string;
  clientSlug: string;
  rows: BudgetOrigin[];
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({ name: "", colorHex: "" });
  const [error, setError] = useState<string | null>(null);

  const onCreate = () => {
    if (!draft.name.trim()) {
      setError("Nombre requerido");
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await createBudgetOrigin({
        clientId,
        clientSlug,
        name: draft.name.trim(),
        colorHex: draft.colorHex.trim() || null,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setDraft({ name: "", colorHex: "" });
      setShowAdd(false);
      router.refresh();
    });
  };

  const onUpdate = (
    id: string,
    partial: { name?: string; colorHex?: string | null },
  ) => {
    startTransition(async () => {
      const r = await updateBudgetOrigin({ id, clientSlug, ...partial });
      if (!r.ok) toast.error(r.error);
      router.refresh();
    });
  };

  const onDelete = async (id: string, name: string) => {
    if (!(await confirm({ title: `¿Eliminar el budget origin "${name}"?`, confirmLabel: "Eliminar", danger: true }))) return;
    startTransition(async () => {
      const r = await deleteBudgetOrigin({ id, clientSlug });
      if (!r.ok) toast.error(r.error);
      router.refresh();
    });
  };

  return (
    <section id="budget-origins">
      <header className="mb-3 flex items-baseline justify-between">
        <h2 className="text-base font-semibold">Budget origins</h2>
        <button
          type="button"
          onClick={() => setShowAdd((s) => !s)}
          className={buttonVariants({ size: "xs" })}
        >
          <Plus size={12} />
          Nuevo budget origin
        </button>
      </header>
      <p className="text-xs text-muted mb-3 max-w-2xl">
        Centros de costo o fuentes de presupuesto del cliente (ej. Online,
        CMI, Trade). Cada proyecto pertenece a uno.
      </p>
      {showAdd && (
        <div className="rounded-lg border border-line bg-paper-2 p-4 mb-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <input
              type="text"
              placeholder="Nombre (ej. Online)"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="flex-1 min-w-[180px] rounded-md border border-line bg-white dark:bg-paper-2 px-2 py-1.5"
            />
            <ColorSelect
              value={draft.colorHex || null}
              onChange={(hex) => setDraft({ ...draft, colorHex: hex ?? "" })}
              disabled={pending}
            />
          </div>
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={onCreate} disabled={pending}>
              Crear
            </Button>
            <button
              type="button"
              onClick={() => {
                setShowAdd(false);
                setError(null);
              }}
              className="rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-1.5 text-xs text-muted hover:text-ink"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
      <div className="rounded-lg border border-line bg-white dark:bg-paper-2 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-paper">
            <tr className="text-[11px] uppercase tracking-[0.06em] text-muted">
              <th className="text-left font-medium px-5 py-2.5">Nombre</th>
              <th className="text-left font-medium px-5 py-2.5">Color</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={3}
                  className="px-5 py-8 text-center text-xs text-muted italic"
                >
                  Sin budget origins. Agregá el primero con el botón de arriba.
                </td>
              </tr>
            ) : (
              rows.map((b) => (
                <tr
                  key={b.id}
                  className="border-t border-line-soft hover:bg-paper-2/50"
                >
                  <td className="px-5 py-2">
                    <input
                      type="text"
                      defaultValue={b.name}
                      disabled={pending}
                      onBlur={(e) =>
                        e.target.value !== b.name &&
                        onUpdate(b.id, { name: e.target.value })
                      }
                      className="w-full bg-transparent text-ink focus:outline-none focus:bg-white dark:focus:bg-paper-2 dark:bg-paper-2 focus:ring-1 focus:ring-accent rounded-sm px-1"
                    />
                  </td>
                  <td className="px-5 py-2">
                    <ColorSelect
                      value={b.colorHex}
                      onChange={(hex) => onUpdate(b.id, { colorHex: hex })}
                      disabled={pending}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      onClick={() => onDelete(b.id, b.name)}
                      disabled={pending}
                      className="text-muted hover:text-danger p-1"
                      aria-label="Eliminar"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
