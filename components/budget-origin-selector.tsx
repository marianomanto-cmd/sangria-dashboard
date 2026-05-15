"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { BudgetOriginOption } from "@/db/queries/budget-origins";

type Props = {
  origins: BudgetOriginOption[];
  current: string | null;
  basePath: string; // e.g., "/proyectos" o "/planes"
  // Otras searchParams a preservar al navegar (ej. status=draft en /planes).
  preserveParams?: Record<string, string | undefined>;
};

export function BudgetOriginSelector({
  origins,
  current,
  basePath,
  preserveParams = {},
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

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

  if (origins.length === 0) return null;

  const byClient = new Map<string, BudgetOriginOption[]>();
  for (const o of origins) {
    const list = byClient.get(o.clientName) ?? [];
    list.push(o);
    byClient.set(o.clientName, list);
  }
  const showClientPrefix = byClient.size > 1;

  const buildHref = (originId: string | null): string => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(preserveParams)) {
      if (v !== undefined) params.set(k, v);
    }
    if (originId) params.set("origin", originId);
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  const currentOrigin = current ? origins.find((o) => o.id === current) ?? null : null;
  const currentLabel = currentOrigin
    ? showClientPrefix
      ? `${currentOrigin.clientName} · ${currentOrigin.name}`
      : currentOrigin.name
    : "Todos los orígenes";

  return (
    <div className="mb-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted mb-2">
        Budget Origin
      </p>
      <div ref={ref} className="relative inline-block">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="inline-flex items-center gap-2 min-w-[260px] justify-between rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-1.5 text-sm font-medium text-ink hover:border-ink-2 focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft transition-colors"
        >
          <span className="inline-flex items-center gap-2 truncate">
            {currentOrigin?.colorHex && (
              <span
                aria-hidden
                className="inline-block w-2 h-2 rounded-full shrink-0"
                style={{ background: currentOrigin.colorHex }}
              />
            )}
            <span className="truncate">{currentLabel}</span>
          </span>
          <ChevronDown
            size={14}
            strokeWidth={2}
            className={`text-muted transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>

        {open && (
          <div
            role="listbox"
            className="absolute left-0 top-full mt-1 w-[320px] rounded-md border border-line bg-white dark:bg-paper-2 shadow-lg z-30 max-h-[480px] overflow-auto py-1"
          >
            <DropdownItem
              href={buildHref(null)}
              isActive={current === null}
              label="Todos los orígenes"
              onClick={() => setOpen(false)}
            />
            <div className="my-1 border-t border-line-soft" />
            {Array.from(byClient.entries()).map(([clientName, list]) => (
              <div key={clientName}>
                {showClientPrefix && (
                  <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                    {clientName}
                  </p>
                )}
                {list.map((o) => (
                  <DropdownItem
                    key={o.id}
                    href={buildHref(o.id)}
                    isActive={current === o.id}
                    label={o.name}
                    colorHex={o.colorHex}
                    onClick={() => setOpen(false)}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DropdownItem({
  href,
  isActive,
  label,
  colorHex,
  onClick,
}: {
  href: string;
  isActive: boolean;
  label: string;
  colorHex?: string | null;
  onClick: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      role="option"
      aria-selected={isActive}
      className="flex items-center gap-2 px-3 py-1.5 text-sm text-ink-2 hover:bg-paper-2 data-[active=true]:text-ink data-[active=true]:font-medium"
      data-active={isActive}
    >
      {colorHex !== undefined && (
        <span
          aria-hidden
          className="inline-block w-2 h-2 rounded-full shrink-0"
          style={colorHex ? { background: colorHex } : undefined}
        />
      )}
      <span className="flex-1 truncate">{label}</span>
      {isActive && <Check size={14} strokeWidth={2.5} className="text-accent" />}
    </Link>
  );
}
