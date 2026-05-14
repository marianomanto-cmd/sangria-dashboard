import { asc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { clients, projects } from "@/db/schema";

export type ClientListRow = {
  id: string;
  name: string;
  slug: string;
  status: (typeof clients.$inferSelect)["status"];
  totalProjects: number;
  activeProjects: number;
  activePipelineUsd: number;
};

export async function getClientsList(): Promise<ClientListRow[]> {
  const rows = await db
    .select({
      id: clients.id,
      name: clients.name,
      slug: clients.slug,
      status: clients.status,
      totalProjects: sql<number>`count(${projects.id})::int`,
      activeProjects: sql<number>`count(${projects.id}) filter (where ${projects.status} = 'active')::int`,
      activePipelineUsd: sql<string>`coalesce(sum(${projects.totalGrossBudgetUsd}) filter (where ${projects.status} = 'active'), 0)`,
    })
    .from(clients)
    .leftJoin(projects, eq(projects.clientId, clients.id))
    .where(ne(clients.status, "archived"))
    .groupBy(clients.id)
    .orderBy(asc(clients.name));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    status: r.status,
    totalProjects: r.totalProjects,
    activeProjects: r.activeProjects,
    activePipelineUsd: Number.parseFloat(r.activePipelineUsd),
  }));
}
