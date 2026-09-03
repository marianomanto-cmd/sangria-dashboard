import { and, asc, desc, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { clients, creativeBillings } from "@/db/schema";

// ════════════════════════════════════════════════════════════════════════════
// Queries de /creative — facturación de trabajo creativo (tabla propia,
// `creative_billings`, sin media plan detrás). Ver db/schema.ts.
//
// Los clientes archivados se excluyen siempre, igual que en el Billing Tracker.
// El scope respeta el filtro global ?client= cuando está activo.
// ════════════════════════════════════════════════════════════════════════════

export type CreativeInvoice = {
  id: string;
  invoiceNumber: string;
  campaignCode: string | null;
  projectName: string | null;
  month: string;
  invoiceDate: string | null;
  amountUsd: number;
  status: string;
  // ISO string, NO Date: así el payload es JSON-safe y `CreativeSummary` se
  // puede envolver en `unstable_cache` sin la mina de siempre — serializa a
  // JSON, y un Date entra como objeto y vuelve como STRING en el cache hit,
  // con el tipo mintiendo justo cuando la caché acierta. Ver el bloque de
  // `getProjectWithPlans` en db/queries/cached.ts.
  paidAt: string | null;
  clientName: string;
};

export type CreativeMonthTotal = {
  month: string;
  invoiced: number;
  paid: number;
  total: number;
};

export type CreativeSummary = {
  invoices: CreativeInvoice[];
  byMonth: CreativeMonthTotal[];
  totalUsd: number;
  paidUsd: number;
  pendingUsd: number;
};

// Estados de una factura EMITIDA. El portal del cliente nunca muestra otra
// cosa: `creative_billings.status` reusa el enum `billing_status`, así que una
// fila en 'draft' (o cualquier estado futuro) es trabajo interno que el cliente
// no tiene por qué ver. Mismo criterio que el Billing Tracker, que sólo lista
// facturas con número.
const EMITTED_STATUSES = ["invoiced", "paid"] as const;

export async function getCreativeBillings(filters: {
  clientId?: string | null;
  status?: string | null;
  // Sólo facturas emitidas (portal del cliente). En la app interna se ve todo.
  emittedOnly?: boolean;
} = {}): Promise<CreativeSummary> {
  const conds: SQL[] = [ne(clients.status, "archived")];
  if (filters.clientId) conds.push(eq(creativeBillings.clientId, filters.clientId));
  if (filters.status === "paid" || filters.status === "invoiced") {
    conds.push(eq(creativeBillings.status, filters.status));
  } else if (filters.emittedOnly) {
    conds.push(inArray(creativeBillings.status, [...EMITTED_STATUSES]));
  }

  const rows = await db
    .select({
      id: creativeBillings.id,
      invoiceNumber: creativeBillings.invoiceNumber,
      campaignCode: creativeBillings.campaignCode,
      projectName: creativeBillings.projectName,
      month: creativeBillings.month,
      invoiceDate: creativeBillings.invoiceDate,
      amountUsd: creativeBillings.amountUsd,
      status: creativeBillings.status,
      paidAt: creativeBillings.paidAt,
      clientName: clients.name,
    })
    .from(creativeBillings)
    .innerJoin(clients, eq(creativeBillings.clientId, clients.id))
    .where(and(...conds))
    .orderBy(desc(creativeBillings.month), asc(creativeBillings.invoiceNumber));

  const invoices: CreativeInvoice[] = rows.map((r) => ({
    ...r,
    amountUsd: Number.parseFloat(r.amountUsd),
    paidAt: r.paidAt ? r.paidAt.toISOString() : null,
  }));

  // Totales por mes para el chart. Se agrupan acá (no en SQL) porque la lista
  // ya viene completa y así el desglose pagado/pendiente sale de una pasada.
  const map = new Map<string, CreativeMonthTotal>();
  for (const inv of invoices) {
    const m = map.get(inv.month) ?? {
      month: inv.month,
      invoiced: 0,
      paid: 0,
      total: 0,
    };
    if (inv.status === "paid") m.paid += inv.amountUsd;
    else m.invoiced += inv.amountUsd;
    m.total += inv.amountUsd;
    map.set(inv.month, m);
  }

  const byMonth = Array.from(map.values()).sort((a, b) =>
    a.month.localeCompare(b.month),
  );

  const paidUsd = invoices
    .filter((i) => i.status === "paid")
    .reduce((a, i) => a + i.amountUsd, 0);
  const totalUsd = invoices.reduce((a, i) => a + i.amountUsd, 0);

  return { invoices, byMonth, totalUsd, paidUsd, pendingUsd: totalUsd - paidUsd };
}

// Opciones del filtro de cliente: sólo clientes que tienen facturas creative.
export async function getCreativeClients(): Promise<
  { id: string; name: string; slug: string }[]
> {
  return db
    .selectDistinct({ id: clients.id, name: clients.name, slug: clients.slug })
    .from(creativeBillings)
    .innerJoin(clients, eq(creativeBillings.clientId, clients.id))
    .where(ne(clients.status, "archived"))
    .orderBy(asc(clients.name));
}

// Conteo rápido (lo usa el subtitle de la página sin traer las filas).
export async function countCreativeBillings(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(creativeBillings);
  return row?.n ?? 0;
}
