import { and, asc, eq, gte, inArray, isNull, lte, ne, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  clients,
  mediaPlans,
  planBillings,
  projects,
} from "@/db/schema";

// ════════════════════════════════════════════════════════════════════════════
// Billing Tracker — vista jerárquica proyecto → planes → facturas emitidas.
//
// Una factura está "emitida" cuando ya tiene número de factura cargado, es
// decir, el estado del billing es 'invoiced' o 'paid' (en ambos casos el
// invoice_number es no-null). El tracker excluye drafts/ready/sent porque
// todavía no son facturas "reales" para el cliente.
//
// Los clientes archivados se excluyen siempre. El scope respeta el filtro
// global ?client= cuando está activo.
// ════════════════════════════════════════════════════════════════════════════

type EmittedStatus = "invoiced" | "paid";

export type TrackerInvoice = {
  id: string;
  invoiceNumber: string;
  month: string;
  status: EmittedStatus;
  mediaSubtotalUsd: number;
  feeSubtotalUsd: number;
  totalUsd: number;
};

export type TrackerPlan = {
  id: string;
  name: string;
  invoices: TrackerInvoice[];
  mediaSubtotalUsd: number;
  feeSubtotalUsd: number;
  totalUsd: number;
};

export type TrackerProject = {
  id: string;
  code: string;
  name: string;
  clientId: string;
  clientName: string;
  clientSlug: string;
  plans: TrackerPlan[];
  mediaSubtotalUsd: number;
  feeSubtotalUsd: number;
  totalUsd: number;
};

export type BillingTrackerFilters = {
  clientId?: string | null;
  budgetOriginId?: string | null;
  projectId?: string | null;
  fromMonth?: string | null;
  toMonth?: string | null;
};

export async function getBillingTracker(
  filters: BillingTrackerFilters = {},
): Promise<TrackerProject[]> {
  const conds: SQL[] = [
    inArray(planBillings.status, ["invoiced", "paid"]),
    ne(clients.status, "archived"),
    sql`${planBillings.invoiceNumber} is not null`,
  ];
  if (filters.clientId) conds.push(eq(projects.clientId, filters.clientId));
  if (filters.budgetOriginId)
    conds.push(eq(projects.budgetOriginId, filters.budgetOriginId));
  if (filters.projectId) conds.push(eq(projects.id, filters.projectId));
  if (filters.fromMonth) conds.push(gte(planBillings.month, filters.fromMonth));
  if (filters.toMonth) conds.push(lte(planBillings.month, filters.toMonth));

  const rows = await db
    .select({
      billingId: planBillings.id,
      month: planBillings.month,
      invoiceNumber: planBillings.invoiceNumber,
      status: planBillings.status,
      totalUsd: planBillings.totalUsd,
      totalNetUsd: planBillings.totalNetUsd,
      totalFeeUsd: planBillings.totalFeeUsd,
      planId: mediaPlans.id,
      planName: mediaPlans.name,
      projectId: projects.id,
      projectCode: projects.code,
      projectName: projects.name,
      clientId: clients.id,
      clientName: clients.name,
      clientSlug: clients.slug,
    })
    .from(planBillings)
    .innerJoin(mediaPlans, and(eq(planBillings.mediaPlanId, mediaPlans.id), isNull(mediaPlans.deletedAt)))
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(and(...conds))
    .orderBy(
      asc(projects.code),
      asc(mediaPlans.name),
      asc(planBillings.month),
    );

  const byProject = new Map<string, TrackerProject>();

  for (const r of rows) {
    const media = Number.parseFloat(r.totalNetUsd);
    const fee = Number.parseFloat(r.totalFeeUsd);
    const total = Number.parseFloat(r.totalUsd);

    let proj = byProject.get(r.projectId);
    if (!proj) {
      proj = {
        id: r.projectId,
        code: r.projectCode,
        name: r.projectName,
        clientId: r.clientId,
        clientName: r.clientName,
        clientSlug: r.clientSlug,
        plans: [],
        mediaSubtotalUsd: 0,
        feeSubtotalUsd: 0,
        totalUsd: 0,
      };
      byProject.set(r.projectId, proj);
    }

    let plan = proj.plans.find((p) => p.id === r.planId);
    if (!plan) {
      plan = {
        id: r.planId,
        name: r.planName,
        invoices: [],
        mediaSubtotalUsd: 0,
        feeSubtotalUsd: 0,
        totalUsd: 0,
      };
      proj.plans.push(plan);
    }

    plan.invoices.push({
      id: r.billingId,
      invoiceNumber: r.invoiceNumber!,
      month: r.month,
      status: r.status as EmittedStatus,
      mediaSubtotalUsd: media,
      feeSubtotalUsd: fee,
      totalUsd: total,
    });
    plan.mediaSubtotalUsd += media;
    plan.feeSubtotalUsd += fee;
    plan.totalUsd += total;
    proj.mediaSubtotalUsd += media;
    proj.feeSubtotalUsd += fee;
    proj.totalUsd += total;
  }

  return Array.from(byProject.values());
}

// ────────────────────────────────────────────────────────────────────────────
// Opciones para los filtros del top: proyectos con al menos una factura
// emitida (scopeados al cliente activo si hay) y rango min/max de meses con
// facturas emitidas.
// ────────────────────────────────────────────────────────────────────────────

export type BillingTrackerFilterOptions = {
  projects: { id: string; code: string; name: string }[];
  minMonth: string | null;
  maxMonth: string | null;
};

export async function getBillingTrackerFilterOptions(
  clientId?: string | null,
): Promise<BillingTrackerFilterOptions> {
  const conds: SQL[] = [
    inArray(planBillings.status, ["invoiced", "paid"]),
    ne(clients.status, "archived"),
    sql`${planBillings.invoiceNumber} is not null`,
  ];
  if (clientId) conds.push(eq(projects.clientId, clientId));
  const where = and(...conds);

  const [projectsRows, monthsRow] = await Promise.all([
    db
      .selectDistinct({
        id: projects.id,
        code: projects.code,
        name: projects.name,
      })
      .from(planBillings)
      .innerJoin(mediaPlans, and(eq(planBillings.mediaPlanId, mediaPlans.id), isNull(mediaPlans.deletedAt)))
      .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
      .innerJoin(clients, eq(projects.clientId, clients.id))
      .where(where),
    db
      .select({
        minMonth: sql<string | null>`min(${planBillings.month})`,
        maxMonth: sql<string | null>`max(${planBillings.month})`,
      })
      .from(planBillings)
      .innerJoin(mediaPlans, and(eq(planBillings.mediaPlanId, mediaPlans.id), isNull(mediaPlans.deletedAt)))
      .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
      .innerJoin(clients, eq(projects.clientId, clients.id))
      .where(where),
  ]);

  return {
    projects: projectsRows.sort((a, b) => a.code.localeCompare(b.code)),
    minMonth: monthsRow[0]?.minMonth ?? null,
    maxMonth: monthsRow[0]?.maxMonth ?? null,
  };
}
