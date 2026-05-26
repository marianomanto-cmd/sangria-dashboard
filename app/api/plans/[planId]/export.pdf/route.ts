import { getPlanDetail } from "@/db/queries/project-detail";
import { listMetricsForClient } from "@/app/actions/plans";
import { renderPlanPdf } from "@/lib/plan-pdf";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ planId: string }> },
) {
  const { planId } = await params;
  const detail = await getPlanDetail(planId);
  if (!detail) {
    return new Response("Plan not found", { status: 404 });
  }

  const allMetrics = await listMetricsForClient(detail.client.id);
  const bytes = await renderPlanPdf(detail, allMetrics);

  const filename = `${detail.project.code}.${detail.plan.name}.pdf`.replace(
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
