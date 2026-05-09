"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Building2, Check, ChevronDown } from "lucide-react";

type ClientOption = {
  slug: string;
  name: string;
};

export function TopbarClientPicker({ clients }: { clients: ClientOption[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Detectar si estamos en /clientes/<slug> para resaltar la selección actual.
  const currentSlug = useMemo(() => {
    const m = pathname?.match(/^\/clientes\/([^/?#]+)/);
    return m?.[1] ?? null;
  }, [pathname]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const currentName =
    clients.find((c) => c.slug === currentSlug)?.name ?? null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-2.5 py-1 text-xs text-ink hover:bg-paper-2 hover:border-ink-2 transition-colors"
      >
        <Building2 size={13} strokeWidth={2} className="text-muted" />
        <span className="truncate max-w-[140px]">
          {currentName ? currentName : "Cliente: todos"}
        </span>
        <ChevronDown
          size={12}
          strokeWidth={2}
          className={`text-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 top-full mt-1 w-[240px] rounded-md border border-line bg-white shadow-lg z-30 max-h-[400px] overflow-auto py-1"
        >
          <Link
            href="/clientes"
            onClick={() => setOpen(false)}
            data-active={currentSlug === null}
            className="flex items-center justify-between px-3 py-1.5 text-sm text-ink-2 hover:bg-paper-2 data-[active=true]:text-ink data-[active=true]:font-medium"
          >
            <span>Ver todos</span>
            {currentSlug === null && (
              <Check size={14} strokeWidth={2.5} className="text-accent" />
            )}
          </Link>
          <div className="my-1 border-t border-line-soft" />
          {clients.map((c) => (
            <Link
              key={c.slug}
              href={`/clientes/${c.slug}`}
              onClick={() => setOpen(false)}
              data-active={currentSlug === c.slug}
              className="flex items-center justify-between px-3 py-1.5 text-sm text-ink-2 hover:bg-paper-2 data-[active=true]:text-ink data-[active=true]:font-medium"
            >
              <span className="truncate">{c.name}</span>
              {currentSlug === c.slug && (
                <Check size={14} strokeWidth={2.5} className="text-accent" />
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
