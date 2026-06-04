import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { getBenchmarks } from "@/db/queries/simulator";
import { canAccessClientExport } from "@/lib/client-portal.server";
import type { BenchmarkRow } from "@/lib/simulator-types";

// ════════════════════════════════════════════════════════════════════════════
// Export de benchmarks (Excel / PDF) de lo filtrado. Recibe clientId + filtros
// (pub/mkt/cm/from/to) + fmt. Ruta pública en el proxy: se autovalida con
// `canAccessClientExport` (sesión interna O cookie de portal del cliente).
// ════════════════════════════════════════════════════════════════════════════

const ACCENT = "FF7A1F3D";
const WHITE = "FFFFFFFF";

function fmtUsd(v: number): string {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
function p(v: number | null, dec = 2): string {
  return v == null ? "—" : v.toFixed(dec);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId");
  if (!clientId) return new Response("Missing clientId", { status: 400 });

  const [client] = await db
    .select({ slug: clients.slug, name: clients.name })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  if (!client) return new Response("Client not found", { status: 404 });

  if (!(await canAccessClientExport(client.slug))) {
    return new Response("Forbidden", { status: 403 });
  }

  const rows = await getBenchmarks({
    clientId,
    publisherId: url.searchParams.get("pub") || null,
    marketId: url.searchParams.get("mkt") || null,
    costMethod: url.searchParams.get("cm") || null,
    dateFrom: url.searchParams.get("from") || null,
    dateTo: url.searchParams.get("to") || null,
  });

  const fmt = url.searchParams.get("fmt") === "pdf" ? "pdf" : "xlsx";
  const base = `benchmarks-${client.slug}`.replace(/[^A-Za-z0-9._-]+/g, "_");

  if (fmt === "pdf") {
    const bytes = await buildPdf(rows, client.name);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${base}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const buf = await buildXlsx(rows, client.name);
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${base}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

async function buildXlsx(rows: BenchmarkRow[], clientName: string) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Benchmarks");

  ws.mergeCells("A1", "P1");
  const title = ws.getCell("A1");
  title.value = `Benchmarks · ${clientName}`;
  title.font = { bold: true, size: 13, color: { argb: ACCENT } };

  const headers = [
    "Publisher",
    "Mercado",
    "Cost method",
    "N",
    "Spend",
    "Delivery %",
    "CPM p25",
    "CPM p50",
    "CPM p75",
    "CPC p25",
    "CPC p50",
    "CPC p75",
    "CPV p25",
    "CPV p50",
    "CPV p75",
    "CTR p25",
    "CTR p50",
    "CTR p75",
  ];
  const hRow = ws.addRow(headers);
  hRow.eachCell((c) => {
    c.font = { bold: true, color: { argb: WHITE }, size: 10 };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ACCENT } };
    c.alignment = { horizontal: "center" };
  });

  for (const r of rows) {
    ws.addRow([
      r.publisherName,
      r.marketName ?? "—",
      r.costMethod ?? "—",
      r.placements,
      Math.round(r.totalSpendUsd),
      r.deliveryPctMedian == null ? "—" : Math.round(r.deliveryPctMedian),
      r.cpm.p25,
      r.cpm.p50,
      r.cpm.p75,
      r.cpc.p25,
      r.cpc.p50,
      r.cpc.p75,
      r.cpv.p25,
      r.cpv.p50,
      r.cpv.p75,
      r.ctr.p25,
      r.ctr.p50,
      r.ctr.p75,
    ]);
  }

  ws.getColumn(1).width = 22;
  ws.getColumn(2).width = 18;
  ws.getColumn(3).width = 14;
  ws.getColumn(5).numFmt = '"$"#,##0';
  for (let i = 7; i <= 18; i++) ws.getColumn(i).numFmt = "0.00";
  ws.views = [{ state: "frozen", ySplit: 2 }];

  return wb.xlsx.writeBuffer();
}

async function buildPdf(rows: BenchmarkRow[], clientName: string) {
  const W = 792; // landscape letter
  const H = 612;
  const M = 32;
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([W, H]);
  let y = H - M;

  // Columnas (x desde M). PDF muestra la mediana (p50) de cada métrica.
  const cols: { label: string; x: number; w: number; align?: "r" }[] = [
    { label: "Publisher", x: 0, w: 110 },
    { label: "Mercado", x: 112, w: 90 },
    { label: "Cost", x: 204, w: 52 },
    { label: "N", x: 258, w: 26, align: "r" },
    { label: "Spend", x: 286, w: 70, align: "r" },
    { label: "Deliv%", x: 358, w: 50, align: "r" },
    { label: "CPM", x: 410, w: 60, align: "r" },
    { label: "CPC", x: 472, w: 60, align: "r" },
    { label: "CPV", x: 534, w: 60, align: "r" },
    { label: "CTR%", x: 596, w: 60, align: "r" },
  ];

  const draw = (
    text: string,
    x: number,
    w: number,
    opts: { bold?: boolean; align?: "r"; color?: [number, number, number]; size?: number } = {},
  ) => {
    const f = opts.bold ? bold : font;
    const size = opts.size ?? 7.5;
    let s = text;
    while (f.widthOfTextAtSize(s, size) > w && s.length > 1) s = s.slice(0, -1);
    const tw = f.widthOfTextAtSize(s, size);
    const dx = opts.align === "r" ? M + x + w - tw : M + x;
    const c = opts.color ?? [0.12, 0.12, 0.12];
    page.drawText(s, { x: dx, y, size, font: f, color: rgb(c[0], c[1], c[2]) });
  };

  const header = () => {
    page.drawRectangle({ x: M, y: y - 14, width: W - M * 2, height: 16, color: rgb(0.48, 0.12, 0.24) });
    const saved = y;
    y = y - 11;
    for (const c of cols) draw(c.label, c.x, c.w, { bold: true, color: [1, 1, 1], align: c.align });
    y = saved - 22;
  };

  draw(`Benchmarks · ${clientName}`, 0, 600, { bold: true, size: 13, color: [0.48, 0.12, 0.24] });
  draw("valores = mediana (p50)", 0, 600, { size: 8, color: [0.5, 0.5, 0.5], align: "r" });
  y -= 18;
  header();

  for (const r of rows) {
    if (y < M + 24) {
      page = pdf.addPage([W, H]);
      y = H - M;
      header();
    }
    draw(r.publisherName, cols[0].x, cols[0].w);
    draw(r.marketName ?? "—", cols[1].x, cols[1].w);
    draw(r.costMethod ?? "—", cols[2].x, cols[2].w);
    draw(String(r.placements), cols[3].x, cols[3].w, { align: "r" });
    draw(fmtUsd(r.totalSpendUsd), cols[4].x, cols[4].w, { align: "r" });
    draw(r.deliveryPctMedian == null ? "—" : `${Math.round(r.deliveryPctMedian)}%`, cols[5].x, cols[5].w, { align: "r" });
    draw(p(r.cpm.p50), cols[6].x, cols[6].w, { align: "r" });
    draw(p(r.cpc.p50), cols[7].x, cols[7].w, { align: "r" });
    draw(p(r.cpv.p50), cols[8].x, cols[8].w, { align: "r" });
    draw(p(r.ctr.p50, 1), cols[9].x, cols[9].w, { align: "r" });
    y -= 14;
  }

  if (rows.length === 0) {
    draw("Sin datos para los filtros aplicados.", 0, 500, { color: [0.5, 0.5, 0.5] });
  }

  return pdf.save();
}
