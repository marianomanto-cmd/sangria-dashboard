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
  isProtectedAuxLabel,
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

// Separadores del naming del cliente ("COPA.m1220|Meta|Latam|..."). Son los
// únicos puntos de corte que tienen esos nombres: no llevan espacios.
const NAME_SEPARATORS = "|_/-";

// Tope de líneas por celda en las HOJAS AUXILIARES. El alto de cada fila se
// calcula con este mismo tope, así que cambiarlo acá cambia las dos puntas a
// la vez. (La tabla del plan no tiene tope: no se recorta nada.)
const AUX_MAX_LINES = 3;

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
  // Corta una "palabra" en los separadores del naming del cliente, dejando el
  // separador pegado al segmento que cierra. Sin esto,
  // "COPA.m1220|Meta|Latam|Performance|Awareness" es UNA palabra de 90
  // caracteres sin espacios: el wrap por palabras no la parte nunca y la celda
  // termina truncándola. Mismo criterio que components/placement-name.tsx.
  function splitOnNameSeparators(word: string): string[] {
    const out: string[] = [];
    let start = 0;
    for (let i = 0; i < word.length; i++) {
      if (NAME_SEPARATORS.includes(word[i])) {
        out.push(word.slice(start, i + 1));
        start = i + 1;
      }
    }
    if (start < word.length) out.push(word.slice(start));
    return out.length > 0 ? out : [word];
  }

  // Último recurso: un pedazo que no entra ni solo en la columna se parte por
  // carácter. Es feo, pero desbordar la celda o recortar en silencio es peor
  // en un documento que se firma.
  function splitToFit(
    piece: string,
    f: typeof font,
    size: number,
    maxW: number,
  ): string[] {
    if (piece.length <= 1 || f.widthOfTextAtSize(piece, size) <= maxW) {
      return [piece];
    }
    const out: string[] = [];
    let cur = "";
    for (const ch of piece) {
      if (cur && f.widthOfTextAtSize(cur + ch, size) > maxW) {
        out.push(cur);
        cur = ch;
      } else {
        cur += ch;
      }
    }
    if (cur) out.push(cur);
    return out;
  }

  // Wrap que NO recorta: devuelve todas las líneas que haga falta. `maxLines`
  // es opcional y sólo lo usan los headers de tabla, donde el alto sí es fijo.
  function wrap(
    s: string,
    f: typeof font,
    size: number,
    maxW: number,
    maxLines?: number,
  ): string[] {
    const safe = sanitize(s).trim();
    if (!safe) return [];
    // `glue` = este pedazo continúa la palabra anterior (vino de partir en un
    // separador o de un corte duro), así que al unirlo NO lleva espacio.
    const atoms: { text: string; glue: boolean }[] = [];
    for (const word of safe.split(/\s+/)) {
      let first = true;
      for (const piece of splitOnNameSeparators(word)) {
        for (const chunk of splitToFit(piece, f, size, maxW)) {
          atoms.push({ text: chunk, glue: !first });
          first = false;
        }
      }
    }
    const lines: string[] = [];
    let line = "";
    for (const a of atoms) {
      const sep = line === "" || a.glue ? "" : " ";
      const test = line + sep + a.text;
      if (line !== "" && f.widthOfTextAtSize(test, size) > maxW) {
        lines.push(line);
        line = a.text;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return maxLines != null ? lines.slice(0, maxLines) : lines;
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
  // El título envuelve al ancho disponible a la izquierda del logo (los dos
  // viven en la misma banda superior). Truncarlo dejaba planes con nombre
  // largo identificados a medias justo en la tapa del documento.
  const headerMaxW = PAGE_W - MARGIN * 2 - (logoW > 0 ? logoW + 18 : 0);
  writeLine(t("export.mediaPlan", lang), { size: 8, bold: true, color: ACCENT });
  y -= 5; // aire extra: el título (17pt) que sigue es más alto que su interlínea
  for (const ln of wrap(detail.plan.name, fontBold, 17, headerMaxW)) {
    writeLine(ln, { size: 17, bold: true });
  }
  for (const ln of wrap(detail.project.code, fontMono, 10, headerMaxW)) {
    writeLine(ln, { size: 10, mono: true, color: [0.45, 0.45, 0.45] });
  }
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

  // ── Layout de columnas ──────────────────────────────────────────────────
  // Este es el documento que firma el cliente, así que la prioridad es que se
  // lea: la columna del nombre se lleva el ancho que necesita el bloque de
  // datos del placement (nombre + mercado + audiencia + método + fechas), y
  // las métricas se reparten el resto.
  const usableW = PAGE_W - MARGIN * 2;

  // La columna de inversión se dimensiona con el monto MÁS ANCHO que va a
  // mostrar (los planes tienen montos de 7 cifras) en vez de un ancho fijo de
  // 74pt, que dejaba el número pegado al header o a la métrica de al lado.
  const INVEST_SIZE = 9;
  const investHdr = lang === "es" ? "Inv. (USD)" : "Invest. (USD)";
  const amountsShown = [
    totalMediaUsd,
    ...detail.publishers.map((g) => g.totalPlannedUsd),
    ...allPlacements.map((pl) => pl.amountUsd),
  ];
  const widestAmountW = Math.max(
    0,
    ...amountsShown.map((v) => fontBold.widthOfTextAtSize(fmtUsd(v), INVEST_SIZE)),
  );
  const investW = Math.max(78, Math.ceil(widestAmountW) + 16);

  // El bloque del placement necesita ancho real: con menos de ~230pt la
  // audiencia queda en una tira de una palabra por línea.
  const minNameW = 235;
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
  const investRight = xInvest + investW - 6;
  const metricRight = (i: number) =>
    MARGIN + nameW + investW + i * metricW + metricW - 4;
  const bodyFont = metricW < 50 ? 7 : 8;

  // ── Tipografía del bloque del placement ─────────────────────────────────
  // Antes: nombre a 8.5pt truncado con ".." y mercado + audiencia + método +
  // fechas apretados en UNA línea gris de 6.5pt, también truncada. O sea que
  // de la audiencia (que suele ser un párrafo) el cliente veía cuatro palabras.
  // Ahora el nombre envuelve y cada dato va etiquetado en su propia línea.
  const NAME_SIZE = 9;
  const NAME_LH = 11.5;
  const FACT_SIZE = 7.5;
  const FACT_LH = 9.5;
  const factLabels: [string, (pl: PlanPlacement) => string][] = [
    [t("common.market", lang), (pl) => pl.marketName ?? ""],
    [t("common.audience", lang), (pl) => pl.audience ?? ""],
    [t("common.costMethod", lang), (pl) => (pl.costMethod ?? "").toUpperCase()],
    [
      t("common.period", lang),
      (pl) =>
        pl.startDate && pl.endDate
          ? `${formatDate(pl.startDate, lang)} -> ${formatDate(pl.endDate, lang)}`
          : "",
    ],
  ];
  // Columna de etiquetas: fija, para que los valores queden alineados entre sí.
  const factLabelW =
    Math.ceil(
      Math.max(
        ...factLabels.map(([l]) =>
          fontBold.widthOfTextAtSize(`${sanitize(l)}:`, FACT_SIZE),
        ),
      ),
    ) + 5;

  // Header de la tabla: el alto se calcula con las líneas que salgan, así que
  // el tope sólo existe para que un nombre de métrica absurdo no se coma la
  // página. Con 6 líneas entra cualquier nombre real del catálogo sin cortarse.
  const HEADER_MAX_LINES = 6;
  const headerSize = 7;
  const headerLineH = 9;
  type Hdr = { lines: string[]; right: boolean; x: number };
  const headerCols: Hdr[] = [
    {
      lines: wrap(t("common.publisherPlacement", lang), fontBold, headerSize, nameW - 8, HEADER_MAX_LINES),
      right: false,
      x: xName + 4,
    },
    { lines: wrap(investHdr, fontBold, headerSize, investW - 6, HEADER_MAX_LINES), right: true, x: investRight },
    ...metricCols.map((m, i) => ({
      lines: wrap(m.name, fontBold, headerSize, metricW - 6, HEADER_MAX_LINES),
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
    // El nombre del publisher envuelve en vez de truncarse (hay nombres largos
    // tipo "Google / YouTube - Video Partners").
    const nameLines = wrap(grp.publisherName, fontBold, 9.5, nameW - 10);
    const rowH = nameLines.length * 12 + (periodStr ? 10 : 0) + 6;
    ensureRoom(rowH);
    page.drawRectangle({ x: MARGIN, y: y - rowH, width: tableW, height: rowH, color: rgb(...ACCENT_SOFT) });
    let ly = y - 12;
    for (const ln of nameLines) {
      textAt(ln, xName + 5, ly, { size: 9.5, bold: true });
      ly -= 12;
    }
    if (periodStr) {
      textAt(periodStr, xName + 5, ly, { size: 7, color: [0.4, 0.4, 0.4] });
    }
    const firstY = y - 12;
    textRight(fmtUsd(grp.totalPlannedUsd), investRight, firstY, {
      size: INVEST_SIZE,
      bold: true,
    });
    const pubDirects = sumDirectMetrics(grp.placements, directSlugs);
    metricCols.forEach((m, i) => {
      const v =
        m.kind === "direct"
          ? (pubDirects[m.slug] ?? null)
          : evalFormula(m.formula, grp.totalPlannedUsd, pubDirects);
      if (v != null && Number.isFinite(v)) {
        textRight(fmtMetric(v, m.unit), metricRight(i), firstY, { size: bodyFont, bold: true });
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

  // Bloque del placement: nombre envuelto + un renglón etiquetado por dato.
  // Nada se recorta. Las líneas se dibujan de a una con su propio ensureRoom,
  // así una audiencia larga fluye a la página siguiente en vez de pisar el pie
  // o desaparecer.
  function drawPlacementRow(pl: PlanPlacement) {
    const nameLines = wrap(
      pl.placementName || "-",
      fontBold,
      NAME_SIZE,
      nameW - 16,
    );
    const factValueW = nameW - 20 - factLabelW;
    const facts = factLabels
      .map(([label, get]) => ({ label, lines: wrap(get(pl), font, FACT_SIZE, factValueW) }))
      .filter((f) => f.lines.length > 0);

    // El bloque no se parte: o entra entero en lo que queda de página, o
    // arranca en la siguiente. Partirlo dejaba la audiencia sola arriba de una
    // página, sin el nombre del placement al que pertenece. Sólo un bloque más
    // alto que una página entera (una audiencia larguísima) fluye, y en ese
    // caso lo hace línea por línea, con su propio ensureRoom.
    const factLineCount = facts.reduce((n, f) => n + f.lines.length, 0);
    const blockH = nameLines.length * NAME_LH + factLineCount * FACT_LH + 9;
    const pageBodyH = PAGE_H - MARGIN * 2 - headerH;
    ensureRoom(
      blockH <= pageBodyH ? blockH : nameLines.length * NAME_LH + FACT_LH + 8,
    );

    // Monto y métricas van alineados con la PRIMERA línea del nombre.
    const firstY = y - NAME_LH + 2.5;
    textRight(fmtUsd(pl.amountUsd), investRight, firstY, { size: INVEST_SIZE });
    metricCols.forEach((m, i) => {
      const v = placementMetricValue(m, pl);
      if (v != null && Number.isFinite(v)) {
        textRight(fmtMetric(v, m.unit), metricRight(i), firstY, { size: bodyFont });
      }
    });

    for (const ln of nameLines) {
      ensureRoom(NAME_LH);
      textAt(ln, xName + 8, y - NAME_LH + 2.5, { size: NAME_SIZE, bold: true });
      y -= NAME_LH;
    }
    for (const f of facts) {
      f.lines.forEach((ln, li) => {
        ensureRoom(FACT_LH);
        const ty = y - FACT_LH + 2.5;
        // La etiqueta sólo en la primera línea del valor; las que siguen
        // arrancan alineadas debajo del valor (sangría francesa).
        if (li === 0) {
          textAt(`${f.label}:`, xName + 12, ty, {
            size: FACT_SIZE,
            bold: true,
            color: [0.42, 0.42, 0.42],
          });
        }
        textAt(ln, xName + 12 + factLabelW, ty, {
          size: FACT_SIZE,
          color: [0.28, 0.28, 0.28],
        });
        y -= FACT_LH;
      });
    }
    y -= 5;
    page.drawLine({
      start: { x: MARGIN, y: y + 1 },
      end: { x: MARGIN + tableW, y: y + 1 },
      thickness: 0.4,
      color: rgb(0.85, 0.85, 0.85),
    });
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
  // Tabla de verdad, con las mismas columnas y el mismo look que la de medios.
  // Antes era una tirada de texto monoespaciado ("management  Management fee
  // sobre media total   (13%)   $36.609  [auto]"): los montos quedaban en
  // cualquier lado del renglón, un nombre largo se iba de la hoja y no había
  // subtotal. En el documento que firma el cliente, los fees son plata que
  // paga: van alineados y sumados.
  writeSeparator();
  writeLine(t("common.fees", lang), { size: 12, bold: true });
  y -= 4;
  if (detail.fees.length === 0) {
    writeLine(t("common.noFees", lang), { size: 9, color: [0.6, 0.6, 0.6] });
  } else {
    const feeTypeW = 74;
    const feeRateW = 54;
    const feeAmountW = investW;
    const feeConceptW = usableW - feeTypeW - feeRateW - feeAmountW;
    const xFeeType = MARGIN;
    const xFeeConcept = xFeeType + feeTypeW;
    const feeRateRight = xFeeConcept + feeConceptW + feeRateW - 6;
    const feeAmountRight = MARGIN + usableW - 6;
    const FEE_SIZE = 9;
    const FEE_LH = 11.5;

    const feeHdrH = 15;
    newPageIfNeeded(feeHdrH + FEE_LH * 2);
    function drawFeesHeader() {
      page.drawRectangle({
        x: MARGIN,
        y: y - feeHdrH,
        width: usableW,
        height: feeHdrH,
        color: rgb(...ACCENT),
      });
      const ty = y - 10.5;
      textAt(t("common.type", lang), xFeeType + 5, ty, { size: headerSize, bold: true, color: WHITE });
      textAt(t("export.concept", lang), xFeeConcept + 5, ty, { size: headerSize, bold: true, color: WHITE });
      textRight(t("common.rate", lang), feeRateRight, ty, { size: headerSize, bold: true, color: WHITE });
      textRight(investHdr, feeAmountRight, ty, { size: headerSize, bold: true, color: WHITE });
      y -= feeHdrH;
    }
    drawFeesHeader();

    for (const f of detail.fees) {
      const conceptLines = wrap(f.name, font, FEE_SIZE, feeConceptW - 10);
      // El "[auto]" del management fee se explica en palabras: el cliente no
      // tiene por qué saber qué significa la etiqueta interna.
      const noteText = [
        f.notes?.trim(),
        f.isAutoComputed
          ? lang === "es"
            ? "Calculado automáticamente a partir del porcentaje sobre la media."
            : "Automatically computed from the percentage over media."
          : null,
      ]
        .filter(Boolean)
        .join(" ");
      const noteLines = wrap(noteText, font, 7.5, feeConceptW - 10);

      if (y - (FEE_LH * conceptLines.length + 6) < MARGIN + 6) {
        page = pdf.addPage([PAGE_W, PAGE_H]);
        y = PAGE_H - MARGIN;
        drawFeesHeader();
      }
      const firstY = y - FEE_LH + 2.5;
      textAt(t(`fee.${f.feeType}`, lang), xFeeType + 5, firstY, { size: FEE_SIZE, bold: true });
      textRight(f.ratePct != null ? `${f.ratePct}%` : "-", feeRateRight, firstY, { size: FEE_SIZE });
      textRight(fmtUsd(f.amountUsd), feeAmountRight, firstY, { size: FEE_SIZE });
      for (const ln of conceptLines) {
        newPageIfNeeded(FEE_LH);
        textAt(ln, xFeeConcept + 5, y - FEE_LH + 2.5, { size: FEE_SIZE });
        y -= FEE_LH;
      }
      for (const ln of noteLines) {
        newPageIfNeeded(9.5);
        textAt(ln, xFeeConcept + 5, y - 9.5 + 2.5, { size: 7.5, color: [0.42, 0.42, 0.42] });
        y -= 9.5;
      }
      y -= 4;
      page.drawLine({
        start: { x: MARGIN, y: y + 1 },
        end: { x: MARGIN + usableW, y: y + 1 },
        thickness: 0.4,
        color: rgb(0.85, 0.85, 0.85),
      });
    }

    // Subtotal de fees: la tabla de medios cierra con TOTAL MEDIA, ésta cierra
    // con TOTAL FEES. Los dos son los sumandos del GRAND TOTAL de abajo.
    const feeTotH = 17;
    newPageIfNeeded(feeTotH + 2);
    page.drawRectangle({ x: MARGIN, y: y - feeTotH, width: usableW, height: feeTotH, color: rgb(...ACCENT) });
    textAt(t("export.totalFees", lang), xFeeType + 5, y - 12, { size: 9, bold: true, color: WHITE });
    textRight(fmtUsd(detail.totals.fees), feeAmountRight, y - 12, { size: 9, bold: true, color: WHITE });
    y -= feeTotH;
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
    // Firma, fecha y disclaimer van SÍ O SÍ en la misma página: es lo que el
    // cliente firma, y separar las líneas de firma del texto que las obliga
    // deja un documento que no se sostiene. Antes cada línea decidía sola si
    // saltaba de página, y con un plan que cerraba cerca del borde la firma
    // quedaba en una hoja y el disclaimer en la siguiente. Reservamos el alto
    // del bloque entero (con el pie, para no dejar una página con sólo eso) y
    // si no entra, abrimos página nueva antes de empezar.
    const discLines = wrap(
      t("export.signatureDisclaimer", lang),
      font,
      8,
      PAGE_W - MARGIN * 2,
    );
    const blockH = 14 + 6 + 14 + 2 + 14 + 8 + discLines.length * 11 + 14 + 12;
    if (y - blockH < MARGIN) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
    writeSeparator();
    y -= 6;
    writeLine(t("export.signaturePrompt", lang), { size: 10 });
    y -= 2;
    writeLine(t("export.dateLabel", lang), { size: 10 });
    y -= 8;
    writeWrapped(t("export.signatureDisclaimer", lang), { size: 8 });
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

    const headerRowIdx = detectAuxHeaderRow(grid, firstContentRow);

    // ── Anchos de columna ─────────────────────────────────────────────────────
    // Por default cada columna toma el ancho de su contenido (acotado) y todo se
    // escala para llenar el ancho usable (la tabla queda full-width como la del
    // plan); al escalar hacia abajo, una columna angosta puede truncar con "…".
    //
    // REGLA DE NEGOCIO: una columna de monto de inversión (etiqueta "NET TOTAL")
    // SIEMPRE tiene que quedar legible → esas columnas se marcan "protegidas":
    // toman su ancho COMPLETO (el que necesita su celda más ancha, sin truncar) y
    // el resto del ancho usable se reparte entre las demás.
    const minColW = 40;
    const maxColW = 220;

    // ¿Una fila se dibuja en negrita? (header / subtotal / total / grand). Se
    // mide con la fuente real para que el ancho reservado alcance.
    const rowIsBold = (r: number) =>
      r === headerRowIdx || classifyAuxRow(grid[r] ?? []) != null;

    // Columnas protegidas: las que tienen en alguna fila una etiqueta de monto.
    const protectedCol: boolean[] = new Array(tableCols).fill(false);
    for (let c = 0; c < tableCols; c++) {
      for (let r = firstContentRow; r <= lastContentRow; r++) {
        if (isProtectedAuxLabel(grid[r]?.[c] ?? "")) {
          protectedCol[c] = true;
          break;
        }
      }
    }

    // Ancho que necesita cada columna para mostrar su celda más ancha SIN
    // truncar (mide con la fuente real de cada fila).
    const required: number[] = new Array(tableCols).fill(0);
    for (let c = 0; c < tableCols; c++) {
      let maxW = 0;
      for (let r = firstContentRow; r <= lastContentRow; r++) {
        const m = findMerge(merges, r, c);
        // Ignoramos celdas combinadas a lo ancho (su texto se reparte).
        if (m && (m.r0 !== r || m.c0 !== c || m.c1 !== m.c0)) continue;
        const txt = auxCellDisplay(grid, r, c);
        if (!txt) continue;
        const f = rowIsBold(r) ? fontBold : font;
        const w = f.widthOfTextAtSize(sanitize(txt), bodyFont);
        if (w > maxW) maxW = w;
      }
      required[c] = maxW + padX * 2;
    }

    // Objetivo por columna: protegida = required completo (mín. minColW);
    // normal = required acotado a [minColW, maxColW].
    const protTarget = (c: number) => Math.max(minColW, required[c]);
    const normTarget = (c: number) =>
      Math.min(maxColW, Math.max(minColW, required[c]));

    let protectedWidth = 0;
    let otherNatural = 0;
    for (let c = 0; c < tableCols; c++) {
      if (protectedCol[c]) protectedWidth += protTarget(c);
      else otherNatural += normTarget(c);
    }

    const colW: number[] = new Array(tableCols).fill(0);
    if (protectedWidth >= usableW) {
      // Caso extremo: ni las columnas protegidas entran en el ancho usable.
      // Escalamos todo proporcional (best-effort; podría truncar, muy raro).
      const total = protectedWidth + otherNatural || usableW;
      const sc = usableW / total;
      for (let c = 0; c < tableCols; c++) {
        colW[c] = (protectedCol[c] ? protTarget(c) : normTarget(c)) * sc;
      }
    } else {
      const remaining = usableW - protectedWidth;
      if (otherNatural > 0) {
        // Protegidas con su ancho completo; el resto se escala (arriba o abajo)
        // para llenar el ancho usable restante.
        const sc = remaining / otherNatural;
        for (let c = 0; c < tableCols; c++) {
          colW[c] = protectedCol[c] ? protTarget(c) : normTarget(c) * sc;
        }
      } else {
        // Solo columnas protegidas: reparten todo el ancho (>= target → nunca
        // truncan).
        const sc = usableW / protectedWidth;
        for (let c = 0; c < tableCols; c++) colW[c] = protTarget(c) * sc;
      }
    }

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
        const lines = wrap(txt, font, bodyFont, availW, AUX_MAX_LINES).length;
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
          const lines = wrap(txt, font, bodyFont, cw - padX * 2, AUX_MAX_LINES);
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
