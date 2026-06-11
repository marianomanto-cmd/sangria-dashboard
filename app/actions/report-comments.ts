"use server";

// Comentarios de reportes del Reporting Calendar (project + manual). Un
// tablerito simple por reporte: lista, agregar, editar y borrar. El primer
// comentario de un reporte manual es su descripción — la siembra
// createManualReport al crearlo (con el creador como autor); los manuales
// pre-existentes se backfillearon una vez vía SQL (ver db/rls.sql/HANDOFF).
// Autor denormalizado como en audit_log.

import { asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { recordAudit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { manualReports, projectReports, reportComments } from "@/db/schema";

type Result<T = void> =
  | (T extends void ? { ok: true } : { ok: true } & T)
  | { ok: false; error: string };

export type ReportRef = {
  kind: "project" | "manual";
  reportId: string;
};

export type ReportComment = {
  id: string;
  body: string;
  authorUserId: string | null;
  authorEmail: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const MAX_BODY_LEN = 4000;

function refCondition(ref: ReportRef) {
  return ref.kind === "project"
    ? eq(reportComments.projectReportId, ref.reportId)
    : eq(reportComments.manualReportId, ref.reportId);
}

export async function listReportComments(
  ref: ReportRef,
): Promise<Result<{ comments: ReportComment[] }>> {
  if (!ref.reportId) return { ok: false, error: "Falta report_id" };

  try {
    const rows = await db
      .select()
      .from(reportComments)
      .where(refCondition(ref))
      .orderBy(asc(reportComments.createdAt));

    return {
      ok: true,
      comments: rows.map((r) => ({
        id: r.id,
        body: r.body,
        authorUserId: r.authorUserId,
        authorEmail: r.authorEmail,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    return { ok: false, error: `No se pudieron cargar los comentarios: ${msg}` };
  }
}

export async function addReportComment(input: {
  ref: ReportRef;
  body: string;
}): Promise<Result> {
  const body = input.body.trim();
  if (!body) return { ok: false, error: "El comentario está vacío" };
  if (body.length > MAX_BODY_LEN) {
    return { ok: false, error: `Máximo ${MAX_BODY_LEN} caracteres` };
  }

  // Validar que el reporte exista (y de paso el kind correcto).
  const exists =
    input.ref.kind === "project"
      ? await db
          .select({ id: projectReports.id })
          .from(projectReports)
          .where(eq(projectReports.id, input.ref.reportId))
          .limit(1)
      : await db
          .select({ id: manualReports.id })
          .from(manualReports)
          .where(eq(manualReports.id, input.ref.reportId))
          .limit(1);
  if (exists.length === 0) return { ok: false, error: "Reporte no encontrado" };

  const user = await getCurrentUser();

  try {
    const [comment] = await db
      .insert(reportComments)
      .values({
        projectReportId: input.ref.kind === "project" ? input.ref.reportId : null,
        manualReportId: input.ref.kind === "manual" ? input.ref.reportId : null,
        body,
        authorUserId: user?.id ?? null,
        authorEmail: user?.email ?? null,
      })
      .returning();

    await recordAudit({
      entityType: "report_comment",
      entityId: comment.id,
      action: "create",
      afterJson: comment,
    });

    revalidatePath("/reportes/calendario");
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    return { ok: false, error: `No se pudo comentar: ${msg}` };
  }
}

export async function updateReportComment(input: {
  commentId: string;
  body: string;
}): Promise<Result> {
  const body = input.body.trim();
  if (!body) return { ok: false, error: "El comentario está vacío" };
  if (body.length > MAX_BODY_LEN) {
    return { ok: false, error: `Máximo ${MAX_BODY_LEN} caracteres` };
  }

  const [before] = await db
    .select()
    .from(reportComments)
    .where(eq(reportComments.id, input.commentId))
    .limit(1);
  if (!before) return { ok: false, error: "Comentario no encontrado" };
  if (before.body === body) return { ok: true };

  const [after] = await db
    .update(reportComments)
    .set({ body, updatedAt: new Date() })
    .where(eq(reportComments.id, input.commentId))
    .returning();

  await recordAudit({
    entityType: "report_comment",
    entityId: input.commentId,
    action: "update",
    beforeJson: before,
    afterJson: after,
  });

  revalidatePath("/reportes/calendario");
  return { ok: true };
}

export async function deleteReportComment(input: {
  commentId: string;
}): Promise<Result> {
  const [before] = await db
    .select()
    .from(reportComments)
    .where(eq(reportComments.id, input.commentId))
    .limit(1);
  if (!before) return { ok: true }; // ya no existe

  await db.delete(reportComments).where(eq(reportComments.id, input.commentId));

  await recordAudit({
    entityType: "report_comment",
    entityId: input.commentId,
    action: "delete",
    beforeJson: before,
  });

  revalidatePath("/reportes/calendario");
  return { ok: true };
}
