import ExcelJS from "exceljs";
import { getBrandLogo } from "@/lib/brand-logo";
import type { MonthlyBillingEstimate } from "@/db/queries/dashboard";
import { formatMonth, type Language } from "@/lib/i18n";

// ════════════════════════════════════════════════════════════════════════════
// Armado del Excel de la tab ESTIMACIÓN del portal. Lo usa el thin handler
// app/api/portal/estimate.xlsx/route.ts. Dos hojas con el look de marca del
// plan de medios:
//   1. Resumen  — una fila por mes (media/fees estimados · bruto · FACTURADO
//                 REAL · neto a facturar) + TOTAL. Cada mes marca su estado
//                 (Cerrado / En curso / Estimado).
//   2. Detalle  — por mes → por proyecto, con subtotal por mes.
// ════════════════════════════════════════════════════════════════════════════

// Paleta de marca — sincronizada con app/globals.css, pacing.xlsx y
// export.xlsx/route.ts.
const ACCENT = "FF7A1F3D";
const ACCENT_SOFT = "FFF5E6EC";
const INK = "FF1C1917";
const WHITE = "FFFFFFFF";
const BORDER = "FFD6D3D1";
const MUTED = "FF78716C";
const SUCCESS = "FF15803D";

const thin = { style: "thin" as const, color: { argb: BORDER } };
const allBorders = { top: thin, left: thin, bottom: thin, right: thin };

const USD_FMT = '"$"#,##0.00';

export function monthStateLabel(
  month: string,
  current: string,
  es: boolean,
): string {
  if (month < current) return es ? "Cerrado" : "Closed";
  if (month === current) return es ? "En curso" : "Current";
  return es ? "Estimado" : "Estimate";
}

export function buildEstimateWorkbook(
  estimates: MonthlyBillingEstimate[],
  opts: { lang: Language; clientName: string; currentMonth: string },
): ExcelJS.Workbook {
  // Orden cronológico (la selección del filtro puede venir en cualquier orden).
  const sorted = [...estimates].sort((a, b) => a.month.localeCompare(b.month));

  const wb = new ExcelJS.Workbook();
  wb.creator = "Sangria Dashboard";
  wb.created = new Date();

  buildResumenSheet(wb, sorted, opts);
  buildDetalleSheet(wb, sorted, opts);
  return wb;
}

// ── Estilos de celdas ─────────────────────────────────────────────────────────

function fillRow(row: ExcelJS.Row, cols: number, argb: string, white = false) {
  for (let c = 1; c <= cols; c++) {
    const cell = row.getCell(c);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
    cell.font = { bold: true, ...(white ? { color: { argb: WHITE } } : {}) };
    cell.border = allBorders;
  }
}

// Banner de título + (opcional) pares de metadata + logo. Devuelve la fila
// libre siguiente (para el header de la tabla).
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

function usdCell(row: ExcelJS.Row, col: number, value: number, argb?: string) {
  const cell = row.getCell(col);
  cell.value = value;
  cell.numFmt = USD_FMT;
  cell.border = allBorders;
  if (argb) cell.font = { color: { argb } };
}

// ── Hoja 1 — Resumen mensual ──────────────────────────────────────────────────

function buildResumenSheet(
  wb: ExcelJS.Workbook,
  estimates: MonthlyBillingEstimate[],
  opts: { lang: Language; clientName: string; currentMonth: string },
) {
  const { lang, clientName, currentMonth } = opts;
  const es = lang === "es";
  const ws = wb.addWorksheet(es ? "Resumen" : "Summary");
  const totalCols = 7;
  ws.columns = [
    { width: 22 }, // Mes
    { width: 12 }, // Estado
    { width: 16 }, // Media (est.)
    { width: 16 }, // Fees (est.)
    { width: 16 }, // Bruto (est.)
    { width: 17 }, // Facturado real
    { width: 16 }, // Neto (falta)
  ];

  const headerEnd = brandHeader(
    ws,
    wb,
    `${es ? "ESTIMACIÓN DE FACTURACIÓN" : "BILLING ESTIMATE"} · ${clientName}`,
    [
      [es ? "Cliente" : "Client", clientName],
      [es ? "Meses" : "Months", estimates.length],
      [es ? "Generado" : "Generated", formatMonth(currentMonth, lang)],
    ],
    totalCols,
  );

  ws.views = [{ state: "frozen", ySplit: headerEnd }];
  tableHeader(ws, headerEnd, [
    es ? "Mes" : "Month",
    es ? "Estado" : "Status",
    "Media (est.)",
    "Fees (est.)",
    es ? "Bruto (est.)" : "Gross (est.)",
    es ? "Facturado real" : "Actual invoiced",
    es ? "Neto (falta)" : "Net (pending)",
  ]);

  let r = headerEnd + 1;
  let media = 0;
  let fees = 0;
  let gross = 0;
  let billed = 0;
  let net = 0;

  for (const e of estimates) {
    const row = ws.getRow(r);
    row.getCell(1).value = formatMonth(e.month, lang);
    row.getCell(1).border = allBorders;
    row.getCell(2).value = monthStateLabel(e.month, currentMonth, es);
    row.getCell(2).border = allBorders;
    usdCell(row, 3, e.grossMediaUsd);
    usdCell(row, 4, e.grossFeesUsd);
    usdCell(row, 5, e.grossUsd);
    usdCell(row, 6, e.alreadyBilledUsd, SUCCESS);
    usdCell(row, 7, e.netUsd);
    media += e.grossMediaUsd;
    fees += e.grossFeesUsd;
    gross += e.grossUsd;
    billed += e.alreadyBilledUsd;
    net += e.netUsd;
    r++;
  }

  const totalRow = ws.getRow(r);
  totalRow.getCell(1).value = "TOTAL";
  usdCell(totalRow, 3, media);
  usdCell(totalRow, 4, fees);
  usdCell(totalRow, 5, gross);
  usdCell(totalRow, 6, billed);
  usdCell(totalRow, 7, net);
  fillRow(totalRow, totalCols, INK, true);
  totalRow.height = 22;

  const noteRow = ws.getRow(r + 2);
  noteRow.getCell(1).value = es
    ? "Bruto = media + fees prorrateados de planes approved/ready. Facturado real = lo emitido (facturado/pagado) ese mes. Neto = bruto − facturado."
    : "Gross = prorated media + fees from approved/ready plans. Actual invoiced = issued (invoiced/paid) that month. Net = gross − invoiced.";
  noteRow.getCell(1).font = { italic: true, color: { argb: MUTED }, size: 9 };
  noteRow.getCell(1).alignment = { wrapText: true, vertical: "top" };
  ws.mergeCells(r + 2, 1, r + 2, totalCols);
  noteRow.height = 28;
}

