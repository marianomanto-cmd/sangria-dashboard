import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  budgetOrigins,
  clients,
  mediaPlans,
  projects,
  projectReports,
} from "@/db/schema";

// ════════════════════════════════════════════════════════════════════════════
// Reporting Calendar: lo que necesita la página /reportes/calendario.
//
// Devuelve dos listas:
//   • pending — proyectos cerrados (status = 'closed') con report row pero
//     sin delivery_date asignada. Se muestran en la tabla superior para que
//     el manager les asigne fecha.
//   • inProgress — reports con delivery_date asignada y delivered_at = null.
//     Son los que aparecen como filas del Gantt.
//
// Notas:
//   • Los reports con delivered_at != null no aparecen acá: el proyecto pasó
//     a 'reportado' y el calendario sólo muestra los "abiertos".
//   • El filtro opcional por clientId respeta `?client=slug` del topbar.
// ════════════════════════════════════════════════════════════════════════════

export type CalendarReport = {
  reportId: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  clientId: string;
  clientName: string;
  clientSlug: string;
  budgetOriginName: string;
  closedAt: string;                       // ISO timestamp
  deliveryDate: string | null;            // YYYY-MM-DD
  deliveryDateAssignedAt: string | null;  // ISO timestamp
};

export type ReportingCalendarData = {
  pending: CalendarReport[];
  inProgress: CalendarReport[];
};

export async function getReportingCalendar(
  clientId?: string | null,
): Promise<ReportingCalendarData> {
  // Sólo proyectos 'closed' aparecen acá. Los 'reportado' ya tienen el
  // reporte entregado.
  const conds = [
    eq(projects.status, "closed"),
    isNull(projectReports.deliveredAt),
  ];
  if (clientId) conds.push(eq(projects.clientId, clientId));

  const rows = await db
    .select({
      reportId: projectReports.id,
      projectId: projects.id,
      projectCode: projects.code,
      projectName: projects.name,
      clientId: clients.id,
      clientName: clients.name,
      clientSlug: clients.slug,
      budgetOriginName: budgetOrigins.name,
      closedAt: projectReports.closedAt,
      deliveryDate: projectReports.deliveryDate,
      deliveryDateAssignedAt: projectReports.deliveryDateAssignedAt,
    })
    .from(projectReports)
    .innerJoin(projects, eq(projectReports.projectId, projects.id))
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .innerJoin(budgetOrigins, eq(projects.budgetOriginId, budgetOrigins.id))
    .where(and(...conds))
    .orderBy(asc(projectReports.closedAt));

  const pending: CalendarReport[] = [];
  const inProgress: CalendarReport[] = [];

  for (const r of rows) {
    const row: CalendarReport = {
      reportId: r.reportId,
      projectId: r.projectId,
      projectCode: r.projectCode,
      projectName: r.projectName,
      clientId: r.clientId,
      clientName: r.clientName,
      clientSlug: r.clientSlug,
      budgetOriginName: r.budgetOriginName,
      closedAt: r.closedAt instanceof Date ? r.closedAt.toISOString() : String(r.closedAt),
      deliveryDate: r.deliveryDate,
      deliveryDateAssignedAt:
        r.deliveryDateAssignedAt instanceof Date
          ? r.deliveryDateAssignedAt.toISOString()
          : r.deliveryDateAssignedAt
            ? String(r.deliveryDateAssignedAt)
            : null,
    };
    if (row.deliveryDate) inProgress.push(row);
    else pending.push(row);
  }

  // Gantt sort: por delivery_date asc; los más próximos arriba.
  inProgress.sort((a, b) => (a.deliveryDate ?? "").localeCompare(b.deliveryDate ?? ""));

  return { pending, inProgress };
}

// Helper para el backfill: lista IDs de proyectos closed que aún no tienen
// fila en project_reports. Lo usa el script `scripts/backfill-reports.mjs`.
export async function getClosedProjectsWithoutReport(): Promise<
  Array<{ id: string; createdAt: Date }>
