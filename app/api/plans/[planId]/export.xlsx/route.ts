import ExcelJS from "exceljs";
import { getBrandLogo } from "@/lib/brand-logo";
import { getPlanDetail } from "@/db/queries/project-detail";
import { listMetricsForClient } from "@/app/actions/plans";
import {
  evalFormula,
  placementMetricValue,
  placementsPeriod,
  resolveMetricColumns,
  sumDirectMetrics,
} from "@/lib/plan-metrics";
import { DEFAULT_LANGUAGE, formatDate, formatMonth, type Language, t } from "@/lib/i18n";
import {
  AUX_SHEET_DEFAULT_NAME,
  AUX_SHEET_GRID_ROW_OFFSET,
  AUX_SHEET_INFO_ROWS,
  auxCellNumber,
  evalAuxFormula,
  isAuxFormula,
} from "@/lib/aux-sheet";
import { canAccessClientExport } from "@/lib/client-portal.server";
import { buildBudgetSplit, NO_DATE_KEY } from "@/lib/budget-split";
import type { PlanAuxSheet } from "@/db/queries/project-detail";

// Paleta de marca — sincronizada con los design tokens de app/globals.css.
const ACCENT = "FF7A1F3D";       // header principal, total media, títulos
const ACCENT_SOFT = "FFF5E6EC";  // subtotales / secciones
const INK = "FF1C1917";          // grand total
const WHITE = "FFFFFFFF";
const BORDER = "FFD6D3D1";       // --color-line
const MUTED = "FF78716C";        // --color-muted
const ZEBRA = "FFFBF4F7";        // banding suave de filas de datos (tabs aux)

const thin = { style: "thin" as const, color: { argb: BORDER } };
const allBorders = { top: thin, left: thin, bottom: thin, right: thin };

