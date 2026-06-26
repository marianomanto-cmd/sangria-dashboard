"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronDown, X } from "lucide-react";
import { type Language } from "@/lib/i18n";

// Filtro multi-select de clientes para la tab "Estimación" del Billing Tracker.
// Persiste como ?clients=slug1,slug2 (slugs, igual que el ?client= global). Si
// hay clientes seleccionados, la página los usa como filtro (override del
// cliente único del topbar); vacío = cae al cliente global / todos.

type ClientOption = { slug: string; name: string };

export function EstimateClientsFilter({
  clients,
  lang,
}: {
  clients: ClientOption[];
  lang: Language;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const valid = useMemo(() => new Set(clients.map((c) => c.slug)), [clients]);
  const selected = useMemo(
    () =>
      (searchParams?.get("clients") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s && valid.has(s)),
    [searchParams, valid],
  );

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const commit = (next: string[]) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (next.length) params.set("clients", next.join(","));
    else params.delete("clients");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  const toggle = (slug: string) =>
    commit(
      selected.includes(slug)
        ? selected.filter((s) => s !== slug)
        : [...selected, slug],
    );

  const allLabel = lang === "es" ? "Todos" : "All";
  const summary =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? (clients.find((c) => c.slug === selected[0])?.name ?? "1")
        : `${selected.length} ${lang === "es" ? "seleccionados" : "selected"}`;

  return (
    <section className="rounded-lg border border-line bg-white dark:bg-paper-2 px-5 py-4 mb-5">
      <div className="flex items-end gap-4 flex-wrap">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted mb-1">
            {lang === "es" ? "Clientes" : "Clients"}
          </p>
          <div ref={ref} className="relative">
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-haspopup="listbox"
              aria-expanded={open}
              className="w-full min-w-[260px] flex items-center justify-between gap-2 rounded-md border border-line bg-white dark:bg-paper-2 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <span
                className={`truncate ${selected.length ? "text-ink" : "text-muted"}`}
              >
                {summary}
              </span>
              <ChevronDown
                size={14}
                className={`text-muted shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
              />
            </button>
            {open && (
              <div
                role="listbox"
                className="absolute z-30 mt-1 w-full max-h-72 overflow-auto rounded-md border border-line bg-white dark:bg-paper-2 shadow-lg py-1"
              >
                {clients.length === 0 ? (
                  <p className="px-2.5 py-1.5 text-xs text-muted">
                    {lang === "es" ? "Sin clientes" : "No clients"}
                  </p>
                ) : (
                  clients.map((c) => {
                    const checked = selected.includes(c.slug);
                    return (
                      <button
                        key={c.slug}
                        type="button"
                        onClick={() => toggle(c.slug)}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-paper-2"
                      >
                        <span
                          className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                            checked
                              ? "bg-accent border-accent text-white"
                              : "border-line"
                          }`}
                        >
                          {checked && <Check size={11} strokeWidth={3} />}
                        </span>
                        <span className="truncate text-ink-2">{c.name}</span>
                      </button>
                    );
                  })
                )}
                {selected.length > 0 && (
                  <button
                    type="button"
                    onClick={() => commit([])}
                    className="w-full border-t border-line-soft px-2.5 py-1.5 text-left text-xs text-muted hover:text-ink"
                  >
                    {lang === "es" ? "Limpiar" : "Clear"}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => commit([])}
            className="inline-flex items-center gap-1 rounded-md border border-line bg-white dark:bg-paper-2 px-2.5 py-1.5 text-xs text-muted hover:text-ink hover:bg-paper-2 transition-colors"
          >
            <X size={12} />
            {lang === "es" ? "Limpiar filtro" : "Clear filter"}
          </button>
        )}
      </div>
    </section>
  );
}
