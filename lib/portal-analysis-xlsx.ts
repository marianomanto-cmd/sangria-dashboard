import ExcelJS from "exceljs";
import { getBrandLogo } from "@/lib/brand-logo";
import type { ActivationRow, MarketAgg } from "@/db/queries/analysis";
import { formatDate, type Language } from "@/lib/i18n";

// ════════════════════════════════════════════════════════════════════════════
// Armado del Excel de la sección ANÁLISIS (mapa por mercado). Lo usa el thin
// handler app/api/portal/analysis.xlsx/route.ts. Dos hojas con el look de
// marca del plan de medios:
//   1. Detalle     — una fila por activación (placement de plan aprobado) con
//                    campaña, mercado, budget origin, proyecto, publisher,
//                    período e inversión + TOTAL. Refleja la data filtrada.
//   2. Por mercado — el agregado que alimenta el mapa (inversión, activaciones
//                    y % del total por mercado) + fila "Sin mercado" si hay
//                    placements sin mercado asignado.
// ════════════════════════════════════════════════════════════════════════════

// Paleta de marca — sincronizada con app/globals.css, estimate.xlsx,
// pacing.xlsx y export.xlsx/route.ts.
const ACCENT = "FF7A1F3D";
const ACCENT_SOFT = "FFF5E6EC";
const INK = "FF1C1917";
const WHITE = "FFFFFFFF";
const BORDER = "FFD6D3D1";
const MUTED = "FF78716C";

const thin = { style: "thin" as const, color: { argb: BORDER } };
const allBorders = { top: thin, left: thin, bottom: thin, right: thin };

const USD_FMT = '"$"#,##0.00';
const PCT_FMT = "0.0%";

export type AnalysisWorkbookOpts = {
  lang: Language;
  clientName: string;
  // Filtros aplicados (ya resueltos a nombres legibles) para el header de la
  // hoja Detalle — el que baja el archivo tiene que saber QUÉ está mirando.
  filters: [string, string][];
  generatedAt: Date;
};

export function buildAnalysisWorkbook(
  rows: ActivationRow[],
  markets: MarketAgg[],
  opts: AnalysisWorkbookOpts,
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Sangria Dashboard";
  wb.created = opts.generatedAt;

  buildDetalleSheet(wb, rows, opts);
  buildPorMercadoSheet(wb, rows, markets, opts);
  return wb;
}

// ── Estilos de celdas (mismo criterio que portal-estimate-xlsx.ts) ───────────

function fillRow(row: ExcelJS.Row, cols: number, argb: string, white = false) {
  for (let c = 1; c <= cols; c++) {
    const cell = row.getCell(c);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
    cell.font = { bold: true, ...(white ? { color: { argb: WHITE } } : {}) };
    cell.border = allBorders;
  }
}

