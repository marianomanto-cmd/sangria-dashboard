import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getBrandLogo } from "@/lib/brand-logo";
import type {
  PlanDetail,
  PlanPlacement,
  PlanPublisherGroup,
} from "@/db/queries/project-detail";
import {
  evalFormula,
  type MetricMeta,
  placementMetricValue,
  resolveMetricColumns,
} from "@/lib/plan-metrics";
import {
  DEFAULT_LANGUAGE,
  formatDate,
  formatDateLong,
  type Language,
  t,
} from "@/lib/i18n";

// Landscape letter: el plan se imprime apaisado para que la tabla de métricas
// (una columna por métrica) tenga ancho. El resto del documento fluye igual.
const PAGE_W = 792;
const PAGE_H = 612;
const MARGIN = 40;
const LINE_GAP = 14;

const ACCENT: [number, number, number] = [0.478, 0.122, 0.239]; // #7A1F3D
const ACCENT_SOFT: [number, number, number] = [0.961, 0.902, 0.925]; // #F5E6EC
const WHITE: [number, number, number] = [1, 1, 1];

export async function renderPlanPdf(
  detail: PlanDetail,
  allMetrics: MetricMeta[],
): Promise<Uint8Array> {
  const lang: Language = detail.client.language ?? DEFAULT_LANGUAGE;

  const allPlacements = detail.publishers.flatMap((g) => g.placements);
  // Columnas de métricas: directs presentes + calculated que resuelven (CTR,
  // engagement rate, CPM, etc. se computan por placement; no se persisten).
  const metricCols = resolveMetricColumns(allMetrics, allPlacements);
  const directSlugs = metricCols
    .filter((m) => m.kind === "direct")
    .map((m) => m.slug);
  const totalMediaUsd = detail.totals.media;

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
  // Los caracteres de control (newline, tab, C1) también explotan el encoder
  // (p.ej. una audience multilínea) → los pasamos a espacio. Acentos latinos
  // (0xA0-0xFF) sí están en WinAnsi.
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
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ")
      .replace(/[^\x20-\xFF]/g, "?");
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

  // ─── Primitivas de texto para la tabla (no avanzan y) ────────────────────
  function textAt(
    s: string,
    x: number,
    yy: number,
    o: { size: number; bold?: boolean; color?: [number, number, number] },
  ) {
    page.drawText(sanitize(s), {
      x,
      y: yy,
      size: o.size,
      font: o.bold ? fontBold : font,
      color: rgb(...(o.color ?? [0.1, 0.1, 0.1])),
    });
  }
  function textRight(
    s: string,
    xRight: number,
    yy: number,
    o: { size: number; bold?: boolean; color?: [number, number, number] },
  ) {
    const f = o.bold ? fontBold : font;
    const safe = sanitize(s);
    const w = f.widthOfTextAtSize(safe, o.size);
    page.drawText(safe, {
      x: xRight - w,
      y: yy,
      size: o.size,
      font: f,
      color: rgb(...(o.color ?? [0.1, 0.1, 0.1])),
    });
  }
  function truncate(
    s: string,
    f: typeof font,
    size: number,
    maxW: number,
  ): string {
    let safe = sanitize(s);
    if (f.widthOfTextAtSize(safe, size) <= maxW) return safe;
    while (safe.length > 1 && f.widthOfTextAtSize(`${safe}..`, size) > maxW) {
      safe = safe.slice(0, -1);
    }
    return `${safe}..`;
  }
  function wrap(s: string, f: typeof font, size: number, maxW: number): string[] {
    const words = sanitize(s).split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (f.widthOfTextAtSize(test, size) > maxW && line) {
        lines.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines.slice(0, 3);
  }

  const numberLocale = lang === "es" ? "es-AR" : "en-US";
  function fmtUsd(v: number): string {
    return `$${v.toLocaleString(numberLocale, { maximumFractionDigits: 0 })}`;
  }
  function fmtMetric(v: number, unit: string | null): string {
    if (unit === "%")
      return `${(v * 100).toLocaleString(numberLocale, { maximumFractionDigits: 2 })}%`;
    if (unit === "$")
      return `$${v.toLocaleString(numberLocale, { maximumFractionDigits: v < 1 ? 4 : 2 })}`;
    return v.toLocaleString(numberLocale, { maximumFractionDigits: 0 });
  }

  function sumDirects(
    placements: PlanPlacement[],
    slugs: string[],
  ): Record<string, number> {
    const acc: Record<string, number> = {};
    for (const s of slugs) acc[s] = 0;
    for (const pl of placements) {
      for (const s of slugs) {
        const v = pl.metricsJson?.[s];
        if (typeof v === "number" && Number.isFinite(v)) acc[s] += v;
      }
    }
    return acc;
  }

  // ─── Logo de marca (esquina superior derecha) ────────────────────────────
  let logoW = 0;
  const logo = getBrandLogo();
  if (logo) {
    try {
      const img =
        logo.type === "png"
          ? await pdf.embedPng(logo.bytes)
          : await pdf.embedJpg(logo.bytes);
      const boxW = 150;
      const boxH = 58;
      const scale = Math.min(boxW / img.width, boxH / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      logoW = w;
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

  // ─── Header ──────────────────────────────────────────────────────────────
  // El título se trunca al ancho disponible a la izquierda del logo para no
  // pisarlo (ambos viven en la misma banda superior).
  const headerMaxW = PAGE_W - MARGIN * 2 - (logoW > 0 ? logoW + 18 : 0);
  writeLine(t("export.mediaPlan", lang), { size: 8, bold: true, color: ACCENT });
  writeLine(truncate(detail.plan.name, fontBold, 17, headerMaxW), { size: 17, bold: true });
  writeLine(truncate(detail.project.code, fontMono, 10, headerMaxW), {
    size: 10,
    mono: true,
    color: [0.45, 0.45, 0.45],
  });
  y -= 4;

  // ─── Metadata ──────────────────────────────────────────────────────────
  writeLine(`${t("common.client", lang)}: ${detail.client.name}`);
  writeLine(`${t("common.project", lang)}: ${detail.project.name}`);
  writeLine(`${t("common.budgetOrigin", lang)}: ${detail.budgetOrigin.name}`);
  const statusLabel = t(`status.${detail.plan.status}`, lang);
  writeLine(
    `${t("common.status", lang)}: ${statusLabel}${detail.plan.currentVersion > 0 ? `   ·   v${detail.plan.currentVersion}` : ""}`,
  );

  writeSeparator();

  // ─── Totales ──────────────────────────────────────────────────────────
  writeLine(t("export.totals", lang), { size: 12, bold: true });
  writeLine(`${t("common.media", lang)}:  ${fmtUsd(detail.totals.media)}`, { mono: true });
  writeLine(`${t("common.fees", lang)}:   ${fmtUsd(detail.totals.fees)}`, { mono: true });
  writeLine(`Grand:  ${fmtUsd(detail.totals.grand)}`, { mono: true, bold: true });

  writeSeparator();

  // ─── Tabla Publishers + placements + métricas ────────────────────────────
  writeLine(t("export.publishersPlacements", lang), { size: 12, bold: true });
  y -= 4;

  // Layout de columnas: nombre (flexible) + inversión + una por métrica.
  const usableW = PAGE_W - MARGIN * 2;
  const investW = 74;
  const minNameW = 150;
  const M = metricCols.length;
  let metricW = M > 0 ? (usableW - minNameW - investW) / M : 0;
  metricW = Math.max(40, Math.min(86, metricW));
  let nameW = usableW - investW - metricW * M;
  if (nameW < minNameW && M > 0) {
    metricW = Math.max(34, (usableW - minNameW - investW) / M);
    nameW = usableW - investW - metricW * M;
  }
  const tableW = usableW;
  const xName = MARGIN;
  const xInvest = MARGIN + nameW;
  const investRight = xInvest + investW - 4;
  const metricRight = (i: number) =>
    MARGIN + nameW + investW + i * metricW + metricW - 4;
  const bodyFont = metricW < 50 ? 7 : 8;

  // Header de la tabla (texto wrap a 1-3 líneas según ancho de columna).
  const headerSize = 7;
  const headerLineH = 9;
  const investHdr = lang === "es" ? "Inv. (USD)" : "Invest. (USD)";
  type Hdr = { lines: string[]; right: boolean; x: number };
  const headerCols: Hdr[] = [
    {
      lines: wrap(t("common.publisherPlacement", lang), fontBold, headerSize, nameW - 8),
      right: false,
      x: xName + 4,
    },
    { lines: wrap(investHdr, fontBold, headerSize, investW - 6), right: true, x: investRight },
    ...metricCols.map((m, i) => ({
      lines: wrap(m.name, fontBold, headerSize, metricW - 6),
      right: true,
      x: metricRight(i),
    })),
  ];
  const maxLines = Math.max(1, ...headerCols.map((c) => c.lines.length));
  const headerH = maxLines * headerLineH + 8;

  function drawTableHeader() {
    page.drawRectangle({
      x: MARGIN,
      y: y - headerH,
      width: tableW,
      height: headerH,
      color: rgb(...ACCENT),
    });
    for (const c of headerCols) {
      c.lines.forEach((ln, li) => {
        const ty = y - 9 - li * headerLineH;
        if (c.right) {
          const w = fontBold.widthOfTextAtSize(ln, headerSize);
          page.drawText(ln, { x: c.x - w, y: ty, size: headerSize, font: fontBold, color: rgb(...WHITE) });
        } else {
          page.drawText(ln, { x: c.x, y: ty, size: headerSize, font: fontBold, color: rgb(...WHITE) });
        }
      });
    }
    y -= headerH;
  }

  function ensureRoom(rowH: number) {
    if (y - rowH < MARGIN + 6) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
      drawTableHeader();
    }
  }

  function drawGroupRow(grp: PlanPublisherGroup) {
    const rowH = 16;
    ensureRoom(rowH);
    page.drawRectangle({ x: MARGIN, y: y - rowH, width: tableW, height: rowH, color: rgb(...ACCENT_SOFT) });
    const paysTag = grp.agencyPays
      ? `[${t("common.agencyPays", lang)}]`
      : `[${t("common.clientPays", lang)}]`;
    textAt(truncate(`${grp.publisherName}  ${paysTag}`, fontBold, 8.5, nameW - 8), xName + 4, y - 11, {
      size: 8.5,
      bold: true,
    });
    textRight(fmtUsd(grp.totalPlannedUsd), investRight, y - 11, { size: 8.5, bold: true });
    const pubDirects = sumDirects(grp.placements, directSlugs);
    metricCols.forEach((m, i) => {
      const v =
        m.kind === "direct"
          ? (pubDirects[m.slug] ?? null)
          : evalFormula(m.formula, grp.totalPlannedUsd, pubDirects);
      if (v != null && Number.isFinite(v)) {
        textRight(fmtMetric(v, m.unit), metricRight(i), y - 11, { size: bodyFont, bold: true });
      }
    });
    y -= rowH;
  }

  function drawNoPlacements() {
    const rowH = 13;
    ensureRoom(rowH);
    textAt(t("common.noPlacements", lang), xName + 8, y - 10, { size: 8, color: [0.6, 0.6, 0.6] });
    y -= rowH;
  }

  function drawPlacementRow(pl: PlanPlacement) {
    const dates =
      pl.startDate && pl.endDate
        ? `${formatDate(pl.startDate, lang)} -> ${formatDate(pl.endDate, lang)}`
        : "";
    const subLine = [pl.marketName, pl.audience, pl.costMethod, dates]
      .filter(Boolean)
      .join("  ·  ");
    const rowH = subLine ? 25 : 15;
    ensureRoom(rowH);
    const lineY = y - 11;
    textAt(truncate(pl.placementName, font, 8.5, nameW - 10), xName + 6, lineY, { size: 8.5 });
    if (subLine) {
      textAt(truncate(subLine, font, 6.5, nameW - 12), xName + 8, y - 21, {
        size: 6.5,
        color: [0.45, 0.45, 0.45],
      });
    }
    textRight(fmtUsd(pl.amountUsd), investRight, lineY, { size: 8.5 });
    metricCols.forEach((m, i) => {
      const v = placementMetricValue(m, pl);
      if (v != null && Number.isFinite(v)) {
        textRight(fmtMetric(v, m.unit), metricRight(i), lineY, { size: bodyFont });
      }
    });
    page.drawLine({
      start: { x: MARGIN, y: y - rowH + 1 },
      end: { x: MARGIN + tableW, y: y - rowH + 1 },
      thickness: 0.4,
      color: rgb(0.85, 0.85, 0.85),
    });
    y -= rowH;
  }

  function drawTotalRow() {
    const rowH = 17;
    ensureRoom(rowH);
    page.drawRectangle({ x: MARGIN, y: y - rowH, width: tableW, height: rowH, color: rgb(...ACCENT) });
    textAt(lang === "es" ? "TOTAL MEDIA" : "MEDIA TOTAL", xName + 4, y - 12, {
      size: 9,
      bold: true,
      color: WHITE,
    });
    textRight(fmtUsd(totalMediaUsd), investRight, y - 12, { size: 9, bold: true, color: WHITE });
    const planDirects = sumDirects(allPlacements, directSlugs);
    metricCols.forEach((m, i) => {
      const v =
        m.kind === "direct"
          ? (planDirects[m.slug] ?? null)
          : evalFormula(m.formula, totalMediaUsd, planDirects);
      if (v != null && Number.isFinite(v)) {
        textRight(fmtMetric(v, m.unit), metricRight(i), y - 12, {
          size: bodyFont,
          bold: true,
          color: WHITE,
        });
      }
    });
    y -= rowH;
  }

  if (y - (headerH + 26) < MARGIN) {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  }
  drawTableHeader();
  for (const grp of detail.publishers) {
    drawGroupRow(grp);
    if (grp.placements.length === 0) drawNoPlacements();
    else for (const pl of grp.placements) drawPlacementRow(pl);
  }
  drawTotalRow();
  y -= 10;

  // ─── Fees ──────────────────────────────────────────────────────────────
  writeSeparator();
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

  // ─── Firma + disclaimer ──────────────────────────────────────────────────
  writeSeparator();
  y -= 6;
  writeLine(t("export.signaturePrompt", lang), { size: 10 });
  y -= 2;
  writeLine(t("export.dateLabel", lang), { size: 10 });
  y -= 8;
  writeWrapped(t("export.signatureDisclaimer", lang), { size: 8 });

  // ─── Footer ──────────────────────────────────────────────────────────────
  writeSeparator();
  const generatedDate = formatDateLong(new Date().toISOString().slice(0, 10), lang);
  const timeUtc = new Date().toISOString().slice(11, 19);
  writeLine(
    `${t("common.generated", lang)}: ${generatedDate} ${timeUtc} UTC   ·   Sangria Media OS`,
    { size: 8, color: [0.55, 0.55, 0.55], mono: true },
  );

  return await pdf.save();
}
