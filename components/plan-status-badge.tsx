// Badge del estado de un PLAN de medios (draft / ready_to_send / approved /
// qa_done / live / archived). Fuente de verdad ÚNICA del label + color: antes
// el mapa de estilos vivía duplicado en el editor, el detalle de proyecto y las
// tablas de Planes/Proyectos, y el label de `ready_to_send` había driftado
// entre "ready" y "ready to send". Espejo de `StatusBadge` (estados de
// proyecto).
//
// Los labels y el significado de cada estado salen de lib/plan-status.ts (el
// mismo módulo que usan las queries y las transiciones), acá vive sólo el look.
//
// Lectura de los colores: `approved` es azul y NO verde a propósito — el plan
// está firmado pero todavía no al aire: le falta el QA. El verde queda para
// `live`, que es lo único que significa "campaña corriendo".
//
// `size`: `md` (default) para headers y la tabla de planes; `sm` para las
// filas compactas del breakdown de la tabla de proyectos.
import {
  PLAN_STATUS_HINTS,
  PLAN_STATUS_LABELS,
  type PlanStatus,
} from "@/lib/plan-status";

const STYLES: Record<PlanStatus, { className: string; dot: string }> = {
  draft: { className: "bg-paper-2 text-muted border-line", dot: "bg-muted" },
  ready_to_send: {
    className: "bg-warn-soft text-warn border-warn-soft",
    dot: "bg-warn",
  },
  approved: {
    className: "bg-info-soft text-info border-info-soft",
    dot: "bg-info",
  },
  qa_done: {
    className: "bg-accent-soft text-accent border-accent-soft",
    dot: "bg-accent",
  },
  live: {
    className: "bg-success-soft text-success border-success-soft",
    dot: "bg-success",
  },
  archived: { className: "bg-paper-2 text-muted border-line", dot: "bg-muted" },
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
  const key = (status in STYLES ? status : "draft") as PlanStatus;
  const style = STYLES[key];
  const dim = SIZES[size];
  return (
    <span
      title={PLAN_STATUS_HINTS[key]}
      className={`inline-flex items-center gap-1.5 rounded-sm border font-medium whitespace-nowrap ${dim.badge} ${style.className}`}
    >
      <span className={`inline-block rounded-full ${dim.dot} ${style.dot}`} />
      {PLAN_STATUS_LABELS[key]}
    </span>
  );
}