// El prorrateo por días + la agregación mercado × mes viven en
// lib/budget-split.ts, compartidos con el preview del editor del plan.

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ planId: string }> },
) {
  const { planId } = await params;
  const detail = await getPlanDetail(planId);
  if (!detail) {
    return new Response("Plan not found", { status: 404 });
  }

  // Ruta pública en el proxy (para el portal del cliente). Barrera real:
  // usuario interno logueado, o sesión de portal del cliente dueño del plan.
  if (!(await canAccessClientExport(detail.client.slug))) {
    return new Response("Forbidden", { status: 403 });
  }

  // El idioma del export sigue al del cliente del plan. Métricas (clicks,
  // views, impressions, cpm, etc.) quedan siempre en inglés.
  const lang: Language = detail.client.language ?? DEFAULT_LANGUAGE;

  const allMetrics = await listMetricsForClient(detail.client.id);
  const metricBySlug = new Map(allMetrics.map((m) => [m.slug, m]));

  // ─── Columnas de métricas: directs presentes + calculated que resuelven ──
  // (calculated como CTR/engagement rate se computan por placement; no se
  // guardan en metrics_json). Orden: direct→calculated, por sortOrder.
  const allPlacements = detail.publishers.flatMap((g) => g.placements);
  const metricColumns = resolveMetricColumns(allMetrics, allPlacements);
  const directSlugs = metricColumns
    .filter((m) => m.kind === "direct")
    .map((m) => m.slug);
  const calculatedSlugs = metricColumns
    .filter((m) => m.kind === "calculated")
    .map((m) => m.slug);
  const metricSlugs = metricColumns.map((m) => m.slug);
  const metricHeaders = metricColumns.map((m) => m.name);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Sangria Dashboard";
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;

  // ─────────────────────────────────────────────────────────────────────────
  // TAB 1 — Media plan
  // ─────────────────────────────────────────────────────────────────────────
  const sheetTitle = lang === "es" ? "Plan de medios" : "Media plan";
  const ws = wb.addWorksheet(sheetTitle);
  // El control +/- para colapsar los placements de un publisher queda sobre
  // la fila de subtotal (que va ARRIBA de sus placements).
  ws.properties.outlineProperties = {
    summaryBelow: false,
    summaryRight: false,
  };

  // Columnas + anchos. Sin columna dedicada de "Primary metric": cada métrica
  // usada en el plan tiene su propia columna, lo cual permite subtotalear y
  // totalear de forma consistente.
  const baseCols = 7;
  const totalCols = baseCols + metricHeaders.length;
  ws.columns = [
    { width: 28 }, // Publisher / Placement
    { width: 14 }, // Start
    { width: 14 }, // End
    { width: 36 }, // Audience
    { width: 36 }, // Notes
    { width: 12 }, // Cost method
    { width: 14 }, // Investment
    ...metricHeaders.map(() => ({ width: 14 })),
  ];

  // ─── Encabezado del documento ───────────────────────────────────────────
  const planPeriod = placementsPeriod(allPlacements);
  const periodFormatted =
    planPeriod.start && planPeriod.end
      ? `${formatDate(planPeriod.start, lang)} → ${formatDate(planPeriod.end, lang)}`
      : "—";

  const statusLabel = t(`status.${detail.plan.status}`, lang);

  // ─── Banner de título a todo el ancho ───────────────────────────────────
  const titleRow = ws.getRow(1);
  titleRow.getCell(1).value = `${t("export.mediaPlan", lang)} — ${detail.plan.name}`;
  titleRow.getCell(1).font = { bold: true, color: { argb: WHITE }, size: 15 };
  titleRow.getCell(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: ACCENT },
  };
  titleRow.getCell(1).alignment = { vertical: "middle", horizontal: "left" };
  ws.mergeCells(1, 1, 1, totalCols);
  titleRow.height = 30;

  const headerPairs: [string, string | number][] = [
    [t("common.client", lang), detail.client.name],
    [t("common.project", lang), `${detail.project.code} — ${detail.project.name}`],
    [t("common.budgetOrigin", lang), detail.budgetOrigin.name],
    [t("common.period", lang), periodFormatted],
    [t("common.version", lang), detail.plan.currentVersion],
    [t("common.status", lang), statusLabel],
    [
      t("common.generated", lang),
      formatDate(new Date().toISOString().slice(0, 10), lang),
    ],
  ];

  headerPairs.forEach(([label, value], i) => {
    const rowIdx = i + 2; // fila 1 = banner de título
    const row = ws.getRow(rowIdx);
    row.getCell(1).value = label;
    row.getCell(1).font = { bold: true, color: { argb: WHITE } };
    row.getCell(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: ACCENT },
    };
    row.getCell(1).alignment = { vertical: "middle", horizontal: "left" };
    row.getCell(2).value = value;
    row.getCell(2).font = { bold: true };
    row.getCell(2).alignment = { vertical: "middle", horizontal: "left" };
    ws.mergeCells(rowIdx, 2, rowIdx, totalCols);
    row.height = 20;
  });

  // ─── Logo de marca (arriba a la derecha) ─────────────────────────────────
  // Lo anclamos sobre las columnas de la derecha del bloque de metadata, que
  // tienen fondo blanco (los valores van alineados a la izquierda), evitando
  // el clash con el fondo de color del banner si el logo es un JPG opaco.
  const logo = getBrandLogo();
  if (logo) {
    const imageId = wb.addImage({
      base64: logo.bytes.toString("base64"),
      extension: logo.type === "png" ? "png" : "jpeg",
    });
    // Encajamos el logo en una caja preservando el aspect ratio (px). Si no se
    // pudieron leer las dimensiones, caemos a un tamaño por defecto.
    const boxW = 150;
    const boxH = 64;
    let w = boxW;
    let h = boxH;
    if (logo.width > 0 && logo.height > 0) {
      const scale = Math.min(boxW / logo.width, boxH / logo.height);
      w = Math.round(logo.width * scale);
      h = Math.round(logo.height * scale);
    }
    ws.addImage(imageId, {
      tl: { col: Math.max(2, totalCols - 2), row: 1.1 },
      ext: { width: w, height: h },
      editAs: "oneCell",
    });
  }

  // Título (1 fila) + pares (N filas) + 1 fila de aire antes de la tabla.
  const headerEndRow = headerPairs.length + 1;
  const tableHeaderRowIdx = headerEndRow + 2;

  // Congelamos todo el encabezado + el header de la tabla.
  ws.views = [{ state: "frozen", ySplit: tableHeaderRowIdx }];

  // ─── Header de la tabla principal ───────────────────────────────────────
  const tableHeader = [
    t("common.publisherPlacement", lang),
    t("common.startDate", lang),
    t("common.endDate", lang),
    t("common.audience", lang),
    t("common.notesFormats", lang),
    t("common.costMethod", lang),
    lang === "es" ? "Inversión (USD)" : "Investment (USD)",
    ...metricHeaders,
  ];
  const headerRow = ws.getRow(tableHeaderRowIdx);
  tableHeader.forEach((label, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = label;
    cell.font = { bold: true, color: { argb: WHITE } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: ACCENT },
    };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = allBorders;
  });
  headerRow.height = 32;

  // Helper para aplicar formato numérico a una celda de métrica según slug.
  function applyMetricFormat(
    cell: ExcelJS.Cell,
    slug: string,
    value: number | null,
  ) {
    if (value == null || !Number.isFinite(value)) {
      cell.value = null;
      return;
    }
    cell.value = value;
    const meta = metricBySlug.get(slug);
    const unit = meta?.unit ?? "";
    if (unit === "%") cell.numFmt = "0.00%";
    else if (unit === "$") cell.numFmt = '"$"#,##0.0000';
    else cell.numFmt = "#,##0";
  }

  let currentRow = tableHeaderRowIdx + 1;

  // ─── Filas por publisher: subtotal + placements ─────────────────────────
  const noPlacementsLabel = t("common.noPlacements", lang);
  for (const grp of detail.publishers) {
    // Subtotal del publisher: direct = sum, calculated = formula sobre el
    // subtotal de directs + el totalPlannedUsd del publisher.
    const pubDirects = sumDirectMetrics(grp.placements, directSlugs);

    const subRow = ws.getRow(currentRow);
    subRow.getCell(1).value = grp.publisherName;
    // Fechas del publisher = más temprana / más tardía de sus placements.
    const pubPeriod = placementsPeriod(grp.placements);
    subRow.getCell(2).value = formatDate(pubPeriod.start, lang);
    subRow.getCell(3).value = formatDate(pubPeriod.end, lang);
    subRow.getCell(7).value = grp.totalPlannedUsd;
    subRow.getCell(7).numFmt = '"$"#,##0.00';
    directSlugs.forEach((slug, i) => {
      const cell = subRow.getCell(baseCols + 1 + i);
      applyMetricFormat(cell, slug, pubDirects[slug] ?? null);
    });
    calculatedSlugs.forEach((slug, i) => {
      const cell = subRow.getCell(baseCols + 1 + directSlugs.length + i);
      const v = evalFormula(
        metricBySlug.get(slug)?.formula,
        grp.totalPlannedUsd,
        pubDirects,
      );
      applyMetricFormat(cell, slug, v);
    });
    for (let c = 1; c <= totalCols; c++) {
      const cell = subRow.getCell(c);
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: ACCENT_SOFT },
      };
      cell.font = { bold: true };
      cell.border = allBorders;
    }
    subRow.getCell(1).alignment = { vertical: "middle", horizontal: "left" };
    subRow.height = 22;
    currentRow++;

    if (grp.placements.length === 0) {
      const row = ws.getRow(currentRow);
      row.getCell(1).value = noPlacementsLabel;
      row.getCell(1).font = { italic: true, color: { argb: MUTED } };
      row.getCell(1).alignment = { indent: 2, vertical: "middle" };
      // Agrupable bajo el publisher (control +/- en la fila de subtotal).
      row.outlineLevel = 1;
      for (let c = 1; c <= totalCols; c++) row.getCell(c).border = allBorders;
      currentRow++;
      continue;
    }

    for (const pl of grp.placements) {
      const row = ws.getRow(currentRow);
      row.getCell(1).value = `${pl.placementName}${pl.marketName ? ` · ${pl.marketName}` : ""}`;
      row.getCell(2).value = formatDate(pl.startDate, lang);
      row.getCell(3).value = formatDate(pl.endDate, lang);
      row.getCell(4).value = pl.audience ?? "";
      row.getCell(5).value = pl.notesMd ?? "";
      row.getCell(6).value = pl.costMethod ?? "";
      row.getCell(7).value = pl.amountUsd;
      row.getCell(7).numFmt = '"$"#,##0.00';

      metricSlugs.forEach((slug, i) => {
        const cell = row.getCell(baseCols + 1 + i);
        const meta = metricBySlug.get(slug);
        applyMetricFormat(cell, slug, meta ? placementMetricValue(meta, pl) : null);
      });

      // Indentación real (no espacios) para anidar el placement bajo su
      // publisher, y outline level para que el grupo sea colapsable.
      row.getCell(1).alignment = { indent: 2, vertical: "top", wrapText: true };
      row.getCell(4).alignment = { wrapText: true, vertical: "top" };
      row.getCell(5).alignment = { wrapText: true, vertical: "top" };
      row.getCell(6).alignment = { horizontal: "center" };
      row.outlineLevel = 1;

      for (let c = 1; c <= totalCols; c++) row.getCell(c).border = allBorders;
      currentRow++;
    }
  }

  // ─── Fila TOTAL MEDIA con totales de métricas ───────────────────────────
  const planDirects = sumDirectMetrics(allPlacements, directSlugs);

  const totalMediaRow = ws.getRow(currentRow);
  totalMediaRow.getCell(1).value =
    lang === "es" ? "TOTAL MEDIA" : "MEDIA TOTAL";
  totalMediaRow.getCell(7).value = detail.totals.media;
  totalMediaRow.getCell(7).numFmt = '"$"#,##0.00';
  directSlugs.forEach((slug, i) => {
    const cell = totalMediaRow.getCell(baseCols + 1 + i);
    applyMetricFormat(cell, slug, planDirects[slug] ?? null);
  });
  calculatedSlugs.forEach((slug, i) => {
    const cell = totalMediaRow.getCell(baseCols + 1 + directSlugs.length + i);
    const v = evalFormula(
      metricBySlug.get(slug)?.formula,
      detail.totals.media,
      planDirects,
    );
    applyMetricFormat(cell, slug, v);
  });
  for (let c = 1; c <= totalCols; c++) {
    const cell = totalMediaRow.getCell(c);
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: ACCENT },
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
      fgColor: { argb: ACCENT },
    };
    ws.mergeCells(currentRow, 1, currentRow, totalCols);
    feesTitleRow.height = 22;
    currentRow++;

    const feeHeaders = [
      t("common.type", lang),
      t("common.name", lang),
      "Rate %",
      lang === "es" ? "Monto (USD)" : "Amount (USD)",
      t("common.notes", lang),
    ];
    const feeColsSpan = [1, 1, 1, 1, Math.max(1, totalCols - 4)];
    const feeHdrRow = ws.getRow(currentRow);
    let col = 1;
    feeHeaders.forEach((label, i) => {
      const cell = feeHdrRow.getCell(col);
      cell.value = label;
      cell.font = { bold: true, color: { argb: WHITE } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: ACCENT },
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
      const notesSpan = feeColsSpan[4];
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
        fgColor: { argb: ACCENT_SOFT },
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
      fgColor: { argb: INK },
    };
    cell.font = { bold: true, size: 12, color: { argb: WHITE } };
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
  sigLineRow.getCell(1).font = { color: { argb: MUTED } };
  ws.mergeCells(currentRow, 1, currentRow, 4);
  currentRow++;

  const sigDateRow = ws.getRow(currentRow);
  sigDateRow.getCell(1).value = t("export.dateLabel", lang);
  sigDateRow.getCell(1).font = { color: { argb: MUTED } };
  currentRow += 2; // fila en blanco antes del disclaimer

  // ─── Disclaimer legal (debajo de la firma) ──────────────────────────────
  const discRow = ws.getRow(currentRow);
  discRow.getCell(1).value = t("export.signatureDisclaimer", lang);
  discRow.getCell(1).font = { italic: true, size: 9, color: { argb: MUTED } };
  discRow.getCell(1).alignment = { wrapText: true, vertical: "top" };
  ws.mergeCells(currentRow, 1, currentRow, Math.min(totalCols, 8));
  discRow.height = 46;

  // ─────────────────────────────────────────────────────────────────────────
  // TAB 2 — Budget split por mercado (prorrateo mensual, sin métricas)
  // ─────────────────────────────────────────────────────────────────────────
  buildBudgetByMarketSheet(wb, detail, lang);

  // ─────────────────────────────────────────────────────────────────────────
  // TABS 3+ — Tabs auxiliares del plan (uno por sheet creado, en orden)
  // ─────────────────────────────────────────────────────────────────────────
  for (const aux of detail.auxSheets) buildAuxSheet(wb, detail, aux, lang);

  // ─── Output ─────────────────────────────────────────────────────────────
  const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;

  const filename = `${detail.plan.name}-V${detail.plan.currentVersion}.xlsx`.replace(
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

// ────────────────────────────────────────────────────────────────────────────
// Tab 2 — Budget by market
// ────────────────────────────────────────────────────────────────────────────

function buildBudgetByMarketSheet(
  wb: ExcelJS.Workbook,
  detail: NonNullable<Awaited<ReturnType<typeof getPlanDetail>>>,
  lang: Language,
) {
  const title = lang === "es" ? "Budget por mercado" : "Budget by market";
  const ws = wb.addWorksheet(title, {
    views: [{ state: "frozen", xSplit: 1, ySplit: 1 }],
  });

  // Agregación placements → market × month (prorrateo por días) compartida
  // con el preview del editor: lib/budget-split.ts.
  const noDateLabel = lang === "es" ? "Sin fecha" : "Undated";
  const split = buildBudgetSplit(
    detail.publishers.flatMap((g) => g.placements),
    {
      noMarketLabel: lang === "es" ? "(sin mercado)" : "(no market)",
      locale: lang === "es" ? "es" : "en",
    },
  );
  const { monthKeys, markets: sortedMarkets, amounts: byMarket } = split;
  const monthHeaders = monthKeys.map((k) =>
    k === NO_DATE_KEY ? noDateLabel : formatMonth(k, lang),
  );

  // Columnas
  const totalCols = 2 + monthKeys.length; // mercado + meses + total
  ws.columns = [
    { width: 32 }, // Market
    ...monthHeaders.map(() => ({ width: 16 })),
    { width: 18 }, // Total
  ];

  // Header
  const headerRow = ws.getRow(1);
  headerRow.getCell(1).value = t("common.market", lang);
  monthHeaders.forEach((label, i) => {
    headerRow.getCell(2 + i).value = label;
  });
  headerRow.getCell(totalCols).value = t("common.total", lang);
  for (let c = 1; c <= totalCols; c++) {
    const cell = headerRow.getCell(c);
    cell.font = { bold: true, color: { argb: WHITE } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: ACCENT },
    };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = allBorders;
  }
  headerRow.height = 28;

  // Rows
  const monthTotals: number[] = monthKeys.map(() => 0);
  let grand = 0;
  let r = 2;
  for (const market of sortedMarkets) {
    const row = ws.getRow(r);
    row.getCell(1).value = market;
    row.getCell(1).font = { bold: true };
    row.getCell(1).alignment = { vertical: "middle", horizontal: "left" };

    let rowTotal = 0;
    const monthMap = byMarket.get(market)!;
    monthKeys.forEach((key, i) => {
      const v = monthMap.get(key) ?? 0;
      const cell = row.getCell(2 + i);
      if (v > 0) {
        cell.value = v;
        cell.numFmt = '"$"#,##0.00';
      }
      rowTotal += v;
      monthTotals[i] += v;
    });

    const totalCell = row.getCell(totalCols);
    totalCell.value = rowTotal;
    totalCell.numFmt = '"$"#,##0.00';
    totalCell.font = { bold: true };
    totalCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: ACCENT_SOFT },
    };
    grand += rowTotal;

    for (let c = 1; c <= totalCols; c++) row.getCell(c).border = allBorders;
    r++;
  }

  if (sortedMarkets.length === 0) {
    const row = ws.getRow(r);
    row.getCell(1).value =
      lang === "es" ? "(sin placements)" : "(no placements)";
    row.getCell(1).font = { italic: true, color: { argb: MUTED } };
    ws.mergeCells(r, 1, r, totalCols);
    r++;
  }

  // Footer: total mensual + grand total
  const footRow = ws.getRow(r);
  footRow.getCell(1).value = t("common.total", lang);
  monthTotals.forEach((v, i) => {
    const cell = footRow.getCell(2 + i);
    cell.value = v;
    cell.numFmt = '"$"#,##0.00';
  });
  footRow.getCell(totalCols).value = grand;
  footRow.getCell(totalCols).numFmt = '"$"#,##0.00';
  for (let c = 1; c <= totalCols; c++) {
    const cell = footRow.getCell(c);
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: INK },
    };
    cell.font = { bold: true };
    cell.border = allBorders;
  }
  footRow.height = 22;
}

