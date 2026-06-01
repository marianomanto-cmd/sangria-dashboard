// Badge del estado de un PLAN de medios (draft / ready_to_send / approved /
// archived). Fuente de verdad ÚNICA del label + color: antes el mapa de
// estilos vivía duplicado en el editor, el detalle de proyecto y las tablas de
// Planes/Proyectos, y el label de `ready_to_send` había driftado entre "ready"
// y "ready to send". Espejo de `StatusBadge` (estados de proyecto).
//
// `size`: `md` (default) para headers y la tabla de planes; `sm` para las
// filas compactas del breakdown de la tabla de proyectos.
type PlanStatus = "draft" | "ready_to_send" | "approved" | "archived";

const STYLES: Record<PlanStatus, { label: string; className: string; dot: string }> = {
  draft: { label: "draft", className: "bg-paper-2 text-muted border-line", dot: "bg-muted" },
  ready_to_send: {
    label: "ready to send",
    className: "bg-warn-soft text-warn border-warn-soft",
    dot: "bg-warn",
  },
  approved: {
    label: "approved",
    className: "bg-success-soft text-success border-success-soft",
    dot: "bg-success",
  },
  archived: { label: "archived", className: "bg-paper-2 text-muted border-line", dot: "bg-muted" },
};

const SIZES = {
  md: { badge: "px-2 py-0.5 text-[11px]", dot: "h-1.5 w-1.5" },
  sm: { badge: "px-1.5 py-0.5 text-[10px]", dot: "h-1 w-1" },
} as const;

export function PlanStatusBadge({
  status,
  size = "md",
}: {
  status: string;
  size?: keyof typeof SIZES;
}) {
  const style = STYLES[status as PlanStatus] ?? STYLES.draft;
  const dim = SIZES[size];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm border font-medium ${dim.badge} ${style.className}`}
    >
      <span className={`inline-block rounded-full ${dim.dot} ${style.dot}`} />
      {style.label}
    </span>
  );
}
