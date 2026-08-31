import ExcelJS from "exceljs";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { clients, mediaPlans, projects } from "@/db/schema";
import {
  getPlanTraffic,
  toTrafficPlacements,
  type PlanTrafficAd,
  type PlanTrafficAdset,
} from "@/db/queries/plan-traffic";
import {
  computeTrafficProgress,
  findPlacementAdIssues,
  findPlacementAdsetIssues,
  isAdLoaded,
} from "@/lib/plan-traffic";

// ════════════════════════════════════════════════════════════════════════════
// Excel del brief de TRÁFICO — espejo descargable de la ventana /trafico.
//
// Regla del repo: el export muestra TODO lo que se ve en la pantalla desde
// donde se descarga. La ventana muestra, por placement, la línea del plan
// (publisher, mercado, monto, método); dentro, cada ADSET con su nombre,
// audiencia, budget, pilar creativo y fechas; y dentro de cada adset, cada AD
// con tipo, carpeta del creativo, copy, título, subtítulo, URL, landing
// y su estado de carga. Todo eso está acá, aplanado a una fila por ad (que es
// como se trabaja), más el bloque de avance de los dos gates.
//
// NO es público: a diferencia de export.xlsx/export.pdf, esta ruta no está en
// `isPublicPlanExportPath`, así que el proxy exige sesión interna. El brief es
// material de producción, no algo que se le manda al cliente.
// ════════════════════════════════════════════════════════════════════════════

const ACCENT = "FF7A1F3D";
const WHITE = "FFFFFFFF";
const BORDER = "FFD6D3D1";
const MUTED = "FF78716C";
const OK_SOFT = "FFE5F3EB";
const WARN_SOFT = "FFFBEFD9";

const thin = { style: "thin" as const, color: { argb: BORDER } };
const allBorders = { top: thin, left: thin, bottom: thin, right: thin };

const COLUMNS: { header: string; width: number }[] = [
  { header: "Publisher", width: 22 },
  { header: "Placement", width: 32 },
  { header: "Mercado", width: 15 },
  { header: "Monto USD", width: 13 },
  { header: "Método", width: 9 },
  // Adset (media planner)
  { header: "Adset", width: 7 },
  { header: "Nombre del adset", width: 28 },
  { header: "Audiencia", width: 36 },
  { header: "Budget USD", width: 13 },
  { header: "Pilar creativo", width: 20 },
  { header: "Inicio", width: 12 },
  { header: "Fin", width: 12 },
  // Ad (AM/PM)
  { header: "Ad", width: 6 },
  { header: "Tipo de ad", width: 18 },
  { header: "Carpeta / link del creativo", width: 34 },
  { header: "Copy", width: 50 },
  { header: "Título", width: 28 },
  { header: "Subtítulo", width: 28 },
  { header: "URL", width: 34 },
  { header: "Landing", width: 34 },
  { header: "Cargado", width: 11 },
  { header: "Cargado por", width: 24 },
  { header: "Cargado el", width: 17 },
  // Diagnóstico
  { header: "Falta (adsets)", width: 40 },
  { header: "Falta (ads)", width: 46 },
];

