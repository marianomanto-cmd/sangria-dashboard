import ExcelJS from "exceljs";
import { getPlanDetail } from "@/db/queries/project-detail";
import { listMetrics } from "@/app/actions/plans";
import { COST_METHOD_PRIMARY_METRIC } from "@/lib/cost-methods";
import { DEFAULT_LANGUAGE, formatDate, type Language, t } from "@/lib/i18n";

const PURPLE = "FF6D28D9";       // header principal
const PURPLE_SOFT = "FFEDE9FE";   // subtotales / secciones
const PURPLE_MED = "FFC4B5FD";    // grand total / firma
const WHITE = "FFFFFFFF";
const BORDER_GRAY = "FFE5E7EB";

const thin = { style: "thin" as const, color: { argb: BORDER_GRAY } };
const allBorders = { top: thin, left: thin, bottom: thin, right: thin };

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ planId: string }> },
) {
  const { planId } = await params;
  const detail = await getPlanDetail(planId);
  if (!detail) {
    return new Response("Plan not found", { status: 404 });
  }

  // El idioma del export sigue al del cliente del plan. Métricas (clicks,
  // views, impressions, etc.) quedan siempre en inglés.
  const lang: Language = detail.client.language ?? DEFAULT_LANGUAGE;

  const allMetrics = await listMetrics();
  const metricBySlug = new Map(allMetrics.map((m) => [m.slug, m]));

  // ─── Slugs de métricas secundarias presentes en el plan ─────────────────
  const secondarySlugs = (() => {
    const set = new Set<string>();
    for (const grp of detail.publishers) {
      for (const pl of grp.placements) {
        const primary = pl.costMethod
          ? COST_METHOD_PRIMARY_METRIC[pl.costMethod] ?? null
          : null;
        for (const slug of Object.keys(pl.metricsJson ?? {})) {
          if (slug !== primary) set.add(slug);
        }
      }
    }
    return [...set].sort((a, b) => {
      const ma = metricBySlug.get(a);
      const mb = metricBySlug.get(b);
      return (ma?.sortOrder ?? 999) - (mb?.sortOrder ?? 999);
    });
  })();

  const secondaryHeaders = secondarySlugs.map(
    (slug) => metricBySlug.get(slug)?.name ?? slug,
  );

  const wb = new ExcelJS.Workbook();
  wb.creator = "Sangria Dashboard";
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;
  // Locale del libro para que Excel interprete dates con el formato regional
  // adecuado al abrirlo. Algunas versiones usan esto para los date pickers.
  const sheetTitle =
    lang === "es" ? "Plan de medios" : "Media plan";
  const ws = wb.addWorksheet(sheetTitle, {
    views: [{ state: "frozen", ySplit: 9 }],
  });

  // ─── Columnas + anchos ──────────────────────────────────────────────────
  const baseCols = 8;
  const totalCols = baseCols + secondaryHeaders.length;
  ws.columns = [
    { width: 28 }, // Publisher / Placement
    { width: 14 }, // Start
    { width: 14 }, // End
    { width: 36 }, // Audience
    { width: 36 }, // Notes
    { width: 12 }, // Cost method
    { width: 14 }, // Investment
    { width: 16 }, // Primary metric
    ...secondaryHeaders.map(() => ({ width: 14 })),
  ];

  // ─── Encabezado del documento ───────────────────────────────────────────
  const periodStart =
    detail.publishers
      .flatMap((g) => g.placements)
      .map((p) => p.startDate)
      .filter((d): d is string => !!d)
      .sort()[0] ?? "";
  const periodEnd =
    detail.publishers
      .flatMap((g) => g.placements)
      .map((p) => p.endDate)
      .filter((d): d is string => !!d)
      .sort()
      .pop() ?? "";
  const periodFormatted =
    periodStart && periodEnd
      ? `${formatDate(periodStart, lang)} → ${formatDate(periodEnd, lang)}`
      : "—";

  const statusLabel = t(`status.${detail.plan.status}`, lang);

  const headerPairs: [string, string | number][] = [
    [t("common.client", lang), detail.client.name],
    [t("common.project", lang), `${detail.project.code} — ${detail.project.name}`],
    [t("common.budgetOrigin", lang), detail.budgetOrigin.name],
    [t("common.period", lang), periodFormatted],
    [t("common.version", lang), detail.plan.currentVersion],
    [t("common.status", lang), statusLabel],
  ];

  headerPairs.forEach(([label, value], i) => {
    const row = ws.getRow(i + 1);
    row.getCell(1).value = label;
    row.getCell(1).font = { bold: true, color: { argb: WHITE } };
    row.getCell(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: PURPLE },
    };
    row.getCell(1).alignment = { vertical: "middle", horizontal: "left" };
    row.getCell(2).value = value;
    row.getCell(2).font = { bold: true };
    row.getCell(2).alignment = { vertical: "middle", horizontal: "left" };
    ws.mergeCells(i + 1, 2, i + 1, totalCols);
    row.height = 20;
  });

  const headerEndRow = headerPairs.length;
  const tableHeaderRowIdx = headerEndRow + 2;

  // ─── Header de la tabla principal ───────────────────────────────────────
  const tableHeader = [
    t("common.publisherPlacement", lang),
    t("common.startDate", lang),
    t("common.endDate", lang),
    t("common.audience", lang),
    t("common.notesFormats", lang),
    t("common.costMethod", lang),
    lang === "es" ? "Inversión (USD)" : "Investment (USD)",
    t("common.primaryMetric", lang),
    ...secondaryHeaders,
  ];
  const headerRow = ws.getRow(tableHeaderRowIdx);
  tableHeader.forEach((label, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = label;
    cell.font = { bold: true, color: { argb: WHITE } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: PURPLE },
    };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = allBorders;
  });
  headerRow.height = 32;

  let currentRow = tableHeaderRowIdx + 1;

  // ─── Filas por publisher: subtotal + placements ─────────────────────────
  const agencyPaysLabel =
    lang === "es" ? "  (agencia paga)" : "  (agency pays)";
  const noPlacementsLabel = t("common.noPlacements", lang);
  for (const grp of detail.publishers) {
    const subRow = ws.getRow(currentRow);
    subRow.getCell(1).value =
      grp.publisherName + (grp.agencyPays ? agencyPaysLabel : "");
    subRow.getCell(7).value = grp.totalPlannedUsd;
    subRow.getCell(7).numFmt = '"$"#,##0.00';
    for (let c = 1; c <= totalCols; c++) {
      const cell = subRow.getCell(c);
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: PURPLE_SOFT },
      };
      cell.font = { bold: true };
      cell.border = allBorders;
    }
    subRow.getCell(1).alignment = { vertical: "middle", horizontal: "left" };
    subRow.height = 22;
    currentRow++;

    if (grp.placements.length === 0) {
      const row = ws.getRow(currentRow);
      row.getCell(1).value = `   ${noPlacementsLabel}`;
      row.getCell(1).font = { italic: true, color: { argb: "FF6B7280" } };
      for (let c = 1; c <= totalCols; c++) row.getCell(c).border = allBorders;
      currentRow++;
      continue;
    }

    for (const pl of grp.placements) {
      const primarySlug = pl.costMethod
        ? COST_METHOD_PRIMARY_METRIC[pl.costMethod] ?? null
        : null;
      const primaryValue =
        primarySlug && pl.metricsJson?.[primarySlug] != null
          ? pl.metricsJson[primarySlug]
          : null;

      const row = ws.getRow(currentRow);
      row.getCell(1).value = `   ${pl.placementName}${pl.marketName ? ` · ${pl.marketName}` : ""}`;
      row.getCell(2).value = formatDate(pl.startDate, lang);
      row.getCell(3).value = formatDate(pl.endDate, lang);
      row.getCell(4).value = pl.audience ?? "";
      row.getCell(5).value = pl.notesMd ?? "";
      row.getCell(6).value = pl.costMethod ?? "";
      row.getCell(7).value = pl.amountUsd;
      row.getCell(7).numFmt = '"$"#,##0.00';
      row.getCell(8).value = primaryValue;
      if (primaryValue != null) row.getCell(8).numFmt = "#,##0";

      secondarySlugs.forEach((slug, i) => {
        const v = pl.metricsJson?.[slug];
        const cell = row.getCell(baseCols + 1 + i);
        if (v != null) {
          cell.value = v;
          const unit = metricBySlug.get(slug)?.unit ?? "";
          if (unit === "%") cell.numFmt = "0.00%";
          else if (unit === "$") cell.numFmt = '"$"#,##0.0000';
          else cell.numFmt = "#,##0";
        }
      });

      row.getCell(4).alignment = { wrapText: true, vertical: "top" };
      row.getCell(5).alignment = { wrapText: true, vertical: "top" };
      row.getCell(6).alignment = { horizontal: "center" };

      for (let c = 1; c <= totalCols; c++) row.getCell(c).border = allBorders;
      currentRow++;
    }
  }

  // ─── Fila TOTAL MEDIA ───────────────────────────────────────────────────
  const totalMediaRow = ws.getRow(currentRow);
  totalMediaRow.getCell(1).value =
    lang === "es" ? "TOTAL MEDIA" : "MEDIA TOTAL";
  totalMediaRow.getCell(7).value = detail.totals.media;
  totalMediaRow.getCell(7).numFmt = '"$"#,##0.00';
  for (let c = 1; c <= totalCols; c++) {
    const cell = totalMediaRow.getCell(c);
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: PURPLE },
    };
    cell.font = { bold: true, color: { argb: WHITE } };
    cell.border = allBorders;
  }
  totalMediaRow.height = 22;
  currentRow += 2;

  // ─── Sección Fees ───────────────────────────────────────────────────────
  if (detail.fees.length > 0 || detail.totals.fees > 0) {
    const feesTitleRow = ws.getRow(currentRow);
    feesTitleRow.getCell(1).value = t("common.fees", lang);
    feesTitleRow.getCell(1).font = { bold: true, color: { argb: WHITE }, size: 12 };
    feesTitleRow.getCell(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: PURPLE },
    };
    ws.mergeCells(currentRow, 1, currentRow, totalCols);
    feesTitleRow.height = 22;
    currentRow++;

    const feeHeaders = [
      t("common.type", lang),
      t("common.name", lang),
      "Rate %",
      lang === "es" ? "Monto (USD)" : "Amount (USD)",
      t("common.auto", lang),
      t("common.notes", lang),
    ];
    const feeColsSpan = [1, 1, 1, 1, 1, totalCols - 5];
    const feeHdrRow = ws.getRow(currentRow);
    let col = 1;
    feeHeaders.forEach((label, i) => {
      const cell = feeHdrRow.getCell(col);
      cell.value = label;
      cell.font = { bold: true, color: { argb: WHITE } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: PURPLE },
      };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.border = allBorders;
      const span = feeColsSpan[i];
      if (span > 1) {
        ws.mergeCells(currentRow, col, currentRow, col + span - 1);
      }
      col += span;
    });
    feeHdrRow.height = 22;
    currentRow++;

    for (const f of detail.fees) {
      const row = ws.getRow(currentRow);
      let c = 1;
      row.getCell(c++).value = f.feeType;
      row.getCell(c++).value = f.name;
      row.getCell(c).value = f.ratePct;
      if (f.ratePct != null) row.getCell(c).numFmt = "0.00";
      c++;
      row.getCell(c).value = f.amountUsd;
      row.getCell(c).numFmt = '"$"#,##0.00';
      c++;
      row.getCell(c++).value = f.isAutoComputed
        ? t("common.yes", lang)
        : t("common.no", lang);
      const notesSpan = feeColsSpan[5];
      row.getCell(c).value = f.notes ?? "";
      row.getCell(c).alignment = { wrapText: true, vertical: "top" };
      if (notesSpan > 1) {
        ws.mergeCells(currentRow, c, currentRow, c + notesSpan - 1);
      }
      for (let cc = 1; cc <= totalCols; cc++) row.getCell(cc).border = allBorders;
      currentRow++;
    }

    const totalFeesRow = ws.getRow(currentRow);
    totalFeesRow.getCell(1).value =
      lang === "es" ? "TOTAL FEES" : "TOTAL FEES";
    totalFeesRow.getCell(4).value = detail.totals.fees;
    totalFeesRow.getCell(4).numFmt = '"$"#,##0.00';
    for (let c = 1; c <= totalCols; c++) {
      const cell = totalFeesRow.getCell(c);
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: PURPLE_SOFT },
      };
      cell.font = { bold: true };
      cell.border = allBorders;
    }
    totalFeesRow.height = 22;
    currentRow++;
  }

  // ─── GRAND TOTAL ────────────────────────────────────────────────────────
  const grandRow = ws.getRow(currentRow);
  grandRow.getCell(1).value = "GRAND TOTAL";
  grandRow.getCell(7).value = detail.totals.grand;
  grandRow.getCell(7).numFmt = '"$"#,##0.00';
  for (let c = 1; c <= totalCols; c++) {
    const cell = grandRow.getCell(c);
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: PURPLE_MED },
    };
    cell.font = { bold: true, size: 12 };
    cell.border = allBorders;
  }
  grandRow.height = 24;
  currentRow += 3;

  // ─── Firma del cliente ──────────────────────────────────────────────────
  const sigLabelRow = ws.getRow(currentRow);
  sigLabelRow.getCell(1).value = t("common.signature", lang);
  sigLabelRow.getCell(1).font = { bold: true };
  currentRow++;

  const sigLineRow = ws.getRow(currentRow);
  sigLineRow.getCell(1).value = "_______________________________________________";
  sigLineRow.getCell(1).font = { color: { argb: "FF6B7280" } };
  ws.mergeCells(currentRow, 1, currentRow, 4);
  currentRow++;

  const sigDateRow = ws.getRow(currentRow);
  sigDateRow.getCell(1).value = t("export.dateLabel", lang);
  sigDateRow.getCell(1).font = { color: { argb: "FF6B7280" } };

  // ─── Output ─────────────────────────────────────────────────────────────
  const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;

  const filename = `${detail.project.code}.${detail.plan.name}.xlsx`.replace(
    /[^A-Za-z0-9._-]+/g,
    "_",
  );

  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
