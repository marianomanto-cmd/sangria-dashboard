import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { billings, mediaPlans } from "@/db/schema";

export type ProjectBillingRow = typeof billings.$inferSelect;

export async function getProjectBillings(
  projectId: string,
): Promise<ProjectBillingRow[]> {
  return db
    .select()
    .from(billings)
    .where(eq(billings.projectId, projectId))
    .orderBy(desc(billings.month), desc(billings.createdAt));
}

export type MediaPlanVersion = typeof mediaPlans.$inferSelect;

export async function getProjectPlanVersions(
  projectId: string,
): Promise<MediaPlanVersion[]> {
  return db
    .select()
    .from(mediaPlans)
    .where(eq(mediaPlans.projectId, projectId))
    .orderBy(desc(mediaPlans.version));
}
