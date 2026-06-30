import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  budgetOrigins,
  clients,
  manualReports,
  mediaPlans,
  projects,
  projectReports,
  reportComments,
} from "@/db/schema";

// Cantidad de comentarios por reporte (project + manual en un solo mapa —
// los ids son uuids, no colisionan). Defensivo: si la tabla todavía no
// existe en prod (falta correr el SQL), devuelve un mapa vacío en vez de
// romper el calendario.
async function getCommentCountsByReport(): Promise<Record<string, number>> {
  try {
    const rows = await db
      .select({
        reportId: sql<string>`coalesce(${reportComments.projectReportId}, ${reportComments.manualReportId})`,
        count: sql<number>`count(*)::int`,
      })
      .from(reportComments)
      .groupBy(
        sql`coalesce(${reportComments.projectReportId}, ${reportComments.manualReportId})`,
      );
    return Object.fromEntries(rows.map((r) => [r.reportId, r.count]));
  } catch {
    return {};
  }
}

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
//   • Los reports con delivered_at != null no aparecen acá (van a la lista
//     de enviados via getSentReports).
//   • El filtro opcional por clientId respeta `?client=slug` del topbar.
//   • Hay dos fuentes de reportes:
//       - project_reports (auto-creados al pasar proyecto a 'closed')
//       - manual_reports (creados ad-hoc por la analista desde el calendario)
//     Ambos se mergean en una sola lista. La discriminación va en el field
//     `kind` para que la UI sepa qué acciones llamar y qué links mostrar.
// ════════════════════════════════════════════════════════════════════════════

export type CalendarReport = {
  reportId: string;
  // Discriminador: "project" → proyecto closed con report auto;
  //                "manual"  → reporte ad-hoc creado por la analista.
  kind: "project" | "manual";
  // Display: project.name para project / manual.name para manual.
  projectName: string;
  // Solo manual: descripción libre (puede ser null).
  description: string | null;
  // Solo project (null para manual):
  projectId: string | null;
  projectCode: string | null;
  closedAt: string | null;
  budgetOriginId: string | null;
  budgetOriginName: string | null;
  // Comunes:
  clientId: string;
  clientName: string;
  clientSlug: string;
  deliveryDate: string | null;
  deliveryDateAssignedAt: string | null;
  // Cantidad de comentarios del tablerito (botón "Comentarios" de la UI).
  commentsCount: number;
};

export type ReportingCalendarData = {
  pending: CalendarReport[];
  inProgress: CalendarReport[];
};

