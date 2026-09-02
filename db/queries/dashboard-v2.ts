import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  clients,
  mediaPlans,
  planBillingPublishers,
  planBillings,
  projects,
} from "@/db/schema";

// ════════════════════════════════════════════════════════════════════════════
// Dashboard v2 — reescrito de cero.
//
// POR QUÉ EXISTE: el dashboard viejo (`db/queries/dashboard.ts` +
// `db/queries/pendings.ts`) hacía ~24 round-trips a la DB, en buena parte EN
// SERIE, e incluía un fan-out por proyecto que terminaba en un `in (140 ids)`.
// Era la única vista de la app con ese peso, y era la única que no cargaba: el
// resto de las ventanas anda. Con `max: 1` (db/index.ts) todas esas queries
// comparten UNA conexión, así que cada `await` suelto es un round-trip completo
// a Ohio (~15ms) esperando al anterior.
//
// DISEÑO DE ESTA VERSIÓN, en una sola regla: **una sola tanda**.
//
//   • 4 queries en total (antes ~24).
//   • Todas salen juntas en un `Promise.all`, así postgres.js las pipelinea
//     sobre la conexión única: ~1 round-trip en vez de ~24 en serie (medido:
//     300 queries triviales tardan 54ms en serie y 9ms en batch).
//   • CERO N+1. Nada de traer proyectos y después pedir sus planes.
//   • Los KPIs NO son queries: se derivan en JS de las filas que ya trajimos.
//     Sumar cuatro números sobre 180 filas en memoria no justifica cuatro
//     viajes a la base.
//
// Si algún día hay que agregar un dato acá: sumalo a una de las 4 queries o
// derivalo en JS. Agregar un `await` suelto es volver al problema.
// ════════════════════════════════════════════════════════════════════════════

export type DashV2Project = {
  id: string;
  code: string;
  name: string;
  clientName: string;
  clientSlug: string;
  status: (typeof projects.$inferSelect)["status"];
  budgetUsd: number;
  spentUsd: number;
  consumptionPct: number;
  planCount: number;
};

export type DashV2Month = { month: string; totalUsd: number };

export type DashV2Kpis = {
  pipelineActiveUsd: number;
  activeClients: number;
  invoicedYtdUsd: number;
  consumptionPct: number;
};

export type DashV2Plan = {
  id: string;
  name: string;
  status: (typeof mediaPlans.$inferSelect)["status"];
  projectCode: string;
  projectName: string;
  clientName: string;
};

export type DashboardV2 = {
  kpis: DashV2Kpis;
  projects: DashV2Project[];
  monthly: DashV2Month[];
  plansInFlight: DashV2Plan[];
};

const num = (v: string | number | null | undefined): number =>
  typeof v === "number" ? v : Number.parseFloat(v ?? "0") || 0;