// ────────────────────────────────────────────────────────────────────────────
// Tabs 3+ — Tabs auxiliares (grillas libres del planner). Mismo encabezado de
// metadata que el editor (proyecto, período, budget origin) y la grilla tal
// cual se cargó; las celdas que parsean limpio como número van numéricas y
// las fórmulas ("=…") se escriben como fórmulas reales de Excel (la
// numeración del editor coincide con la del tab, así las refs no se corren).
// ────────────────────────────────────────────────────────────────────────────

function buildAuxSheet(
  wb: ExcelJS.Workbook,
  detail: NonNullable<Awaited<ReturnType<typeof getPlanDetail>>>,
  aux: PlanAuxSheet,
  lang: Language,
) {
  // Nombre de tab válido para Excel: sin []:*?/\ y máx. 31 chars; si colisiona
  // con otro tab del workbook, sufijo numérico.
  const base =
    aux.name.replace(/[\[\]:*?/\\]/g, "").trim().slice(0, 31) ||
    AUX_SHEET_DEFAULT_NAME;
  let title = base;
  for (
    let i = 2;
    wb.worksheets.some((s) => s.name.toLowerCase() === title.toLowerCase());
    i++
  ) {
    const suffix = ` (${i})`;
    title = base.slice(0, 31 - suffix.length) + suffix;
  }
  const ws = wb.addWorksheet(title);

  const grid = aux.grid;

  // ─── Caja con contenido ───────────────────────────────────────────────────
  // Solo damos formato (bordes / fondos / alto de fila) al rectángulo que tiene
  // datos —o que cubre una unión—, para no pintar de color toda la grilla
  // vacía. `tableCols` fija el ancho del bloque (metadata + tabla) de modo que
  // ambos queden alineados, igual que en el Tab 1.
  let firstContentRow = -1;
  let lastContentRow = -1;
  let lastContentCol = -1;
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (!grid[r][c].trim()) continue;
      if (firstContentRow === -1) firstContentRow = r;
      lastContentRow = r;
      if (c > lastContentCol) lastContentCol = c;
    }
  }
  // Las uniones también forman parte del bloque a formatear (un título
  // combinado a lo ancho, p.ej., puede pasarse del último dato).
  for (const m of aux.merges) {
    if (firstContentRow === -1 || m.r0 < firstContentRow) firstContentRow = m.r0;
    if (m.r1 > lastContentRow) lastContentRow = m.r1;
    if (m.c1 > lastContentCol) lastContentCol = m.c1;
  }
  const tableCols = Math.max(2, lastContentCol + 1);

  // Valor que se VE en una celda (para estimar el ancho de columna): el texto
  // tal cual, el número como lo escribe Excel, o el resultado de la fórmula.
  const cellDisplay = (r: number, c: number): string => {
    const raw = (grid[r]?.[c] ?? "").trim();
    if (!raw) return "";
    if (isAuxFormula(raw)) {
      const res = evalAuxFormula(grid[r][c], grid, { r, c });
      return res.ok ? String(res.value) : raw;
    }
    const n = auxCellNumber(raw);
    return n != null ? String(n) : raw;
  };

  // ¿La celda es numérica (número suelto o fórmula que resuelve)? → se alinea a
  // la derecha, como las columnas de plata de la hoja principal.
  const isNumericCell = (r: number, c: number): boolean => {
    const raw = (grid[r]?.[c] ?? "").trim();
    if (!raw) return false;
    if (isAuxFormula(raw)) return evalAuxFormula(grid[r][c], grid, { r, c }).ok;
    return auxCellNumber(raw) != null;
  };

  // Metadata del plan, mismo estilo que el Tab 1.
  const allPlacements = detail.publishers.flatMap((g) => g.placements);
  const period = placementsPeriod(allPlacements);
  const periodFormatted =
    period.start && period.end
      ? `${formatDate(period.start, lang)} → ${formatDate(period.end, lang)}`
      : "—";
  const infoPairs: [string, string][] = [
    [t("common.project", lang), `${detail.project.code} — ${detail.project.name}`],
    [t("common.period", lang), periodFormatted],
    [t("common.budgetOrigin", lang), detail.budgetOrigin.name],
  ];

  // ─── Anchos de columna ajustados al contenido ─────────────────────────────
  // Por columna, el texto más largo de la grilla (la col 0 también considera
  // las etiquetas de metadata). Acotado a [10..48]; 16 mínimo en la col de
  // etiquetas para que respiren.
  ws.columns = Array.from({ length: tableCols }, (_, c) => {
    let maxLen = 0;
    for (let r = 0; r < grid.length; r++) {
      const len = cellDisplay(r, c).length;
      if (len > maxLen) maxLen = len;
    }
    if (c === 0) {
      for (const [label] of infoPairs) {
        if (label.length > maxLen) maxLen = label.length;
      }
    }
    const min = c === 0 ? 16 : 10;
    return { width: Math.min(48, Math.max(min, maxLen + 2)) };
  });

  infoPairs.forEach(([label, value], i) => {
    const row = ws.getRow(i + 1);
    row.getCell(1).value = label;
    row.getCell(1).font = { bold: true, color: { argb: WHITE } };
    row.getCell(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: ACCENT },
    };
    row.getCell(1).alignment = { vertical: "middle", horizontal: "left" };
    row.getCell(2).value = value;
    row.getCell(2).font = { bold: true };
    row.getCell(2).alignment = { vertical: "middle", horizontal: "left" };
    ws.mergeCells(i + 1, 2, i + 1, tableCols);
    row.height = 20;
  });

  // Grilla vacía → queda solo la metadata.
  if (firstContentRow === -1) return;

  // La primera fila con contenido, si son todo etiquetas de texto, se trata
  // como header (fondo ACCENT). Subtotales/totales se detectan por su etiqueta.
  const headerRowIdx = detectAuxHeaderRow(grid, firstContentRow);

  // Congelamos la metadata (+ el header de la grilla, si lo hay), como hace el
  // Tab 1 con su encabezado.
  ws.views = [
    {
      state: "frozen",
      ySplit:
        headerRowIdx >= 0
          ? AUX_SHEET_GRID_ROW_OFFSET + headerRowIdx
          : AUX_SHEET_INFO_ROWS,
    },
  ];

  // ─── Grilla con formato (una fila de aire después de la metadata; AUX_SHEET_
  // GRID_ROW_OFFSET es la misma numeración que muestra el editor) ────────────
  let zebra = 0; // alterna el banding SOLO entre filas de datos
  for (let r = firstContentRow; r <= lastContentRow; r++) {
    const cells = grid[r] ?? [];
    if (!cells.some((x) => x.trim())) continue; // respeta las filas en blanco

    const row = ws.getRow(AUX_SHEET_GRID_ROW_OFFSET + r);
    const kind = r === headerRowIdx ? "header" : classifyAuxRow(cells);

    let fill: string | null = null;
    let fontColor: string | null = null;
    let bold = false;
    switch (kind) {
      case "header":
      case "total":
        fill = ACCENT;
        fontColor = WHITE;
        bold = true;
        break;
      case "grand":
        fill = INK;
        fontColor = WHITE;
        bold = true;
        break;
      case "subtotal":
        fill = ACCENT_SOFT;
        bold = true;
        break;
      default:
        if (zebra % 2 === 1) fill = ZEBRA; // datos: banding en filas alternas
        zebra++;
    }

    for (let c = 0; c < tableCols; c++) {
      const cell = row.getCell(c + 1);
      const raw = (cells[c] ?? "").trim();
      if (raw) {
        if (isAuxFormula(raw)) {
          // Solo va como fórmula si nuestro evaluador la resuelve (garantiza
          // sintaxis válida); si no, va el texto crudo para que se vea el error.
          const res = evalAuxFormula(grid[r][c], grid, { r, c });
          // Uppercase: Excel guarda refs y funciones en mayúsculas; nuestro
          // lenguaje no tiene strings literales, así que es seguro.
          cell.value = res.ok
            ? { formula: raw.slice(1).toUpperCase(), result: res.value }
            : grid[r][c];
        } else {
          cell.value = auxCellNumber(raw) ?? grid[r][c];
        }
      }
      cell.border = allBorders;
      if (fill) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      }
      if (bold || fontColor) {
        cell.font = {
          bold,
          ...(fontColor ? { color: { argb: fontColor } } : {}),
        };
      }
      cell.alignment = {
        vertical: "middle",
        horizontal:
          kind === "header" ? "center" : isNumericCell(r, c) ? "right" : "left",
      };
    }
    row.height = kind ? 22 : 20; // subtotales/totales/header un poco más altos
  }

  // Celdas combinadas: mismas coords que la grilla (fila +AUX_SHEET_GRID_ROW_
  // OFFSET, columna +1). Centramos la master. try/catch por las dudas: nuestras
  // uniones no se solapan, pero ExcelJS tira si una unión pisa otra.
  for (const m of aux.merges) {
    const top = AUX_SHEET_GRID_ROW_OFFSET + m.r0;
    const left = m.c0 + 1;
    const bottom = AUX_SHEET_GRID_ROW_OFFSET + m.r1;
    const right = m.c1 + 1;
    try {
      ws.mergeCells(top, left, bottom, right);
      ws.getCell(top, left).alignment = {
        vertical: "middle",
        horizontal: "center",
        wrapText: true,
      };
    } catch {
      // unión inválida → se ignora, el resto del tab sale igual
    }
  }
}

