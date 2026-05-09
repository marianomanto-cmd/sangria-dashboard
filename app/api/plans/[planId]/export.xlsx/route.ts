import * as XLSX from "xlsx";
import { getPlanDetail } from "@/db/queries/project-detail";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ planId: string }> },
) {
  const { planId } = await params;
  const detail = await getPlanDetail(planId);
  if (!detail) {
    return new Response("Plan no encontrado", { status: 404 });
  }

  const wb = XLSX.utils.book_new();

  // ─── Hoja 1: Resumen ──────────────────────────────────────────────────
  const summaryRows: (string | number)[][] = [
    ["Plan", detail.plan.name],
    ["Status", detail.plan.status],
    ["Versión", detail.plan.currentVersion],
    ["Cliente", detail.client.name],
    ["Proyecto", detail.project.name],
    ["Project code", detail.project.code],
    ["Budget Origin", detail.budgetOrigin.name],
    [],
    ["Total media", detail.totals.media],
    ["Total fees", detail.totals.fees],
    ["Total grand", detail.totals.grand],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, wsSummary, "Resumen");

  // ─── Hoja 2: Publishers + placements ─────────────────────────────────
  const placementRows: (string | number | null)[][] = [
    [
      "Publisher",
      "Agencia paga",
      "Total publisher (USD)",
      "Placement",
      "Mercado",
      "Audience",
      "Cost method",
      "Monto (USD)",
      "Inicio",
      "Fin",
      "Notas",
    ],
  ];
  for (const grp of detail.publishers) {
    if (grp.placements.length === 0) {
      placementRows.push([
        grp.publisherName,
        grp.agencyPays ? "sí" : "no",
        grp.totalPlannedUsd,
        "(sin placements)",
        null, null, null, null, null, null, null,
      ]);
    } else {
      for (const pl of grp.placements) {
        placementRows.push([
          grp.publisherName,
          grp.agencyPays ? "sí" : "no",
          grp.totalPlannedUsd,
          pl.placementName,
          pl.marketName ?? "—",
          pl.audience ?? "",
          pl.costMethod ?? "",
          pl.amountUsd,
          pl.startDate ?? "",
          pl.endDate ?? "",
          pl.notesMd ?? "",
        ]);
      }
    }
  }
  const wsPlace = XLSX.utils.aoa_to_sheet(placementRows);
  XLSX.utils.book_append_sheet(wb, wsPlace, "Placements");

  // ─── Hoja 3: Fees ────────────────────────────────────────────────────
  const feeRows: (string | number)[][] = [
    ["Tipo", "Nombre", "Rate %", "Monto (USD)", "Auto-calculado", "Notas"],
  ];
  for (const f of detail.fees) {
    feeRows.push([
      f.feeType,
      f.name,
      f.ratePct ?? "",
      f.amountUsd,
      f.isAutoComputed ? "sí" : "no",
      f.notes ?? "",
    ]);
  }
  const wsFees = XLSX.utils.aoa_to_sheet(feeRows);
  XLSX.utils.book_append_sheet(wb, wsFees, "Fees");

  // ─── Hoja 4: Métricas por placement (jsonb expandido) ────────────────
  const metricsRows: (string | number)[][] = [
    ["Publisher", "Placement", "Métrica", "Valor"],
  ];
  for (const grp of detail.publishers) {
    for (const pl of grp.placements) {
      const entries = Object.entries(pl.metricsJson ?? {});
      if (entries.length === 0) {
        metricsRows.push([grp.publisherName, pl.placementName, "(sin métricas)", ""]);
      } else {
        for (const [slug, value] of entries) {
          metricsRows.push([grp.publisherName, pl.placementName, slug, value]);
        }
      }
    }
  }
  const wsMetrics = XLSX.utils.aoa_to_sheet(metricsRows);
  XLSX.utils.book_append_sheet(wb, wsMetrics, "Métricas");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const filename = `${detail.project.code}.${detail.plan.name}.xlsx`.replace(
    /[^A-Za-z0-9._-]+/g,
    "_",
  );

  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