export async function getDashboardV2(
  clientId: string | null = null,
): Promise<DashboardV2> {
  const yearStart = `${new Date().getFullYear()}-01`;
  const byClient = clientId ? [eq(projects.clientId, clientId)] : [];

  // ── Query 1: una fila por proyecto, con su presupuesto, gastado y cantidad
  // de planes. El `count(distinct)` evita que los joins inflen el conteo.
  const projectsQuery = db
    .select({
      id: projects.id,
      code: projects.code,
      name: projects.name,
      clientName: clients.name,
      clientSlug: clients.slug,
      status: projects.status,
      budgetUsd: projects.totalGrossBudgetUsd,
      spentUsd: sql<string>`coalesce(sum(${planBillingPublishers.amountRealUsd}), 0)`,
      planCount: sql<number>`count(distinct ${mediaPlans.id})::int`,
      clientId: projects.clientId,
    })
    .from(projects)
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .leftJoin(
      mediaPlans,
      and(eq(mediaPlans.projectId, projects.id), isNull(mediaPlans.deletedAt)),
    )
    .leftJoin(planBillings, eq(planBillings.mediaPlanId, mediaPlans.id))
    .leftJoin(
      planBillingPublishers,
      eq(planBillingPublishers.planBillingId, planBillings.id),
    )
    .where(byClient.length ? and(...byClient) : undefined)
    .groupBy(projects.id, clients.name, clients.slug)
    .orderBy(desc(sql`coalesce(sum(${planBillingPublishers.amountRealUsd}), 0)`));

  // ── Query 2: facturación real por mes (el gráfico).
  const monthlyQuery = db
    .select({
      month: planBillings.month,
      totalUsd: sql<string>`coalesce(sum(${planBillingPublishers.amountRealUsd}), 0)`,
    })
    .from(planBillings)
    .innerJoin(
      mediaPlans,
      and(
        eq(planBillings.mediaPlanId, mediaPlans.id),
        isNull(mediaPlans.deletedAt),
      ),
    )
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
    .leftJoin(
      planBillingPublishers,
      eq(planBillingPublishers.planBillingId, planBillings.id),
    )
    .where(byClient.length ? and(...byClient) : undefined)
    .groupBy(planBillings.month)
    .orderBy(planBillings.month);

  // ── Query 3: facturado en el año (escalar). Es `plan_billings.total_usd`,
  // no el gastado real: son métricas distintas y no se derivan una de otra.
  const invoicedQuery = db
    .select({
      value: sql<string>`coalesce(sum(${planBillings.totalUsd}), 0)`,
    })
    .from(planBillings)
    .innerJoin(
      mediaPlans,
      and(
        eq(planBillings.mediaPlanId, mediaPlans.id),
        isNull(mediaPlans.deletedAt),
      ),
    )
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
    .where(
      and(
        inArray(planBillings.status, ["invoiced", "paid"]),
        gte(planBillings.month, yearStart),
        ...byClient,
      ),
    );

  // ── Query 4: planes en vuelo. Reemplaza al bloque de "pendientes" viejo,
  // que eran 5 queries con ventanas de fecha calculadas en JS. Acá alcanza con
  // los planes que están vivos: es lo que el equipo mira para saber qué hay en
  // curso, y sale de una sola lectura.
  const plansQuery = db
    .select({
      id: mediaPlans.id,
      name: mediaPlans.name,
      status: mediaPlans.status,
      projectCode: projects.code,
      projectName: projects.name,
      clientName: clients.name,
    })
    .from(mediaPlans)
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(
      and(
        isNull(mediaPlans.deletedAt),
        inArray(mediaPlans.status, ["approved", "qa_done", "live"]),
        ...byClient,
      ),
    )
    .orderBy(desc(mediaPlans.createdAt))
    .limit(50);

  // UNA sola tanda. Ver el comentario de arriba: esto es lo que hace que la
  // página cueste ~1 round-trip en vez de ~24.
  const [projectRows, monthlyRows, invoicedRows, planRows] = await Promise.all([
    projectsQuery,
    monthlyQuery,
    invoicedQuery,
    plansQuery,
  ]);

  // ── KPIs derivados en JS (sin tocar la DB de nuevo) ────────────────────────
  let pipelineActiveUsd = 0;
  let spentActiveUsd = 0;
  const activeClientIds = new Set<string>();
  for (const r of projectRows) {
    if (r.status !== "active") continue;
    pipelineActiveUsd += num(r.budgetUsd);
    spentActiveUsd += num(r.spentUsd);
    activeClientIds.add(r.clientId);
  }

  const projectsOut: DashV2Project[] = projectRows.map((r) => {
    const budgetUsd = num(r.budgetUsd);
    const spentUsd = num(r.spentUsd);
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      clientName: r.clientName,
      clientSlug: r.clientSlug,
      status: r.status,
      budgetUsd,
      spentUsd,
      consumptionPct: budgetUsd > 0 ? (spentUsd / budgetUsd) * 100 : 0,
      planCount: r.planCount,
    };
  });

  return {
    kpis: {
      pipelineActiveUsd,
      activeClients: activeClientIds.size,
      invoicedYtdUsd: num(invoicedRows[0]?.value),
      consumptionPct:
        pipelineActiveUsd > 0 ? (spentActiveUsd / pipelineActiveUsd) * 100 : 0,
    },
    projects: projectsOut,
    monthly: monthlyRows.map((m) => ({
      month: m.month,
      totalUsd: num(m.totalUsd),
    })),
    plansInFlight: planRows,
  };
}
