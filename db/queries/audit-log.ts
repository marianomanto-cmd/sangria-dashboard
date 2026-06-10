import { and, desc, eq, gt, gte, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, mediaPlanPublishers } from "@/db/schema";

export type AuditLogRow = typeof auditLog.$inferSelect;

export type AuditLogFilters = {
  entityType?: string;
  action?: string;
  sinceDate?: string; // 'YYYY-MM-DD'
};

const DEFAULT_LIMIT = 200;

export async function getAuditLog(
  filters: AuditLogFilters = {},
  limit: number = DEFAULT_LIMIT,
): Promise<AuditLogRow[]> {
  const conds = [];
  if (filters.entityType) conds.push(eq(auditLog.entityType, filters.entityType));
  if (filters.action) conds.push(eq(auditLog.action, filters.action));
  if (filters.sinceDate) {
    conds.push(gte(auditLog.createdAt, new Date(`${filters.sinceDate}T00:00:00Z`)));
  }

  return db
    .select()
    .from(auditLog)
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
}

// ────────────────────────────────────────────────────────────────────────────
// Historial de edición de un plan: todos los eventos del audit_log que tocan
// el plan o su contenido (publishers, placements, fees, tabs auxiliares).
// Los hijos no llevan el plan_id en entity_id, así que se buscan por el
// mediaPlanId que viaja en before/afterJson — eso incluye también hijos que
// ya fueron BORRADOS (sus rows no existen más, pero el audit conserva el
// JSON). Para placements (que solo llevan mediaPlanPublisherId) primero se
// recolectan los ids de bloques publisher del plan, vivos + históricos.
//
// `since` permite acotar a la "versión vigente" (eventos posteriores a la
// última aprobación) — lo computa el caller con los snapshots del plan.
// ────────────────────────────────────────────────────────────────────────────

const PLAN_CHILD_ENTITY_TYPES = [
  "media_plan_publisher",
  "media_plan_fee",
  "media_plan_aux_sheet",
];

export async function getPlanAuditEvents(
  planId: string,
  opts: { since?: Date | null; limit?: number } = {},
): Promise<AuditLogRow[]> {
  const limit = opts.limit ?? 300;

  const childWithPlanId = sql`(${auditLog.beforeJson}->>'mediaPlanId' = ${planId} or ${auditLog.afterJson}->>'mediaPlanId' = ${planId})`;

  // Ids de bloques publisher del plan: históricos (desde el audit) + vivos
  // (por si alguna row es anterior al wire-up del audit).
  const [auditMpps, liveMpps] = await Promise.all([
    db
      .select({ id: auditLog.entityId })
      .from(auditLog)
      .where(
        and(eq(auditLog.entityType, "media_plan_publisher"), childWithPlanId),
      ),
    db
      .select({ id: mediaPlanPublishers.id })
      .from(mediaPlanPublishers)
      .where(eq(mediaPlanPublishers.mediaPlanId, planId)),
  ]);
  const mppIds = [...new Set([...auditMpps, ...liveMpps].map((r) => r.id))];

  const scopes = [
    and(eq(auditLog.entityType, "media_plan"), eq(auditLog.entityId, planId)),
    and(inArray(auditLog.entityType, PLAN_CHILD_ENTITY_TYPES), childWithPlanId),
  ];
  if (mppIds.length > 0) {
    scopes.push(
      and(
        eq(auditLog.entityType, "media_plan_placement"),
        inArray(
          sql`coalesce(${auditLog.beforeJson}->>'mediaPlanPublisherId', ${auditLog.afterJson}->>'mediaPlanPublisherId')`,
          mppIds,
        ),
      ),
    );
  }

  const conds = [or(...scopes)];
  if (opts.since) conds.push(gt(auditLog.createdAt, opts.since));

  const rows = await db
    .select()
    .from(auditLog)
    .where(and(...conds))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);

  return rows.map(compactAuxSheetRow);
}

// Los updates de un tab auxiliar guardan la grilla COMPLETA en before/after
// (hay un evento por celda commiteada) — servirlas enteras inflaría el
// payload de la página del plan. Se compactan a "filas×columnas (+ celdas
// cambiadas)"; el JSON completo sigue disponible en /auditoria.
function gridOf(j: unknown): string[][] | null {
  if (!j || typeof j !== "object") return null;
  const g = (j as { gridJson?: unknown }).gridJson;
  return Array.isArray(g) ? (g as string[][]) : null;
}

function compactAuxSheetRow(row: AuditLogRow): AuditLogRow {
  if (row.entityType !== "media_plan_aux_sheet") return row;
  const bGrid = gridOf(row.beforeJson);
  const aGrid = gridOf(row.afterJson);

  let changed = 0;
  if (bGrid && aGrid) {
    const nRows = Math.max(bGrid.length, aGrid.length);
    for (let r = 0; r < nRows; r++) {
      const nCols = Math.max(bGrid[r]?.length ?? 0, aGrid[r]?.length ?? 0);
      for (let c = 0; c < nCols; c++) {
        if ((bGrid[r]?.[c] ?? "") !== (aGrid[r]?.[c] ?? "")) changed++;
      }
    }
  }

  const summarize = (j: unknown, g: string[][] | null, suffix: string) =>
    j && typeof j === "object"
      ? {
          ...(j as Record<string, unknown>),
          gridJson: g ? `${g.length}×${g[0]?.length ?? 0}${suffix}` : undefined,
        }
      : j;

  return {
    ...row,
    beforeJson: summarize(row.beforeJson, bGrid, ""),
    afterJson: summarize(
      row.afterJson,
      aGrid,
      changed > 0
        ? ` · ${changed} ${changed === 1 ? "celda cambiada" : "celdas cambiadas"}`
        : "",
    ),
  };
}

export type AuditLogStats = {
  total: number;
  byEntityType: Array<{ entityType: string; count: number }>;
  byAction: Array<{ action: string; count: number }>;
};

export async function getAuditLogStats(): Promise<AuditLogStats> {
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(auditLog);

  const byEntityType = await db
    .select({
      entityType: auditLog.entityType,
      count: sql<number>`count(*)::int`,
    })
    .from(auditLog)
    .groupBy(auditLog.entityType)
    .orderBy(desc(sql`count(*)`));

  const byAction = await db
    .select({
      action: auditLog.action,
      count: sql<number>`count(*)::int`,
    })
    .from(auditLog)
    .groupBy(auditLog.action)
    .orderBy(desc(sql`count(*)`));

  return { total, byEntityType, byAction };
}
