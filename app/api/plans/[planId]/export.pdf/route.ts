import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getBrandLogo } from "@/lib/brand-logo";
import { getPlanDetail } from "@/db/queries/project-detail";
import {
  DEFAULT_LANGUAGE,
  formatDate,
  formatDateLong,
  type Language,
  t,
} from "@/lib/i18n";

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
    return new Response("Plan not found", { status: 404 });
  }

  const lang: Language = detail.client.language ?? DEFAULT_LANGUAGE;

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

  // Locale para formatear números/moneda en el body del PDF. Las métricas
  // se mantienen como en runtime (numbers como locale del cliente, no como
  // anglicismos — la decisión "métricas en inglés" aplica a NAMES, no a
  // dígitos).
  const numberLocale = lang === "es" ? "es-AR" : "en-US";
  function fmtUsd(v: number): string {
    return `$${v.toLocaleString(numberLocale, { maximumFractionDigits: 0 })}`;
  }
  function fmtNum(v: number): string {
    return v.toLocaleString(numberLocale);
  }

  // ─── Logo de marca (esquina superior derecha) ───────────────────────
  // El header de texto se escribe alineado a la izquierda, así que el logo a
  // la derecha no se solapa. Se acota a una caja para no invadir la metadata.
  const logo = getBrandLogo();
  if (logo) {
    try {
      const img =
        logo.type === "png"
          ? await pdf.embedPng(logo.bytes)
          : await pdf.embedJpg(logo.bytes);
      const boxW = 150;
      const boxH = 64;
      const scale = Math.min(boxW / img.width, boxH / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, {
        x: PAGE_W - MARGIN - w,
        y: PAGE_H - MARGIN - h,
        width: w,
        height: h,
      });
    } catch {
      // imagen inválida o no embebible: seguimos sin logo
    }
  }

  // ─── Header ──────────────────────────────────────────────────────────
  writeLine(t("export.mediaPlan", lang), {
    size: 8,
    bold: true,
    color: [0.5, 0.1, 0.25],
  });
  writeLine(detail.plan.name, { size: 20, bold: true });
  writeLine(detail.project.code, { size: 10, mono: true, color: [0.45, 0.45, 0.45] });
  y -= 4;

  // ─── Metadata ────────────────────────────────────────────────────────
  writeLine(`${t("common.client", lang)}: ${detail.client.name}`);
  writeLine(`${t("common.project", lang)}: ${detail.project.name}`);
  writeLine(`${t("common.budgetOrigin", lang)}: ${detail.budgetOrigin.name}`);
  const statusLabel = t(`status.${detail.plan.status}`, lang);
  writeLine(
    `${t("common.status", lang)}: ${statusLabel}${detail.plan.currentVersion > 0 ? `   ·   v${detail.plan.currentVersion}` : ""}`,
  );

  writeSeparator();

  // ─── Totales ─────────────────────────────────────────────────────────
  writeLine(t("export.totals", lang), { size: 12, bold: true });
  writeLine(`${t("common.media", lang)}:  ${fmtUsd(detail.totals.media)}`, { mono: true });
  writeLine(`${t("common.fees", lang)}:   ${fmtUsd(detail.totals.fees)}`, { mono: true });
  writeLine(`Grand:  ${fmtUsd(detail.totals.grand)}`, { mono: true, bold: true });

  writeSeparator();

  // ─── Publishers + placements ─────────────────────────────────────────
  writeLine(t("export.publishersPlacements", lang), { size: 12, bold: true });
  y -= 2;
  for (const grp of detail.publishers) {
    const paysTag = grp.agencyPays
      ? `[${t("common.agencyPays", lang)}]`
      : `[${t("common.clientPays", lang)}]`;
    writeLine(
      `${grp.publisherName}   —   ${fmtUsd(grp.totalPlannedUsd)}   ${paysTag}`,
      { bold: true, size: 11 },
    );
    if (grp.placements.length === 0) {
      writeLine(t("common.noPlacements", lang), {
        size: 9,
        color: [0.6, 0.6, 0.6],
        indent: 12,
      });
    } else {
      for (const pl of grp.placements) {
        writeLine(`• ${pl.placementName}`, { size: 10, indent: 12 });
        const meta = [
          pl.marketName ?? "—",
          pl.audience || "",
          pl.costMethod ?? "",
          fmtUsd(pl.amountUsd),
          pl.startDate && pl.endDate
            ? `${formatDate(pl.startDate, lang)} → ${formatDate(pl.endDate, lang)}`
            : "",
        ]
          .filter(Boolean)
          .join("   ·   ");
        writeWrapped(meta, { size: 8.5, indent: 24 });
        const metricEntries = Object.entries(pl.metricsJson ?? {});
        if (metricEntries.length > 0) {
          writeWrapped(
            metricEntries
              .map(([k, v]) =>
                `${k}: ${typeof v === "number" ? fmtNum(v) : String(v)}`,
              )
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
  writeLine(t("common.fees", lang), { size: 12, bold: true });
  y -= 2;
  if (detail.fees.length === 0) {
    writeLine(t("common.noFees", lang), { size: 9, color: [0.6, 0.6, 0.6] });
  } else {
    for (const f of detail.fees) {
      const rate = f.ratePct != null ? `   (${f.ratePct}%)` : "";
      const autoTag = f.isAutoComputed ? "  [auto]" : "";
      writeLine(
        `${f.feeType.padEnd(10)} ${f.name}${rate}   ${fmtUsd(f.amountUsd)}${autoTag}`,
        { mono: true, size: 9.5 },
      );
      if (f.notes) {
        writeWrapped(f.notes, { size: 8.5, indent: 12 });
      }
    }
  }

  // ─── Firma + disclaimer ──────────────────────────────────────────────
  writeSeparator();
  y -= 6;
  writeLine(t("export.signaturePrompt", lang), { size: 10 });
  y -= 2;
  writeLine(t("export.dateLabel", lang), { size: 10 });
  y -= 8;
  writeWrapped(t("export.signatureDisclaimer", lang), { size: 8 });

  // ─── Footer ──────────────────────────────────────────────────────────
  writeSeparator();
  const generatedDate = formatDateLong(
    new Date().toISOString().slice(0, 10),
    lang,
  );
  const timeUtc = new Date().toISOString().slice(11, 19);
  writeLine(
    `${t("common.generated", lang)}: ${generatedDate} ${timeUtc} UTC   ·   Sangria Media OS`,
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
