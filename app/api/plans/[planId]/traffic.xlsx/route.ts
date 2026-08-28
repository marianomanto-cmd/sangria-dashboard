import ExcelJS from "exceljs";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { clients, mediaPlans, projects } from "@/db/schema";
import { getPlanTraffic, toTrafficPlacements } from "@/db/queries/plan-traffic";
import {
  adFormatLabel,
  computeTrafficProgress,
  findPlacementTrafficIssues,
  isAdLoaded,
} from "@/lib/plan-traffic";

// ════════════════════════════════════════════════════════════════════════════
// Excel del brief de TRÁFICO — espejo descargable de la ventana /trafico.
//
// Regla del repo: el export muestra TODO lo que se ve en la pantalla desde
// donde se descarga. La ventana muestra, por placement, la línea del plan
// (publisher, mercado, monto, método), la cantidad de adsets, la carpeta de
// tráfico y, adentro, cada anuncio con tipo/copy/título/subtítulo/CTA/landing,
// su estado de carga y qué le falta. Todo eso está acá, aplanado a una fila por
// anuncio (que es como el trafficker trabaja), más el bloque de avance de
// arriba de la pantalla.
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
  { header: "Placement", width: 34 },
  { header: "Mercado", width: 16 },
  { header: "Monto USD", width: 14 },
  { header: "Método", width: 10 },
  { header: "Adsets", width: 9 },
  { header: "Carpeta de tráfico", width: 34 },
  { header: "Anuncio", width: 9 },
  { header: "Tipo de anuncio", width: 18 },
  { header: "Copy", width: 52 },
  { header: "Título", width: 30 },
  { header: "Subtítulo", width: 30 },
  { header: "CTA", width: 18 },
  { header: "Landing page", width: 38 },
  { header: "Cargado", width: 12 },
  { header: "Cargado por", width: 26 },
  { header: "Cargado el", width: 18 },
  { header: "Falta completar", width: 46 },
];

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
    views: [{ state: "frozen", ySplit: 8 }],
  });
  const lastCol = COLUMNS.length;

  ws.columns = COLUMNS.map((c) => ({ width: c.width }));

  // ─── Cabecera: plan + bloque de avance (los chips de la pantalla) ────────
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

  const meta = [
    ["Cliente", planRow.clientName],
    ["Proyecto", planRow.projectName],
    [
      "Estado del plan",
      `${planRow.status}${planRow.currentVersion > 0 ? ` · v${planRow.currentVersion}` : ""}`,
    ],
    [
      "Placements briefeados",
      `${progress.placementsComplete}/${progress.placements}`,
    ],
    ["Anuncios completos", `${progress.adsComplete}/${progress.ads}`],
    ["Cargados en plataforma", `${progress.adsLoaded}/${progress.ads}`],
  ];
  meta.forEach(([label, value], i) => {
    const r = ws.getRow(2 + i);
    r.getCell(1).value = label;
    r.getCell(1).font = { bold: true, size: 9, color: { argb: MUTED } };
    r.getCell(2).value = value;
    r.getCell(2).font = { size: 9 };
  });

  // ─── Encabezado de la tabla ─────────────────────────────────────────────
  const headerRow = ws.getRow(8);
  COLUMNS.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, size: 9, color: { argb: WHITE } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ACCENT } };
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = allBorders;
  });
  headerRow.height = 20;

  // ─── Filas: una por anuncio; los placements sin anuncios igual aparecen ──
  let rowIdx = 9;
  rows.forEach((row, i) => {
    const issues = findPlacementTrafficIssues(placements[i], true);
    const ads = row.brief?.ads ?? [];
    const base = [
      row.publisherName,
      row.placementName ?? "(placement sin nombre)",
      row.marketName ?? "—",
      row.amountUsd,
      row.costMethod ?? "—",
      row.brief?.adsetsCount ?? 0,
      row.brief?.trafficFolderUrl ?? "",
    ];

    if (ads.length === 0) {
      const r = ws.getRow(rowIdx++);
      [...base, "—", "—", "", "", "", "", "", "No", "", "", issues.join(" · ")].forEach(
        (v, c) => {
          r.getCell(c + 1).value = v as ExcelJS.CellValue;
        },
      );
      styleDataRow(r, lastCol, false, true);
      return;
    }

    ads.forEach((ad, n) => {
      const loaded = isAdLoaded(ad);
      const r = ws.getRow(rowIdx++);
      const values: ExcelJS.CellValue[] = [
        ...(base as ExcelJS.CellValue[]),
        n + 1,
        adFormatLabel(ad.adFormat, ad.adFormatOther),
        ad.copy ?? "",
        ad.headline ?? "",
        ad.subheadline ?? "",
        ad.cta ?? "",
        ad.landingUrl ?? "",
        loaded ? "Sí" : "No",
        ad.loadedByEmail ?? "",
        ad.loadedAt ? new Date(ad.loadedAt) : "",
        // El detalle de lo que falta se repite sólo en la primera fila del
        // placement: es un diagnóstico de la línea, no de cada anuncio.
        n === 0 ? issues.join(" · ") : "",
      ];
      values.forEach((v, c) => {
        r.getCell(c + 1).value = v;
      });
      styleDataRow(r, lastCol, loaded, issues.length > 0);
    });
  });

  // Formatos de columna
  ws.getColumn(4).numFmt = '"$"#,##0.00';
  ws.getColumn(6).numFmt = "#,##0";
  ws.getColumn(17).numFmt = "dd/mm/yyyy hh:mm";
  ws.autoFilter = { from: { row: 8, column: 1 }, to: { row: 8, column: lastCol } };

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
// pantalla — verde si el anuncio ya está cargado, ámbar si a la línea le falta
// algo para poder ir a Live.
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
  // La celda de "Cargado" en negrita: es la que el trafficker escanea.
  row.getCell(15).font = { size: 9, bold: true };
  row.getCell(15).alignment = { vertical: "top", horizontal: "center" };
}
