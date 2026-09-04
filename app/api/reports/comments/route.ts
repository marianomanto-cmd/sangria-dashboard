import { NextResponse } from "next/server";
import { listReportComments } from "@/app/actions/report-comments";

// ════════════════════════════════════════════════════════════════════════════
// Comentarios de un reporte, por GET.
//
// Misma razón que `app/api/simulator/read/route.ts`: leer los comentarios era
// una server action (`listReportComments`), y una server action viaja por
// POST. La sesión de auditoría —solo lectura— tiene cerrado todo lo que no sea
// GET en el proxy, así que el modal de comentarios le quedaba colgado en
// "Cargando…" para siempre.
//
// El handler reusa la misma función, así que hay una sola implementación de la
// consulta; lo único que cambia es el transporte.
//
// Auth: la ruta no está en la allowlist del proxy, así que exige sesión —la
// interna o la de auditoría, que pasa por ser GET.
// ════════════════════════════════════════════════════════════════════════════
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const kind = sp.get("kind");
  const reportId = sp.get("reportId");

  if (kind !== "project" && kind !== "manual") {
    return NextResponse.json({ ok: false, error: "kind inválido" }, { status: 400 });
  }
  if (!reportId) {
    return NextResponse.json({ ok: false, error: "Falta reportId" }, { status: 400 });
  }

  const res = await listReportComments({ kind, reportId });
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
}
