"use client";

import { useEffect, useRef, useState } from "react";
import type { CalendarReport } from "@/db/queries/reports";
import { type Language } from "@/lib/i18n";

// ════════════════════════════════════════════════════════════════════════════
// Gantt de reportes con Mermaid.js (cargado desde el CDN de jsdelivr). Reemplaza
// al SVG propio (components/reporting-gantt.tsx). Visualización read-only: las
// acciones (editar fecha / entregado / eliminar) viven en la lista de al lado.
// Cada reporte = una tarea desde closed_at → delivery_date; las atrasadas van
// como `crit` (rojo). Mermaid dibuja solo la línea de "hoy".
// ════════════════════════════════════════════════════════════════════════════

/* eslint-disable @typescript-eslint/no-explicit-any */
let mermaidPromise: Promise<any> | null = null;
let initialized = false;

function loadMermaid(): Promise<any> {
  if (mermaidPromise) return mermaidPromise;
  mermaidPromise = new Promise((resolve, reject) => {
    const w = window as any;
    if (w.mermaid) return resolve(w.mermaid);
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js";
    s.async = true;
    s.onload = () => resolve((window as any).mermaid);
    s.onerror = () => reject(new Error("mermaid load failed"));
    document.head.appendChild(s);
  });
  return mermaidPromise;
}

function ensureInit(mermaid: any) {
  if (initialized) return;
  const dark = document.documentElement.classList.contains("dark");
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
    themeVariables: {
      // Barras "active" en burgundy de marca, atrasadas en rojo, hoy en azul.
      activeTaskBkgColor: "#a8345f",
      activeTaskBorderColor: "#7a1f3d",
      taskBkgColor: "#a8345f",
      taskBorderColor: "#7a1f3d",
      taskTextColor: "#ffffff",
      taskTextLightColor: "#ffffff",
      taskTextOutsideColor: dark ? "#e7e5e4" : "#1c1917",
      critBkgColor: "#dc2626",
      critBorderColor: "#b91c1c",
      todayLineColor: "#3b82f6",
      gridColor: dark ? "#3a3633" : "#e7e5e4",
      sectionBkgColor: dark ? "#26211f" : "#faf9f8",
      altSectionBkgColor: dark ? "#1f1b1a" : "#f3f1ef",
      titleColor: dark ? "#e7e5e4" : "#1c1917",
    },
  });
  initialized = true;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function sanitize(s: string): string {
  return s.replace(/[:;#\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 56) || "—";
}

function dateOnly(s: string | null): string | null {
  if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function buildGantt(
  reports: CalendarReport[],
  lang: Language,
  showClient: boolean,
): { code: string; tasks: number } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Agrupado por cliente (section). En el portal hay un solo cliente.
  const byClient = new Map<string, CalendarReport[]>();
  for (const r of reports) {
    const arr = byClient.get(r.clientName) ?? [];
    arr.push(r);
    byClient.set(r.clientName, arr);
  }

  const lines = [
    "gantt",
    "dateFormat YYYY-MM-DD",
    "axisFormat %d/%m",
  ];
  let tasks = 0;
  let i = 0;
  for (const [client, rs] of byClient) {
    const section = showClient
      ? client
      : lang === "es"
        ? "Entregas"
        : "Deliveries";
    lines.push(`section ${sanitize(section)}`);
    for (const r of rs) {
      const end = dateOnly(r.deliveryDate);
      if (!end) continue;
      let start = dateOnly(r.closedAt) ?? addDays(end, -14);
      if (start >= end) start = addDays(end, -1);
      const late = new Date(`${end}T00:00:00`) < today;
      const tag = late ? "crit, " : "active, ";
      lines.push(`${sanitize(r.projectName)} :${tag}t${i}, ${start}, ${end}`);
      tasks++;
      i++;
    }
  }
  return { code: lines.join("\n"), tasks };
}

export function MermaidGantt({
  reports,
  lang = "es",
  showClient = false,
}: {
  reports: CalendarReport[];
  lang?: Language;
  showClient?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const { code, tasks } = buildGantt(reports, lang, showClient);
    if (tasks === 0) {
      if (ref.current) ref.current.innerHTML = "";
      return;
    }
    (async () => {
      try {
        const mermaid = await loadMermaid();
        ensureInit(mermaid);
        const id = `mgantt-${Math.random().toString(36).slice(2)}`;
        const { svg } = await mermaid.render(id, code);
        if (cancelled) return;
        if (ref.current) ref.current.innerHTML = svg;
        setError(false);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reports, lang, showClient]);

  const hasReports = reports.some((r) => !!r.deliveryDate);

  if (!hasReports) {
    return (
      <div className="rounded-lg border border-line border-dashed bg-paper-2 px-5 py-12 text-center text-sm text-muted">
        {lang === "es" ? "Sin reportes en curso." : "No reports in progress."}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-white dark:bg-paper-2 p-4 overflow-x-auto">
      {error ? (
        <p className="text-sm text-muted py-6 text-center">
          {lang === "es"
            ? "No se pudo cargar el diagrama."
            : "Could not load the diagram."}
        </p>
      ) : (
        <div ref={ref} className="min-w-[640px] [&_svg]:h-auto [&_svg]:max-w-none" />
      )}
    </div>
  );
}
