import type {
  ReportComment,
  ReportRef,
} from "@/app/actions/report-comments";

// Lectura de los comentarios de un reporte, por GET.
//
// Misma razón que `lib/simulator-read.ts`: la versión anterior era una server
// action, y una server action viaja por POST, que la sesión de auditoría tiene
// cerrado. El modal quedaba colgado en "Cargando…" para siempre.
//
// La firma es la misma que la de la action que reemplaza, así que en el
// componente el cambio es una línea de import. El handler está en
// `app/api/reports/comments/route.ts` y reusa la misma consulta, así que no
// hay dos implementaciones.
//
// Ojo: al pasar por JSON, `createdAt` / `updatedAt` llegan como string y no
// como Date. El componente ya las envolvía en `new Date(...)` en los tres
// lugares donde las usa, así que no hubo que tocar nada más.
type ListResult =
  | { ok: true; comments: ReportComment[] }
  | { ok: false; error: string };

export async function listReportComments(
  ref: ReportRef,
): Promise<ListResult> {
  try {
    const res = await fetch(
      `/api/reports/comments?kind=${encodeURIComponent(ref.kind)}&reportId=${encodeURIComponent(ref.reportId)}`,
    );
    const data = (await res.json()) as ListResult;
    return data;
  } catch {
    return { ok: false, error: "No se pudieron cargar los comentarios." };
  }
}