> {
  const rows = await db
    .select({ id: projects.id, createdAt: projects.createdAt })
    .from(projects)
    .leftJoin(projectReports, eq(projectReports.projectId, projects.id))
    .where(and(eq(projects.status, "closed"), isNull(projectReports.id)));
  return rows;
}

// Cuenta total de reports en el calendario (para badge del sidebar opcional).
export async function getOpenReportsCount(
  clientId?: string | null,
): Promise<number> {
  const conds = [
    eq(projects.status, "closed"),
    isNull(projectReports.deliveredAt),
  ];
  if (clientId) conds.push(eq(projects.clientId, clientId));

  const rows = await db
    .select({ id: projectReports.id })
    .from(projectReports)
    .innerJoin(projects, eq(projectReports.projectId, projects.id))
    .where(and(...conds));
  return rows.length;
}

// ════════════════════════════════════════════════════════════════════════════
// Reportes enviados: los que ya tienen delivered_at (proyecto = 'reportado').
// Se listan en la página /reportes/calendario debajo del Gantt, con filtro de
// texto libre por proyecto o campaña.
//
// Trae además los nombres de las campañas (media_plans) de cada proyecto para
// que el filtro de texto pueda matchear por campaña, no sólo por proyecto.
// ════════════════════════════════════════════════════════════════════════════

export type SentReport = {
  reportId: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  clientId: string;
  clientName: string;
  clientSlug: string;
  budgetOriginName: string;
  closedAt: string;             // ISO timestamp
  deliveryDate: string | null;  // YYYY-MM-DD — fecha objetivo comprometida
  deliveredAt: string;          // ISO timestamp — fecha real de envío
  planNames: string[];          // nombres de campañas/planes del proyecto
};

export async function getSentReports(
  clientId?: string | null,
): Promise<SentReport[]> {
  const conds = [isNotNull(projectReports.deliveredAt)];
  if (clientId) conds.push(eq(projects.clientId, clientId));

  const rows = await db
    .select({
      reportId: projectReports.id,
      projectId: projects.id,
      projectCode: projects.code,
      projectName: projects.name,
      clientId: clients.id,
      clientName: clients.name,
      clientSlug: clients.slug,
      budgetOriginName: budgetOrigins.name,
      closedAt: projectReports.closedAt,
      deliveryDate: projectReports.deliveryDate,
      deliveredAt: projectReports.deliveredAt,
    })
    .from(projectReports)
    .innerJoin(projects, eq(projectReports.projectId, projects.id))
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .innerJoin(budgetOrigins, eq(projects.budgetOriginId, budgetOrigins.id))
    .where(and(...conds))
    .orderBy(desc(projectReports.deliveredAt));

  if (rows.length === 0) return [];

  // Nombres de campañas (planes) por proyecto para el filtro de texto.
  const projectIds = [...new Set(rows.map((r) => r.projectId))];
  const planRows = await db
    .select({ projectId: mediaPlans.projectId, name: mediaPlans.name })
    .from(mediaPlans)
    .where(and(inArray(mediaPlans.projectId, projectIds), isNull(mediaPlans.deletedAt)));

  const plansByProject = new Map<string, string[]>();
  for (const p of planRows) {
    const arr = plansByProject.get(p.projectId) ?? [];
    arr.push(p.name);
    plansByProject.set(p.projectId, arr);
  }

  return rows.map((r) => ({
    reportId: r.reportId,
    projectId: r.projectId,
    projectCode: r.projectCode,
    projectName: r.projectName,
    clientId: r.clientId,
    clientName: r.clientName,
    clientSlug: r.clientSlug,
    budgetOriginName: r.budgetOriginName,
    closedAt: r.closedAt instanceof Date ? r.closedAt.toISOString() : String(r.closedAt),
    deliveryDate: r.deliveryDate,
    deliveredAt:
      r.deliveredAt instanceof Date
        ? r.deliveredAt.toISOString()
        : String(r.deliveredAt),
    planNames: plansByProject.get(r.projectId) ?? [],
  }));
}
