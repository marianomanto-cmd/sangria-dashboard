import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { DEFAULT_LANGUAGE, formatMonth, type Language } from "@/lib/i18n";

// ════════════════════════════════════════════════════════════════════════════
// Render del reporte PDF de un plan_billing — formato pedido por finanzas:
//
//   #  | Product/service  | Description                            | Qty | Rate | Amount
//   1  | Media Placement  | <plan> - <project> - <publisher> - <month> | 1 | <amt> | <amt>
//   2  | Media Placement  | ...                                     | 1 | <amt> | <amt>
//   3  | Services         | Fee - <Fee name>                        | 1 | <amt> | <amt>
//   ...
//
// Una fila por publisher facturable + una fila por fee imputado. La Qty es
// siempre 1, Rate = Amount (es un único monto, no un unit price). El filtrado
// de qué publishers/fees entran vive en el route handler (necesita el detalle
// del billing); acá solo se dibuja.
//
// Estilo (importante — finanzas procesa este PDF con un sistema automático):
//   • NADA de filas con fondo de color. El header antes tenía un fondo bordó
//     que rompía el procesamiento del lado de finanzas ("the red rows won't
//     work in processing"). Ahora el header es texto oscuro sobre blanco con
//     una línea fina debajo, y las filas se separan con una línea fina gris.
//     Solo se usan trazos (líneas), nunca rectángulos rellenos.
//   • La descripción se ENVUELVE en varias líneas cuando no entra en la
//     columna, en vez de truncarse con "…". Así el texto siempre queda
//     completo y legible (antes se cortaba, p.ej. "... - Instagram - J.").
// ════════════════════════════════════════════════════════════════════════════

export type BillingReportInput = {
  planName: string;
  projectName: string;
  // Slug del cliente. Se usa solo para decidir el idioma del label del mes;
  // el cuerpo de la tabla queda siempre en inglés (formato de finanzas).
  clientSlug: string;
  month: string; // YYYY-MM
  mediaLines: { publisherName: string; amountUsd: number }[];
  feeLines: { feeName: string; amountUsd: number }[];
};

const PAGE_W = 612; // letter
const PAGE_H = 792;
const MARGIN = 40;

// Posiciones X (relativas a MARGIN) y anchos de cada columna. La columna
// Amount termina exactamente en el margen derecho (MARGIN + 0..532 → 572)
// para que ningún número quede pegado o cortado contra el borde de la hoja.
const COL_NUM_X = 0;
const COL_NUM_W = 20;
const COL_PROD_X = 26;
const COL_PROD_W = 84;
const COL_DESC_X = 114;
const COL_DESC_W = 232; // envuelve
const COL_QTY_X = 352;
const COL_QTY_W = 24;
const COL_RATE_X = 384;
const COL_RATE_W = 68;
const COL_AMT_X = 458;
const COL_AMT_W = 74;

const FONT_SIZE = 9.5;
const LINE_H = 11; // separación entre líneas dentro de una celda multilínea
const ROW_H = 16; // alto base de una fila de una sola línea (baseline→baseline)

