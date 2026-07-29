import {
  getPlanDetail,
  getPlanDetailAtVersion,
} from "@/db/queries/project-detail";
import { listMetricsForClient } from "@/app/actions/plans";
import { renderPlanPdf } from "@/lib/plan-pdf";
import { canAccessClientExport } from "@/lib/client-portal.server";
import {
  parseVersionParam,
  versionFilenameSuffix,
} from "@/lib/plan-export-version";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ planId: string }> },
) {
  const { planId } = await params;
  // ?v=N → baja el PDF de esa versión APROBADA (snapshot del historial), en vez
  // del plan vigente. Sin el param, el comportamiento es el de siempre.
  const version = parseVersionParam(req);
  if (version === "invalid") {
    return new Response("Bad request: ?v debe ser un entero >= 1", {
      status: 400,
    });
  }
  const detail =
    version == null
      ? await getPlanDetail(planId)
      : await getPlanDetailAtVersion(planId, version);
  if (!detail) {
    return new Response(
      version == null ? "Plan not found" : `Versión v${version} no encontrada`,
      { status: 404 },
    );
  }

  // La ruta es pública en el proxy (para que el cliente baje el PDF desde su
  // portal). La barrera real: usuario interno logueado, o sesión de portal del
  // cliente dueño del plan.
  if (!(await canAccessClientExport(detail.client.slug))) {
    return new Response("Forbidden", { status: 403 });
  }

  const allMetrics = await listMetricsForClient(detail.client.id);
  const bytes = await renderPlanPdf(detail, allMetrics);

  const filename = `${detail.plan.name}-V${detail.plan.currentVersion}${versionFilenameSuffix(version)}.pdf`.replace(
    /[^A-Za-z0-9._-]+/g,
    "_",
  );

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
