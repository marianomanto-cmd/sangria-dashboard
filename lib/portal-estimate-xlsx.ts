import ExcelJS from "exceljs";
import { getBrandLogo } from "@/lib/brand-logo";
import type {
  MonthlyBillingEstimate,
  ProjectBillingProjection,
} from "@/db/queries/dashboard";
import { billingStatusLabel } from "@/components/billing-status-badge";
import { formatMonth, formatMonthShort, t, type Language } from "@/lib/i18n";

// ════════════════════════════════════════════════════════════════════════════
// Armado del Excel de la tab ESTIMACIÓN del portal. Lo usa el thin handler
// app/api/portal/estimate.xlsx/route.ts. Refleja EXACTAMENTE lo que se ve en
// pantalla, con el look de marca del plan de medios. Tres hojas:
//   1. Resumen    — una fila por mes. Header agrupado en dos filas: ESTIMACIÓN
//                   (media · fees · bruto) · FACTURADO REAL (media · fees ·
//                   bruto) · neto a facturar + TOTAL. Cada mes marca su estado
//                   (Cerrado / En curso / Estimado).
//   2. Detalle    — por mes → por proyecto, mismo desglose (est. + real), con
//                   subtotal por mes.
//   3. Proyección — espeja el desplegable de cada proyecto: por proyecto →
//                   plan, Total / Facturado / Falta facturar, las facturas
//                   emitidas y la proyección de lo que falta por mes restante.
//                   El detalle de cada plan queda colapsable (outline).
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
  projections: ProjectBillingProjection[],
  opts: { lang: Language; clientName: string; currentMonth: string },
): ExcelJS.Workbook {
  // Orden cronológico (la selección del filtro puede venir en cualquier orden).
  const sorted = [...estimates].sort((a, b) => a.month.localeCompare(b.month));
  // Proyección: los proyectos con más por facturar primero (lo más accionable).
  const sortedProjections = [...projections].sort(
    (a, b) => b.remainingUsd - a.remainingUsd,
  );

  const wb = new ExcelJS.Workbook();
  wb.creator = "Sangria Dashboard";
  wb.created = new Date();

  buildResumenSheet(wb, sorted, opts);
  buildDetalleSheet(wb, sorted, opts);
  buildProyeccionSheet(wb, sortedProjections, opts);
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

// Header de tabla agrupado en dos filas. Cada columna raíz es:
//   - { label }              → columna simple; ocupa las dos filas (merge vert.)
//   - { group, subs: [...] } → grupo; el label va arriba (merge horizontal
//                              sobre sus sub-columnas) y cada sub-label abajo.
// Con esto ESTIMACIÓN y FACTURADO REAL abren cada uno sus columnas media/fees/
// bruto. Devuelve la primera fila de datos (rowIdx + 2).
type HeaderCol = { label: string } | { group: string; subs: string[] };

function groupedHeader(
  ws: ExcelJS.Worksheet,
  rowIdx: number,
  cols: HeaderCol[],
): number {
  const top = ws.getRow(rowIdx);
  const bottom = ws.getRow(rowIdx + 1);
  const style = (cell: ExcelJS.Cell) => {
    cell.font = { bold: true, color: { argb: WHITE } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ACCENT } };
    cell.alignment = {
      vertical: "middle",
      horizontal: "center",
      wrapText: true,
    };
    cell.border = allBorders;
  };

  let c = 1;
  for (const col of cols) {
    if ("label" in col) {
      style(top.getCell(c));
      style(bottom.getCell(c));
      top.getCell(c).value = col.label;
      ws.mergeCells(rowIdx, c, rowIdx + 1, c);
      c++;
    } else {
      const start = c;
      const end = c + col.subs.length - 1;
      for (let k = start; k <= end; k++) style(top.getCell(k));
      top.getCell(start).value = col.group;
      ws.mergeCells(rowIdx, start, rowIdx, end);
      col.subs.forEach((sub, i) => {
        style(bottom.getCell(start + i));
        bottom.getCell(start + i).value = sub;
      });
      c = end + 1;
    }
  }
  top.height = 22;
  bottom.height = 24;
  return rowIdx + 2;
}

