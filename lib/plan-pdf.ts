import { PDFDocument, type PDFPage, StandardFonts, rgb } from "pdf-lib";
import { getBrandLogo } from "@/lib/brand-logo";
import type {
  PlanAuxSheet,
  PlanDetail,
  PlanPlacement,
  PlanPublisherGroup,
} from "@/db/queries/project-detail";
import {
  evalFormula,
  type MetricMeta,
  placementMetricValue,
  placementsPeriod,
  resolveMetricColumns,
  sumDirectMetrics,
} from "@/lib/plan-metrics";
import {
  auxCellNumber,
  auxContentBounds,
  type AuxMerge,
  classifyAuxRow,
  detectAuxHeaderRow,
  evalAuxFormula,
  findMerge,
  isAuxFormula,
} from "@/lib/aux-sheet";
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
const INK: [number, number, number] = [0.11, 0.098, 0.09]; // #1C1917 (grand total)
const ZEBRA: [number, number, number] = [0.984, 0.957, 0.969]; // #FBF4F7 banding
const CELL_LINE: [number, number, number] = [0.839, 0.827, 0.82]; // #D6D3D1 borders

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
    newPageIfNeeded(14);
    page.drawLine({
      start: { x: MARGIN, y: y - 2 },
      end: { x: PAGE_W - MARGIN, y: y - 2 },
      thickness: 0.5,
      color: rgb(0.7, 0.7, 0.7),
    });
    // Bajamos lo suficiente para que el título de sección (size 12) que suele
    // venir después no toque la línea con sus ascendentes.
    y -= 14;
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

  // ─── Logo de marca (esquina superior derecha) ────────────────────────────
  // Lo embebemos una sola vez y lo redibujamos en cada página que abre sección
  // (la 1ra del plan + cada hoja auxiliar), vía drawLogo().
  let logoImg: Awaited<ReturnType<typeof pdf.embedPng>> | null = null;
  let logoW = 0;
  let logoH = 0;
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
      logoImg = img;
      logoW = img.width * scale;
      logoH = img.height * scale;
    } catch {
      // imagen inválida o no embebible: seguimos sin logo
    }
  }
  function drawLogo(p: PDFPage) {
    if (!logoImg) return;
    p.drawImage(logoImg, {
      x: PAGE_W - MARGIN - logoW,
      y: PAGE_H - MARGIN - logoH,
      width: logoW,
      height: logoH,
    });
  }
  drawLogo(page);

  // Páginas que ya llevan un bloque de firma/fecha (la última del plan y cada
  // hoja auxiliar). Las usa la pasada final de "iniciales por página".
  const signedPages = new Set<PDFPage>();

  // ─── Header ──────────────────────────────────────────────────────────────
  // El título se trunca al ancho disponible a la izquierda del logo para no
  // pisarlo (ambos viven en la misma banda superior).
  const headerMaxW = PAGE_W - MARGIN * 2 - (logoW > 0 ? logoW + 18 : 0);
  writeLine(t("export.mediaPlan", lang), { size: 8, bold: true, color: ACCENT });
  y -= 5; // aire extra: el título (17pt) que sigue es más alto que su interlínea
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
  // Período general del plan = más temprana/más tardía de todos los placements.
  const planPeriod = placementsPeriod(allPlacements);
  const planPeriodStr =
    planPeriod.start && planPeriod.end
      ? `${formatDate(planPeriod.start, lang)} -> ${formatDate(planPeriod.end, lang)}`
      : "—";
  writeLine(`${t("common.period", lang)}: ${planPeriodStr}`);
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
    // Fechas del publisher = más temprana/más tardía de sus placements; se
    // dibujan como sub-línea bajo el nombre (consistente con los placements).
    const period = placementsPeriod(grp.placements);
    const periodStr =
      period.start && period.end
        ? `${formatDate(period.start, lang)} -> ${formatDate(period.end, lang)}`
        : "";
    const rowH = periodStr ? 24 : 16;
    ensureRoom(rowH);
    page.drawRectangle({ x: MARGIN, y: y - rowH, width: tableW, height: rowH, color: rgb(...ACCENT_SOFT) });
    textAt(truncate(grp.publisherName, fontBold, 8.5, nameW - 8), xName + 4, y - 11, {
      size: 8.5,
      bold: true,
    });
    if (periodStr) {
      textAt(truncate(periodStr, font, 6.5, nameW - 8), xName + 4, y - 20, {
        size: 6.5,
        color: [0.45, 0.45, 0.45],
      });
    }
    textRight(fmtUsd(grp.totalPlannedUsd), investRight, y - 11, { size: 8.5, bold: true });
    const pubDirects = sumDirectMetrics(grp.placements, directSlugs);
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
    const planDirects = sumDirectMetrics(allPlacements, directSlugs);
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

  // ─── Total del plan (media + fees) ───────────────────────────────────────
  y -= 8;
  const gtH = 18;
  newPageIfNeeded(gtH + 2);
  page.drawRectangle({
    x: MARGIN,
    y: y - gtH,
    width: PAGE_W - MARGIN * 2,
    height: gtH,
    color: rgb(0.11, 0.098, 0.09),
  });
  textAt(t("common.grandTotal", lang), MARGIN + 6, y - 13, { size: 10, bold: true, color: WHITE });
  textAt(
    `(${t("common.media", lang)} ${fmtUsd(detail.totals.media)}  +  ${t("common.fees", lang)} ${fmtUsd(detail.totals.fees)})`,
    MARGIN + 116,
    y - 12,
    { size: 8, color: [0.78, 0.78, 0.78] },
  );
  textRight(fmtUsd(detail.totals.grand), PAGE_W - MARGIN - 6, y - 13, { size: 11, bold: true, color: WHITE });
  y -= gtH;

  // ─── Firma + disclaimer + footer del plan ────────────────────────────────
  drawSignatureBlock();
  drawFooterLine();

  // ─── Hojas auxiliares (una por página, con el formato del plan + firma) ───
  // El cliente firma cada hoja por separado, así que cada una lleva su propio
  // bloque de firma/fecha + disclaimer, igual que el plan principal.
  for (const aux of detail.auxSheets) renderAuxSheet(aux);

  // ─── Iniciales por página ────────────────────────────────────────────────
  // En docs multipágina el cliente inicializa cada página que NO lleva firma
  // completa (las páginas con bloque de firma —última del plan + cada hoja
  // auxiliar— ya quedan firmadas, así que se saltean).
  const pages = pdf.getPages();
  if (pages.length > 1) {
    const initials = sanitize(t("export.initials", lang));
    const size = 8;
    const w = font.widthOfTextAtSize(initials, size);
    for (const p of pages) {
      if (signedPages.has(p)) continue;
      p.drawText(initials, {
        x: PAGE_W - MARGIN - w,
        y: 20,
        size,
        font,
        color: rgb(0.45, 0.45, 0.45),
      });
    }
  }

  return await pdf.save();

  // ──────────────────────────────────────────────────────────────────────────
  // Helpers de sección (firma / footer / hojas auxiliares). Declarados como
  // function para hoistearse; cierran sobre page/y/lang/fuentes/helpers.
  // ──────────────────────────────────────────────────────────────────────────

  function drawSignatureBlock() {
    writeSeparator();
    y -= 6;
    writeLine(t("export.signaturePrompt", lang), { size: 10 });
    y -= 2;
    writeLine(t("export.dateLabel", lang), { size: 10 });
    y -= 8;
    writeWrapped(t("export.signatureDisclaimer", lang), { size: 8 });
    // La firma cae en la página actual (writeLine/writeWrapped pueden haber
    // saltado de página); la marcamos como firmada para la pasada de iniciales.
    signedPages.add(page);
  }

  function drawFooterLine() {
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
  }

  // Número formateado para mostrar el RESULTADO de una fórmula del tab aux
  // (las celdas de texto/número planas se muestran tal cual las cargó el planner).
  function fmtAuxNumber(v: number): string {
    if (Number.isInteger(v)) return v.toLocaleString(numberLocale);
    return v.toLocaleString(numberLocale, {
      maximumFractionDigits: Math.abs(v) < 1 ? 4 : 2,
    });
  }

  // Texto visible de una celda del tab auxiliar: fórmula → su resultado (o el
  // texto crudo si no resuelve, como hace el Excel), número/texto → tal cual.
  function auxCellDisplay(grid: string[][], r: number, c: number): string {
    const raw = (grid[r]?.[c] ?? "").trim();
    if (!raw) return "";
    if (isAuxFormula(raw)) {
      const res = evalAuxFormula(grid[r][c], grid, { r, c });
      return res.ok ? fmtAuxNumber(res.value) : raw;
    }
    return raw;
  }

  // ¿La celda es numérica (número suelto o fórmula que resuelve)? → se alinea a
  // la derecha, como las columnas de plata del plan.
  function auxIsNumeric(grid: string[][], r: number, c: number): boolean {
    const raw = (grid[r]?.[c] ?? "").trim();
    if (!raw) return false;
    if (isAuxFormula(raw)) return evalAuxFormula(grid[r][c], grid, { r, c }).ok;
    return auxCellNumber(raw) != null;
  }

  // Renderiza una hoja auxiliar en una página nueva: metadata del plan + la
  // grilla con el formato del plan (header accent, subtotales/totales, banding,
  // uniones) + bloque de firma/fecha.
  function renderAuxSheet(aux: PlanAuxSheet) {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
    drawLogo(page);

    const auxHeaderMaxW = PAGE_W - MARGIN * 2 - (logoW > 0 ? logoW + 18 : 0);
    writeLine(`${t("export.mediaPlan", lang)}  ·  ${t("export.auxSheet", lang)}`, {
      size: 8,
      bold: true,
      color: ACCENT,
    });
    y -= 5;
    writeLine(truncate(aux.name, fontBold, 17, auxHeaderMaxW), {
      size: 17,
      bold: true,
    });
    writeLine(truncate(detail.plan.name, fontMono, 10, auxHeaderMaxW), {
      size: 10,
      mono: true,
      color: [0.45, 0.45, 0.45],
    });
    y -= 4;

    // Metadata read-only (misma que el tab auxiliar del Excel: proyecto /
    // período / budget origin).
    writeLine(`${t("common.project", lang)}: ${detail.project.code} - ${detail.project.name}`);
    writeLine(`${t("common.period", lang)}: ${planPeriodStr}`);
    writeLine(`${t("common.budgetOrigin", lang)}: ${detail.budgetOrigin.name}`);

    writeSeparator();

    const grid = aux.grid;
    const merges = aux.merges;
    const bounds = auxContentBounds(grid, merges);
    if (bounds.firstContentRow === -1) {
      writeLine(lang === "es" ? "(hoja vacía)" : "(empty sheet)", {
        size: 9,
        color: [0.6, 0.6, 0.6],
      });
    } else {
      drawAuxTable(grid, merges, bounds);
    }

    drawSignatureBlock();
    drawFooterLine();
  }

  // Dibuja la grilla de un tab auxiliar como tabla a todo el ancho usable.
  function drawAuxTable(
    grid: string[][],
    merges: AuxMerge[],
    bounds: { firstContentRow: number; lastContentRow: number; lastContentCol: number },
  ) {
    const { firstContentRow, lastContentRow, lastContentCol } = bounds;
    const tableCols = Math.max(1, lastContentCol + 1);
    const usableW = PAGE_W - MARGIN * 2;
    const bodyFont = tableCols > 12 ? 7 : 8;
    const lineH = bodyFont + 2;
    const padX = 4;
    const padY = 3;

    // ── Anchos de columna: naturales (del contenido) escalados a llenar el
    // ancho usable, así la tabla queda full-width como la del plan ──
    const natural: number[] = new Array(tableCols).fill(0);
    for (let c = 0; c < tableCols; c++) {
      let maxW = 0;
      for (let r = firstContentRow; r <= lastContentRow; r++) {
        const m = findMerge(merges, r, c);
        // Para el sizing por columna ignoramos las celdas combinadas a lo ancho
        // (su texto se reparte entre varias columnas).
        if (m && (m.r0 !== r || m.c0 !== c || m.c1 !== m.c0)) continue;
        const txt = auxCellDisplay(grid, r, c);
        if (!txt) continue;
        const w = font.widthOfTextAtSize(sanitize(txt), bodyFont);
        if (w > maxW) maxW = w;
      }
      natural[c] = Math.min(220, Math.max(40, maxW + padX * 2));
    }
    const totalNatural = natural.reduce((s, w) => s + w, 0) || usableW;
    const scale = usableW / totalNatural;
    const colW = natural.map((w) => w * scale);
    const colX: number[] = [];
    let acc = MARGIN;
    for (let c = 0; c < tableCols; c++) {
      colX[c] = acc;
      acc += colW[c];
    }
    const mergedW = (c0: number, c1: number) => {
      let w = 0;
      for (let c = c0; c <= c1; c++) w += colW[c] ?? 0;
      return w;
    };

    const headerRowIdx = detectAuxHeaderRow(grid, firstContentRow);

    // ── Altura de cada fila (según el wrap del contenido por celda) ──
    const rowH: Record<number, number> = {};
    for (let r = firstContentRow; r <= lastContentRow; r++) {
      let maxLines = 1;
      for (let c = 0; c < tableCols; c++) {
        const m = findMerge(merges, r, c);
        if (m && (m.r0 !== r || m.c0 !== c)) continue; // no es la master
        const availW = (m ? mergedW(m.c0, m.c1) : colW[c]) - padX * 2;
        const txt = auxCellDisplay(grid, r, c);
        if (!txt) continue;
        const lines = wrap(txt, font, bodyFont, availW).length;
        if (lines > maxLines) maxLines = lines;
      }
      rowH[r] = maxLines * lineH + padY * 2;
    }
    const mergedH = (r0: number, r1: number) => {
      let h = 0;
      for (let r = r0; r <= r1; r++) h += rowH[r] ?? lineH + padY * 2;
      return h;
    };

    type RowKind = "header" | "grand" | "total" | "subtotal" | null;
    const styleFor = (
      kind: RowKind,
    ): { fill: [number, number, number] | null; text: [number, number, number]; bold: boolean } | null => {
      switch (kind) {
        case "header":
        case "total":
          return { fill: ACCENT, text: WHITE, bold: true };
        case "grand":
          return { fill: INK, text: WHITE, bold: true };
        case "subtotal":
          return { fill: ACCENT_SOFT, text: [0.1, 0.1, 0.1], bold: true };
        default:
          return null;
      }
    };

    let zebra = 0; // banding solo entre filas de datos

    function drawAuxRow(r: number) {
      const cells = grid[r] ?? [];
      const isHeader = r === headerRowIdx;
      const kind: RowKind = isHeader ? "header" : classifyAuxRow(cells);
      const style = styleFor(kind);
      let band = false;
      if (!style) {
        band = zebra % 2 === 1;
        zebra++;
      }
      const rowTop = y;
      for (let c = 0; c < tableCols; c++) {
        const m = findMerge(merges, r, c);
        if (m && (m.r0 !== r || m.c0 !== c)) continue; // celda tapada
        const cx = colX[m ? m.c0 : c];
        const cw = m ? mergedW(m.c0, m.c1) : colW[c];
        const ch = m ? mergedH(m.r0, m.r1) : rowH[r];
        const fill = style ? style.fill : band ? ZEBRA : null;
        if (fill) {
          page.drawRectangle({
            x: cx,
            y: rowTop - ch,
            width: cw,
            height: ch,
            color: rgb(...fill),
          });
        }
        page.drawRectangle({
          x: cx,
          y: rowTop - ch,
          width: cw,
          height: ch,
          borderColor: rgb(...CELL_LINE),
          borderWidth: 0.5,
        });
        const txt = auxCellDisplay(grid, r, c);
        if (txt) {
          const lines = wrap(txt, font, bodyFont, cw - padX * 2);
          const f = style?.bold ? fontBold : font;
          const color = style ? style.text : [0.1, 0.1, 0.1];
          const numeric = auxIsNumeric(grid, r, c);
          const blockH = lines.length * lineH;
          let ty = rowTop - (ch - blockH) / 2 - bodyFont;
          for (const ln of lines) {
            const sln = truncate(ln, f, bodyFont, cw - padX * 2);
            if (isHeader) {
              const w = f.widthOfTextAtSize(sln, bodyFont);
              page.drawText(sln, {
                x: cx + (cw - w) / 2,
                y: ty,
                size: bodyFont,
                font: f,
                color: rgb(color[0], color[1], color[2]),
              });
            } else if (numeric) {
              const w = f.widthOfTextAtSize(sln, bodyFont);
              page.drawText(sln, {
                x: cx + cw - padX - w,
                y: ty,
                size: bodyFont,
                font: f,
                color: rgb(color[0], color[1], color[2]),
              });
            } else {
              page.drawText(sln, {
                x: cx + padX,
                y: ty,
                size: bodyFont,
                font: f,
                color: rgb(color[0], color[1], color[2]),
              });
            }
            ty -= lineH;
          }
        }
      }
      y -= rowH[r];
    }

    for (let r = firstContentRow; r <= lastContentRow; r++) {
      const cells = grid[r] ?? [];
      const hasContent = cells.some((x) => x.trim());
      const coveredByMerge = merges.some((m) => r >= m.r0 && r <= m.r1);
      // Filas en blanco fuera de toda unión se saltean (como el Excel); las
      // cubiertas por una unión NO, para que el alto vertical de la unión cuadre.
      if (!hasContent && !coveredByMerge) continue;
      if (y - rowH[r] < MARGIN) {
        page = pdf.addPage([PAGE_W, PAGE_H]);
        y = PAGE_H - MARGIN;
        drawLogo(page);
        if (headerRowIdx >= 0 && r > headerRowIdx) drawAuxRow(headerRowIdx);
      }
      drawAuxRow(r);
    }
    y -= 10;
  }
}