export async function getReportingCalendar(
  clientId?: string | null,
): Promise<ReportingCalendarData> {
  const projConds = [
    eq(projects.status, "closed"),
    isNull(projectReports.deliveredAt),
  ];
  if (clientId) projConds.push(eq(projects.clientId, clientId));

  const manualConds = [isNull(manualReports.deliveredAt)];
  if (clientId) manualConds.push(eq(manualReports.clientId, clientId));

  const [projRows, manualRows, commentCounts] = await Promise.all([
    db
      .select({
        reportId: projectReports.id,
        projectId: projects.id,
        projectCode: projects.code,
        projectName: projects.name,
        clientId: clients.id,
        clientName: clients.name,
        clientSlug: clients.slug,
        budgetOriginId: projects.budgetOriginId,
        budgetOriginName: budgetOrigins.name,
        closedAt: projectReports.closedAt,
        deliveryDate: projectReports.deliveryDate,
        deliveryDateAssignedAt: projectReports.deliveryDateAssignedAt,
      })
      .from(projectReports)
      .innerJoin(projects, eq(projectReports.projectId, projects.id))
      .innerJoin(clients, eq(projects.clientId, clients.id))
      .innerJoin(budgetOrigins, eq(projects.budgetOriginId, budgetOrigins.id))
      .where(and(...projConds))
      .orderBy(asc(projectReports.closedAt)),
    db
      .select({
        reportId: manualReports.id,
        name: manualReports.name,
        description: manualReports.description,
        clientId: clients.id,
        clientName: clients.name,
        clientSlug: clients.slug,
        deliveryDate: manualReports.deliveryDate,
        deliveryDateAssignedAt: manualReports.deliveryDateAssignedAt,
        createdAt: manualReports.createdAt,
      })
      .from(manualReports)
      .innerJoin(clients, eq(clients.id, manualReports.clientId))
      .where(and(...manualConds))
      .orderBy(asc(manualReports.createdAt)),
    getCommentCountsByReport(),
  ]);

  const pending: CalendarReport[] = [];
  const inProgress: CalendarReport[] = [];

  for (const r of projRows) {
    const row: CalendarReport = {
      reportId: r.reportId,
      kind: "project",
      projectName: r.projectName,
      description: null,
      projectId: r.projectId,
      projectCode: r.projectCode,
      closedAt:
        r.closedAt instanceof Date ? r.closedAt.toISOString() : String(r.closedAt),
      budgetOriginId: r.budgetOriginId,
      budgetOriginName: r.budgetOriginName,
      clientId: r.clientId,
      clientName: r.clientName,
      clientSlug: r.clientSlug,
      deliveryDate: r.deliveryDate,
      deliveryDateAssignedAt:
        r.deliveryDateAssignedAt instanceof Date
          ? r.deliveryDateAssignedAt.toISOString()
          : r.deliveryDateAssignedAt
            ? String(r.deliveryDateAssignedAt)
            : null,
      commentsCount: commentCounts[r.reportId] ?? 0,
    };
    if (row.deliveryDate) inProgress.push(row);
    else pending.push(row);
  }

  for (const r of manualRows) {
    // Los manuales SIEMPRE tienen delivery_date (es required en el schema),
    // así que van directo a inProgress. Nunca caen en `pending`.
    inProgress.push({
      reportId: r.reportId,
      kind: "manual",
      projectName: r.name,
      description: r.description,
      projectId: null,
      projectCode: null,
      closedAt:
        r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
      budgetOriginId: null,
      budgetOriginName: null,
      clientId: r.clientId,
      clientName: r.clientName,
      clientSlug: r.clientSlug,
      deliveryDate: r.deliveryDate,
      deliveryDateAssignedAt:
        r.deliveryDateAssignedAt instanceof Date
          ? r.deliveryDateAssignedAt.toISOString()
          : String(r.deliveryDateAssignedAt),
      commentsCount: commentCounts[r.reportId] ?? 0,
    });
  }

  // Gantt sort: por delivery_date asc; los más próximos arriba.
  inProgress.sort((a, b) =>
    (a.deliveryDate ?? "").localeCompare(b.deliveryDate ?? ""),
  );

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

// Cuenta total de reports en el calendario (project + manual no entregados).
export async function getOpenReportsCount(
  clientId?: string | null,
): Promise<number> {
  const projConds = [
    eq(projects.status, "closed"),
    isNull(projectReports.deliveredAt),
  ];
  if (clientId) projConds.push(eq(projects.clientId, clientId));

  const manualConds = [isNull(manualReports.deliveredAt)];
  if (clientId) manualConds.push(eq(manualReports.clientId, clientId));

  const [projRows, manualRows] = await Promise.all([
    db
      .select({ id: projectReports.id })
      .from(projectReports)
      .innerJoin(projects, eq(projectReports.projectId, projects.id))
      .where(and(...projConds)),
    db
      .select({ id: manualReports.id })
      .from(manualReports)
      .where(and(...manualConds)),
  ]);
  return projRows.length + manualRows.length;
}

// ════════════════════════════════════════════════════════════════════════════
// Reportes enviados: los que ya tienen delivered_at. Combina project + manual.
// Se listan en /reportes/calendario debajo del Gantt, con filtro de texto
// libre por proyecto / campaña / nombre de reporte manual.
// ════════════════════════════════════════════════════════════════════════════

export type SentReport = {
  reportId: string;
  kind: "project" | "manual";
  projectName: string;            // display name: project.name o manual.name
  description: string | null;     // solo manual
  projectId: string | null;       // null para manual
  projectCode: string | null;     // null para manual
  clientId: string;
  clientName: string;
  clientSlug: string;
  budgetOriginId: string | null;    // null para manual
  budgetOriginName: string | null;  // null para manual
  closedAt: string;
  deliveryDate: string | null;
  deliveredAt: string;
  reportPptUrl: string | null;
  planNames: string[];            // solo para project (vacío para manual)
  commentsCount: number;
};

export async function getSentReports(
  clientId?: string | null,
): Promise<SentReport[]> {
  const projConds = [isNotNull(projectReports.deliveredAt)];
  if (clientId) projConds.push(eq(projects.clientId, clientId));

  const manualConds = [isNotNull(manualReports.deliveredAt)];
  if (clientId) manualConds.push(eq(manualReports.clientId, clientId));

  const [projRows, manualRows, commentCounts] = await Promise.all([
    db
      .select({
        reportId: projectReports.id,
        projectId: projects.id,
        projectCode: projects.code,
        projectName: projects.name,
        clientId: clients.id,
        clientName: clients.name,
        clientSlug: clients.slug,
        budgetOriginId: projects.budgetOriginId,
        budgetOriginName: budgetOrigins.name,
        closedAt: projectReports.closedAt,
        deliveryDate: projectReports.deliveryDate,
        deliveredAt: projectReports.deliveredAt,
        reportPptUrl: projectReports.reportPptUrl,
      })
      .from(projectReports)
      .innerJoin(projects, eq(projectReports.projectId, projects.id))
      .innerJoin(clients, eq(projects.clientId, clients.id))
      .innerJoin(budgetOrigins, eq(projects.budgetOriginId, budgetOrigins.id))
      .where(and(...projConds))
      .orderBy(desc(projectReports.deliveredAt)),
    db
      .select({
        reportId: manualReports.id,
        name: manualReports.name,
        description: manualReports.description,
        clientId: clients.id,
        clientName: clients.name,
        clientSlug: clients.slug,
        createdAt: manualReports.createdAt,
        deliveryDate: manualReports.deliveryDate,
        deliveredAt: manualReports.deliveredAt,
        reportPptUrl: manualReports.reportPptUrl,
      })
      .from(manualReports)
      .innerJoin(clients, eq(clients.id, manualReports.clientId))
      .where(and(...manualConds))
      .orderBy(desc(manualReports.deliveredAt)),
    getCommentCountsByReport(),
  ]);

  // Plan names para project rows (filtro de texto).
  const projectIds = [...new Set(projRows.map((r) => r.projectId))];
  const plansByProject = new Map<string, string[]>();
  if (projectIds.length > 0) {
    const planRows = await db
      .select({ projectId: mediaPlans.projectId, name: mediaPlans.name })
      .from(mediaPlans)
      .where(
        and(inArray(mediaPlans.projectId, projectIds), isNull(mediaPlans.deletedAt)),
      );
    for (const p of planRows) {
      const arr = plansByProject.get(p.projectId) ?? [];
      arr.push(p.name);
      plansByProject.set(p.projectId, arr);
    }
  }

  const out: SentReport[] = [];

  for (const r of projRows) {
    out.push({
      reportId: r.reportId,
      kind: "project",
      projectName: r.projectName,
      description: null,
      projectId: r.projectId,
      projectCode: r.projectCode,
      clientId: r.clientId,
      clientName: r.clientName,
      clientSlug: r.clientSlug,
      budgetOriginId: r.budgetOriginId,
      budgetOriginName: r.budgetOriginName,
      closedAt:
        r.closedAt instanceof Date ? r.closedAt.toISOString() : String(r.closedAt),
      deliveryDate: r.deliveryDate,
      deliveredAt:
        r.deliveredAt instanceof Date
          ? r.deliveredAt.toISOString()
          : String(r.deliveredAt),
      reportPptUrl: r.reportPptUrl,
      planNames: plansByProject.get(r.projectId) ?? [],
      commentsCount: commentCounts[r.reportId] ?? 0,
    });
  }

  for (const r of manualRows) {
    out.push({
      reportId: r.reportId,
      kind: "manual",
      projectName: r.name,
      description: r.description,
      projectId: null,
      projectCode: null,
      clientId: r.clientId,
      clientName: r.clientName,
      clientSlug: r.clientSlug,
      budgetOriginId: null,
      budgetOriginName: null,
      closedAt:
        r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
      deliveryDate: r.deliveryDate,
      deliveredAt:
        r.deliveredAt instanceof Date
          ? r.deliveredAt.toISOString()
          : String(r.deliveredAt),
      reportPptUrl: r.reportPptUrl,
      planNames: [],
      commentsCount: commentCounts[r.reportId] ?? 0,
    });
  }

  // Re-sort por deliveredAt desc (cada fuente venía ordenada, pero el merge
  // no preserva el orden).
  out.sort((a, b) => b.deliveredAt.localeCompare(a.deliveredAt));
  return out;
}
