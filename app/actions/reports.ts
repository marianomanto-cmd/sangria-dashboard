"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { clients, manualReports, projects, projectReports } from "@/db/schema";
import { recordAudit } from "@/lib/audit";

type Result = { ok: true } | { ok: false; error: string };
type ReportKind = "project" | "manual";

// ════════════════════════════════════════════════════════════════════════════
// Project status + report lifecycle.
//
// Reglas:
//   • setProjectStatus(closed) → upsert idempotente de project_reports.
//   • setProjectStatus(reportado) → no se permite directo: sólo se entra acá
//     vía markReportDelivered.
//   • setReportDeliveryDate(date) → escribe delivery_date y reescribe
//     delivery_date_assigned_at = now().
//   • markReportDelivered → delivered_at=now() + (si es project) project.status
//     pasa a 'reportado'. Para manual queda en la DB para historial.
//   • Reportes manuales: createManualReport / deleteManualReport (no hay
//     equivalente para project_reports porque esos los maneja el lifecycle
//     del proyecto).
//   • Las acciones (setDeliveryDate / markDelivered / setPptUrl) aceptan un
//     `kind` para saber qué tabla tocar — la UI pasa el discriminador que ya
//     trae en cada CalendarReport / SentReport.
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

  await recordAudit({
    entityType: "project",
    entityId: input.projectId,
    action: "status_change",
    beforeJson: { status: before.status },
    afterJson: { status: after.status },
  });

  if (input.status === "closed") {
    await ensureProjectReport(input.projectId);
  }

  revalidatePath("/proyectos");
  revalidatePath(`/proyectos/${before.code}`);
  revalidatePath("/reportes/calendario");
  return { ok: true };
}

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
  kind: ReportKind;
  deliveryDate: string; // YYYY-MM-DD
}): Promise<Result> {
  if (!input.deliveryDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return { ok: false, error: "Fecha inválida (esperado YYYY-MM-DD)" };
  }

  if (input.kind === "project") {
    const [before] = await db
      .select()
      .from(projectReports)
      .where(eq(projectReports.id, input.reportId))
      .limit(1);
    if (!before) return { ok: false, error: "Reporte no encontrado" };
    if (before.deliveredAt)
      return { ok: false, error: "El reporte ya fue entregado" };

    const [after] = await db
      .update(projectReports)
      .set({
        deliveryDate: input.deliveryDate,
        deliveryDateAssignedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(projectReports.id, input.reportId))
      .returning();

    await recordAudit({
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
  } else {
    const [before] = await db
      .select()
      .from(manualReports)
      .where(eq(manualReports.id, input.reportId))
      .limit(1);
    if (!before) return { ok: false, error: "Reporte no encontrado" };
    if (before.deliveredAt)
      return { ok: false, error: "El reporte ya fue entregado" };

    const [after] = await db
      .update(manualReports)
      .set({
        deliveryDate: input.deliveryDate,
        deliveryDateAssignedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(manualReports.id, input.reportId))
      .returning();

    await recordAudit({
      entityType: "manual_report",
      entityId: input.reportId,
      action: "delivery_date_update",
      beforeJson: {
        deliveryDate: before.deliveryDate,
        deliveryDateAssignedAt: before.deliveryDateAssignedAt,
      },
      afterJson: {
        deliveryDate: after.deliveryDate,
        deliveryDateAssignedAt: after.deliveryDateAssignedAt,
      },
    });
  }

  revalidatePath("/reportes/calendario");
  return { ok: true };
}

export async function markReportDelivered(input: {
  reportId: string;
  kind: ReportKind;
}): Promise<Result> {
  const now = new Date();

  if (input.kind === "project") {
    const [before] = await db
      .select()
      .from(projectReports)
      .where(eq(projectReports.id, input.reportId))
      .limit(1);
    if (!before) return { ok: false, error: "Reporte no encontrado" };
    if (before.deliveredAt)
      return { ok: false, error: "El reporte ya fue entregado" };
    if (!before.deliveryDate) {
      return {
        ok: false,
        error:
          "Asigná primero una fecha de entrega antes de marcar como entregado",
      };
    }

    await db
      .update(projectReports)
      .set({ deliveredAt: now, updatedAt: now })
      .where(eq(projectReports.id, input.reportId));

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

      await recordAudit({
        entityType: "project",
        entityId: before.projectId,
        action: "status_change",
        beforeJson: { status: projBefore.status },
        afterJson: { status: "reportado" },
      });
    }

    await recordAudit({
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

  // kind === "manual"
  const [before] = await db
    .select()
    .from(manualReports)
    .where(eq(manualReports.id, input.reportId))
    .limit(1);
  if (!before) return { ok: false, error: "Reporte no encontrado" };
  if (before.deliveredAt)
    return { ok: false, error: "El reporte ya fue entregado" };

  await db
    .update(manualReports)
    .set({ deliveredAt: now, updatedAt: now })
    .where(eq(manualReports.id, input.reportId));

  await recordAudit({
    entityType: "manual_report",
    entityId: input.reportId,
    action: "delivered",
    beforeJson: { deliveredAt: null },
    afterJson: { deliveredAt: now.toISOString() },
  });

  revalidatePath("/reportes/calendario");
  return { ok: true };
}

type UrlParseResult =
  | { ok: true; url: string | null }
  | { ok: false; error: string };

function parseUrlOrEmpty(raw: string): UrlParseResult {
  const s = raw.trim();
  if (s === "") return { ok: true, url: null };
  let parsed: URL;
  try {
    parsed = new URL(s);
  } catch {
    return {
      ok: false,
      error: "Link inválido (pegá la URL completa, ej: https://…)",
    };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      error: "El link tiene que empezar con http:// o https://",
    };
  }
  return { ok: true, url: s };
}

export async function setReportPptUrl(input: {
  reportId: string;
  kind: ReportKind;
  url: string;
}): Promise<Result> {
  const parsed = parseUrlOrEmpty(input.url);
  if (!parsed.ok) return parsed;
  const url = parsed.url;

  if (input.kind === "project") {
    const [before] = await db
      .select()
      .from(projectReports)
      .where(eq(projectReports.id, input.reportId))
      .limit(1);
    if (!before) return { ok: false, error: "Reporte no encontrado" };
    if (before.reportPptUrl === url) return { ok: true };

    await db
      .update(projectReports)
      .set({ reportPptUrl: url, updatedAt: new Date() })
      .where(eq(projectReports.id, input.reportId));

    await recordAudit({
      entityType: "project_report",
      entityId: input.reportId,
      action: url ? "ppt_url_set" : "ppt_url_clear",
      beforeJson: { reportPptUrl: before.reportPptUrl },
      afterJson: { reportPptUrl: url },
    });
  } else {
    const [before] = await db
      .select()
      .from(manualReports)
      .where(eq(manualReports.id, input.reportId))
      .limit(1);
    if (!before) return { ok: false, error: "Reporte no encontrado" };
    if (before.reportPptUrl === url) return { ok: true };

    await db
      .update(manualReports)
      .set({ reportPptUrl: url, updatedAt: new Date() })
      .where(eq(manualReports.id, input.reportId));

    await recordAudit({
      entityType: "manual_report",
      entityId: input.reportId,
      action: url ? "ppt_url_set" : "ppt_url_clear",
      beforeJson: { reportPptUrl: before.reportPptUrl },
      afterJson: { reportPptUrl: url },
    });
  }

  revalidatePath("/reportes/calendario");
  return { ok: true };
}

// ─── Manual reports CRUD ───────────────────────────────────────────────────

export async function createManualReport(input: {
  clientId: string;
  name: string;
  description?: string | null;
  deliveryDate: string; // YYYY-MM-DD
}): Promise<Result> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "El nombre es obligatorio" };
  if (!input.deliveryDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return { ok: false, error: "Fecha inválida (esperado YYYY-MM-DD)" };
  }

  const [c] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.id, input.clientId))
    .limit(1);
  if (!c) return { ok: false, error: "Cliente no encontrado" };

  const [created] = await db
    .insert(manualReports)
    .values({
      clientId: input.clientId,
      name,
      description: input.description?.trim() || null,
      deliveryDate: input.deliveryDate,
    })
    .returning();

  await recordAudit({
    entityType: "manual_report",
    entityId: created.id,
    action: "create",
    afterJson: created,
  });

  revalidatePath("/reportes/calendario");
  return { ok: true };
}

export async function deleteManualReport(input: {
  reportId: string;
}): Promise<Result> {
  const [before] = await db
    .select()
    .from(manualReports)
    .where(eq(manualReports.id, input.reportId))
    .limit(1);
  if (!before) return { ok: false, error: "Reporte no encontrado" };

  await db.delete(manualReports).where(eq(manualReports.id, input.reportId));

  await recordAudit({
    entityType: "manual_report",
    entityId: input.reportId,
    action: "delete",
    beforeJson: before,
  });

  revalidatePath("/reportes/calendario");
  return { ok: true };
}
