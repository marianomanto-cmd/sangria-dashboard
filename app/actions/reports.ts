"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { auditLog, projects, projectReports } from "@/db/schema";

type Result = { ok: true } | { ok: false; error: string };

// ════════════════════════════════════════════════════════════════════════════
// Project status + report lifecycle.
//
// Reglas:
//   • setProjectStatus(closed) → upsert idempotente de project_reports.
//   • setProjectStatus(reportado) → no se permite directo: sólo se entra acá
//     vía markReportDelivered.
//   • setReportDeliveryDate(date) → escribe delivery_date y reescribe
//     delivery_date_assigned_at = now() (representa el compromiso vigente).
//   • markReportDelivered → delivered_at=now() + project.status='reportado'
//     + audit log. La fila queda en la DB para historial pero desaparece del
//     calendario (filtro deliveredAt IS NULL en getReportingCalendar).
// ════════════════════════════════════════════════════════════════════════════

export async function setProjectStatus(input: {
  projectId: string;
  status: (typeof projects.$inferSelect)["status"];
}): Promise<Result> {
  if (input.status === "reportado") {
    return {
      ok: false,
      error:
        "Status 'reportado' se alcanza marcando el reporte como entregado desde /reportes/calendario",
    };
  }

  const [before] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1);
  if (!before) return { ok: false, error: "Proyecto no encontrado" };

  if (before.status === input.status) return { ok: true };

  // No se permite "des-reportar" un proyecto desde acá; si está reportado
  // hay que ir por el calendario o un proceso administrativo.
  if (before.status === "reportado") {
    return {
      ok: false,
      error: "Un proyecto ya reportado no se puede cambiar de status desde acá",
    };
  }

  const [after] = await db
    .update(projects)
    .set({ status: input.status })
    .where(eq(projects.id, input.projectId))
    .returning();

  await db.insert(auditLog).values({
    entityType: "project",
    entityId: input.projectId,
    action: "status_change",
    beforeJson: { status: before.status },
    afterJson: { status: after.status },
  });

  // Si pasamos a closed: crear (o asegurar) la fila de project_reports.
  if (input.status === "closed") {
    await ensureProjectReport(input.projectId);
  }

  revalidatePath("/proyectos");
  revalidatePath(`/proyectos/${before.code}`);
  revalidatePath("/reportes/calendario");
  return { ok: true };
}

// Crea la fila de project_reports si no existe. Idempotente vía unique
// constraint en project_id. Si la fila ya existe no toca nada (no
// re-pisa closed_at).
export async function ensureProjectReport(projectId: string): Promise<Result> {
  try {
    await db
      .insert(projectReports)
      .values({ projectId })
      .onConflictDoNothing({ target: projectReports.projectId });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return { ok: false, error: msg };
  }
}

export async function setReportDeliveryDate(input: {
  reportId: string;
  deliveryDate: string; // YYYY-MM-DD
}): Promise<Result> {
  if (!input.deliveryDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return { ok: false, error: "Fecha inválida (esperado YYYY-MM-DD)" };
  }

  const [before] = await db
    .select()
    .from(projectReports)
    .where(eq(projectReports.id, input.reportId))
    .limit(1);
  if (!before) return { ok: false, error: "Reporte no encontrado" };
  if (before.deliveredAt) {
    return { ok: false, error: "El reporte ya fue entregado" };
  }

  const [after] = await db
    .update(projectReports)
    .set({
      deliveryDate: input.deliveryDate,
      deliveryDateAssignedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(projectReports.id, input.reportId))
    .returning();

  await db.insert(auditLog).values({
    entityType: "project_report",
    entityId: input.reportId,
    action: before.deliveryDate ? "delivery_date_update" : "delivery_date_set",
    beforeJson: {
      deliveryDate: before.deliveryDate,
      deliveryDateAssignedAt: before.deliveryDateAssignedAt,
    },
    afterJson: {
      deliveryDate: after.deliveryDate,
      deliveryDateAssignedAt: after.deliveryDateAssignedAt,
    },
  });

  revalidatePath("/reportes/calendario");
  return { ok: true };
}

export async function markReportDelivered(input: {
  reportId: string;
}): Promise<Result> {
  const [before] = await db
    .select()
    .from(projectReports)
    .where(eq(projectReports.id, input.reportId))
    .limit(1);
  if (!before) return { ok: false, error: "Reporte no encontrado" };
  if (before.deliveredAt) {
    return { ok: false, error: "El reporte ya fue entregado" };
  }
  if (!before.deliveryDate) {
    return {
      ok: false,
      error: "Asigná primero una fecha de entrega antes de marcar como entregado",
    };
  }

  const now = new Date();

  await db
    .update(projectReports)
    .set({ deliveredAt: now, updatedAt: now })
    .where(eq(projectReports.id, input.reportId));

  // Proyecto pasa a 'reportado'.
  const [projBefore] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, before.projectId))
    .limit(1);

  if (projBefore && projBefore.status !== "reportado") {
    await db
      .update(projects)
      .set({ status: "reportado" })
      .where(eq(projects.id, before.projectId));

    await db.insert(auditLog).values({
      entityType: "project",
      entityId: before.projectId,
      action: "status_change",
      beforeJson: { status: projBefore.status },
      afterJson: { status: "reportado" },
    });
  }

  await db.insert(auditLog).values({
    entityType: "project_report",
    entityId: input.reportId,
    action: "delivered",
    beforeJson: { deliveredAt: null },
    afterJson: { deliveredAt: now.toISOString() },
  });

  revalidatePath("/reportes/calendario");
  revalidatePath("/proyectos");
  if (projBefore) revalidatePath(`/proyectos/${projBefore.code}`);
  return { ok: true };
}
