import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  actualSpend,
  billingLines,
  billings,
  budgetOrigins,
  clients,
  mediaPlanLines,
  mediaPlans,
  projects,
} from "@/db/schema";

// ────────────────────────────────────────────────────────────────────────────
// Listado de billings (para /billing)
// ────────────────────────────────────────────────────────────────────────────

export type BillingListRow = {
  id: string;
  month: string;
  invoiceNumber: string | null;
  status: (typeof billings.$inferSelect)["status"];
  totalUsd: number;
  totalNetUsd: number;
  totalFeeUsd: number;
  projectId: string;
  projectName: string;
  projectCode: string;
  clientName: string;
  clientSlug: string;
  budgetOriginName: string;
  createdAt: Date;
  sentAt: Date | null;
  paidAt: Date | null;
  dueDate: string | null;
};

export async function getBillingsList(): Promise<BillingListRow[]> {
  const rows = await db
    .select({
      id: billings.id,
      month: billings.month,
      invoiceNumber: billings.invoiceNumber,
      status: billings.status,
      totalUsd: billings.totalUsd,
      totalNetUsd: billings.totalNetUsd,
      totalFeeUsd: billings.totalFeeUsd,
      projectId: billings.projectId,
      projectName: projects.name,
      projectCode: projects.code,
      clientName: clients.name,
      clientSlug: clients.slug,
      budgetOriginName: budgetOrigins.name,
      createdAt: billings.createdAt,
      sentAt: billings.sentAt,
      paidAt: billings.paidAt,
      dueDate: billings.dueDate,
    })
    .from(billings)
    .innerJoin(projects, eq(billings.projectId, projects.id))
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .innerJoin(budgetOrigins, eq(billings.budgetOriginId, budgetOrigins.id))
    .orderBy(desc(billings.createdAt));

  return rows.map((r) => ({
    ...r,
    totalUsd: Number.parseFloat(r.totalUsd),
    totalNetUsd: Number.parseFloat(r.totalNetUsd),
    totalFeeUsd: Number.parseFloat(r.totalFeeUsd),
  }));
}

// ────────────────────────────────────────────────────────────────────────────
// Detalle de billing (para /billing/[id])
// ────────────────────────────────────────────────────────────────────────────

export type BillingDetail = {
  billing: typeof billings.$inferSelect;
  project: { id: string; name: string; code: string };
  client: { id: string; name: string; slug: string };
  budgetOrigin: { id: string; name: string; colorHex: string | null };
  lines: Array<{
    id: string;
    publisher: string;
    placementName: string;
    amountNet: number;
    feeAmount: number;
    total: number;
  }>;
};

export async function getBillingDetail(
  id: string,
): Promise<BillingDetail | null> {
  const [row] = await db
    .select({
      billing: billings,
      project: { id: projects.id, name: projects.name, code: projects.code },
      client: { id: clients.id, name: clients.name, slug: clients.slug },
      origin: {
        id: budgetOrigins.id,
        name: budgetOrigins.name,
        colorHex: budgetOrigins.colorHex,
      },
    })
    .from(billings)
    .innerJoin(projects, eq(billings.projectId, projects.id))
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .innerJoin(budgetOrigins, eq(billings.budgetOriginId, budgetOrigins.id))
    .where(eq(billings.id, id))
    .limit(1);

  if (!row) return null;

  const lines = await db
    .select({
      id: billingLines.id,
      publisher: mediaPlanLines.publisher,
      placementName: mediaPlanLines.placementName,
      amountNet: billingLines.amountNet,
      feeAmount: billingLines.feeAmount,
      total: billingLines.total,
      sortOrder: mediaPlanLines.sortOrder,
    })
    .from(billingLines)
    .innerJoin(
      mediaPlanLines,
      eq(billingLines.mediaPlanLineId, mediaPlanLines.id),
    )
    .where(eq(billingLines.billingId, id))
    .orderBy(asc(mediaPlanLines.sortOrder));

  return {
    billing: row.billing,
    project: row.project,
    client: row.client,
    budgetOrigin: row.origin,
    lines: lines.map((l) => ({
      id: l.id,
      publisher: l.publisher,
      placementName: l.placementName,
      amountNet: Number.parseFloat(l.amountNet),
      feeAmount: Number.parseFloat(l.feeAmount),
      total: Number.parseFloat(l.total),
    })),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Datos para el wizard de generación (/billing/nuevo)
// ────────────────────────────────────────────────────────────────────────────

export type BillingCandidate = {
  projectId: string;
  projectName: string;
  projectCode: string;
  clientName: string;
  budgetOriginName: string;
  monthsWithSpend: string[]; // YYYY-MM, descendente
  alreadyBilledMonths: string[]; // YYYY-MM con factura existente
};

export async function getBillingCandidates(): Promise<BillingCandidate[]> {
  // Para cada proyecto activo o cerrado: meses con actual_spend > 0
  // y meses ya facturados.
  const rows = await db
    .select({
      projectId: projects.id,
      projectName: projects.name,
      projectCode: projects.code,
      clientName: clients.name,
      budgetOriginName: budgetOrigins.name,
      month: actualSpend.month,
      total: sql<string>`coalesce(sum(${actualSpend.amountUsd}), 0)`,
    })
    .from(projects)
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .innerJoin(budgetOrigins, eq(projects.budgetOriginId, budgetOrigins.id))
    .innerJoin(mediaPlans, eq(mediaPlans.projectId, projects.id))
    .innerJoin(
      mediaPlanLines,
      eq(mediaPlanLines.mediaPlanId, mediaPlans.id),
    )
    .innerJoin(
      actualSpend,
      eq(actualSpend.mediaPlanLineId, mediaPlanLines.id),
    )
    .where(inArray(projects.status, ["active", "closed"]))
    .groupBy(
      projects.id,
      projects.name,
      projects.code,
      clients.name,
      budgetOrigins.name,
      actualSpend.month,
    )
    .having(sql`sum(${actualSpend.amountUsd}) > 0`);

  const billed = await db
    .select({ projectId: billings.projectId, month: billings.month })
    .from(billings);

  const billedSet = new Set(billed.map((b) => `${b.projectId}::${b.month}`));

  const byProject = new Map<string, BillingCandidate>();
  for (const r of rows) {
    let candidate = byProject.get(r.projectId);
    if (!candidate) {
      candidate = {
        projectId: r.projectId,
        projectName: r.projectName,
        projectCode: r.projectCode,
        clientName: r.clientName,
        budgetOriginName: r.budgetOriginName,
        monthsWithSpend: [],
        alreadyBilledMonths: [],
      };
      byProject.set(r.projectId, candidate);
    }
    candidate.monthsWithSpend.push(r.month);
    if (billedSet.has(`${r.projectId}::${r.month}`)) {
      candidate.alreadyBilledMonths.push(r.month);
    }
  }

  // Ordenar meses descendente.
  for (const c of byProject.values()) {
    c.monthsWithSpend.sort().reverse();
    c.alreadyBilledMonths.sort().reverse();
  }

  return Array.from(byProject.values()).sort((a, b) =>
    a.projectName.localeCompare(b.projectName),
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Próximo número de factura del año (sequential YYYY-NNNN)
// ────────────────────────────────────────────────────────────────────────────

export async function getNextInvoiceNumber(year: number): Promise<string> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(billings)
    .where(
      and(
        inArray(billings.status, ["sent", "paid"]),
        gte(billings.month, `${year}-01`),
        sql`${billings.month} < ${`${year + 1}-01`}`,
      ),
    );
  const next = count + 1;
  return `${year}-${String(next).padStart(4, "0")}`;
}
