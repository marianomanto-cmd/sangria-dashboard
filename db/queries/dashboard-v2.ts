import { sql } from "drizzle-orm";
import { db } from "@/db";

// ════════════════════════════════════════════════════════════════════════════
// Dashboard — TABLERO DE PENDIENTES. Nada más.
//
// POR QUÉ SE ACHICÓ (05/sep/2026). La versión anterior de este archivo intentó
// ser el dashboard entero: KPIs, salud por cliente, tabla de proyectos con
// sparklines, gráfico real vs proyectado, planes en vuelo, reportes y por
// cobrar. Eran NUEVE queries en un solo `Promise.all` contra un pool de TRES
// conexiones (`MAX_CONNECTIONS` en db/index.ts), y la página se caía a diario:
//
//   • En prod, cada carga fallaba en una query DISTINTA (medido el 05/sep:
//     13:38:42 la de proyectado, 13:39:02 la de por cobrar, 13:39:42 la de
//     proyectos). Cuando el que falla cambia en cada intento, no hay una query
//     rota: hay CONTENCIÓN. Las que no consiguen conexión mueren contra el
//     reloj de `db/index.ts` sin haberse ejecutado nunca.
//   • `Promise.all` rechaza con el PRIMER error, así que una sola query
//     ahogada se llevaba puesto el dashboard completo.
//
// LA REGLA AHORA: **el fan-out no puede superar al pool**. Son TRES queries
// para TRES conexiones — una cada una, sin cola local y sin pipeline. Si algún
// día hay que sumar un dato, va DENTRO de una de las tres o se deriva en JS.
// Agregar una cuarta query es volver al problema.
//
// QUÉ MUESTRA, y nada más que eso:
//   1. Billings pendientes    — meses cerrados sin facturar.
//   2. Trackings pendientes   — campañas al aire sin el cierre del día.
//   3. Planes pendientes de QA — firmados que no pueden ir a live hasta que
//                                el AM/PM controle el armado.
//   4. Planes pendientes de aprobar — congelados esperando la firma.
//
// Los planes (3 y 4) salen de UNA query: es la misma tabla con dos estados,
// y separarlos en dos lecturas era gastar un round-trip en un `where`.
//
// Todo lo que se fue (facturación, cartera, proyectos) sigue vivo en sus
// propias pantallas: /billing, /billing-tracker, /proyectos, /planes,
// /reportes/calendario y /dashboard-legacy.
// ════════════════════════════════════════════════════════════════════════════

// ── 1. Billings pendientes ──────────────────────────────────────────────────
export type PendingBilling = {
  planId: string;
  planName: string;
  projectCode: string;
  clientName: string;
  month: string;
  href: string;
};

// ── 2. Trackings pendientes ─────────────────────────────────────────────────
export type PendingTracking = {
  planId: string;
  planName: string;
  clientName: string;
  // Último día TRACKEADO (snapshot_date), no la fecha en que se cargó. Es el
  // mismo criterio que usan el campaign tracker y db/queries/pendings.ts.
  lastCloseDate: string | null;
  daysSinceClose: number | null; // null = nunca se cerró
  href: string;
};

// ── 3 y 4. Planes pendientes ────────────────────────────────────────────────
export type PendingPlan = {
  id: string;
  name: string;
  version: number;
  projectCode: string;
  projectName: string;
  clientName: string;
  // Días desde que el plan quedó esperando ESTA acción:
  //   • pendiente de QA      → desde que se firmó la versión vigente
  //                            (media_plan_snapshots.approved_at)
  //   • pendiente de aprobar → desde que el MM lo congeló
  //                            (media_plan_planning_qa_runs.completed_at)
  // null = no hay fecha registrada (planes viejos, anteriores al QA).
  waitingDays: number | null;
  href: string;
};

export type DashboardV2 = {
  pendingBillings: PendingBilling[];
  pendingTracking: PendingTracking[];
  plansPendingQa: PendingPlan[];
  plansPendingApproval: PendingPlan[];
};

