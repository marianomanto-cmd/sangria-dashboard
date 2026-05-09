import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  actualSpend,
  billings,
  clients,
  mediaPlanLines,
  mediaPlans,
  projects,
} from "@/db/schema";

// ────────────────────────────────────────────────────────────────────────────
// KPIs del dashboard
// ────────────────────────────────────────────────────────────────────────────

export type DashboardKpis = {
  pipelineActiveUsd: number;
  activeClients: number;
  invoicedYtdUsd: number;
  consumptionPct: number;
};

export async function getDashboardKpis(): Promise<DashboardKpis> {
  const yearStartMonth = `${new Date().getFullYear()}-01`;

  // 1. Pipeline activo: sum de total_budget_usd de proyectos activos.
  const [pipelineRow] = await db
    .select({
      value: sql<string>`coalesce(sum(${projects.totalBudgetUsd}), 0)`,
    })
    .from(projects)
    .where(eq(projects.status, "active"));

  // 2. Clientes activos: cuántos clientes tienen al menos un proyecto activo.
  const [clientsRow] = await db
    .select({
      value: sql<number>`count(distinct ${projects.clientId})::int`,
    })
    .from(projects)
    .where(eq(projects.status, "active"));

  // 3. Facturado YTD: facturas emitidas o pagadas desde enero del año actual.
  const [invoicedRow] = await db
    .select({
      value: sql<string>`coalesce(sum(${billings.totalUsd}), 0)`,
    })
    .from(billings)
    .where(
      and(
        inArray(billings.status, ["sent", "paid"]),
        sql`${billings.month} >= ${yearStartMonth}`,
      ),
    );

  // 4. % avance: gasto real total / pipeline activo (avance promedio del Q).
  //    Si no hay pipeline activo todavía, devolvemos 0 para evitar /0.
  const [consumptionRow] = await db
    .select({
      spent: sql<string>`coalesce(sum(${actualSpend.amountUsd}), 0)`,
    })
    .from(actualSpend)
    .innerJoin(
      mediaPlanLines,
      eq(actualSpend.mediaPlanLineId, mediaPlanLines.id),
    )
    .innerJoin(mediaPlans, eq(mediaPlanLines.mediaPlanId, mediaPlans.id))
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
    .where(eq(projects.status, "active"));

  const pipeline = Number.parseFloat(pipelineRow.value);
  const spent = Number.parseFloat(consumptionRow.spent);
  const consumptionPct = pipeline > 0 ? (spent / pipeline) * 100 : 0;

  return {
    pipelineActiveUsd: pipeline,
    activeClients: clientsRow.value,
    invoicedYtdUsd: Number.parseFloat(invoicedRow.value),
    consumptionPct,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Tabla de proyectos: cada proyecto con su cliente + gasto real agregado.
// El cálculo de gasto va por la cadena: project → media_plan → lines → spend.
// Proyectos sin plan aprobado terminan con spentUsd = 0.
// ────────────────────────────────────────────────────────────────────────────

export type DashboardProjectRow = {
  id: string;
  code: string;
  name: string;
  clientName: string;
  status: (typeof projects.$inferSelect)["status"];
  totalBudgetUsd: number;
  spentUsd: number;
  consumptionPct: number;
};

export async function getDashboardProjects(): Promise<DashboardProjectRow[]> {
  const rows = await db
    .select({
      id: projects.id,
      code: projects.code,
      name: projects.name,
      clientName: clients.name,
      status: projects.status,
      totalBudgetUsd: projects.totalBudgetUsd,
      spentUsd: sql<string>`coalesce(sum(${actualSpend.amountUsd}), 0)`,
    })
    .from(projects)
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .leftJoin(mediaPlans, eq(mediaPlans.projectId, projects.id))
    .leftJoin(mediaPlanLines, eq(mediaPlanLines.mediaPlanId, mediaPlans.id))
    .leftJoin(actualSpend, eq(actualSpend.mediaPlanLineId, mediaPlanLines.id))
    .groupBy(projects.id, clients.name)
    .orderBy(asc(projects.code));

  return rows.map((r) => {
    const total = Number.parseFloat(r.totalBudgetUsd ?? "0");
    const spent = Number.parseFloat(r.spentUsd);
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      clientName: r.clientName,
      status: r.status,
      totalBudgetUsd: total,
      spentUsd: spent,
      consumptionPct: total > 0 ? (spent / total) * 100 : 0,
    };
  });
}
