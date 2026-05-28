import ExcelJS from "exceljs";
import { getBrandLogo } from "@/lib/brand-logo";
import {
  getHistoricalReport,
  getReportFilterOptions,
  type HistoricalReportFilters,
} from "@/db/queries/historical-report";
import { resolveClientFromSearchParams } from "@/lib/client-filter.server";
import {
  identityLabel,
  moneyLabel,
  parseColsParam,
  resolveReportColumns,
  type IdentityColId,
} from "@/lib/historical-report-columns";
import { DEFAULT_LANGUAGE, formatDate, type Language, t } from "@/lib/i18n";

// Paleta de marca (idéntica al export de plan).
const ACCENT = "FF7A1F3D";
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

// Ancho aproximado para cada columna de identidad (chars en Excel).
const IDENTITY_WIDTHS: Record<IdentityColId, number> = {
  client: 22,
  project: 28,
  budgetOrigin: 18,
  plan: 24,
  publisher: 20,
  placement: 32,
  market: 14,
  costMethod: 12,
  dates: 22,
  audience: 36,
};

function identityCellValue(
  id: IdentityColId,
  r: Awaited<ReturnType<typeof getHistoricalReport>>["rows"][number],
  lang: Language,
): string {
  switch (id) {
    case "client":
      return r.clientName;
    case "project":
      return `${r.projectName} · ${r.projectCode}`;
    case "budgetOrigin":
      return r.budgetOriginName;
    case "plan":
      return r.planName;
    case "publisher":
      return r.publisherName;
    case "placement":
      return r.placementName;
    case "market":
      return r.marketName ?? "";
    case "costMethod":
      return r.costMethod ?? "";
    case "dates":
      if (!r.startDate && !r.endDate) return "";
      return `${formatDate(r.startDate, lang)} → ${formatDate(r.endDate, lang)}`;
    case "audience":
      return r.audience ?? "";
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sp = Object.fromEntries(url.searchParams);
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

  const [options, report] = await Promise.all([
    getReportFilterOptions(client?.id ?? null),
    getHistoricalReport(filters),
  ]);

  const selectedCols = parseColsParam(url.searchParams.get("cols"));
  const cols = resolveReportColumns(
    selectedCols,
    options.metrics,
    report.metricColumns,
  );

  // ── Workbook ────────────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  wb.creator = "Sangria Dashboard";
  wb.created = new Date();

  const sheetTitle = lang === "es" ? "Reporte histórico" : "Historical report";
  const ws = wb.addWorksheet(sheetTitle);

  const headers: string[] = [
    ...cols.identity.map((id) => identityLabel(id, lang)),
    ...cols.money.map((id) => moneyLabel(id, lang)),
    ...cols.metrics.map((m) => m.name),
  ];
  const totalCols = headers.length;

  ws.columns = [
    ...cols.identity.map((id) => ({ width: IDENTITY_WIDTHS[id] })),
    ...cols.money.map(() => ({ width: 18 })),
    ...cols.metrics.map(() => ({ width: 14 })),
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
  if (totalCols >= 2) ws.mergeCells(1, 1, 1, totalCols);
  titleRow.height = 26;

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
    [lang === "es" ? "Filas" : "Rows", String(report.rows.length)],
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
    if (totalCols >= 2) ws.mergeCells(i + 2, 2, i + 2, totalCols);
    r.height = 18;
  });

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
  headers.forEach((label, i) => {
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
  for (const r of report.rows) {
    const row = ws.getRow(cur);
    let c = 1;
    for (const id of cols.identity) {
      const cell = row.getCell(c++);
      cell.value = identityCellValue(id, r, lang);
      if (id === "audience" || id === "project") {
        cell.alignment = { wrapText: true, vertical: "top" };
      }
    }
    for (const id of cols.money) {
      const cell = row.getCell(c++);
      cell.value = id === "planned" ? r.plannedUsd : r.billedShareUsd;
      cell.numFmt = '"$"#,##0.00';
    }
    for (const m of cols.metrics) {
      const cell = row.getCell(c++);
      const v = r.trackedMetrics[m.slug];
      if (v != null && Number.isFinite(v)) {
        cell.value = v;
        cell.numFmt = metricNumFmt(m.unit);
      }
    }
    for (let i = 1; i <= totalCols; i++) row.getCell(i).border = allBorders;
    cur++;
  }

  if (report.rows.length === 0) {
    const empty = ws.getRow(cur);
    empty.getCell(1).value =
      lang === "es"
        ? "Sin datos históricos para los filtros aplicados"
        : "No historical data for the applied filters";
    empty.getCell(1).font = { italic: true, color: { argb: MUTED } };
    if (totalCols >= 2) ws.mergeCells(cur, 1, cur, totalCols);
  }

  const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  const stamp = new Date().toISOString().slice(0, 10);
  const filename =
    `reporte-historico-${client?.slug ?? "all"}-${stamp}.xlsx`.replace(
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
