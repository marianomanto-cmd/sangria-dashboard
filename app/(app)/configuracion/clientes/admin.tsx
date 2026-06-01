"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowUpRight, Plus, Settings } from "lucide-react";
import {
  createClient as createClientAction,
  updateClient,
} from "@/app/actions/clients";
import { Button } from "@/components/button";
import type { clients as clientsTable } from "@/db/schema";
import type { Language } from "@/lib/i18n";

type Client = typeof clientsTable.$inferSelect;
type ClientStatus = Client["status"];

const LANGUAGE_OPTIONS: Array<{ value: Language; label: string }> = [
  { value: "en", label: "Inglés" },
  { value: "es", label: "Español" },
];

const STATUS_OPTIONS: Array<{ value: ClientStatus; label: string }> = [
  { value: "active", label: "Activo" },
  { value: "paused", label: "Pausado" },
  { value: "archived", label: "Archivado" },
];

export function ClientsAdmin({ initialRows }: { initialRows: Client[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showAddForm, setShowAddForm] = useState(false);
  const [draft, setDraft] = useState({
    name: "",
    prefix: "",
    language: "en" as Language,
  });
  const [error, setError] = useState<string | null>(null);

  const refresh = () => router.refresh();

  const onCreate = async () => {
    if (!draft.name.trim()) {
      setError("Nombre requerido");
      return;
    }
    setError(null);
    const r = await createClientAction({
      name: draft.name.trim(),
      prefix: draft.prefix.trim() || null,
      language: draft.language,
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setDraft({ name: "", prefix: "", language: "en" });
    setShowAddForm(false);
    refresh();
  };

  const onUpdate = (
    id: string,
    partial: Omit<Parameters<typeof updateClient>[0], "id">,
  ) => {
    startTransition(async () => {
      const r = await updateClient({ ...partial, id });
      if (!r.ok) alert(r.error);
      refresh();
    });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-line bg-white dark:bg-paper-2 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-paper">
            <tr className="text-[11px] uppercase tracking-[0.06em] text-muted">
              <th className="text-left font-medium px-5 py-2.5">Nombre</th>
              <th className="text-left font-medium px-5 py-2.5">Slug</th>
              <th className="text-left font-medium px-5 py-2.5">Prefijo</th>
              <th className="text-left font-medium px-5 py-2.5">Idioma</th>
              <th className="text-left font-medium px-5 py-2.5">Estado</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody>
            {initialRows.map((c) => (
              <tr
                key={c.id}
                className="border-t border-line-soft hover:bg-paper-2 transition-colors"
              >
                <td className="px-5 py-2">
                  <input
                    type="text"
                    defaultValue={c.name}
                    disabled={pending}
                    onBlur={(e) =>
                      e.target.value !== c.name &&
                      onUpdate(c.id, { name: e.target.value })
                    }
                    className="font-medium bg-transparent border-b border-transparent hover:border-line focus:border-accent focus:outline-none px-1 -mx-1 w-full"
                  />
                </td>
                <td className="px-5 py-2 font-mono text-xs text-muted">
                  {c.slug}
                </td>
                <td className="px-5 py-2">
                  <input
                    type="text"
                    defaultValue={c.prefix ?? ""}
                    disabled={pending}
                    placeholder="—"
                    onBlur={(e) => {
                      const v = e.target.value;
                      if (v !== (c.prefix ?? "")) {
                        onUpdate(c.id, { prefix: v || null });
                      }
                    }}
                    className="font-mono text-xs bg-transparent border-b border-transparent hover:border-line focus:border-accent focus:outline-none px-1 -mx-1 w-20"
                  />
                </td>
                <td className="px-5 py-2">
                  <select
                    value={c.language}
                    disabled={pending}
                    onChange={(e) =>
                      onUpdate(c.id, { language: e.target.value as Language })
                    }
                    className="rounded-md border border-line bg-white dark:bg-paper-2 px-2 py-1 text-xs focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft"
                  >
                    {LANGUAGE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-5 py-2">
                  <select
                    value={c.status}
                    disabled={pending}
                    onChange={(e) =>
                      onUpdate(c.id, { status: e.target.value as ClientStatus })
                    }
                    className="rounded-md border border-line bg-white dark:bg-paper-2 px-2 py-1 text-xs focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft"
                  >
                    {STATUS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-2 text-center">
                  <div className="inline-flex items-center gap-0.5">
                    <Link
                      href={`/configuracion/clientes/${c.slug}`}
                      className="text-muted hover:text-accent inline-flex p-1"
                      title="Publishers / métricas / mercados de este cliente"
                    >
                      <Settings size={14} />
                    </Link>
                    <Link
                      href={`/clientes/${c.slug}`}
                      className="text-muted hover:text-ink inline-flex p-1"
                      title="Ver cliente"
                    >
                      <ArrowUpRight size={14} />
                    </Link>
                  </div>
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
              Agregar cliente
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2 py-1.5">
              <input
                type="text"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Nombre del cliente"
                autoFocus
                className="rounded-md border border-line bg-white dark:bg-paper-2 px-2 py-1 text-sm focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft"
              />
              <input
                type="text"
                value={draft.prefix}
                onChange={(e) =>
                  setDraft({ ...draft, prefix: e.target.value.toUpperCase() })
                }
                placeholder="Prefijo (opcional)"
                className="rounded-md border border-line bg-white dark:bg-paper-2 px-2 py-1 text-sm font-mono w-32 focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft"
              />
              <select
                value={draft.language}
                onChange={(e) =>
                  setDraft({ ...draft, language: e.target.value as Language })
                }
                className="rounded-md border border-line bg-white dark:bg-paper-2 px-2 py-1 text-sm focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft"
              >
                {LANGUAGE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <Button size="xs" onClick={onCreate}>
                Crear
              </Button>
              <button
                type="button"
                onClick={() => {
                  setShowAddForm(false);
                  setDraft({ name: "", prefix: "", language: "en" });
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
        El slug se genera automáticamente desde el nombre y no es editable
        después. El prefijo (ej. COPA, CRA) se usa al armar el code de los
        proyectos. El idioma afecta el formato de fechas en la UI y el
        contenido de los exports (PDF/Excel) cuando este cliente está
        seleccionado en el filtro global. Las métricas (clicks, views, etc.)
        siempre quedan en inglés.
      </p>
    </div>
  );
}