// Header de tabla simple (una fila), estilo banner de marca. Lo usa la hoja
// Proyección para el encabezado de la tabla de planes de cada proyecto.
function simpleHeader(ws: ExcelJS.Worksheet, rowIdx: number, labels: string[]) {
  const row = ws.getRow(rowIdx);
  labels.forEach((label, i) => {
    const cell = row.getCell(i + 1);
    cell.value = label;
    cell.font = { bold: true, color: { argb: WHITE } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ACCENT } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = allBorders;
  });
  row.height = 24;
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
  const totalCols = 9;
  ws.columns = [
    { width: 22 }, // Mes
    { width: 12 }, // Estado
    { width: 15 }, // Estimación · Media
    { width: 15 }, // Estimación · Fees
    { width: 15 }, // Estimación · Bruto
    { width: 15 }, // Facturado real · Media
    { width: 15 }, // Facturado real · Fees
    { width: 15 }, // Facturado real · Bruto
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

  const bruto = es ? "Bruto" : "Gross";
  const dataStart = groupedHeader(ws, headerEnd, [
    { label: es ? "Mes" : "Month" },
    { label: es ? "Estado" : "Status" },
    { group: es ? "Estimación" : "Estimate", subs: ["Media", "Fees", bruto] },
    {
      group: es ? "Facturado real" : "Actual invoiced",
      subs: ["Media", "Fees", bruto],
    },
    { label: es ? "Neto (falta)" : "Net (pending)" },
  ]);

  ws.views = [{ state: "frozen", ySplit: dataStart - 1 }];

  let r = dataStart;
  let media = 0;
  let fees = 0;
  let gross = 0;
  let billedMedia = 0;
  let billedFees = 0;
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
    usdCell(row, 6, e.alreadyBilledMediaUsd, SUCCESS);
    usdCell(row, 7, e.alreadyBilledFeesUsd, SUCCESS);
    usdCell(row, 8, e.alreadyBilledUsd, SUCCESS);
    usdCell(row, 9, e.netUsd);
    media += e.grossMediaUsd;
    fees += e.grossFeesUsd;
    gross += e.grossUsd;
    billedMedia += e.alreadyBilledMediaUsd;
    billedFees += e.alreadyBilledFeesUsd;
    billed += e.alreadyBilledUsd;
    net += e.netUsd;
    r++;
  }

  const totalRow = ws.getRow(r);
  totalRow.getCell(1).value = "TOTAL";
  usdCell(totalRow, 3, media);
  usdCell(totalRow, 4, fees);
  usdCell(totalRow, 5, gross);
  usdCell(totalRow, 6, billedMedia);
  usdCell(totalRow, 7, billedFees);
  usdCell(totalRow, 8, billed);
  usdCell(totalRow, 9, net);
  fillRow(totalRow, totalCols, INK, true);
  totalRow.height = 22;

  const noteRow = ws.getRow(r + 2);
  noteRow.getCell(1).value = es
    ? "Bruto = media + fees prorrateados de planes approved/ready. Facturado real (media · fees · bruto) = lo emitido (facturado/pagado) ese mes. Neto = bruto − facturado."
    : "Gross = prorated media + fees from approved/ready plans. Actual invoiced (media · fees · gross) = issued (invoiced/paid) that month. Net = gross − invoiced.";
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
  const totalCols = 8;
  ws.columns = [
    { width: 34 }, // Proyecto
    { width: 15 }, // Estimación · Media
    { width: 15 }, // Estimación · Fees
    { width: 15 }, // Estimación · Bruto
    { width: 15 }, // Facturado real · Media
    { width: 15 }, // Facturado real · Fees
    { width: 15 }, // Facturado real · Bruto
    { width: 16 }, // Neto
  ];

  const headerEnd = brandHeader(
    ws,
    wb,
    `${es ? "ESTIMACIÓN — DETALLE POR PROYECTO" : "ESTIMATE — DETAIL BY PROJECT"} · ${clientName}`,
    [],
    totalCols,
  );

  const bruto = es ? "Bruto" : "Gross";
  const dataStart = groupedHeader(ws, headerEnd, [
    { label: es ? "Proyecto" : "Project" },
    { group: es ? "Estimación" : "Estimate", subs: ["Media", "Fees", bruto] },
    {
      group: es ? "Facturado real" : "Actual invoiced",
      subs: ["Media", "Fees", bruto],
    },
    { label: es ? "Neto (falta)" : "Net (pending)" },
  ]);

  ws.views = [{ state: "frozen", ySplit: dataStart - 1, xSplit: 1 }];

  let r = dataStart;

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
      usdCell(row, 5, p.alreadyBilledMediaUsd, SUCCESS);
      usdCell(row, 6, p.alreadyBilledFeesUsd, SUCCESS);
      usdCell(row, 7, p.alreadyBilledUsd, SUCCESS);
      usdCell(row, 8, p.netUsd);
      r++;
    }

    // Subtotal del mes.
    const subRow = ws.getRow(r);
    subRow.getCell(1).value = es ? "Subtotal mes" : "Month subtotal";
    usdCell(subRow, 2, e.grossMediaUsd);
    usdCell(subRow, 3, e.grossFeesUsd);
    usdCell(subRow, 4, e.grossUsd);
    usdCell(subRow, 5, e.alreadyBilledMediaUsd);
    usdCell(subRow, 6, e.alreadyBilledFeesUsd);
    usdCell(subRow, 7, e.alreadyBilledUsd);
    usdCell(subRow, 8, e.netUsd);
    fillRow(subRow, totalCols, ACCENT_SOFT);
    subRow.getCell(1).alignment = { vertical: "middle", horizontal: "left" };
    subRow.height = 20;
    r += 2; // subtotal + aire entre meses
  }
}

