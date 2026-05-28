import ExcelJS from "exceljs";
import { getBrandLogo } from "@/lib/brand-logo";
import {
  getHistoricalReport,
  type HistoricalReportFilters,
} from "@/db/queries/historical-report";
import { resolveClientFromSearchParams } from "@/lib/client-filter.server";
import { DEFAULT_LANGUAGE, formatDate, type Language, t } from "@/lib/i18n";

// Paleta de marca (idéntica al export de plan).
const ACCENT = "FF7A1F3D";
const ACCENT_SOFT = "FFF5E6EC";
const WHITE = "FFFFFFFF";
const BORDER = "FFD6D3D1";
const MUTED = "FF78716C";

const thin = { style: "thin" as const, color: { argb: BORDER } };
const allBorders = { top: thin, left: thin, bottom: thin, right: thin };

function metricNumFmt(unit: string | null): string {
  if (unit === "%") return "0.00%";
  if (unit === "$") return '"$"#,##0.0000';
  return "#,##0";
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sp = Object.fromEntries(url.searchParams);
  // El filtro de cliente respeta el global (?client=slug). Resolvemos a id.
  const client = await resolveClientFromSearchParams(sp);
  const lang: Language = client?.language ?? DEFAULT_LANGUAGE;

  const filters: HistoricalReportFilters = {
    clientId: client?.id ?? null,
    budgetOriginId: url.searchParams.get("origin") || null,
    projectId: url.searchParams.get("project") || null,
    planId: url.searchParams.get("plan") || null,
    placementId: url.searchParams.get("placement") || null,
    fromMonth: url.searchParams.get("from") || null,
    toMonth: url.searchParams.get("to") || null,
  };

  const { rows, metricColumns } = await getHistoricalReport(filters);

  // ── Workbook ────────────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  wb.creator = "Sangria Dashboard";
  wb.created = new Date();

  const sheetTitle = lang === "es" ? "Reporte histórico" : "Historical report";
  const ws = wb.addWorksheet(sheetTitle);

  // Columnas base + métricas dinámicas.
  const baseHeaders = [
    lang === "es" ? "Cliente" : "Client",
    lang === "es" ? "Proyecto" : "Project",
    "Code",
    "Budget Origin",
    "Plan",
    "Publisher",
    "Placement",
    lang === "es" ? "Mercado" : "Market",
    lang === "es" ? "Cost method" : "Cost method",
    lang === "es" ? "Inicio" : "Start",
    lang === "es" ? "Fin" : "End",
    lang === "es" ? "Audiencia" : "Audience",
    lang === "es" ? "Planeado (USD)" : "Planned (USD)",
    lang === "es" ? "Facturado share (USD)" : "Billed share (USD)",
  ];
  const metricHeaders = metricColumns.map((m) => m.name);
  const allHeaders = [...baseHeaders, ...metricHeaders];
  const totalCols = allHeaders.length;

  ws.columns = [
    { width: 22 }, // cliente
    { width: 28 }, // proyecto
    { width: 16 }, // code
    { width: 18 }, // budget origin
    { width: 24 }, // plan
    { width: 20 }, // publisher
    { width: 32 }, // placement
    { width: 14 }, // mercado
    { width: 12 }, // cost method
    { width: 12 }, // start
    { width: 12 }, // end
    { width: 36 }, // audience
    { width: 16 }, // planeado
    { width: 16 }, // billed
    ...metricColumns.map(() => ({ width: 14 })),
  ];

  // ── Banner ──────────────────────────────────────────────────────────────
  const titleRow = ws.getRow(1);
  titleRow.getCell(1).value =
    lang === "es"
      ? "REPORTE HISTÓRICO DE CAMPAÑA"
      : "CAMPAIGN HISTORICAL REPORT";
  titleRow.getCell(1).font = { bold: true, color: { argb: WHITE }, size: 14 };
  titleRow.getCell(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: ACCENT },
  };
  titleRow.getCell(1).alignment = { vertical: "middle", horizontal: "left" };
  ws.mergeCells(1, 1, 1, totalCols);
  titleRow.height = 26;

  // Header con filtros aplicados.
  const meta: [string, string][] = [
    [
      lang === "es" ? "Cliente" : "Client",
      client?.name ?? (lang === "es" ? "Todos" : "All"),
    ],
    [
      lang === "es" ? "Período" : "Period",
      filters.fromMonth || filters.toMonth
        ? `${filters.fromMonth ?? "—"} → ${filters.toMonth ?? "—"}`
        : lang === "es"
          ? "Todo"
          : "All",
    ],
    [
      lang === "es" ? "Filas" : "Rows",
      String(rows.length),
    ],
    [
      t("common.generated", lang),
      formatDate(new Date().toISOString().slice(0, 10), lang),
    ],
  ];
  meta.forEach(([label, value], i) => {
    const r = ws.getRow(i + 2);
    r.getCell(1).value = label;
    r.getCell(1).font = { bold: true, color: { argb: WHITE } };
    r.getCell(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: ACCENT },
    };
    r.getCell(1).alignment = { vertical: "middle", horizontal: "left" };
    r.getCell(2).value = value;
    r.getCell(2).font = { bold: true };
    ws.mergeCells(i + 2, 2, i + 2, totalCols);
    r.height = 18;
  });

  // Logo arriba a la derecha (mismo patrón que export de plan).
  const logo = getBrandLogo();
  if (logo) {
    const imageId = wb.addImage({
      base64: logo.bytes.toString("base64"),
      extension: logo.type === "png" ? "png" : "jpeg",
    });
    const boxW = 130;
    const boxH = 50;
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

  const headerEndRow = meta.length + 1;
  const tableHeaderRow = headerEndRow + 2;
  ws.views = [{ state: "frozen", ySplit: tableHeaderRow }];

  // ── Header de la tabla ──────────────────────────────────────────────────
  const hdr = ws.getRow(tableHeaderRow);
  allHeaders.forEach((label, i) => {
    const c = hdr.getCell(i + 1);
    c.value = label;
    c.font = { bold: true, color: { argb: WHITE } };
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: ACCENT },
    };
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    c.border = allBorders;
  });
  hdr.height = 28;

  // ── Filas ───────────────────────────────────────────────────────────────
  let cur = tableHeaderRow + 1;
  for (const r of rows) {
    const row = ws.getRow(cur);
    let c = 1;
    row.getCell(c++).value = r.clientName;
    row.getCell(c++).value = r.projectName;
    row.getCell(c++).value = r.projectCode;
    row.getCell(c++).value = r.budgetOriginName;
    row.getCell(c++).value = r.planName;
    row.getCell(c++).value = r.publisherName;
    row.getCell(c++).value = r.placementName;
    row.getCell(c++).value = r.marketName ?? "";
    row.getCell(c++).value = r.costMethod ?? "";
    row.getCell(c++).value = r.startDate ?? "";
    row.getCell(c++).value = r.endDate ?? "";
    row.getCell(c).value = r.audience ?? "";
    row.getCell(c).alignment = { wrapText: true, vertical: "top" };
    c++;
    const plannedCell = row.getCell(c++);
    plannedCell.value = r.plannedUsd;
    plannedCell.numFmt = '"$"#,##0.00';
    const billedCell = row.getCell(c++);
    billedCell.value = r.billedShareUsd;
    billedCell.numFmt = '"$"#,##0.00';
    for (const mc of metricColumns) {
      const cell = row.getCell(c++);
      const v = r.trackedMetrics[mc.slug];
      if (v != null && Number.isFinite(v)) {
        cell.value = v;
        cell.numFmt = metricNumFmt(mc.unit);
      }
    }
    for (let i = 1; i <= totalCols; i++) row.getCell(i).border = allBorders;
    cur++;
  }

  if (rows.length === 0) {
    const empty = ws.getRow(cur);
    empty.getCell(1).value =
      lang === "es"
        ? "Sin datos históricos para los filtros aplicados"
        : "No historical data for the applied filters";
    empty.getCell(1).font = { italic: true, color: { argb: MUTED } };
    ws.mergeCells(cur, 1, cur, totalCols);
  }

  // ── Output ──────────────────────────────────────────────────────────────
  const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  const stamp = new Date().toISOString().slice(0, 10);
  const filename =
    `reporte-historico-${client?.slug ?? "all"}-${stamp}.xlsx`.replace(
      /[^A-Za-z0-9._-]+/g,
      "_",
    );

  // Silenciar warning de constante no usada en Excel sin filas (fill ACCENT_SOFT
  // se podría usar para subtotales en próxima iteración).
  void ACCENT_SOFT;

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
