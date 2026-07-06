import { getBillingDetail } from "@/db/queries/billing";
import { renderBillingReportPdf } from "@/lib/billing-report-pdf";

// ════════════════════════════════════════════════════════════════════════════
// Endpoint del reporte PDF de un plan_billing (formato para finanzas). Este PDF
// se descarga cuando el manager aprieta "Reportar" en el editor del billing; el
// billing pasa a estado 'sent' (reportado).
//
// El armado visual del PDF vive en `lib/billing-report-pdf.ts`. Acá solo se
// resuelve el detalle del billing y se decide qué líneas entran:
//   • Media Placement: solo los publishers que la AGENCIA paga (agencyPays).
//     Los que el cliente paga directo se cargan igual en el billing (su consumo
//     alimenta el cálculo del management fee, que el cliente sí paga), pero su
//     inversión de medios NO se factura ni se reporta: se excluyen del PDF.
//     `agencyPays` es la verdad estructural (override del bloque ?? default del
//     publisher); `isBillable` es el flag editable del mes y se respeta además
//     para poder marcar no-facturable un publisher de agencia en un mes puntual.
//   • Services: fees con imputación > 0 en el mes.
// ════════════════════════════════════════════════════════════════════════════

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const detail = await getBillingDetail(id);
  if (!detail) {
    return new Response("Billing not found", { status: 404 });
  }

  const billablePublishers = detail.publisherLines.filter(
    (p) => p.agencyPays && p.isBillable && p.amountThisMonthUsd > 0,
  );
  const imputedFees = detail.feeLines.filter((f) => f.imputedThisMonthUsd > 0);

  const bytes = await renderBillingReportPdf({
    planName: detail.plan.name,
    projectName: detail.project.name,
    clientSlug: detail.client.slug,
    month: detail.billing.month,
    mediaLines: billablePublishers.map((p) => ({
      publisherName: p.publisherName,
      amountUsd: p.amountThisMonthUsd,
    })),
    feeLines: imputedFees.map((f) => ({
      feeName: f.feeName,
      amountUsd: f.imputedThisMonthUsd,
    })),
  });

  const filename = `${detail.project.code}.${detail.plan.name}.${detail.billing.month}.report.pdf`.replace(
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
