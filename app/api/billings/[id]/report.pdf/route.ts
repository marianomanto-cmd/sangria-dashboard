import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { getBillingDetail } from "@/db/queries/billing";
import { DEFAULT_LANGUAGE, formatMonth, type Language } from "@/lib/i18n";

// ════════════════════════════════════════════════════════════════════════════
// Reporte PDF de un plan_billing — formato pedido por finanzas:
//
//   #  | Product/service  | Description                            | Qty | Rate | Amount
//   1  | Media Placement  | <plan> - <project> - <publisher> - <month> | 1 | <amt> | <amt>
//   2  | Media Placement  | ...                                     | 1 | <amt> | <amt>
//   3  | Services         | Fee - <Fee name>                        | 1 | <amt> | <amt>
//   ...
//
// Una fila por publisher facturable con consumo > 0 + una fila por cada fee
// con imputación > 0 en el mes. La Qty es siempre 1, Rate = Amount (porque
// es un único monto, no un unit price).
//
// Este PDF se descarga cuando el manager aprieta "Reportar" en el editor del
// billing; el billing pasa a estado 'sent' (reportado).
//
// ── Estilo (pedido explícito: "que no tengan el fondo bordo, molesta / misma
// tipografía en todas las celdas / todo legible") ──────────────────────────
//   · Header SIN fondo bordó: gris muy claro + texto tinta + línea divisoria.
//     El PDF va a finanzas y se imprime/reenvía; el bloque de color saturado
//     molestaba y no aporta información.
//   · UNA sola tipografía (Helvetica) en TODAS las celdas del cuerpo, mismo
//     size. El header es el único bold. Antes se mezclaba Courier y Helvetica
//     dentro de una misma fila. Los dígitos de Helvetica son de ancho fijo,
//     así que las columnas de plata alinean igual sin usar monoespaciada.
//   · Nada se trunca: la Description hace wrap en varias líneas y la fila
//     crece; las columnas de plata son anchas para el monto más largo real.
// ════════════════════════════════════════════════════════════════════════════

const PAGE_W = 612; // letter
const PAGE_H = 792;
const MARGIN = 40;
const TABLE_W = PAGE_W - MARGIN * 2; // 532

// Geometría de columnas: x relativo a MARGIN + ancho. Con 6pt de padding
// interno a cada lado para que el texto no toque el borde del sombreado.
const COL = {
  num: { x: 6, w: 16 },
  prod: { x: 26, w: 86 },
  desc: { x: 118, w: 214 },
  qty: { x: 338, w: 24 },
  rate: { x: 368, w: 76 },
  amt: { x: 448, w: 78 }, // 448 + 78 = 526 (+6 de padding = 532) ✓
} as const;

// Paleta neutra — sin bordó.
const INK: [number, number, number] = [0.11, 0.11, 0.12];
const MUTED: [number, number, number] = [0.45, 0.45, 0.48];
const HEADER_BG: [number, number, number] = [0.93, 0.93, 0.94];
const ZEBRA: [number, number, number] = [0.972, 0.972, 0.976];
const RULE: [number, number, number] = [0.75, 0.75, 0.78];