export async function renderBillingReportPdf(
  input: BillingReportInput,
): Promise<Uint8Array> {
  // El label del mes va al idioma del cliente del plan; el cuerpo de la tabla
  // queda en inglés porque es el formato que pide finanzas ("Media Placement"
  // / "Services"). Hoy siempre EN.
  const headerLang: Language = input.clientSlug ? "en" : DEFAULT_LANGUAGE;

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fontMono = await pdf.embedFont(StandardFonts.Courier);

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN - 10; // baseline de la fila actual

  function sanitize(text: string): string {
    return text
      .replace(/→/g, "->")
      .replace(/—/g, "-")
      .replace(/–/g, "-")
      .replace(/·/g, "-")
      .replace(/“|”/g, '"')
      .replace(/‘|’/g, "'")
      .replace(/×/g, "x")
      .replace(/…/g, "...")
      .replace(/[^\x00-\xFF]/g, "?");
  }

  function fmtUsd(v: number): string {
    return `$${v.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  type FontRef = typeof font;

  // Parte un texto en líneas que entran en `maxWidth`. Corta por palabras;
  // si una palabra sola no entra (p.ej. un nombre de plan larguísimo sin
  // espacios) la parte por caracteres. Nunca trunca: todo el texto se
  // renderiza en tantas líneas como haga falta.
  function wrapText(
    text: string,
    f: FontRef,
    size: number,
    maxWidth: number,
  ): string[] {
    const words = sanitize(text).split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let cur = "";
    for (let word of words) {
      // Palabra más ancha que la columna → partir por caracteres.
      while (f.widthOfTextAtSize(word, size) > maxWidth && word.length > 1) {
        let i = 1;
        while (
          i < word.length &&
          f.widthOfTextAtSize(word.slice(0, i + 1), size) <= maxWidth
        ) {
          i++;
        }
        if (cur) {
          lines.push(cur);
          cur = "";
        }
        lines.push(word.slice(0, i));
        word = word.slice(i);
      }
      const test = cur ? `${cur} ${word}` : word;
      if (f.widthOfTextAtSize(test, size) <= maxWidth) {
        cur = test;
      } else {
        if (cur) lines.push(cur);
        cur = word;
      }
    }
    if (cur) lines.push(cur);
    return lines.length > 0 ? lines : [""];
  }

  function drawText(
    text: string,
    x: number,
    yPos: number,
    options: {
      size?: number;
      bold?: boolean;
      mono?: boolean;
      color?: [number, number, number];
      align?: "left" | "right" | "center";
      w?: number;
      truncate?: boolean;
    } = {},
  ) {
    const size = options.size ?? FONT_SIZE;
    const f = options.bold ? fontBold : options.mono ? fontMono : font;
    const color = options.color ?? [0.12, 0.12, 0.12];
    let str = sanitize(text);
    const w = options.w ?? 0;
    // Solo para celdas cortas de una línea (num/qty/rate/amount/product); la
    // descripción se envuelve con wrapText y nunca pasa por acá a truncarse.
    if (options.truncate && w > 0) {
      while (f.widthOfTextAtSize(str, size) > w && str.length > 1) {
        str = str.slice(0, -1);
      }
    }
    let drawX = MARGIN + x;
    if (options.align === "right") {
      drawX = MARGIN + x + w - f.widthOfTextAtSize(str, size);
    } else if (options.align === "center") {
      drawX = MARGIN + x + (w - f.widthOfTextAtSize(str, size)) / 2;
    }
    page.drawText(str, {
      x: drawX,
      y: yPos,
      size,
      font: f,
      color: rgb(color[0], color[1], color[2]),
    });
  }

  function hRule(atY: number, thickness: number, gray: number) {
    page.drawLine({
      start: { x: MARGIN, y: atY },
      end: { x: PAGE_W - MARGIN, y: atY },
      thickness,
      color: rgb(gray, gray, gray),
    });
  }

  function drawTableHeader() {
    const dark: [number, number, number] = [0.13, 0.13, 0.13];
    drawText("#", COL_NUM_X, y, { w: COL_NUM_W, bold: true, color: dark, align: "center" });
    drawText("Product/service", COL_PROD_X, y, { w: COL_PROD_W, bold: true, color: dark, truncate: true });
    drawText("Description", COL_DESC_X, y, { w: COL_DESC_W, bold: true, color: dark });
    drawText("Qty", COL_QTY_X, y, { w: COL_QTY_W, bold: true, color: dark, align: "center" });
    drawText("Rate", COL_RATE_X, y, { w: COL_RATE_W, bold: true, color: dark, align: "right" });
    drawText("Amount", COL_AMT_X, y, { w: COL_AMT_W, bold: true, color: dark, align: "right" });
    const ruleY = y - 6;
    hRule(ruleY, 1, 0.13);
    y = ruleY - 14; // baseline de la primera fila de datos
  }

  function newPageIfNeeded(rowH: number) {
    if (y - rowH < MARGIN) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN - 10;
      drawTableHeader();
    }
  }

  function drawRow(
    idx: number,
    productService: string,
    description: string,
    amountUsd: number,
  ) {
    const descLines = wrapText(description, font, FONT_SIZE, COL_DESC_W);
    const extra = (descLines.length - 1) * LINE_H;
    newPageIfNeeded(extra + ROW_H);
    const baseY = y;
    drawText(String(idx), COL_NUM_X, baseY, { w: COL_NUM_W, align: "center", mono: true });
    drawText(productService, COL_PROD_X, baseY, { w: COL_PROD_W, truncate: true });
    descLines.forEach((ln, i) => {
      drawText(ln, COL_DESC_X, baseY - i * LINE_H, { w: COL_DESC_W });
    });
    drawText("1", COL_QTY_X, baseY, { w: COL_QTY_W, align: "center", mono: true });
    drawText(fmtUsd(amountUsd), COL_RATE_X, baseY, { w: COL_RATE_W, align: "right", mono: true });
    drawText(fmtUsd(amountUsd), COL_AMT_X, baseY, { w: COL_AMT_W, align: "right", mono: true, bold: true });
    // Separador fino (trazo, no relleno) al pie de la fila.
    const sepY = baseY - extra - 6;
    hRule(sepY, 0.5, 0.86);
    y = sepY - 10; // baseline de la próxima fila
  }

  // ───── Tabla ───────────────────────────────────────────────────────────
  // Sin header de documento ni metadata — solo la tabla pedida por finanzas.
  drawTableHeader();

  let rowIdx = 1;

  for (const m of input.mediaLines) {
    const description = `${input.planName} - ${input.projectName} - ${m.publisherName} - ${formatMonth(input.month, headerLang)}`;
    drawRow(rowIdx, "Media Placement", description, m.amountUsd);
    rowIdx++;
  }

  for (const f of input.feeLines) {
    const description = `Fee - ${f.feeName}`;
    drawRow(rowIdx, "Services", description, f.amountUsd);
    rowIdx++;
  }

  if (input.mediaLines.length === 0 && input.feeLines.length === 0) {
    newPageIfNeeded(ROW_H);
    drawText("(no billable lines for this month)", COL_PROD_X, y, {
      size: 9,
      color: [0.5, 0.5, 0.5],
    });
    y -= ROW_H;
  }

  return pdf.save();
}