// ── Hoja 2 — Detalle por proyecto ─────────────────────────────────────────────

function buildDetalleSheet(
  wb: ExcelJS.Workbook,
  estimates: MonthlyBillingEstimate[],
  opts: { lang: Language; clientName: string; currentMonth: string },
) {
  const { lang, clientName, currentMonth } = opts;
  const es = lang === "es";
  const ws = wb.addWorksheet(es ? "Detalle" : "Detail");
  const totalCols = 6;
  ws.columns = [
    { width: 34 }, // Proyecto
    { width: 16 }, // Media (est.)
    { width: 16 }, // Fees (est.)
    { width: 16 }, // Bruto (est.)
    { width: 17 }, // Facturado real
    { width: 16 }, // Neto
  ];

  const headerEnd = brandHeader(
    ws,
    wb,
    `${es ? "ESTIMACIÓN — DETALLE POR PROYECTO" : "ESTIMATE — DETAIL BY PROJECT"} · ${clientName}`,
    [],
    totalCols,
  );

  ws.views = [{ state: "frozen", ySplit: headerEnd, xSplit: 1 }];
  tableHeader(ws, headerEnd, [
    es ? "Proyecto" : "Project",
    "Media (est.)",
    "Fees (est.)",
    es ? "Bruto (est.)" : "Gross (est.)",
    es ? "Facturado real" : "Actual invoiced",
    es ? "Neto (falta)" : "Net (pending)",
  ]);

  let r = headerEnd + 1;

  for (const e of estimates) {
    // Banner del mes (todo el ancho).
    const monthRow = ws.getRow(r);
    monthRow.getCell(1).value = `${formatMonth(e.month, lang)} · ${monthStateLabel(e.month, currentMonth, es)}`;
    monthRow.getCell(1).font = { bold: true, color: { argb: WHITE }, size: 12 };
    monthRow.getCell(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: ACCENT },
    };
    monthRow.getCell(1).alignment = { vertical: "middle", horizontal: "left" };
    ws.mergeCells(r, 1, r, totalCols);
    monthRow.height = 22;
    r++;

    if (e.byProject.length === 0) {
      const row = ws.getRow(r);
      row.getCell(1).value = es
        ? "(sin facturación ni planes activos este mes)"
        : "(no invoicing or active plans this month)";
      row.getCell(1).font = { italic: true, color: { argb: MUTED } };
      row.getCell(1).alignment = { indent: 1, vertical: "middle" };
      for (let c = 1; c <= totalCols; c++) row.getCell(c).border = allBorders;
      r += 2; // fila + aire entre meses
      continue;
    }

    for (const p of e.byProject) {
      const row = ws.getRow(r);
      row.getCell(1).value = `${p.projectName} · ${p.projectCode}`;
      row.getCell(1).alignment = { indent: 1, vertical: "middle", wrapText: true };
      row.getCell(1).border = allBorders;
      usdCell(row, 2, p.grossMediaUsd);
      usdCell(row, 3, p.grossFeesUsd);
      usdCell(row, 4, p.grossUsd);
      usdCell(row, 5, p.alreadyBilledUsd, SUCCESS);
      usdCell(row, 6, p.netUsd);
      r++;
    }

    // Subtotal del mes.
    const subRow = ws.getRow(r);
    subRow.getCell(1).value = es ? "Subtotal mes" : "Month subtotal";
    usdCell(subRow, 2, e.grossMediaUsd);
    usdCell(subRow, 3, e.grossFeesUsd);
    usdCell(subRow, 4, e.grossUsd);
    usdCell(subRow, 5, e.alreadyBilledUsd);
    usdCell(subRow, 6, e.netUsd);
    fillRow(subRow, totalCols, ACCENT_SOFT);
    subRow.getCell(1).alignment = { vertical: "middle", horizontal: "left" };
    subRow.height = 20;
    r += 2; // subtotal + aire entre meses
  }
}
