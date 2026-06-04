import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  budgetOrigins,
  clients,
  mediaPlanPlacements,
  mediaPlanPublishers,
  mediaPlans,
  planBillingPublishers,
  planBillings,
  projects,
  publishers,
} from "@/db/schema";

// ════════════════════════════════════════════════════════════════════════════
// Queries del portal de cliente (público, read-only). Todo scopeado a un solo
// cliente. Los datos los sirven las queries existentes (dashboard, billing
// tracker, estimate, reports) pasando clientId; acá solo el lookup del cliente
// por slug y las opciones de filtros (budget origin / proyecto / mes).
// ════════════════════════════════════════════════════════════════════════════

export type PortalClient = {
  id: string;
  name: string;
  slug: string;
  language: (typeof clients.$inferSelect)["language"];
  prefix: string | null;
};

export async function getPortalClient(
  slug: string,
): Promise<PortalClient | null> {
  const [c] = await db
    .select({
      id: clients.id,
      name: clients.name,
      slug: clients.slug,
      language: clients.language,
      prefix: clients.prefix,
    })
    .from(clients)
    .where(and(eq(clients.slug, slug), ne(clients.status, "archived")))
    .limit(1);
  return c ?? null;
}

export type PortalFilterOptions = {
  budgetOrigins: { id: string; name: string }[];
  projects: { id: string; code: string; name: string }[];
  months: string[]; // YYYY-MM ascendente
};

function enumerateMonths(start: string, end: string): string[] {
  const out: string[] = [];
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  if (!Number.isFinite(sy) || !Number.isFinite(sm)) return out;
  let y = sy;
  let m = sm;
  let guard = 0;
  while ((y < ey || (y === ey && m <= em)) && guard < 600) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    guard += 1;
  }
  return out;
}

export async function getPortalFilterOptions(
  clientId: string,
): Promise<PortalFilterOptions> {
  // Budget origins de los proyectos del cliente.
  const origins = await db
    .selectDistinct({ id: budgetOrigins.id, name: budgetOrigins.name })
    .from(projects)
    .innerJoin(budgetOrigins, eq(projects.budgetOriginId, budgetOrigins.id))
    .where(eq(projects.clientId, clientId))
    .orderBy(asc(budgetOrigins.name));

  // Proyectos del cliente (con al menos un plan vivo).
  const projs = await db
    .selectDistinct({
      id: projects.id,
      code: projects.code,
      name: projects.name,
    })
    .from(projects)
    .innerJoin(
      mediaPlans,
      and(eq(mediaPlans.projectId, projects.id), isNull(mediaPlans.deletedAt)),
    )
    .where(eq(projects.clientId, clientId))
    .orderBy(asc(projects.code));

  // Rango de meses: combina meses de billings + spans de placements del cliente.
  const [billingRange] = await db
    .select({
      min: sql<string | null>`min(${planBillings.month})`,
      max: sql<string | null>`max(${planBillings.month})`,
    })
    .from(planBillings)
    .innerJoin(
      mediaPlans,
      and(eq(planBillings.mediaPlanId, mediaPlans.id), isNull(mediaPlans.deletedAt)),
    )
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
    .where(eq(projects.clientId, clientId));

  const [placementRange] = await db
    .select({
      min: sql<string | null>`min(${mediaPlanPlacements.startDate})::text`,
      max: sql<string | null>`max(${mediaPlanPlacements.endDate})::text`,
    })
    .from(mediaPlanPlacements)
    .innerJoin(
      mediaPlanPublishers,
      eq(mediaPlanPlacements.mediaPlanPublisherId, mediaPlanPublishers.id),
    )
    .innerJoin(
      mediaPlans,
      and(eq(mediaPlanPublishers.mediaPlanId, mediaPlans.id), isNull(mediaPlans.deletedAt)),
    )
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
    .where(eq(projects.clientId, clientId));

  const candidatesMin = [
    billingRange?.min ?? null,
    placementRange?.min ? placementRange.min.slice(0, 7) : null,
  ].filter((x): x is string => !!x);
  const candidatesMax = [
    billingRange?.max ?? null,
    placementRange?.max ? placementRange.max.slice(0, 7) : null,
  ].filter((x): x is string => !!x);

  const minMonth = candidatesMin.sort()[0] ?? null;
  const maxMonth = candidatesMax.sort().reverse()[0] ?? null;
  const months = minMonth && maxMonth ? enumerateMonths(minMonth, maxMonth) : [];

  return { budgetOrigins: origins, projects: projs, months };
}

// Inversión por publisher para un cliente: planeado (media_plan_publishers,
// planes no-draft) vs real (plan_billing_publishers). Dos agregaciones por
// separado (para no caer en cartesian) mergeadas por nombre de publisher.
// Alimenta el chart "Inversión por publisher" del Resumen del portal.
export async function getClientSpendByPublisher(
  clientId: string,
): Promise<{ name: string; planned: number; real: number }[]> {
  const realRows = await db
    .select({
      name: publishers.name,
      value: sql<string>`coalesce(sum(${planBillingPublishers.amountRealUsd}), 0)`,
    })
    .from(planBillingPublishers)
    .innerJoin(publishers, eq(planBillingPublishers.publisherId, publishers.id))
    .innerJoin(
      planBillings,
      eq(planBillingPublishers.planBillingId, planBillings.id),
    )
    .innerJoin(
      mediaPlans,
      and(eq(planBillings.mediaPlanId, mediaPlans.id), isNull(mediaPlans.deletedAt)),
    )
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
    .where(eq(projects.clientId, clientId))
    .groupBy(publishers.name);

  const plannedRows = await db
    .select({
      name: publishers.name,
      value: sql<string>`coalesce(sum(${mediaPlanPublishers.totalPlannedUsd}), 0)`,
    })
    .from(mediaPlanPublishers)
    .innerJoin(publishers, eq(mediaPlanPublishers.publisherId, publishers.id))
    .innerJoin(
      mediaPlans,
      and(
        eq(mediaPlanPublishers.mediaPlanId, mediaPlans.id),
        isNull(mediaPlans.deletedAt),
        ne(mediaPlans.status, "draft"),
      ),
    )
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
    .where(eq(projects.clientId, clientId))
    .groupBy(publishers.name);

  const map = new Map<string, { name: string; planned: number; real: number }>();
  for (const r of plannedRows) {
    const v = Number.parseFloat(r.value);
    map.set(r.name, { name: r.name, planned: v, real: 0 });
  }
  for (const r of realRows) {
    const v = Number.parseFloat(r.value);
    const e = map.get(r.name) ?? { name: r.name, planned: 0, real: 0 };
    e.real = v;
    map.set(r.name, e);
  }

  return Array.from(map.values())
    .filter((r) => r.planned > 0 || r.real > 0)
    .sort((a, b) => b.planned + b.real - (a.planned + a.real));
}
