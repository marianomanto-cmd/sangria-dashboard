type ProjectStatus = "planning" | "active" | "paused" | "closed";

const STYLES: Record<ProjectStatus, { label: string; className: string; dot: string }> = {
  planning: {
    label: "planificación",
    className: "bg-info-soft text-info border-info-soft",
    dot: "bg-info",
  },
  active: {
    label: "activo",
    className: "bg-success-soft text-success border-success-soft",
    dot: "bg-success",
  },
  paused: {
    label: "pausado",
    className: "bg-warn-soft text-warn border-warn-soft",
    dot: "bg-warn",
  },
  closed: {
    label: "cerrado",
    className: "bg-paper-2 text-muted border-line",
    dot: "bg-muted",
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
