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

// ── Pendientes: las cuatro cosas que el equipo tiene que accionar ───────────
export type PendingBilling = {
  planId: string;
  planName: string;
  projectCode: string;
  clientName: string;
  month: string;
};

export type PendingReport = {
  id: string;
  name: string;
  clientName: string;
  deliveryDate: string;
  daysUntil: number; // negativo = vencido
};

export type Receivable = {
  id: string;
  invoiceNumber: string | null;
  planName: string;
  clientName: string;
  month: string;
  amountUsd: number;
  daysOverdue: number | null; // null = todavía no vence
};

export type StaleTracking = {
  planId: string;
  planName: string;
  clientName: string;
  lastCloseDate: string | null;
  daysSinceClose: number | null;
};

export type DashV2Client = {
  slug: string;
  name: string;
  budgetUsd: number;
  spentUsd: number;
  consumptionPct: number;
  projectCount: number;
  activeProjects: number;
};

export type DashboardV2 = {
  kpis: DashV2Kpis;
  projects: DashV2Project[];
  clients: DashV2Client[];
  monthly: DashV2Month[];
  plansInFlight: DashV2Plan[];
  pendingBillings: PendingBilling[];
  pendingReports: PendingReport[];
  receivables: Receivable[];
  staleTracking: StaleTracking[];
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

  // Filtro por cliente para las queries en SQL directo, como fragmento.
  const clientSql = clientId
    ? sql`and pr.client_id = ${clientId}`
    : sql``;

  // ── Query 5: BILLING PENDIENTE. Meses ya cerrados de un plan vivo que
  // todavía no tienen su billing terminado (falta la fila, o está en draft).
  // Los meses se generan EN SQL a partir del período de los placements; el
  // dashboard viejo los enumeraba en JS plan por plan, que es de donde salía
  // buena parte de su fan-out.
  const pendingBillingsQuery = db.execute<{
    plan_id: string;
    plan_name: string;
    project_code: string;
    client_name: string;
    month: string;
  }>(sql`
    select mp.id as plan_id, mp.name as plan_name, pr.code as project_code,
           c.name as client_name, to_char(m, 'YYYY-MM') as month
    from media_plans mp
    join projects pr on pr.id = mp.project_id
    join clients  c  on c.id  = pr.client_id
    cross join lateral (
      select min(pl.start_date) as s, max(pl.end_date) as e
      from media_plan_publishers mpp
      join media_plan_placements pl on pl.media_plan_publisher_id = mpp.id
      where mpp.media_plan_id = mp.id
    ) per
    cross join lateral generate_series(
      date_trunc('month', per.s), date_trunc('month', per.e), interval '1 month'
    ) m
    left join plan_billings pb
           on pb.media_plan_id = mp.id and pb.month = to_char(m, 'YYYY-MM')
    where mp.deleted_at is null
      and mp.status in ('approved','qa_done','live','finished')
      and per.s is not null
      and to_char(m, 'YYYY-MM') < to_char(now(), 'YYYY-MM')
      and (pb.id is null or pb.status = 'draft')
      ${clientSql}
    order by month desc
    limit 40
  `);

  // ── Query 6: REPORTES pendientes. Los dos tipos (de proyecto y manuales) en
  // UNA query con union all, no en dos lecturas separadas.
  const pendingReportsQuery = db.execute<{
    id: string;
    name: string;
    client_name: string;
    delivery_date: string;
    days_until: number;
  }>(sql`
    select rep.id, rep.name, rep.client_name,
           to_char(rep.delivery_date, 'YYYY-MM-DD') as delivery_date,
           (rep.delivery_date - current_date)::int  as days_until
    from (
      select prep.id, pr.name as name, c.name as client_name,
             prep.delivery_date, pr.client_id
      from project_reports prep
      join projects pr on pr.id = prep.project_id
      join clients  c  on c.id  = pr.client_id
      where prep.delivered_at is null and prep.delivery_date is not null
      union all
      select mr.id, mr.name, c.name, mr.delivery_date, mr.client_id
      from manual_reports mr
      join clients c on c.id = mr.client_id
      where mr.delivered_at is null
    ) rep
    ${clientId ? sql`where rep.client_id = ${clientId}` : sql``}
    order by rep.delivery_date asc
    limit 40
  `);

  // ── Query 7: POR COBRAR. Billings emitidos y sin pagar.
  const receivablesQuery = db.execute<{
    id: string;
    invoice_number: string | null;
    plan_name: string;
    client_name: string;
    month: string;
    amount_usd: string;
    days_overdue: number | null;
  }>(sql`
    select pb.id, pb.invoice_number, mp.name as plan_name, c.name as client_name,
           pb.month, pb.total_usd as amount_usd,
           case when pb.due_date is null then null
                else greatest((current_date - pb.due_date)::int, 0)
           end as days_overdue
    from plan_billings pb
    join media_plans mp on mp.id = pb.media_plan_id and mp.deleted_at is null
    join projects pr on pr.id = mp.project_id
    join clients  c  on c.id  = pr.client_id
    where pb.paid_at is null
      and pb.status in ('sent','invoiced')
      ${clientSql}
    order by pb.due_date asc nulls last, pb.month desc
    limit 40
  `);

  // ── Query 8: TRACKING desactualizado. Campañas vigentes hoy cuyo último
  // cierre de tracking quedó viejo (o que nunca se cerraron).
  const staleTrackingQuery = db.execute<{
    plan_id: string;
    plan_name: string;
    client_name: string;
    last_close: string | null;
    days_since: number | null;
  }>(sql`
    select mp.id as plan_id, mp.name as plan_name, c.name as client_name,
           to_char(max(cas.closed_at), 'YYYY-MM-DD')          as last_close,
           (current_date - max(cas.closed_at)::date)::int     as days_since
    from media_plans mp
    join projects pr on pr.id = mp.project_id
    join clients  c  on c.id  = pr.client_id
    left join campaign_actual_snapshots cas on cas.media_plan_id = mp.id
    where mp.deleted_at is null
      and mp.status in ('approved','qa_done','live')
      ${clientSql}
    group by mp.id, mp.name, c.name
    having max(cas.closed_at) is null
        or max(cas.closed_at)::date < current_date
    order by max(cas.closed_at) asc nulls first
    limit 40
  `);

  // UNA sola tanda con las OCHO queries. Ver el comentario de arriba: esto es
  // lo que hace que la página cueste ~1 round-trip en vez de ~24 en serie.
  const [
    projectRows,
    monthlyRows,
    invoicedRows,
    planRows,
    pendingBillingRows,
    pendingReportRows,
    receivableRows,
    staleTrackingRows,
  ] = await Promise.all([
    projectsQuery,
    monthlyQuery,
    invoicedQuery,
    plansQuery,
    pendingBillingsQuery,
    pendingReportsQuery,
    receivablesQuery,
    staleTrackingQuery,
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

  // ── Salud por cliente: se agrega en JS sobre las filas de proyectos que ya
  // tenemos. No hace falta otra query para agrupar 180 filas por cliente.
  const clientAgg = new Map<string, DashV2Client>();
  for (const p of projectsOut) {
    const prev = clientAgg.get(p.clientSlug);
    const acc: DashV2Client = prev ?? {
      slug: p.clientSlug,
      name: p.clientName,
      budgetUsd: 0,
      spentUsd: 0,
      consumptionPct: 0,
      projectCount: 0,
      activeProjects: 0,
    };
    acc.budgetUsd += p.budgetUsd;
    acc.spentUsd += p.spentUsd;
    acc.projectCount += 1;
    if (p.status === "active") acc.activeProjects += 1;
    clientAgg.set(p.clientSlug, acc);
  }
  const clientsOut = [...clientAgg.values()]
    .map((c) => ({
      ...c,
      consumptionPct: c.budgetUsd > 0 ? (c.spentUsd / c.budgetUsd) * 100 : 0,
    }))
    .sort((a, b) => b.spentUsd - a.spentUsd);

  return {
    kpis: {
      pipelineActiveUsd,
      activeClients: activeClientIds.size,
      invoicedYtdUsd: num(invoicedRows[0]?.value),
      consumptionPct:
        pipelineActiveUsd > 0 ? (spentActiveUsd / pipelineActiveUsd) * 100 : 0,
    },
    projects: projectsOut,
    clients: clientsOut,
    monthly: monthlyRows.map((m) => ({
      month: m.month,
      totalUsd: num(m.totalUsd),
    })),
    plansInFlight: planRows,
    pendingBillings: [...pendingBillingRows].map((r) => ({
      planId: r.plan_id,
      planName: r.plan_name,
      projectCode: r.project_code,
      clientName: r.client_name,
      month: r.month,
    })),
    pendingReports: [...pendingReportRows].map((r) => ({
      id: r.id,
      name: r.name,
      clientName: r.client_name,
      deliveryDate: r.delivery_date,
      daysUntil: Number(r.days_until),
    })),
    receivables: [...receivableRows].map((r) => ({
      id: r.id,
      invoiceNumber: r.invoice_number,
      planName: r.plan_name,
      clientName: r.client_name,
      month: r.month,
      amountUsd: num(r.amount_usd),
      daysOverdue: r.days_overdue === null ? null : Number(r.days_overdue),
    })),
    staleTracking: [...staleTrackingRows].map((r) => ({
      planId: r.plan_id,
      planName: r.plan_name,
      clientName: r.client_name,
      lastCloseDate: r.last_close,
      daysSinceClose: r.days_since === null ? null : Number(r.days_since),
    })),
  };
}