export async function getDashboardV2(
  clientId: string | null = null,
): Promise<DashboardV2> {
  // Filtro global de cliente (`?client=slug`), como fragmento reusable.
  const clientSql = clientId ? sql`and pr.client_id = ${clientId}` : sql``;

  // ── Query 1: BILLINGS PENDIENTES. Meses ya cerrados de un plan firmado que
  // todavía no tienen su billing terminado (falta la fila, o quedó en draft).
  // Los meses se generan EN SQL a partir del período de los placements.
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

  // ── Query 2: TRACKINGS PENDIENTES. Campañas VIGENTES HOY (hoy cae dentro
  // del período de sus placements) que todavía no tienen el cierre del día.
  //
  // Dos cosas que la versión anterior hacía mal y acá están arregladas:
  //
  //   • El período SÍ se chequea. Antes el comentario decía "campañas vigentes
  //     hoy" pero el SQL sólo miraba el status, así que un plan firmado que
  //     arranca el mes que viene aparecía como "tracking pendiente" desde el
  //     día que se aprobaba, y una campaña ya terminada seguía apareciendo
  //     hasta que alguien la pasaba a `finished` a mano.
  //   • El último cierre sale de `max(snapshot_date)` — el día TRACKEADO — y
  //     no de `max(closed_at)`. Es el criterio del campaign tracker y de
  //     db/queries/pendings.ts, y además usa `idx_cas_plan_date` en vez de
  //     agregar a mano todas las filas de snapshots del plan (que son
  //     placement × métrica × día: el join que hacía pesada a esta query).
  const pendingTrackingQuery = db.execute<{
    plan_id: string;
    plan_name: string;
    client_name: string;
    last_close: string | null;
    days_since: number | null;
  }>(sql`
    select mp.id as plan_id, mp.name as plan_name, c.name as client_name,
           to_char(trk.d, 'YYYY-MM-DD')  as last_close,
           (current_date - trk.d)::int   as days_since
    from media_plans mp
    join projects pr on pr.id = mp.project_id
    join clients  c  on c.id  = pr.client_id
    cross join lateral (
      select min(pl.start_date) as s, max(pl.end_date) as e
      from media_plan_publishers mpp
      join media_plan_placements pl on pl.media_plan_publisher_id = mpp.id
      where mpp.media_plan_id = mp.id
    ) per
    cross join lateral (
      select max(cas.snapshot_date) as d
      from campaign_actual_snapshots cas
      where cas.media_plan_id = mp.id
    ) trk
    where mp.deleted_at is null
      and mp.status in ('approved','qa_done','live')
      and per.s is not null and per.e is not null
      and current_date between per.s and per.e
      and (trk.d is null or trk.d < current_date)
      ${clientSql}
    order by trk.d asc nulls first
    limit 40
  `);

  // ── Query 3: PLANES PENDIENTES, los dos estados en UNA lectura.
  //
  //   ready_to_send → el MM lo congeló y espera la firma  → PENDIENTE DE APROBAR
  //   approved      → el cliente firmó y falta el QA de armado → PENDIENTE DE QA
  //                   (regla dura: a `live` sólo se llega desde `qa_done`)
  //
  // Los dos left join son lookups por índice único y dan la fecha desde la que
  // cada plan está esperando: el snapshot de la versión vigente (cuándo se
  // firmó) y el QA de planificación de la versión siguiente (cuándo se
  // congeló). Ver lib/plan-status.ts para el lifecycle completo.
  const pendingPlansQuery = db.execute<{
    id: string;
    name: string;
    status: string;
    version: number;
    project_code: string;
    project_name: string;
    client_name: string;
    waiting_days: number | null;
  }>(sql`
    select mp.id, mp.name, mp.status, mp.current_version as version,
           pr.code as project_code, pr.name as project_name,
           c.name as client_name,
           (case when mp.status = 'approved'
                 then current_date - snap.approved_at::date
                 else current_date - pqa.completed_at::date
            end)::int as waiting_days
    from media_plans mp
    join projects pr on pr.id = mp.project_id
    join clients  c  on c.id  = pr.client_id
    left join media_plan_snapshots snap
           on snap.media_plan_id = mp.id
          and snap.version_number = mp.current_version
    left join media_plan_planning_qa_runs pqa
           on pqa.media_plan_id = mp.id
          and pqa.version_number = mp.current_version + 1
    where mp.deleted_at is null
      and mp.status in ('ready_to_send','approved')
      ${clientSql}
    order by waiting_days desc nulls last, mp.name asc
    limit 60
  `);

  // UNA sola tanda de TRES queries para TRES conexiones. Ver el bloque de
  // arriba: ésta es la regla que mantiene la página en pie.
  const [billingRows, trackingRows, planRows] = await Promise.all([
    pendingBillingsQuery,
    pendingTrackingQuery,
    pendingPlansQuery,
  ]);

  const toPlan = (r: {
    id: string;
    name: string;
    version: number;
    project_code: string;
    project_name: string;
    client_name: string;
    waiting_days: number | null;
  }): PendingPlan => ({
    id: r.id,
    name: r.name,
    version: Number(r.version),
    projectCode: r.project_code,
    projectName: r.project_name,
    clientName: r.client_name,
    waitingDays: r.waiting_days === null ? null : Number(r.waiting_days),
    href: `/proyectos/${r.project_code}/planes/${r.id}`,
  });

  const plans = [...planRows];

  return {
    pendingBillings: [...billingRows].map((r) => ({
      planId: r.plan_id,
      planName: r.plan_name,
      projectCode: r.project_code,
      clientName: r.client_name,
      month: r.month,
      href: `/proyectos/${r.project_code}/planes/${r.plan_id}/billing`,
    })),
    pendingTracking: [...trackingRows].map((r) => ({
      planId: r.plan_id,
      planName: r.plan_name,
      clientName: r.client_name,
      lastCloseDate: r.last_close,
      daysSinceClose: r.days_since === null ? null : Number(r.days_since),
      href: `/campaign-tracker/${r.plan_id}`,
    })),
    plansPendingQa: plans.filter((r) => r.status === "approved").map(toPlan),
    plansPendingApproval: plans
      .filter((r) => r.status === "ready_to_send")
      .map(toPlan),
  };
}
