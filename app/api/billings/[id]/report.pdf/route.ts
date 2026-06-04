import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
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
// ════════════════════════════════════════════════════════════════════════════

const PAGE_W = 612; // letter
const PAGE_H = 792;
const MARGIN = 40;

// Posiciones X de columnas (de izquierda, anclado en MARGIN)
const COL_NUM_X = 0;       // 24 wide
const COL_PROD_X = 28;     // 90 wide
const COL_DESC_X = 122;    // 290 wide (truncates)
const COL_QTY_X = 416;     // 30 wide (centered)
const COL_RATE_X = 452;    // 50 wide (right-aligned)
const COL_AMT_X = 510;     // 50 wide (right-aligned, ends at MARGIN + 532 = 572 ≈ PAGE_W - MARGIN)

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
  const fontMono = await pdf.embedFont(StandardFonts.Courier);

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  function newPageIfNeeded(needed: number) {
    if (y - needed < MARGIN + 60) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
      drawTableHeader();
    }
  }

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

  function drawText(
    text: string,
    x: number,
    options: {
      size?: number;
      bold?: boolean;
      mono?: boolean;
      color?: [number, number, number];
      align?: "left" | "right" | "center";
      maxWidth?: number;
    } = {},
  ) {
    const size = options.size ?? 9.5;
    const f = options.bold ? fontBold : options.mono ? fontMono : font;
    const color = options.color ?? [0.12, 0.12, 0.12];
    let drawX = MARGIN + x;
    let str = sanitize(text);
    if (options.maxWidth) {
      // Truncar si excede maxWidth
      while (f.widthOfTextAtSize(str, size) > options.maxWidth && str.length > 1) {
        str = `${str.slice(0, -2)}…`.replace("…", "...");
        if (str.endsWith("....")) str = str.slice(0, -3);
      }
    }
    if (options.align === "right") {
      const w = f.widthOfTextAtSize(str, size);
      drawX = MARGIN + x + (options.maxWidth ?? 0) - w;
    } else if (options.align === "center") {
      const w = f.widthOfTextAtSize(str, size);
      drawX = MARGIN + x + ((options.maxWidth ?? 0) - w) / 2;
    }
    page.drawText(str, {
      x: drawX,
      y,
      size,
      font: f,
      color: rgb(color[0], color[1], color[2]),
    });
  }

  function drawTableHeader() {
    const purple: [number, number, number] = [0.48, 0.12, 0.24];
    // fondo
    page.drawRectangle({
      x: MARGIN,
      y: y - 16,
      width: PAGE_W - MARGIN * 2,
      height: 18,
      color: rgb(purple[0], purple[1], purple[2]),
    });
    const headerY = y - 12;
    const saved = y;
    y = headerY;
    drawText("#", COL_NUM_X, { bold: true, color: [1, 1, 1], maxWidth: 24, align: "center" });
    drawText("Product/service", COL_PROD_X, { bold: true, color: [1, 1, 1], maxWidth: 90 });
    drawText("Description", COL_DESC_X, { bold: true, color: [1, 1, 1], maxWidth: 290 });
    drawText("Qty", COL_QTY_X, { bold: true, color: [1, 1, 1], maxWidth: 30, align: "center" });
    drawText("Rate", COL_RATE_X, { bold: true, color: [1, 1, 1], maxWidth: 50, align: "right" });
    drawText("Amount", COL_AMT_X, { bold: true, color: [1, 1, 1], maxWidth: 50, align: "right" });
    y = saved - 22;
  }

  function drawRow(
    idx: number,
    productService: string,
    description: string,
    amountUsd: number,
    options: { altBg?: boolean } = {},
  ) {
    newPageIfNeeded(20);
    if (options.altBg) {
      page.drawRectangle({
        x: MARGIN,
        y: y - 4,
        width: PAGE_W - MARGIN * 2,
        height: 16,
        color: rgb(0.97, 0.96, 0.95),
      });
    }
    drawText(String(idx), COL_NUM_X, { maxWidth: 24, align: "center", mono: true });
    drawText(productService, COL_PROD_X, { maxWidth: 90 });
    drawText(description, COL_DESC_X, { maxWidth: 290 });
    drawText("1", COL_QTY_X, { maxWidth: 30, align: "center", mono: true });
    drawText(fmtUsd(amountUsd), COL_RATE_X, { maxWidth: 50, align: "right", mono: true });
    drawText(fmtUsd(amountUsd), COL_AMT_X, { maxWidth: 50, align: "right", mono: true, bold: true });
    y -= 16;
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
    newPageIfNeeded(20);
    drawText("(no billable lines for this month)", COL_PROD_X, {
      size: 9,
      color: [0.5, 0.5, 0.5],
    });
    y -= 16;
  }

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