// Banner de título + pares de metadata + logo. Devuelve la fila libre
// siguiente (para el header de la tabla).
function brandHeader(
  ws: ExcelJS.Worksheet,
  wb: ExcelJS.Workbook,
  title: string,
  pairs: [string, string | number][],
  totalCols: number,
): number {
  const titleRow = ws.getRow(1);
  titleRow.getCell(1).value = title;
  titleRow.getCell(1).font = { bold: true, color: { argb: WHITE }, size: 15 };
  titleRow.getCell(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: ACCENT },
  };
  titleRow.getCell(1).alignment = { vertical: "middle", horizontal: "left" };
  ws.mergeCells(1, 1, 1, totalCols);
  titleRow.height = 30;

  pairs.forEach(([label, value], i) => {
    const rowIdx = i + 2;
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

  const logo = pairs.length > 0 ? getBrandLogo() : null;
  if (logo) {
    const imageId = wb.addImage({
      base64: logo.bytes.toString("base64"),
      extension: logo.type === "png" ? "png" : "jpeg",
    });
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

  return pairs.length + 3; // título(1) + pares(N) + 1 de aire
}

function tableHeader(ws: ExcelJS.Worksheet, rowIdx: number, labels: string[]) {
  const row = ws.getRow(rowIdx);
  labels.forEach((label, i) => {
    const cell = row.getCell(i + 1);
    cell.value = label;
    cell.font = { bold: true, color: { argb: WHITE } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ACCENT } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = allBorders;
  });
  row.height = 30;
}

function textCell(row: ExcelJS.Row, col: number, value: string, muted = false) {
  const cell = row.getCell(col);
  cell.value = value;
  cell.border = allBorders;
  cell.alignment = { vertical: "middle", wrapText: false };
  if (muted) cell.font = { color: { argb: MUTED } };
}

function usdCell(row: ExcelJS.Row, col: number, value: number) {
  const cell = row.getCell(col);
  cell.value = value;
  cell.numFmt = USD_FMT;
  cell.border = allBorders;
  cell.alignment = { vertical: "middle", horizontal: "right" };
}

// ── Hoja 1 — Detalle de activaciones (línea por línea) ───────────────────────

function buildDetalleSheet(
  wb: ExcelJS.Workbook,
  rows: ActivationRow[],
  opts: AnalysisWorkbookOpts,
) {
  const { lang, clientName, filters } = opts;
  const es = lang === "es";
  const ws = wb.addWorksheet(es ? "Detalle" : "Detail");
  const totalCols = 8;
  ws.columns = [
    { width: 32 }, // Campaña
    { width: 22 }, // Mercado
    { width: 18 }, // Budget Origin
    { width: 32 }, // Proyecto
    { width: 22 }, // Publisher
    { width: 13 }, // Desde
    { width: 13 }, // Hasta
    { width: 16 }, // Inversión (USD)
  ];

  const totalUsd = rows.reduce((s, r) => s + r.amountUsd, 0);
  const pairs: [string, string | number][] = [
    [es ? "Cliente" : "Client", clientName],
    [es ? "Activaciones" : "Activations", rows.length],
    [es ? "Generado" : "Generated", formatDate(opts.generatedAt.toISOString().slice(0, 10), lang)],
    ...filters,
  ];

  const headerEnd = brandHeader(
    ws,
    wb,
    `${es ? "ANÁLISIS POR MERCADO" : "MARKET ANALYSIS"} · ${clientName}`,
    pairs,
    totalCols,
  );

  ws.views = [{ state: "frozen", ySplit: headerEnd }];
  tableHeader(ws, headerEnd, [
    es ? "Campaña" : "Campaign",
    es ? "Mercado" : "Market",
    "Budget Origin",
    es ? "Proyecto" : "Project",
    "Publisher",
    es ? "Desde" : "From",
    es ? "Hasta" : "To",
    es ? "Inversión (USD)" : "Spend (USD)",
  ]);
  // Autofiltro sobre la tabla: el export es para trabajar la data en Excel.
  ws.autoFilter = {
    from: { row: headerEnd, column: 1 },
    to: { row: headerEnd + Math.max(rows.length, 1), column: totalCols },
  };

  let r = headerEnd + 1;
  const dash = "—";

  if (rows.length === 0) {
    const row = ws.getRow(r);
    row.getCell(1).value = es
      ? "(sin activaciones para los filtros aplicados)"
      : "(no activations for the current filters)";
    row.getCell(1).font = { italic: true, color: { argb: MUTED } };
    for (let c = 1; c <= totalCols; c++) row.getCell(c).border = allBorders;
    ws.mergeCells(r, 1, r, totalCols);
    r++;
  }

  for (const a of rows) {
    const row = ws.getRow(r);
    textCell(row, 1, a.planName);
    textCell(row, 2, a.marketName ?? dash, !a.marketName);
    textCell(row, 3, a.budgetOriginName ?? dash, !a.budgetOriginName);
    textCell(row, 4, `${a.projectName} · ${a.projectCode}`);
    textCell(row, 5, a.publisherName);
    textCell(row, 6, a.startDate ? formatDate(a.startDate, lang) : dash, !a.startDate);
    textCell(row, 7, a.endDate ? formatDate(a.endDate, lang) : dash, !a.endDate);
    usdCell(row, 8, a.amountUsd);
    r++;
  }

  const totalRow = ws.getRow(r);
  totalRow.getCell(1).value = "TOTAL";
  usdCell(totalRow, 8, totalUsd);
  fillRow(totalRow, totalCols, INK, true);
  totalRow.height = 22;

  const noteRow = ws.getRow(r + 2);
  noteRow.getCell(1).value = es
    ? "Una fila por activación: placement de un plan de medios APROBADO del cliente, con la campaña (plan), el mercado, el budget origin del proyecto y la inversión planificada."
    : "One row per activation: a placement from an APPROVED media plan, with its campaign (plan), market, the project's budget origin and the planned spend.";
  noteRow.getCell(1).font = { italic: true, color: { argb: MUTED }, size: 9 };
  noteRow.getCell(1).alignment = { wrapText: true, vertical: "top" };
  ws.mergeCells(r + 2, 1, r + 2, totalCols);
  noteRow.height = 28;
}

// ── Hoja 2 — Agregado por mercado (lo que alimenta el mapa) ──────────────────

function buildPorMercadoSheet(
  wb: ExcelJS.Workbook,
  rows: ActivationRow[],
  markets: MarketAgg[],
  opts: AnalysisWorkbookOpts,
) {
  const { lang, clientName } = opts;
  const es = lang === "es";
  const ws = wb.addWorksheet(es ? "Por mercado" : "By market");
  const totalCols = 4;
  ws.columns = [
    { width: 28 }, // Mercado
    { width: 14 }, // Activaciones
    { width: 16 }, // Inversión (USD)
    { width: 12 }, // % Inversión
  ];

  const headerEnd = brandHeader(
    ws,
    wb,
    `${es ? "INVERSIÓN POR MERCADO" : "SPEND BY MARKET"} · ${clientName}`,
    [],
    totalCols,
  );

  ws.views = [{ state: "frozen", ySplit: headerEnd }];
  tableHeader(ws, headerEnd, [
    es ? "Mercado" : "Market",
    es ? "Activaciones" : "Activations",
    es ? "Inversión (USD)" : "Spend (USD)",
    es ? "% Inversión" : "% Spend",
  ]);

  // Placements sin mercado asignado: no están en el agregado del mapa, pero
  // tienen que aparecer para que el total reconcilie con la hoja Detalle.
  const unassigned = rows.filter((a) => !a.marketId);
  const unassignedUsd = unassigned.reduce((s, a) => s + a.amountUsd, 0);
  const totalUsd =
    markets.reduce((s, m) => s + m.plannedUsd, 0) + unassignedUsd;
  const totalCount = markets.reduce((s, m) => s + m.count, 0) + unassigned.length;

  let r = headerEnd + 1;

  const countCell = (row: ExcelJS.Row, value: number) => {
    const cell = row.getCell(2);
    cell.value = value;
    cell.border = allBorders;
    cell.alignment = { vertical: "middle", horizontal: "center" };
  };
  const pctCell = (row: ExcelJS.Row, value: number) => {
    const cell = row.getCell(4);
    cell.value = value;
    cell.numFmt = PCT_FMT;
    cell.border = allBorders;
    cell.alignment = { vertical: "middle", horizontal: "right" };
  };

  for (const m of markets) {
    const row = ws.getRow(r);
    textCell(row, 1, m.marketName);
    countCell(row, m.count);
    usdCell(row, 3, m.plannedUsd);
    pctCell(row, totalUsd > 0 ? m.plannedUsd / totalUsd : 0);
    r++;
  }

  if (unassigned.length > 0) {
    const row = ws.getRow(r);
    textCell(row, 1, es ? "Sin mercado" : "No market", true);
    countCell(row, unassigned.length);
    usdCell(row, 3, unassignedUsd);
    pctCell(row, totalUsd > 0 ? unassignedUsd / totalUsd : 0);
    r++;
  }

  if (markets.length === 0 && unassigned.length === 0) {
    const row = ws.getRow(r);
    row.getCell(1).value = es
      ? "(sin datos para los filtros aplicados)"
      : "(no data for the current filters)";
    row.getCell(1).font = { italic: true, color: { argb: MUTED } };
    for (let c = 1; c <= totalCols; c++) row.getCell(c).border = allBorders;
    ws.mergeCells(r, 1, r, totalCols);
    r++;
  }

  const totalRow = ws.getRow(r);
  totalRow.getCell(1).value = "TOTAL";
  countCell(totalRow, totalCount);
  usdCell(totalRow, 3, totalUsd);
  pctCell(totalRow, totalUsd > 0 ? 1 : 0);
  fillRow(totalRow, totalCols, ACCENT_SOFT);
  totalRow.height = 22;
}
