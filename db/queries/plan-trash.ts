import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { clients, mediaPlans, projects } from "@/db/schema";

// Papelera de planes: los planes soft-deleted (deletedAt != null). Se guardan
// ad eternum y se listan en /configuracion/papelera-planes para poder
// restaurarlos. Respeta el filtro global ?client= si está presente.

export type DeletedPlan = {
  planId: string;
  planName: string;
  status: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  clientName: string;
  clientSlug: string;
  deletedAt: string; // ISO timestamp
};

export async function getDeletedPlans(
  clientId?: string | null,
): Promise<DeletedPlan[]> {
  const conds = [isNotNull(mediaPlans.deletedAt)];
  if (clientId) conds.push(eq(projects.clientId, clientId));

  const rows = await db
    .select({
      planId: mediaPlans.id,
      planName: mediaPlans.name,
      status: mediaPlans.status,
      projectId: projects.id,
      projectCode: projects.code,
      projectName: projects.name,
      clientName: clients.name,
      clientSlug: clients.slug,
      deletedAt: mediaPlans.deletedAt,
    })
    .from(mediaPlans)
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(and(...conds))
    .orderBy(desc(mediaPlans.deletedAt));

  return rows.map((r) => ({
    planId: r.planId,
    planName: r.planName,
    status: r.status,
    projectId: r.projectId,
    projectCode: r.projectCode,
    projectName: r.projectName,
    clientName: r.clientName,
    clientSlug: r.clientSlug,
    deletedAt:
      r.deletedAt instanceof Date
        ? r.deletedAt.toISOString()
        : String(r.deletedAt),
  }));
}