const FONT_SIZE = 9.5;
const HEADER_SIZE = 9;
const LINE_H = 12; // interlineado dentro de una celda con wrap
const PAD_TOP = 4.5;
const PAD_BOTTOM = 4.5;
const HEADER_H = 19;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const detail = await getBillingDetail(id);
  if (!detail) {
    return new Response("Billing not found", { status: 404 });
  }

  const lang: Language = DEFAULT_LANGUAGE;
  // El idioma del PDF de billing va al idioma del cliente del plan (si es ES
  // queremos labels en español; el cuerpo de la tabla queda en inglés porque
  // es el formato que pide finanzas — "Media Placement" / "Services").
  // Por ahora siempre EN en la tabla y ES/EN en el header.
  const headerLang: Language = detail.client.slug ? "en" : lang;

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  // `y` es siempre el borde SUPERIOR de lo próximo que se dibuja.
  let y = PAGE_H - MARGIN;

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

  // Corta el texto en las líneas que entren en `maxWidth`. Nunca trunca: si una
  // palabra sola es más ancha que la columna, la parte por caracteres.
  function wrapText(text: string, f: PDFFont, size: number, maxWidth: number): string[] {
    const words = sanitize(text).split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let cur = "";
    for (const word of words) {
      const candidate = cur ? `${cur} ${word}` : word;
      if (f.widthOfTextAtSize(candidate, size) <= maxWidth) {
        cur = candidate;
        continue;
      }
      if (cur) {
        lines.push(cur);
        cur = "";
      }
      let chunk = "";
      for (const ch of word) {
        if (chunk && f.widthOfTextAtSize(chunk + ch, size) > maxWidth) {
          lines.push(chunk);
          chunk = ch;
        } else {
          chunk += ch;
        }
      }
      cur = chunk;
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [""];
  }

  function drawCell(
    text: string,
    col: { x: number; w: number },
    baselineY: number,
    options: {
      size?: number;
      bold?: boolean;
      color?: [number, number, number];
      align?: "left" | "right" | "center";
    } = {},
  ) {
    const size = options.size ?? FONT_SIZE;
    const f = options.bold ? fontBold : font;
    const color = options.color ?? INK;
    const str = sanitize(text);
    const w = f.widthOfTextAtSize(str, size);
    let drawX = MARGIN + col.x;
    if (options.align === "right") drawX = MARGIN + col.x + col.w - w;
    else if (options.align === "center") drawX = MARGIN + col.x + (col.w - w) / 2;
    page.drawText(str, {
      x: drawX,
      y: baselineY,
      size,
      font: f,
      color: rgb(color[0], color[1], color[2]),
    });
  }

  function drawRule(atY: number) {
    page.drawLine({
      start: { x: MARGIN, y: atY },
      end: { x: PAGE_W - MARGIN, y: atY },
      thickness: 0.7,
      color: rgb(RULE[0], RULE[1], RULE[2]),
    });
  }

  function drawTableHeader() {
    page.drawRectangle({
      x: MARGIN,
      y: y - HEADER_H,
      width: TABLE_W,
      height: HEADER_H,
      color: rgb(HEADER_BG[0], HEADER_BG[1], HEADER_BG[2]),
    });
    const baseline = y - HEADER_H + 6.5;
    const o = { bold: true, size: HEADER_SIZE, color: INK } as const;
    drawCell("#", COL.num, baseline, { ...o, align: "center" });
    drawCell("Product/service", COL.prod, baseline, o);
    drawCell("Description", COL.desc, baseline, o);
    drawCell("Qty", COL.qty, baseline, { ...o, align: "center" });
    drawCell("Rate", COL.rate, baseline, { ...o, align: "right" });
    drawCell("Amount", COL.amt, baseline, { ...o, align: "right" });
    drawRule(y - HEADER_H);
    y -= HEADER_H;
  }

  function newPage() {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
    drawTableHeader();
  }

  function drawRow(
    idx: number,
    productService: string,
    description: string,
    amountUsd: number,
    options: { altBg?: boolean } = {},
  ) {
    const descLines = wrapText(description, font, FONT_SIZE, COL.desc.w);
    const rowH = PAD_TOP + FONT_SIZE + (descLines.length - 1) * LINE_H + PAD_BOTTOM;
    if (y - rowH < MARGIN) newPage();

    if (options.altBg) {
      page.drawRectangle({
        x: MARGIN,
        y: y - rowH,
        width: TABLE_W,
        height: rowH,
        color: rgb(ZEBRA[0], ZEBRA[1], ZEBRA[2]),
      });
    }
    const baseline = y - PAD_TOP - FONT_SIZE;
    drawCell(String(idx), COL.num, baseline, { align: "center", color: MUTED });
    drawCell(productService, COL.prod, baseline);
    descLines.forEach((line, i) => {
      drawCell(line, COL.desc, baseline - i * LINE_H);
    });
    drawCell("1", COL.qty, baseline, { align: "center" });
    drawCell(fmtUsd(amountUsd), COL.rate, baseline, { align: "right" });
    drawCell(fmtUsd(amountUsd), COL.amt, baseline, { align: "right" });
    y -= rowH;
  }

  // ───── Tabla ───────────────────────────────────────────────────────────
  // Sin header de documento ni metadata — solo la tabla pedida por finanzas.
  drawTableHeader();

  let rowIdx = 1;
  let alt = false;

  // Solo van al reporte los publishers que la AGENCIA paga (agencyPays). Los
  // que el cliente paga directo se cargan igual en el billing (su consumo
  // alimenta el cálculo del management fee, que el cliente sí paga), pero su
  // inversión de medios NO se factura ni se reporta: se excluyen del PDF.
  // `agencyPays` es la verdad estructural (override del bloque ?? default del
  // publisher); `isBillable` es el flag editable del mes y se respeta además
  // para poder marcar no-facturable un publisher de agencia en un mes puntual.
  const billablePublishers = detail.publisherLines.filter(
    (p) => p.agencyPays && p.isBillable && p.amountThisMonthUsd > 0,
  );
  for (const p of billablePublishers) {
    const description = `${detail.plan.name} - ${detail.project.name} - ${p.publisherName} - ${formatMonth(detail.billing.month, headerLang)}`;
    drawRow(rowIdx, "Media Placement", description, p.amountThisMonthUsd, {
      altBg: alt,
    });
    rowIdx++;
    alt = !alt;
  }

  // Fees con imputación > 0
  const imputedFees = detail.feeLines.filter((f) => f.imputedThisMonthUsd > 0);
  for (const f of imputedFees) {
    const description = `Fee - ${f.feeName}`;
    drawRow(rowIdx, "Services", description, f.imputedThisMonthUsd, {
      altBg: alt,
    });
    rowIdx++;
    alt = !alt;
  }

  if (billablePublishers.length === 0 && imputedFees.length === 0) {
    const rowH = PAD_TOP + FONT_SIZE + PAD_BOTTOM;
    if (y - rowH < MARGIN) newPage();
    drawCell("(no billable lines for this month)", COL.prod, y - PAD_TOP - FONT_SIZE, {
      color: MUTED,
    });
    y -= rowH;
  }

  drawRule(y);

  const bytes = await pdf.save();
  const filename = `${detail.project.code}.${detail.plan.name}.${detail.billing.month}.report.pdf`.replace(
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
