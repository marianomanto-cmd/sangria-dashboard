import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getPlanDetail } from "@/db/queries/project-detail";

const PAGE_W = 612; // letter
const PAGE_H = 792;
const MARGIN = 40;
const LINE_GAP = 14;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ planId: string }> },
) {
  const { planId } = await params;
  const detail = await getPlanDetail(planId);
  if (!detail) {
    return new Response("Plan no encontrado", { status: 404 });
  }

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fontMono = await pdf.embedFont(StandardFonts.Courier);

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  function newPageIfNeeded(needed = LINE_GAP) {
    if (y - needed < MARGIN) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
  }

  // Helvetica/Courier de pdf-lib usan WinAnsi: caracteres fuera de ese set
  // (arrows, em-dash, smart quotes, etc.) explotan al renderizar. Sanitizamos
  // a equivalentes ASCII antes de dibujar. Acentos latinos sí están en WinAnsi.
  function sanitize(text: string): string {
    return text
      .replace(/→/g, "->")
      .replace(/←/g, "<-")
      .replace(/—/g, "-")
      .replace(/–/g, "-")
      .replace(/·/g, "-")
      .replace(/“|”/g, '"')
      .replace(/‘|’/g, "'")
      .replace(/×/g, "x")
      .replace(/…/g, "...")
      // Cualquier otro char fuera de Latin-1 lo bajamos a "?"
      .replace(/[^\x00-\xFF]/g, "?");
  }

  function writeLine(
    text: string,
    opts: {
      size?: number;
      bold?: boolean;
      mono?: boolean;
      color?: [number, number, number];
      indent?: number;
    } = {},
  ) {
    const size = opts.size ?? 10;
    const f = opts.bold ? fontBold : opts.mono ? fontMono : font;
    const color = opts.color ?? [0.1, 0.1, 0.1];
    newPageIfNeeded(size + 4);
    page.drawText(sanitize(text), {
      x: MARGIN + (opts.indent ?? 0),
      y,
      size,
      font: f,
      color: rgb(color[0], color[1], color[2]),
    });
    y -= size + 4;
  }

  function writeWrapped(
    text: string,
    opts: { size?: number; mono?: boolean; indent?: number } = {},
  ) {
    const size = opts.size ?? 9;
    const f = opts.mono ? fontMono : font;
    const indent = opts.indent ?? 0;
    const maxWidth = PAGE_W - MARGIN * 2 - indent;
    const safe = sanitize(text);
    const words = safe.split(/\s+/);
    let line = "";
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      const width = f.widthOfTextAtSize(test, size);
      if (width > maxWidth && line) {
        newPageIfNeeded(size + 3);
        page.drawText(line, {
          x: MARGIN + indent,
          y,
          size,
          font: f,
          color: rgb(0.2, 0.2, 0.2),
        });
        y -= size + 3;
        line = w;
      } else {
        line = test;
      }
    }
    if (line) {
      newPageIfNeeded(size + 3);
      page.drawText(line, {
        x: MARGIN + indent,
        y,
        size,
        font: f,
        color: rgb(0.2, 0.2, 0.2),
      });
      y -= size + 3;
    }
  }

  function writeSeparator() {
    newPageIfNeeded(8);
    page.drawLine({
      start: { x: MARGIN, y: y - 2 },
      end: { x: PAGE_W - MARGIN, y: y - 2 },
      thickness: 0.5,
      color: rgb(0.7, 0.7, 0.7),
    });
    y -= 8;
  }

  function fmtUsd(v: number): string {
    return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }

  // ─── Header ──────────────────────────────────────────────────────────
  writeLine("MEDIA PLAN", { size: 8, bold: true, color: [0.5, 0.1, 0.25] });
  writeLine(detail.plan.name, { size: 20, bold: true });
  writeLine(detail.project.code, { size: 10, mono: true, color: [0.45, 0.45, 0.45] });
  y -= 4;

  // ─── Metadata ────────────────────────────────────────────────────────
  writeLine(`Cliente: ${detail.client.name}`);
  writeLine(`Proyecto: ${detail.project.name}`);
  writeLine(`Budget Origin: ${detail.budgetOrigin.name}`);
  writeLine(
    `Status: ${detail.plan.status}${detail.plan.currentVersion > 0 ? `   ·   v${detail.plan.currentVersion}` : ""}`,
  );

  writeSeparator();

  // ─── Totales ─────────────────────────────────────────────────────────
  writeLine("Totales", { size: 12, bold: true });
  writeLine(`Media:  ${fmtUsd(detail.totals.media)}`, { mono: true });
  writeLine(`Fees:   ${fmtUsd(detail.totals.fees)}`, { mono: true });
  writeLine(`Grand:  ${fmtUsd(detail.totals.grand)}`, { mono: true, bold: true });

  writeSeparator();

  // ─── Publishers + placements ─────────────────────────────────────────
  writeLine("Publishers & Placements", { size: 12, bold: true });
  y -= 2;
  for (const grp of detail.publishers) {
    writeLine(
      `${grp.publisherName}   —   ${fmtUsd(grp.totalPlannedUsd)}   ${grp.agencyPays ? "[agencia paga]" : "[cliente paga directo]"}`,
      { bold: true, size: 11 },
    );
    if (grp.placements.length === 0) {
      writeLine("(sin placements)", { size: 9, color: [0.6, 0.6, 0.6], indent: 12 });
    } else {
      for (const pl of grp.placements) {
        writeLine(`• ${pl.placementName}`, { size: 10, indent: 12 });
        const meta = [
          pl.marketName ?? "—",
          pl.audience || "",
          pl.costMethod ?? "",
          fmtUsd(pl.amountUsd),
          pl.startDate && pl.endDate ? `${pl.startDate} → ${pl.endDate}` : "",
        ]
          .filter(Boolean)
          .join("   ·   ");
        writeWrapped(meta, { size: 8.5, indent: 24 });
        const metricEntries = Object.entries(pl.metricsJson ?? {});
        if (metricEntries.length > 0) {
          writeWrapped(
            metricEntries
              .map(([k, v]) => `${k}: ${typeof v === "number" ? v.toLocaleString("en-US") : String(v)}`)
              .join(" · "),
            { size: 8.5, mono: true, indent: 24 },
          );
        }
        if (pl.notesMd) {
          writeWrapped(pl.notesMd, { size: 8, indent: 24 });
        }
      }
    }
    y -= 4;
  }

  writeSeparator();

  // ─── Fees ────────────────────────────────────────────────────────────
  writeLine("Fees", { size: 12, bold: true });
  y -= 2;
  if (detail.fees.length === 0) {
    writeLine("(sin fees)", { size: 9, color: [0.6, 0.6, 0.6] });
  } else {
    for (const f of detail.fees) {
      const rate = f.ratePct != null ? `   (${f.ratePct}%)` : "";
      writeLine(
        `${f.feeType.padEnd(10)} ${f.name}${rate}   ${fmtUsd(f.amountUsd)}${f.isAutoComputed ? "  [auto]" : ""}`,
        { mono: true, size: 9.5 },
      );
      if (f.notes) {
        writeWrapped(f.notes, { size: 8.5, indent: 12 });
      }
    }
  }

  // ─── Footer ──────────────────────────────────────────────────────────
  writeSeparator();
  writeLine(
    `Generado: ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC   ·   Sangria Media OS`,
    { size: 8, color: [0.55, 0.55, 0.55], mono: true },
  );

  const bytes = await pdf.save();
  const filename = `${detail.project.code}.${detail.plan.name}.pdf`.replace(
    /[^A-Za-z0-9._-]+/g,
    "_",
  );

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