// Primera celda no vacía de una fila (donde suele ir la etiqueta).
function firstAuxLabel(cells: string[]): string {
  for (const cell of cells) {
    const v = cell.trim();
    if (v) return v;
  }
  return "";
}

// Clasifica una fila como total / subtotal mirando SOLO su etiqueta (primera
// celda con contenido), igual que "TOTAL MEDIA" / "GRAND TOTAL" en el Tab 1.
// Mirar solo la etiqueta evita confundir un header con columnas tipo "Total
// impresiones". null = fila de datos común.
function classifyAuxRow(
  cells: string[],
): "grand" | "total" | "subtotal" | null {
  const label = firstAuxLabel(cells).toLowerCase();
  if (!label) return null;
  if (/^(grand\s*total|gran\s*total|total\s*general)\b/.test(label)) return "grand";
  if (/^sub\s*-?\s*totals?\b/.test(label) || /^subtotales?\b/.test(label))
    return "subtotal";
  if (/^totals?\b/.test(label) || /^totales?\b/.test(label)) return "total";
  return null;
}

// La primera fila con contenido es "header" si son todo etiquetas de texto
// (sin números ni fórmulas) y no es ya un total/subtotal. Si no, -1.
function detectAuxHeaderRow(grid: string[][], firstContentRow: number): number {
  const cells = grid[firstContentRow];
  if (!cells || classifyAuxRow(cells)) return -1;
  let hasText = false;
  for (const cell of cells) {
    const v = cell.trim();
    if (!v) continue;
    if (isAuxFormula(v) || auxCellNumber(v) != null) return -1;
    hasText = true;
  }
  return hasText ? firstContentRow : -1;
}
