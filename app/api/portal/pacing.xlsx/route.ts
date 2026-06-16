import ExcelJS from "exceljs";
import { getBrandLogo } from "@/lib/brand-logo";
import {
  getCampaignTrackerPlan,
  type CampaignTrackerPlan,
  type TrackerPlacement,
} from "@/db/queries/campaign-tracker";
import { canAccessClientExport } from "@/lib/client-portal.server";
import { DEFAULT_LANGUAGE, formatDate, type Language } from "@/lib/i18n";
import {
  buildMetricRows,
  CALC_METRICS,
  computePaceStatus,
  DIRECT_METRIC_LABELS,
  type DirectGoal,
  type MetricUnit,
  type PaceStatus,
} from "@/lib/campaign-metrics";

// ════════════════════════════════════════════════════════════════════════════
// Export EJECUTIVO del pacing — CONSOLIDADO de varias campañas a la vez.
//
// El cliente (o un interno) selecciona campañas en el portal (Proyectos) y baja
// UN Excel con el pacing combinado, para presentar a nivel ejecutivo. Tres
// hojas, con el mismo look de marca que el Excel del plan de medios:
//   1. Resumen   — una fila por campaña (goal/real/avance/pace/estado) + total.
//   2. Detalle   — por campaña → publisher → placement, con métricas goal/real
//                  (delivery + derivadas) en columnas (detalle amplio).
//   3. Por mercado — desglose agregado por mercado (goal/real/avance + métricas).
//
// Ruta pública en el proxy (`/api/portal/*`). Barrera real: canAccessClientExport
// (sesión interna O cookie de portal del cliente) + ownership de cada plan.
// ════════════════════════════════════════════════════════════════════════════

export const maxDuration = 60;

// Paleta de marca — sincronizada con app/globals.css y export.xlsx/route.ts.
const ACCENT = "FF7A1F3D";
const ACCENT_SOFT = "FFF5E6EC";
const INK = "FF1C1917";
const WHITE = "FFFFFFFF";
const BORDER = "FFD6D3D1";
const MUTED = "FF78716C";

const thin = { style: "thin" as const, color: { argb: BORDER } };
const allBorders = { top: thin, left: thin, bottom: thin, right: thin };

const USD_FMT = '"$"#,##0.00';
const PCT_FMT = '0"%"'; // valor ya viene ×100

// Tope de planes por export (cada uno son varias queries; evita un export
// gigante que cuelgue la función). Suficiente para una presentación ejecutiva.
const MAX_PLANS = 40;

type MetricCol = { key: string; label: string; unit: MetricUnit };