// ── Hoja 3 — Proyección de facturación por plan ──────────────────────────────
// Espeja el desplegable por proyecto de la vista (ProjectProjectionDetail): por
// cada proyecto, sus planes con Total / Facturado / Falta facturar; y anidado
// (colapsable) el detalle de cada plan: las facturas emitidas (su suma reconcilia
// con "Facturado") y la proyección de lo que falta por cada mes restante (su
// suma reconcilia con "Falta facturar"). Forward-looking: ignora el filtro de
// Mes, igual que la vista (horizonte = meses restantes de cada plan).

function buildProyeccionSheet(
  wb: ExcelJS.Workbook,
  projections: ProjectBillingProjection[],
  opts: { lang: Language; clientName: string; currentMonth: string },
) {
  const { lang, clientName, currentMonth } = opts;
  const es = lang === "es";
  const ws = wb.addWorksheet(es ? "Proyección" : "Projection");
  // El control +/- para colapsar el detalle de un plan queda sobre la fila de
  // resumen del plan (que va ARRIBA de su detalle).
  ws.properties.outlineProperties = { summaryBelow: false, summaryRight: false };

  const totalCols = 5;
  ws.columns = [
    { width: 42 }, // Plan · período / detalle (facturas, meses)
    { width: 15 }, // Estado
    { width: 16 }, // Total
    { width: 16 }, // Facturado
    { width: 16 }, // Falta facturar
  ];

  const headerEnd = brandHeader(
    ws,
    wb,
    `${es ? "ESTIMACIÓN — PROYECCIÓN DE FACTURACIÓN" : "ESTIMATE — BILLING PROJECTION"} · ${clientName}`,
    [
      [es ? "Cliente" : "Client", clientName],
      [es ? "Proyectos" : "Projects", projections.length],
      [es ? "Generado" : "Generated", formatMonth(currentMonth, lang)],
    ],
    totalCols,
  );

  // Congelamos solo el bloque de marca (título + metadata); la nota y la tabla
  // scrollean.
  ws.views = [{ state: "frozen", ySplit: headerEnd - 1 }];

  // Nota de contexto: la hoja es forward-looking e ignora el filtro de Mes.
  const noteRow = ws.getRow(headerEnd);
  noteRow.getCell(1).value = es
    ? "Facturación restante por plan: total a facturar, ya facturado (facturas emitidas) y lo que falta, prorrateado por cada mes que le queda al plan. Horizonte = meses restantes de cada plan (no depende del filtro de Mes)."
    : "Remaining billing per plan: total to invoice, already invoiced (issued invoices) and what's left, prorated across each remaining month of the plan. Horizon = each plan's remaining months (independent of the Month filter).";
  noteRow.getCell(1).font = { italic: true, color: { argb: MUTED }, size: 9 };
  noteRow.getCell(1).alignment = { wrapText: true, vertical: "top" };
  ws.mergeCells(headerEnd, 1, headerEnd, totalCols);
  noteRow.height = 30;

  let r = headerEnd + 2; // fila de aire tras la nota

  if (projections.length === 0) {
    const row = ws.getRow(r);
    row.getCell(1).value = es
      ? "(sin planes approved/ready para proyectar)"
      : "(no approved/ready plans to project)";
    row.getCell(1).font = { italic: true, color: { argb: MUTED } };
    row.getCell(1).alignment = { indent: 1, vertical: "middle" };
    for (let c = 1; c <= totalCols; c++) row.getCell(c).border = allBorders;
    return;
  }

  for (const proj of projections) {
    // Banner del proyecto (todo el ancho).
    const bannerRow = ws.getRow(r);
    bannerRow.getCell(1).value = `${proj.projectName} · ${proj.projectCode}`;
    bannerRow.getCell(1).font = { bold: true, color: { argb: WHITE }, size: 12 };
    bannerRow.getCell(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: ACCENT },
    };
    bannerRow.getCell(1).alignment = { vertical: "middle", horizontal: "left" };
    ws.mergeCells(r, 1, r, totalCols);
    bannerRow.height = 22;
    r++;

    // Header de la tabla de planes del proyecto.
    simpleHeader(ws, r, [
      "Plan",
      es ? "Estado" : "Status",
      es ? "Total" : "Total",
      es ? "Facturado" : "Invoiced",
      es ? "Falta facturar" : "Left to invoice",
    ]);
    r++;

    for (const plan of proj.plans) {
      // Fila resumen del plan (estilo subtotal). Su detalle va anidado abajo y
      // colapsable bajo esta fila.
      const period =
        plan.periodStart && plan.periodEnd
          ? `${formatMonthShort(plan.periodStart.slice(0, 7), lang)} – ${formatMonthShort(plan.periodEnd.slice(0, 7), lang)}`
          : "—";
      const planRow = ws.getRow(r);
      planRow.getCell(1).value = `${plan.planName} · ${period}`;
      planRow.getCell(2).value = t(`status.${plan.status}`, lang);
      usdCell(planRow, 3, plan.grossUsd);
      usdCell(planRow, 4, plan.billedUsd);
      usdCell(planRow, 5, plan.remainingUsd);
      fillRow(planRow, totalCols, ACCENT_SOFT);
      planRow.getCell(1).alignment = {
        vertical: "middle",
        horizontal: "left",
        wrapText: true,
      };
      planRow.getCell(2).alignment = { vertical: "middle", horizontal: "center" };
      planRow.height = 20;
      r++;

      // ── Detalle anidado (outline nivel 1, colapsable bajo la fila del plan) ──

      // Facturas emitidas: número · mes · estado + monto (bajo "Facturado").
      if (plan.invoices.length > 0) {
        const lblRow = ws.getRow(r);
        lblRow.getCell(1).value = es ? "Facturas emitidas" : "Issued invoices";
        lblRow.getCell(1).font = {
          bold: true,
          italic: true,
          color: { argb: MUTED },
          size: 10,
        };
        lblRow.getCell(1).alignment = { indent: 1, vertical: "middle" };
        lblRow.outlineLevel = 1;
        for (let c = 1; c <= totalCols; c++) lblRow.getCell(c).border = allBorders;
        r++;

        for (const inv of plan.invoices) {
          const invRow = ws.getRow(r);
          invRow.getCell(1).value = `${inv.invoiceNumber} · ${formatMonthShort(inv.month, lang)}`;
          invRow.getCell(1).alignment = { indent: 2, vertical: "middle" };
          invRow.getCell(2).value = billingStatusLabel(inv.status, lang);
          invRow.getCell(2).alignment = {
            vertical: "middle",
            horizontal: "center",
          };
          usdCell(invRow, 4, inv.totalUsd, SUCCESS);
          invRow.outlineLevel = 1;
          for (let c = 1; c <= totalCols; c++)
            invRow.getCell(c).border = allBorders;
          r++;
        }
      }

      // Proyección por mes restante: mes + monto (bajo "Falta facturar").
      const projLblRow = ws.getRow(r);
      projLblRow.getCell(1).value = es
        ? "Proyección por mes restante"
        : "Projection per remaining month";
      projLblRow.getCell(1).font = {
        bold: true,
        italic: true,
        color: { argb: MUTED },
        size: 10,
      };
      projLblRow.getCell(1).alignment = { indent: 1, vertical: "middle" };
      projLblRow.outlineLevel = 1;
      for (let c = 1; c <= totalCols; c++)
        projLblRow.getCell(c).border = allBorders;
      r++;

      if (plan.months.length === 0) {
        const noneRow = ws.getRow(r);
        noneRow.getCell(1).value = es
          ? "Sin saldo pendiente de facturar."
          : "Nothing left to invoice.";
        noneRow.getCell(1).font = { italic: true, color: { argb: MUTED } };
        noneRow.getCell(1).alignment = { indent: 2, vertical: "middle" };
        noneRow.outlineLevel = 1;
        for (let c = 1; c <= totalCols; c++)
          noneRow.getCell(c).border = allBorders;
        r++;
      } else {
        for (const m of plan.months) {
          const mRow = ws.getRow(r);
          mRow.getCell(1).value = formatMonth(m.month, lang);
          mRow.getCell(1).alignment = { indent: 2, vertical: "middle" };
          usdCell(mRow, 5, m.projectedUsd);
          mRow.outlineLevel = 1;
          for (let c = 1; c <= totalCols; c++) mRow.getCell(c).border = allBorders;
          r++;
        }
      }
    }

    r++; // aire entre proyectos
  }
}
