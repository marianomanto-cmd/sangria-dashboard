import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  budgetOrigins,
  clients,
  mediaPlanLines,
  mediaPlans,
  projects,
} from "@/db/schema";

export type ProjectDetailLine = {
  id: string;
  publisher: (typeof mediaPlanLines.$inferSelect)["publisher"];
  placementName: string;
  audienceMarket: string | null;
  startDate: string | null;
  endDate: string | null;
  budgetNetUsd: number;
  feePct: number;
  notes: string | null;
  sortOrder: number;
};

export type PublisherGroup = {
  publisher: ProjectDetailLine["publisher"];
  lines: ProjectDetailLine[];
  totalBudget: number;
  totalFee: number;
  minStart: string | null;
  maxEnd: string | null;
};

export type ProjectDetail = {
  project: typeof projects.$inferSelect;
  client: { id: string; name: string; slug: string };
  budgetOrigin: { id: string; name: string; colorHex: string | null };
  activePlan: typeof mediaPlans.$inferSelect | null;
  publishers: PublisherGroup[];
  totalLines: number;
  totalBudget: number;
  totalFee: number;
};

export async function getProjectDetail(
  code: string,
): Promise<ProjectDetail | null> {
  // 1. Project + client + budget origin en un round-trip.
  const [row] = await db
    .select({
      project: projects,
      client: { id: clients.id, name: clients.name, slug: clients.slug },
      origin: {
        id: budgetOrigins.id,
        name: budgetOrigins.name,
        colorHex: budgetOrigins.colorHex,
      },
    })
    .from(projects)
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .innerJoin(budgetOrigins, eq(projects.budgetOriginId, budgetOrigins.id))
    .where(eq(projects.code, code))
    .limit(1);

  if (!row) return null;

  // 2. Plan vigente (status='approved'). Si hay varios — solo debería haber
  //    uno por la regla del prompt — tomamos el de mayor versión.
  const [activePlan] = await db
    .select()
    .from(mediaPlans)
    .where(
      and(
        eq(mediaPlans.projectId, row.project.id),
        eq(mediaPlans.status, "approved"),
      ),
    )
    .orderBy(asc(mediaPlans.version))
    .limit(1);

  // 3. Líneas del plan.
  const linesRows = activePlan
    ? await db
        .select()
        .from(mediaPlanLines)
        .where(eq(mediaPlanLines.mediaPlanId, activePlan.id))
        .orderBy(asc(mediaPlanLines.sortOrder))
    : [];

  // 4. Agrupar por publisher.
  const groupMap = new Map<string, ProjectDetailLine[]>();
  for (const l of linesRows) {
    const detailLine: ProjectDetailLine = {
      id: l.id,
      publisher: l.publisher,
      placementName: l.placementName,
      audienceMarket: l.audienceMarket,
      startDate: l.startDate,
      endDate: l.endDate,
      budgetNetUsd: Number.parseFloat(l.budgetNetUsd),
      feePct: Number.parseFloat(l.feePct),
      notes: l.notes,
      sortOrder: l.sortOrder,
    };
    const list = groupMap.get(l.publisher) ?? [];
    list.push(detailLine);
    groupMap.set(l.publisher, list);
  }

  const publishers: PublisherGroup[] = Array.from(groupMap.entries()).map(
    ([pub, lines]) => {
      let minStart: string | null = null;
      let maxEnd: string | null = null;
      let totalBudget = 0;
      let totalFee = 0;
      for (const ln of lines) {
        totalBudget += ln.budgetNetUsd;
        totalFee += ln.budgetNetUsd * (ln.feePct / 100);
        if (ln.startDate && (!minStart || ln.startDate < minStart))
          minStart = ln.startDate;
        if (ln.endDate && (!maxEnd || ln.endDate > maxEnd)) maxEnd = ln.endDate;
      }
      return {
        publisher: pub as ProjectDetailLine["publisher"],
        lines,
        totalBudget,
        totalFee,
        minStart,
        maxEnd,
      };
    },
  );

  // Orden por total budget descendente (mayor inversión primero).
  publishers.sort((a, b) => b.totalBudget - a.totalBudget);

  const totalBudget = publishers.reduce((s, p) => s + p.totalBudget, 0);
  const totalFee = publishers.reduce((s, p) => s + p.totalFee, 0);
  const totalLines = linesRows.length;

  return {
    project: row.project,
    client: row.client,
    budgetOrigin: row.origin,
    activePlan: activePlan ?? null,
    publishers,
    totalLines,
    totalBudget,
    totalFee,
  };
}