export async function GET(req: Request) {
  const url = new URL(req.url);
  const clientSlug = (url.searchParams.get("client") ?? "").trim();
  const planIds = (url.searchParams.get("plans") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_PLANS);

  if (!clientSlug || planIds.length === 0) {
    return new Response("Bad request", { status: 400 });
  }
  if (!(await canAccessClientExport(clientSlug))) {
    return new Response("Forbidden", { status: 403 });
  }

  const fetched = await Promise.all(planIds.map((id) => getCampaignTrackerPlan(id)));
  // Solo planes que existen Y pertenecen al cliente pedido (ownership: no se
  // pueden colar ids de otro cliente vía query param).
  const plans = fetched.filter(
    (p): p is CampaignTrackerPlan => !!p && p.client.slug === clientSlug,
  );
  if (plans.length === 0) {
    return new Response("No plans", { status: 404 });
  }

  const lang: Language = plans[0].client.language ?? DEFAULT_LANGUAGE;
  const clientName = plans[0].client.name;
  const metricCols = collectMetricColumns(plans);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Sangria Dashboard";
  wb.created = new Date();

  buildResumenSheet(wb, plans, lang, clientName);
  buildDetalleSheet(wb, plans, lang, metricCols);
  buildPorMercadoSheet(wb, plans, lang, metricCols);

  const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  const today = new Date().toISOString().slice(0, 10);
  const filename = `${clientName}-pacing-${today}.xlsx`.replace(
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

// ── Helpers de métricas ───────────────────────────────────────────────────────

// Orden canónico de las columnas de métricas (delivery directas primero, luego
// derivadas), excluyendo "amount" (va como Goal/Real USD dedicado).
const CANON_ORDER = [
  ...Object.keys(DIRECT_METRIC_LABELS).filter((k) => k !== "amount"),
  ...CALC_METRICS.map((c) => c.key),
];

// Unión de métricas presentes en TODA la selección, ordenadas canónicamente.
function collectMetricColumns(plans: CampaignTrackerPlan[]): MetricCol[] {
  const seen = new Map<string, MetricCol>();
  for (const p of plans)
    for (const pub of p.publishers)
      for (const pl of pub.placements)
        for (const m of pl.metrics) {
          if (m.key === "amount") continue;
          if (!seen.has(m.key))
            seen.set(m.key, { key: m.key, label: m.label, unit: m.unit });
        }
  const ordered: MetricCol[] = [];
  for (const k of CANON_ORDER) {
    const c = seen.get(k);
    if (c) {
      ordered.push(c);
      seen.delete(k);
    }
  }
  for (const c of seen.values()) ordered.push(c);
  return ordered;
}

// Valores de métrica de UN placement, indexados por key.
function placementMetricMap(
  pl: TrackerPlacement,
): Map<string, { goal: number | null; actual: number }> {
  return new Map(pl.metrics.map((m) => [m.key, { goal: m.goal, actual: m.actual }]));
}

// Agregado de métricas sobre un set de placements: suma las directas y RE-DERIVA
// las calculadas (CPM/CTR/…) desde las sumas (igual que los subtotales de la app;
// promediar tarifas estaría mal). Incluye "amount" para poder derivar las que lo
// necesitan.
function aggregateMetricMap(
  placements: TrackerPlacement[],
): Map<string, { goal: number | null; actual: number }> {
  const goalByKey: Record<string, number> = {};
  const actualByKey: Record<string, number> = {};
  for (const pl of placements)
    for (const m of pl.metrics) {
      if (m.kind !== "direct") continue;
      goalByKey[m.key] = (goalByKey[m.key] ?? 0) + (m.goal ?? 0);
      actualByKey[m.key] = (actualByKey[m.key] ?? 0) + m.actual;
    }
  const directGoals: DirectGoal[] = Object.keys(goalByKey).map((k) => ({
    key: k,
    goal: goalByKey[k],
  }));
  const rows = buildMetricRows(directGoals, actualByKey, (_k, f) => f);
  return new Map(rows.map((r) => [r.key, { goal: r.goal, actual: r.actual }]));
}

function metricNumFmt(unit: MetricUnit): string {
  if (unit === "$") return USD_FMT;
  if (unit === "%") return '0.00"%"';
  if (unit === "x") return '0.00"x"';
  return "#,##0";
}

function setMetricCell(
  cell: ExcelJS.Cell,
  unit: MetricUnit,
  value: number | null,
) {
  if (value == null || !Number.isFinite(value)) {
    cell.value = null;
    return;
  }
  cell.value = value;
  cell.numFmt = metricNumFmt(unit);
}

function paceLabel(status: PaceStatus, es: boolean): string {
  if (status === "behind") return es ? "Atrasado" : "Behind";
  if (status === "over_pace") return es ? "Adelantado" : "Ahead";
  return es ? "En ritmo" : "On pace";
}

function progressOf(goal: number, actual: number): number {
  return goal > 0 ? (actual / goal) * 100 : 0;
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

// Banner de título + (opcional) pares de metadata + logo. Devuelve la fila libre
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

  // Logo solo en hojas con metadata (la portada/Resumen); en las demás iría
  // encima del banner de color.
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

function tableHeader(
  ws: ExcelJS.Worksheet,
  rowIdx: number,
  labels: string[],
) {
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

// ── Hoja 1 — Resumen ejecutivo ────────────────────────────────────────────────

function buildResumenSheet(
  wb: ExcelJS.Workbook,
  plans: CampaignTrackerPlan[],
  lang: Language,
  clientName: string,
) {
  const es = lang === "es";
  const ws = wb.addWorksheet(es ? "Resumen" : "Summary");
  const totalCols = 8;
  ws.columns = [
    { width: 26 }, // Proyecto
    { width: 28 }, // Campaña
    { width: 24 }, // Período
    { width: 16 }, // Goal
    { width: 16 }, // Real
    { width: 12 }, // Avance
    { width: 12 }, // Pace
    { width: 14 }, // Estado
  ];

  const headerEnd = brandHeader(
    ws,
    wb,
    `${es ? "PACING — RESUMEN EJECUTIVO" : "PACING — EXECUTIVE SUMMARY"} · ${clientName}`,
    [
      [es ? "Cliente" : "Client", clientName],
      [es ? "Campañas" : "Campaigns", plans.length],
      [
        es ? "Generado" : "Generated",
        formatDate(new Date().toISOString().slice(0, 10), lang),
      ],
    ],
    totalCols,
  );

  ws.views = [{ state: "frozen", ySplit: headerEnd }];
  tableHeader(ws, headerEnd, [
    es ? "Proyecto" : "Project",
    es ? "Campaña" : "Campaign",
    es ? "Período" : "Period",
    "Goal (USD)",
    es ? "Real (USD)" : "Actual (USD)",
    es ? "Avance" : "Progress",
    "Pace",
    es ? "Estado" : "Status",
  ]);

  let r = headerEnd + 1;
  let goalSum = 0;
  let actualSum = 0;

  for (const p of plans) {
    const goal = p.goalInvestmentUsd;
    const actual = p.actualInvestmentUsd;
    const prog = progressOf(goal, actual);
    const status = computePaceStatus(prog, p.pacePct);
    goalSum += goal;
    actualSum += actual;

    const row = ws.getRow(r);
    row.getCell(1).value = p.project.name;
    row.getCell(2).value = p.plan.name;
    row.getCell(3).value =
      p.periodStart && p.periodEnd
        ? `${formatDate(p.periodStart, lang)} → ${formatDate(p.periodEnd, lang)}`
        : "—";
    row.getCell(4).value = goal;
    row.getCell(4).numFmt = USD_FMT;
    row.getCell(5).value = actual;
    row.getCell(5).numFmt = USD_FMT;
    row.getCell(6).value = prog;
    row.getCell(6).numFmt = PCT_FMT;
    row.getCell(7).value = p.pacePct;
    row.getCell(7).numFmt = PCT_FMT;
    row.getCell(8).value = paceLabel(status, es);
    for (let c = 1; c <= totalCols; c++) row.getCell(c).border = allBorders;
    r++;
  }

  const totalRow = ws.getRow(r);
  totalRow.getCell(1).value = "TOTAL";
  totalRow.getCell(4).value = goalSum;
  totalRow.getCell(4).numFmt = USD_FMT;
  totalRow.getCell(5).value = actualSum;
  totalRow.getCell(5).numFmt = USD_FMT;
  totalRow.getCell(6).value = progressOf(goalSum, actualSum);
  totalRow.getCell(6).numFmt = PCT_FMT;
  fillRow(totalRow, totalCols, INK, true);
  totalRow.height = 22;
}

// ── Hoja 2 — Detalle amplio ─────────────────────────────────────────────────

function buildDetalleSheet(
  wb: ExcelJS.Workbook,
  plans: CampaignTrackerPlan[],
  lang: Language,
  metricCols: MetricCol[],
) {
  const es = lang === "es";
  const ws = wb.addWorksheet(es ? "Detalle" : "Detail");
  // Base: label · mercado · goal · real · avance · pace. Luego goal/real por
  // cada métrica.
  const base = 6;
  const totalCols = base + metricCols.length * 2;
  ws.columns = [
    { width: 38 },
    { width: 20 },
    { width: 15 },
    { width: 15 },
    { width: 11 },
    { width: 11 },
    ...metricCols.flatMap(() => [{ width: 14 }, { width: 14 }]),
  ];

  const headerEnd = brandHeader(
    ws,
    wb,
    es ? "PACING — DETALLE POR CAMPAÑA" : "PACING — DETAIL BY CAMPAIGN",
    [],
    totalCols,
  );

  // Header de la tabla: las métricas ocupan 2 columnas (Goal/Real). Header en
  // una sola fila ("{métrica} Goal" / "{métrica} Real") para robustez.
  const headerLabels = [
    es ? "Publisher / Placement" : "Publisher / Placement",
    es ? "Mercado" : "Market",
    "Goal (USD)",
    es ? "Real (USD)" : "Actual (USD)",
    es ? "Avance" : "Progress",
    "Pace",
    ...metricCols.flatMap((m) => [`${m.label} · Goal`, `${m.label} · ${es ? "Real" : "Actual"}`]),
  ];
  ws.views = [{ state: "frozen", ySplit: headerEnd, xSplit: 1 }];
  tableHeader(ws, headerEnd, headerLabels);

  let r = headerEnd + 1;

  const writeMetricCells = (
    row: ExcelJS.Row,
    map: Map<string, { goal: number | null; actual: number }>,
  ) => {
    metricCols.forEach((m, i) => {
      const v = map.get(m.key);
      setMetricCell(row.getCell(base + 1 + i * 2), m.unit, v?.goal ?? null);
      setMetricCell(row.getCell(base + 2 + i * 2), m.unit, v ? v.actual : null);
    });
  };

  for (const p of plans) {
    // Banner de la campaña (todo el ancho).
    const campRow = ws.getRow(r);
    campRow.getCell(1).value = `${p.project.name} · ${p.plan.name}`;
    campRow.getCell(1).font = { bold: true, color: { argb: WHITE }, size: 12 };
    campRow.getCell(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: ACCENT },
    };
    campRow.getCell(1).alignment = { vertical: "middle", horizontal: "left" };
    ws.mergeCells(r, 1, r, totalCols);
    campRow.height = 22;
    r++;

    for (const pub of p.publishers) {
      // Subtotal del publisher.
      const subRow = ws.getRow(r);
      subRow.getCell(1).value = pub.publisherName;
      subRow.getCell(3).value = pub.goalInvestmentUsd;
      subRow.getCell(3).numFmt = USD_FMT;
      subRow.getCell(4).value = pub.actualInvestmentUsd;
      subRow.getCell(4).numFmt = USD_FMT;
      subRow.getCell(5).value = pub.progressPct;
      subRow.getCell(5).numFmt = PCT_FMT;
      writeMetricCells(subRow, aggregateMetricMap(pub.placements));
      fillRow(subRow, totalCols, ACCENT_SOFT);
      subRow.getCell(1).alignment = { vertical: "middle", horizontal: "left" };
      subRow.height = 20;
      r++;

      if (pub.placements.length === 0) {
        const row = ws.getRow(r);
        row.getCell(1).value = es ? "(sin placements)" : "(no placements)";
        row.getCell(1).font = { italic: true, color: { argb: MUTED } };
        row.getCell(1).alignment = { indent: 2, vertical: "middle" };
        for (let c = 1; c <= totalCols; c++) row.getCell(c).border = allBorders;
        r++;
        continue;
      }

      for (const pl of pub.placements) {
        const row = ws.getRow(r);
        row.getCell(1).value = pl.name;
        row.getCell(1).alignment = { indent: 2, vertical: "top", wrapText: true };
        row.getCell(2).value = pl.marketName ?? "";
        row.getCell(3).value = pl.goalInvestmentUsd;
        row.getCell(3).numFmt = USD_FMT;
        row.getCell(4).value = pl.actualInvestmentUsd;
        row.getCell(4).numFmt = USD_FMT;
        row.getCell(5).value = pl.progressPct;
        row.getCell(5).numFmt = PCT_FMT;
        row.getCell(6).value = pl.pacePct;
        row.getCell(6).numFmt = PCT_FMT;
        writeMetricCells(row, placementMetricMap(pl));
        for (let c = 1; c <= totalCols; c++) row.getCell(c).border = allBorders;
        r++;
      }
    }

    // Total de la campaña.
    const totRow = ws.getRow(r);
    totRow.getCell(1).value = es ? "TOTAL CAMPAÑA" : "CAMPAIGN TOTAL";
    totRow.getCell(3).value = p.goalInvestmentUsd;
    totRow.getCell(3).numFmt = USD_FMT;
    totRow.getCell(4).value = p.actualInvestmentUsd;
    totRow.getCell(4).numFmt = USD_FMT;
    totRow.getCell(5).value = progressOf(p.goalInvestmentUsd, p.actualInvestmentUsd);
    totRow.getCell(5).numFmt = PCT_FMT;
    writeMetricCells(
      totRow,
      aggregateMetricMap(p.publishers.flatMap((g) => g.placements)),
    );
    fillRow(totRow, totalCols, INK, true);
    totRow.height = 20;
    r += 2; // aire entre campañas
  }
}

// ── Hoja 3 — Por mercado ──────────────────────────────────────────────────────

function buildPorMercadoSheet(
  wb: ExcelJS.Workbook,
  plans: CampaignTrackerPlan[],
  lang: Language,
  metricCols: MetricCol[],
) {
  const es = lang === "es";
  const ws = wb.addWorksheet(es ? "Por mercado" : "By market");
  const noMarket = es ? "(sin mercado)" : "(no market)";

  // Agrupamos todos los placements de toda la selección por mercado.
  const byMarket = new Map<string, TrackerPlacement[]>();
  for (const p of plans)
    for (const pub of p.publishers)
      for (const pl of pub.placements) {
        const key = pl.marketName ?? noMarket;
        const list = byMarket.get(key) ?? [];
        list.push(pl);
        byMarket.set(key, list);
      }

  const base = 4; // Mercado · Goal · Real · Avance
  const totalCols = base + metricCols.length * 2;
  ws.columns = [
    { width: 30 },
    { width: 16 },
    { width: 16 },
    { width: 11 },
    ...metricCols.flatMap(() => [{ width: 14 }, { width: 14 }]),
  ];

  const headerEnd = brandHeader(
    ws,
    wb,
    es ? "PACING — DESGLOSE POR MERCADO" : "PACING — BREAKDOWN BY MARKET",
    [],
    totalCols,
  );

  tableHeader(ws, headerEnd, [
    es ? "Mercado" : "Market",
    "Goal (USD)",
    es ? "Real (USD)" : "Actual (USD)",
    es ? "Avance" : "Progress",
    ...metricCols.flatMap((m) => [`${m.label} · Goal`, `${m.label} · ${es ? "Real" : "Actual"}`]),
  ]);
  ws.views = [{ state: "frozen", ySplit: headerEnd, xSplit: 1 }];

  const writeMetricCells = (
    row: ExcelJS.Row,
    map: Map<string, { goal: number | null; actual: number }>,
  ) => {
    metricCols.forEach((m, i) => {
      const v = map.get(m.key);
      setMetricCell(row.getCell(base + 1 + i * 2), m.unit, v?.goal ?? null);
      setMetricCell(row.getCell(base + 2 + i * 2), m.unit, v ? v.actual : null);
    });
  };

  // Filas ordenadas por goal de inversión desc.
  const rows = Array.from(byMarket.entries())
    .map(([market, placements]) => {
      const goal = placements.reduce((s, pl) => s + pl.goalInvestmentUsd, 0);
      const actual = placements.reduce((s, pl) => s + pl.actualInvestmentUsd, 0);
      return { market, placements, goal, actual };
    })
    .sort((a, b) => b.goal - a.goal);

  let r = headerEnd + 1;
  let goalSum = 0;
  let actualSum = 0;

  for (const m of rows) {
    const row = ws.getRow(r);
    row.getCell(1).value = m.market;
    row.getCell(1).font = { bold: true };
    row.getCell(2).value = m.goal;
    row.getCell(2).numFmt = USD_FMT;
    row.getCell(3).value = m.actual;
    row.getCell(3).numFmt = USD_FMT;
    row.getCell(4).value = progressOf(m.goal, m.actual);
    row.getCell(4).numFmt = PCT_FMT;
    writeMetricCells(row, aggregateMetricMap(m.placements));
    for (let c = 1; c <= totalCols; c++) row.getCell(c).border = allBorders;
    goalSum += m.goal;
    actualSum += m.actual;
    r++;
  }

  if (rows.length === 0) {
    const row = ws.getRow(r);
    row.getCell(1).value = es ? "(sin placements)" : "(no placements)";
    row.getCell(1).font = { italic: true, color: { argb: MUTED } };
    ws.mergeCells(r, 1, r, totalCols);
    r++;
  }

  const totalRow = ws.getRow(r);
  totalRow.getCell(1).value = "TOTAL";
  totalRow.getCell(2).value = goalSum;
  totalRow.getCell(2).numFmt = USD_FMT;
  totalRow.getCell(3).value = actualSum;
  totalRow.getCell(3).numFmt = USD_FMT;
  totalRow.getCell(4).value = progressOf(goalSum, actualSum);
  totalRow.getCell(4).numFmt = PCT_FMT;
  writeMetricCells(
    totalRow,
    aggregateMetricMap(rows.flatMap((m) => m.placements)),
  );
  fillRow(totalRow, totalCols, INK, true);
  totalRow.height = 22;
}
