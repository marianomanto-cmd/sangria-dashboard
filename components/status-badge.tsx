type ProjectStatus = "planning" | "active" | "paused" | "closed" | "reportado";

// Todos los soft backgrounds usan tokens que swappean en dark mode
// (ver app/globals.css). Las clases con borde explícito a soft también
// migran solas: el token de bg se reescribe automáticamente bajo `.dark`.
const STYLES: Record<ProjectStatus, { label: string; className: string; dot: string }> = {
  planning: {
    label: "planificación",
    className: "bg-info-soft text-info border-info-soft/80",
    dot: "bg-info",
  },
  active: {
    label: "activo",
    className: "bg-success-soft text-success border-success-soft/80",
    dot: "bg-success",
  },
  paused: {
    label: "pausado",
    className: "bg-warn-soft text-warn border-warn-soft/80",
    dot: "bg-warn",
  },
  closed: {
    label: "cerrado",
    className: "bg-paper-2 text-muted border-line",
    dot: "bg-muted",
  },
  reportado: {
    label: "reportado",
    className: "bg-accent-soft text-accent border-accent/20",
    dot: "bg-accent",
  },
};

export function StatusBadge({ status }: { status: ProjectStatus }) {
  const style = STYLES[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[11px] font-medium ${style.className}`}
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}
