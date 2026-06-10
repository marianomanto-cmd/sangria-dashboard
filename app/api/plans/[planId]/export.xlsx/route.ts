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
import { AUX_SHEET_DEFAULT_NAME, auxCellNumber } from "@/lib/aux-sheet";
import { canAccessClientExport } from "@/lib/client-portal.server";
import type { PlanAuxSheet } from "@/db/queries/project-detail";

// Paleta de marca — sincronizada con los design tokens de app/globals.css.
const ACCENT = "FF7A1F3D";       // header principal, total media, títulos
const ACCENT_SOFT = "FFF5E6EC";  // subtotales / secciones
const INK = "FF1C1917";          // grand total
const WHITE = "FFFFFFFF";
const BORDER = "FFD6D3D1";       // --color-line
const MUTED = "FF78716C";        // --color-muted

const thin = { style: "thin" as const, color: { argb: BORDER } };
const allBorders = { top: thin, left: thin, bottom: thin, right: thin };

// ────────────────────────────────────────────────────────────────────────────
// Helpers de cálculo
// ────────────────────────────────────────────────────────────────────────────

// Prorratea un monto entre los meses que cubre [startISO, endISO] usando
// proporción de días (inclusive en ambos extremos). Si faltan fechas devuelve
// el monto bajo la clave especial "no-date" para que aparezca en una columna
// aparte y nunca se "pierda".
function prorateByMonth(
  amount: number,
  startISO: string | null,
  endISO: string | null,
): Map<string, number> {
  const out = new Map<string, number>();
  if (amount === 0) return out;
  if (!startISO || !endISO) {
    out.set("no-date", amount);
    return out;
  }
  const s = parseDate(startISO);
  const e = parseDate(endISO);
  if (!s || !e || e < s) {
    out.set("no-date", amount);
    return out;
  }
  const totalDays = daysBetween(s, e) + 1;
  if (totalDays <= 0) {
    out.set("no-date", amount);
    return out;
  }
  let cursor = new Date(s.getFullYear(), s.getMonth(), 1);
  while (cursor <= e) {
    const y = cursor.getFullYear();
    const mIdx = cursor.getMonth();
    const monthStart = new Date(y, mIdx, 1);
    const monthEnd = new Date(y, mIdx + 1, 0);
    const segStart = monthStart > s ? monthStart : s;
    const segEnd = monthEnd < e ? monthEnd : e;
    const days = daysBetween(segStart, segEnd) + 1;
    if (days > 0) {
      const key = `${y}-${String(mIdx + 1).padStart(2, "0")}`;
      out.set(key, (out.get(key) ?? 0) + (amount * days) / totalDays);
    }
    cursor = new Date(y, mIdx + 1, 1);
  }
  return out;
}

function parseDate(iso: string): Date | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(
    Number.parseInt(m[1], 10),
    Number.parseInt(m[2], 10) - 1,
    Number.parseInt(m[3], 10),
  );
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

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
  // TAB 3 — Sheet auxiliar (solo si el plan tiene uno creado)
  // ─────────────────────────────────────────────────────────────────────────
  if (detail.auxSheet) buildAuxSheet(wb, detail, detail.auxSheet, lang);

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

  // Agrega placements → market × month con prorrateo por días.
  const noMarketLabel = lang === "es" ? "(sin mercado)" : "(no market)";
  const noDateLabel = lang === "es" ? "Sin fecha" : "Undated";
  const byMarket = new Map<string, Map<string, number>>();
  const monthsSet = new Set<string>();
  let hasNoDate = false;

  for (const grp of detail.publishers) {
    for (const pl of grp.placements) {
      if (!pl.amountUsd) continue;
      const market = pl.marketName ?? noMarketLabel;
      const alloc = prorateByMonth(pl.amountUsd, pl.startDate, pl.endDate);
      let m = byMarket.get(market);
      if (!m) {
        m = new Map();
        byMarket.set(market, m);
      }
      for (const [key, usd] of alloc) {
        m.set(key, (m.get(key) ?? 0) + usd);
        if (key === "no-date") hasNoDate = true;
        else monthsSet.add(key);
      }
    }
  }

  const sortedMonths = [...monthsSet].sort();
  // "no-date" se renderiza como última columna si aplica.
  const monthKeys = hasNoDate ? [...sortedMonths, "no-date"] : sortedMonths;
  const monthHeaders = monthKeys.map((k) =>
    k === "no-date" ? noDateLabel : formatMonth(k, lang),
  );
  const sortedMarkets = [...byMarket.keys()].sort((a, b) =>
    a.localeCompare(b, lang === "es" ? "es" : "en"),
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
// Tab 3 — Sheet auxiliar (grilla libre del planner). Mismo encabezado de
// metadata que el editor (proyecto, período, budget origin) y la grilla tal
// cual se cargó; las celdas que parsean limpio como número van numéricas.
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

  const gridCols = Math.max(1, ...aux.grid.map((r) => r.length));
  const totalCols = Math.max(2, gridCols);
  ws.columns = Array.from({ length: totalCols }, (_, c) => ({
    width: c === 0 ? 24 : 16,
  }));

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
    ws.mergeCells(i + 1, 2, i + 1, totalCols);
    row.height = 20;
  });

  // Grilla libre (una fila de aire después de la metadata).
  const startRow = infoPairs.length + 2;
  aux.grid.forEach((cells, r) => {
    const row = ws.getRow(startRow + r);
    cells.forEach((cell, c) => {
      if (!cell.trim()) return;
      row.getCell(c + 1).value = auxCellNumber(cell) ?? cell;
    });
  });
}