const HEADER_ROW = 9;
const EMPTY = "";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ planId: string }> },
) {
  const { planId } = await params;

  const [planRow] = await db
    .select({
      name: mediaPlans.name,
      status: mediaPlans.status,
      currentVersion: mediaPlans.currentVersion,
      projectCode: projects.code,
      projectName: projects.name,
      clientName: clients.name,
    })
    .from(mediaPlans)
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(and(eq(mediaPlans.id, planId), isNull(mediaPlans.deletedAt)))
    .limit(1);

  if (!planRow) return new Response("Plan not found", { status: 404 });

  const rows = await getPlanTraffic(planId);
  const placements = toTrafficPlacements(rows);
  const progress = computeTrafficProgress(placements);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Sangria Dashboard";
  wb.created = new Date();

  const ws = wb.addWorksheet("Tráfico", {
    views: [{ state: "frozen", ySplit: HEADER_ROW }],
  });
  const lastCol = COLUMNS.length;
  ws.columns = COLUMNS.map((c) => ({ width: c.width }));

  // ─── Cabecera: plan + los dos gates de la pantalla ──────────────────────
  const title = ws.getRow(1);
  title.getCell(1).value = `TRÁFICO · ${planRow.projectCode}.${planRow.name}`;
  title.getCell(1).font = { bold: true, size: 14, color: { argb: WHITE } };
  title.height = 24;
  ws.mergeCells(1, 1, 1, lastCol);
  title.getCell(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: ACCENT },
  };
  title.getCell(1).alignment = { vertical: "middle", indent: 1 };

  const meta: [string, string][] = [
    ["Cliente", planRow.clientName],
    ["Proyecto", planRow.projectName],
    [
      "Estado del plan",
      `${planRow.status}${planRow.currentVersion > 0 ? ` · v${planRow.currentVersion}` : ""}`,
    ],
    [
      "Adsets · placements con adsets",
      `${progress.placementsWithAdsets}/${progress.placements}`,
    ],
    ["Adsets · completos", `${progress.adsetsComplete}/${progress.adsets}`],
    ["Ads · completos", `${progress.adsComplete}/${progress.ads}`],
    ["Ads · cargados en plataforma", `${progress.adsLoaded}/${progress.ads}`],
  ];
  meta.forEach(([label, value], i) => {
    const r = ws.getRow(2 + i);
    r.getCell(1).value = label;
    r.getCell(1).font = { bold: true, size: 9, color: { argb: MUTED } };
    r.getCell(2).value = value;
    r.getCell(2).font = { size: 9 };
  });

  // ─── Encabezado de la tabla ─────────────────────────────────────────────
  const headerRow = ws.getRow(HEADER_ROW);
  COLUMNS.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, size: 9, color: { argb: WHITE } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ACCENT } };
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = allBorders;
  });
  headerRow.height = 22;

  // ─── Filas: una por ad. Los adsets sin ads y los placements sin adsets
  //     igual aparecen, con su diagnóstico — es lo que la pantalla muestra.
  let rowIdx = HEADER_ROW + 1;

  const adsetCells = (a: PlanTrafficAdset | null, n: number): ExcelJS.CellValue[] =>
    a
      ? [
          n,
          a.name ?? EMPTY,
          a.audience ?? EMPTY,
          a.budgetUsd ?? EMPTY,
          a.creativePillar ?? EMPTY,
          a.startDate ?? EMPTY,
          a.endDate ?? EMPTY,
        ]
      : ["—", EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY];

  const adCells = (ad: PlanTrafficAd | null, n: number): ExcelJS.CellValue[] =>
    ad
      ? [
          n,
          ad.adTypeRequiresDetail
            ? (ad.adTypeOther ?? "").trim() || (ad.adTypeName ?? "Otro")
            : ad.adTypeName ?? EMPTY,
          ad.creativeUrl ?? EMPTY,
          ad.copy ?? EMPTY,
          ad.headline ?? EMPTY,
          ad.subheadline ?? EMPTY,
          ad.clickUrl ?? EMPTY,
          ad.landingUrl ?? EMPTY,
          isAdLoaded(ad) ? "Sí" : "No",
          ad.loadedByEmail ?? EMPTY,
          ad.loadedAt ? new Date(ad.loadedAt) : EMPTY,
        ]
      : ["—", EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, "No", EMPTY, EMPTY];

  rows.forEach((row, i) => {
    const adsetIssues = findPlacementAdsetIssues(placements[i]);
    const adIssues = findPlacementAdIssues(placements[i]);
    const base: ExcelJS.CellValue[] = [
      row.publisherName,
      row.placementName ?? "(placement sin nombre)",
      row.marketName ?? "—",
      row.amountUsd,
      row.costMethod ?? "—",
    ];
    const adsets = row.brief?.adsets ?? [];

    // El diagnóstico se escribe una sola vez por placement (primera fila): es
    // de la línea, no de cada ad.
    let firstOfPlacement = true;
    const emit = (
      adset: PlanTrafficAdset | null,
      adsetNo: number,
      ad: PlanTrafficAd | null,
      adNo: number,
    ) => {
      const r = ws.getRow(rowIdx++);
      const values: ExcelJS.CellValue[] = [
        ...base,
        ...adsetCells(adset, adsetNo),
        ...adCells(ad, adNo),
        firstOfPlacement ? adsetIssues.join(" · ") : EMPTY,
        firstOfPlacement ? adIssues.join(" · ") : EMPTY,
      ];
      firstOfPlacement = false;
      values.forEach((v, c) => {
        r.getCell(c + 1).value = v;
      });
      styleDataRow(
        r,
        lastCol,
        ad != null && isAdLoaded(ad),
        adsetIssues.length > 0 || adIssues.length > 0,
      );
    };

    if (adsets.length === 0) {
      emit(null, 0, null, 0);
      return;
    }
    adsets.forEach((adset, n) => {
      if (adset.ads.length === 0) {
        emit(adset, n + 1, null, 0);
        return;
      }
      adset.ads.forEach((ad, m) => emit(adset, n + 1, ad, m + 1));
    });
  });

  // Formatos de columna (1-indexados, en el orden de COLUMNS)
  ws.getColumn(4).numFmt = '"$"#,##0.00';   // Monto USD
  ws.getColumn(9).numFmt = '"$"#,##0.00';   // Budget USD
  ws.getColumn(23).numFmt = "dd/mm/yyyy hh:mm"; // Cargado el
  ws.autoFilter = {
    from: { row: HEADER_ROW, column: 1 },
    to: { row: HEADER_ROW, column: lastCol },
  };

  const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  const filename = `${planRow.projectCode}.${planRow.name}-trafico.xlsx`.replace(
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

// Fila de datos: bordes, wrap en los textos largos y el mismo semáforo que la
// pantalla — verde si el ad ya está cargado, ámbar si a la línea le falta algo.
function styleDataRow(
  row: ExcelJS.Row,
  lastCol: number,
  loaded: boolean,
  incomplete: boolean,
) {
  const fill = loaded ? OK_SOFT : incomplete ? WARN_SOFT : null;
  for (let c = 1; c <= lastCol; c++) {
    const cell = row.getCell(c);
    cell.border = allBorders;
    cell.font = { size: 9 };
    cell.alignment = { vertical: "top", wrapText: true };
    if (fill) {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    }
  }
  // La celda de "Cargado" en negrita: es la que se escanea.
  row.getCell(21).font = { size: 9, bold: true };
  row.getCell(21).alignment = { vertical: "top", horizontal: "center" };
}
