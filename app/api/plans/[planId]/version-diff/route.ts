import { NextResponse } from "next/server";
import { getPlanVersionDiff } from "@/db/queries/plan-qa";

// Diff de UNA versión del plan contra la anterior, para el desplegable del
// historial de versiones.
//
// Existe para no traer `snapshot_json` de TODAS las versiones en cada render de
// la página del plan: eso transfería megabytes por una conexión del pooler en
// cada carga y en cada `router.refresh()` post-guardado, y era peor con cada
// versión nueva. Fue lo que colgaba la página (incidente del 02/sep/2026).
//
// Auth: la ruta NO está en la allowlist del proxy (`lib/supabase/middleware.ts`),
// así que exige sesión de la agencia como cualquier página interna.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ planId: string }> },
) {
  const { planId } = await params;
  const raw = new URL(request.url).searchParams.get("version");
  const version = Number(raw);
  if (!Number.isInteger(version) || version < 1) {
    return NextResponse.json({ error: "version inválida" }, { status: 400 });
  }

  const diff = await getPlanVersionDiff(planId, version);
  if (!diff) {
    return NextResponse.json({ error: "versión no encontrada" }, { status: 404 });
  }
  return NextResponse.json({ diff });
}
