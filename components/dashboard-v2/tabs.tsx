"use client";

import { useState } from "react";
import type { ReactNode } from "react";

// Toggle de vistas. El dashboard viejo tenía tres pestañas (Cuentas /
// Operaciones / Ejecutivo) porque cada rol mira cosas distintas; se conserva esa
// estructura. El estado vive acá y las tres secciones reciben data YA cargada,
// así que cambiar de pestaña es instantáneo y no dispara ninguna query.
//
// Las secciones llegan como props ReactNode desde el server component: el
// browser recibe el markup ya renderizado, no las queries ni los helpers.

const TABS = [
  ["cuentas", "Cuentas"],
  ["operaciones", "Operaciones"],
  ["ejecutivo", "Ejecutivo"],
] as const;

type TabId = (typeof TABS)[number][0];

export function DashboardTabs({
  cuentas,
  operaciones,
  ejecutivo,
}: {
  cuentas: ReactNode;
  operaciones: ReactNode;
  ejecutivo: ReactNode;
}) {
  const [tab, setTab] = useState<TabId>("cuentas");

  return (
    <div className="space-y-5">
      <div className="inline-flex items-center gap-0.5 rounded-[10px] border border-line bg-paper-2 p-[3px]">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-pressed={tab === id}
            className={`px-3.5 py-1.5 rounded-lg text-[13px] transition-colors ${
              tab === id
                ? "bg-white dark:bg-paper text-ink shadow-sm font-medium"
                : "text-muted hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Las tres van montadas y se ocultan con `hidden`: cambiar de pestaña no
          re-renderiza nada y el markup ya vino del server. */}
      <div hidden={tab !== "cuentas"}>{cuentas}</div>
      <div hidden={tab !== "operaciones"}>{operaciones}</div>
      <div hidden={tab !== "ejecutivo"}>{ejecutivo}</div>
    </div>
  );
}
