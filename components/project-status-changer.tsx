"use client";

import { useState, useTransition } from "react";
import { setProjectStatus } from "@/app/actions/reports";
import type { Language } from "@/lib/i18n";

type Status = "planning" | "active" | "paused" | "closed" | "reportado";

const LABELS: Record<Status, Record<Language, string>> = {
  planning: { en: "planning", es: "planificación" },
  active: { en: "active", es: "activo" },
  paused: { en: "paused", es: "pausado" },
  closed: { en: "closed", es: "cerrado" },
  reportado: { en: "reported", es: "reportado" },
};

const PROMPTS: Record<Status, Record<Language, string>> = {
  planning: { en: "Set to planning", es: "Marcar como planificación" },
  active: { en: "Set to active", es: "Marcar como activo" },
  paused: { en: "Set to paused", es: "Marcar como pausado" },
  closed: { en: "Close project", es: "Cerrar proyecto" },
  reportado: { en: "Mark as reported", es: "Marcar como reportado" },
};

// El changer no permite mover MANUALMENTE a 'reportado' — ese estado se
// alcanza marcando el reporte como entregado desde /reportes/calendario.
// Tampoco permite volver desde 'reportado'.
const SELECTABLE: Status[] = ["planning", "active", "paused", "closed"];

export function ProjectStatusChanger({
  projectId,
  currentStatus,
  lang,
}: {
  projectId: string;
  currentStatus: Status;
  lang: Language;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (currentStatus === "reportado") {
    return (
      <p className="text-[11px] text-muted italic">
        {lang === "es"
          ? "El proyecto fue reportado al cliente. No se puede cambiar el status desde acá."
          : "Project has been reported to the client. Status can't be changed from here."}
      </p>
    );
  }

  const options = SELECTABLE.filter((s) => s !== currentStatus);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] uppercase tracking-[0.08em] text-muted font-medium">
        {lang === "es" ? "Cambiar a" : "Set to"}:
      </span>
      {options.map((s) => (
        <button
          key={s}
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const res = await setProjectStatus({ projectId, status: s });
              if (!res.ok) setError(res.error);
            });
          }}
          className="inline-flex items-center gap-1.5 rounded-sm border border-line bg-white dark:bg-paper-2 px-2 py-1 text-xs hover:bg-paper-2 transition-colors disabled:opacity-50"
        >
          {PROMPTS[s][lang]}
        </button>
      ))}
      {pending && (
        <span className="text-[11px] text-muted">
          {lang === "es" ? "guardando…" : "saving…"}
        </span>
      )}
      {error && (
        <span className="text-[11px] text-danger">{error}</span>
      )}
      {currentStatus === "closed" && !pending && !error && (
        <span className="text-[11px] text-muted italic ml-1">
          {lang === "es"
            ? "→ se registró en el calendario de reportes"
            : "→ added to the reporting calendar"}
        </span>
      )}
    </div>
  );
}
