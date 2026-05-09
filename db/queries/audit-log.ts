import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog } from "@/db/schema";

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
