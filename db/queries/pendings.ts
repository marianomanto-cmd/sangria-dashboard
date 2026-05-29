import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  campaignActualSnapshots,
  clients,
  mediaPlanPlacements,
  mediaPlanPublishers,
  mediaPlans,
  planBillings,
  projects,
} from "@/db/schema";
import { getReportingCalendar } from "@/db/queries/reports";

// ════════════════════════════════════════════════════════════════════════════
// Tablero de pendientes del dashboard. Cuatro categorías, todas derivadas de
// columnas existentes (no hay flags nuevos en el schema):
//
//   1. billings  — meses YA cerrados (mes < mes actual) de un plan aprobado
//                  que todavía no tienen su billing report (no existe fila en
//                  plan_billings para ese (plan, mes)).
//   2. tracking  — campañas vigentes hoy (plan aprobado, hoy dentro del
//                  período) cuyo último cierre de tracking es anterior a hoy
//                  (o que nunca se trackearon).
//   3. reports   — reports del calendario (con delivery_date, sin entregar):
//                  upcoming = a ≤7 días de la fecha; overdue = fecha ya pasada.
//   4. invoices  — cualquier billing sin pagar (paid_at null: draft/ready/
//                  sent/invoiced). Las que pasaron su due_date se marcan vencidas.
//
// Todo respeta el filtro global por cliente (?client=slug).
// ════════════════════════════════════════════════════════════════════════════

const NEAR_DELIVERY_DAYS = 7;

export type PendingBilling = {
  planId: string;
  planName: string;
  projectCode: string;
  projectName: string;
  clientName: string;
  month: string; // YYYY-MM
};

export type PendingTracking = {
  planId: string;
  planName: string;
  projectCode: string;
  projectName: string;
  clientName: string;
  lastCloseDate: string | null; // YYYY-MM-DD
  daysSinceClose: number | null;
};

export type PendingReport = {
  reportId: string;
  // Null para reportes manuales (no atados a un proyecto).
  projectCode: string | null;
  projectName: string;
  clientName: string;
  deliveryDate: string; // YYYY-MM-DD
  daysUntil: number; // negativo = vencido
};

export type PendingInvoice = {
  billingId: string;
  planId: string;
  planName: string;
  projectCode: string;
  projectName: string;
  clientName: string;
  month: string;
  status: string; // draft | ready | sent | invoiced
  invoiceNumber: string | null;
  totalUsd: number;
  dueDate: string | null;
  overdue: boolean;
};

export type DashboardPendings = {
  billings: PendingBilling[];
  tracking: PendingTracking[];
  reportsUpcoming: PendingReport[];
  reportsOverdue: PendingReport[];
  invoices: PendingInvoice[];
};

// ── Helpers de fecha (todo en YYYY-MM-DD / YYYY-MM, comparables como string) ──

function todayParts() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return { dateStr: `${y}-${m}-${d}`, monthStr: `${y}-${m}` };
}

// Mes anterior a un YYYY-MM dado.
function previousMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split("-").map(Number);
  const prev = new Date(y, m - 2, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
}

function enumerateMonths(start: string, end: string): string[] {
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  // Defensa dura contra fechas malformadas (NaN / Infinity / fuera de rango),
  // p.ej. un placement con start_date '-infinity': al parsear, el mes queda NaN
  // y `NaN > 12` es false, por lo que el año nunca incrementa → loop infinito.
  // Si algún componente no es un entero válido, no enumeramos nada.
  if (
    !Number.isInteger(sy) ||
    !Number.isInteger(sm) ||
    !Number.isInteger(ey) ||
    !Number.isInteger(em) ||
    sm < 1 ||
    sm > 12 ||
    em < 1 ||
    em > 12
  ) {
    return [];
  }
  // Guard numérico (consistente con el loop; no comparación de strings).
  if (sy > ey || (sy === ey && sm > em)) return [];
  const out: string[] = [];
  let y = sy;
  let m = sm;
  // Tope de seguridad (100 años) para que NUNCA pueda colgar, pase lo que pase.
  for (let guard = 0; guard < 1200 && (y < ey || (y === ey && m <= em)); guard++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

// Días entre dos YYYY-MM-DD (to - from). Usa UTC para evitar DST.
function daysBetween(fromStr: string, toStr: string): number {
  const [fy, fm, fd] = fromStr.split("-").map(Number);
  const [ty, tm, td] = toStr.split("-").map(Number);
  const from = Date.UTC(fy, fm - 1, fd);
  const to = Date.UTC(ty, tm - 1, td);
  return Math.round((to - from) / 86_400_000);
}

export async function getDashboardPendings(
  clientId?: string | null,
): Promise<DashboardPendings> {
  const { dateStr: today, monthStr: currentMonth } = todayParts();
  const lastClosedMonth = previousMonth(currentMonth);

  const [billings, tracking, calendar, invoices] = await Promise.all([
    getPendingBillings(clientId, lastClosedMonth),
    getPendingTracking(clientId, today),
    getReportingCalendar(clientId),
    getPendingInvoices(clientId, today),
  ]);

  const reportsUpcoming: PendingReport[] = [];
  const reportsOverdue: PendingReport[] = [];
  for (const r of calendar.inProgress) {
    if (!r.deliveryDate) continue;
    const daysUntil = daysBetween(today, r.deliveryDate);
    const item: PendingReport = {
      reportId: r.reportId,
      projectCode: r.projectCode,
      projectName: r.projectName,
      clientName: r.clientName,
      deliveryDate: r.deliveryDate,
      daysUntil,
    };
    if (daysUntil < 0) reportsOverdue.push(item);
    else if (daysUntil <= NEAR_DELIVERY_DAYS) reportsUpcoming.push(item);
  }
  reportsUpcoming.sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate));
  reportsOverdue.sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate));

  return { billings, tracking, reportsUpcoming, reportsOverdue, invoices };
}

// ── 1. Billing reports faltantes de meses ya cerrados ────────────────────────

async function getPendingBillings(
  clientId: string | null | undefined,
  lastClosedMonth: string,
): Promise<PendingBilling[]> {
  const conds = [eq(mediaPlans.status, "approved"), isNull(mediaPlans.deletedAt)];
  if (clientId) conds.push(eq(projects.clientId, clientId));

  const planRows = await db
    .select({
      planId: mediaPlans.id,
      planName: mediaPlans.name,
      projectCode: projects.code,
      projectName: projects.name,
      clientName: clients.name,
      periodStart: sql<string | null>`min(${mediaPlanPlacements.startDate})::text`,
      periodEnd: sql<string | null>`max(${mediaPlanPlacements.endDate})::text`,
    })
    .from(mediaPlans)
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .leftJoin(
      mediaPlanPublishers,
      eq(mediaPlanPublishers.mediaPlanId, mediaPlans.id),
    )
    .leftJoin(
      mediaPlanPlacements,
      eq(mediaPlanPlacements.mediaPlanPublisherId, mediaPlanPublishers.id),
    )
    .where(and(...conds))
    .groupBy(mediaPlans.id, projects.id, clients.id);

  if (planRows.length === 0) return [];

  const planIds = planRows.map((p) => p.planId);
  const billed = await db
    .select({ planId: planBillings.mediaPlanId, month: planBillings.month })
    .from(planBillings)
    .where(inArray(planBillings.mediaPlanId, planIds));

  const billedKey = new Set(billed.map((b) => `${b.planId}:${b.month}`));

  const out: PendingBilling[] = [];
  for (const p of planRows) {
    if (!p.periodStart || !p.periodEnd) continue;
    const startMonth = p.periodStart.slice(0, 7);
    const endMonth = p.periodEnd.slice(0, 7);
    // Sólo meses cuyo cierre ya pasó (≤ mes anterior al actual).
    const upper = endMonth < lastClosedMonth ? endMonth : lastClosedMonth;
    for (const month of enumerateMonths(startMonth, upper)) {
      if (!billedKey.has(`${p.planId}:${month}`)) {
        out.push({
          planId: p.planId,
          planName: p.planName,
          projectCode: p.projectCode,
          projectName: p.projectName,
          clientName: p.clientName,
          month,
        });
      }
    }
  }
  // Más viejos primero (los más urgentes de regularizar).
  out.sort((a, b) => a.month.localeCompare(b.month));
  return out;
}

// ── 2. Tracking del día pendiente en campañas vigentes ───────────────────────

async function getPendingTracking(
  clientId: string | null | undefined,
  today: string,
): Promise<PendingTracking[]> {
  const conds = [eq(mediaPlans.status, "approved"), isNull(mediaPlans.deletedAt)];
  if (clientId) conds.push(eq(projects.clientId, clientId));

  // 1. Período de cada plan (min start / max end). El join publishers→placements
  //    es jerárquico (1 fila por placement del plan), no multiplica. NO se
  //    joinea campaign_actual_snapshots acá: sería una segunda rama 1:N sobre
  //    media_plans y el producto cartesiano placements × snapshots dispara el
  //    statement timeout en prod. El último cierre se trae aparte (paso 3).
  const planRows = await db
    .select({
      planId: mediaPlans.id,
      planName: mediaPlans.name,
      projectCode: projects.code,
      projectName: projects.name,
      clientName: clients.name,
      periodStart: sql<string | null>`min(${mediaPlanPlacements.startDate})::text`,
      periodEnd: sql<string | null>`max(${mediaPlanPlacements.endDate})::text`,
    })
    .from(mediaPlans)
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .leftJoin(
      mediaPlanPublishers,
      eq(mediaPlanPublishers.mediaPlanId, mediaPlans.id),
    )
    .leftJoin(
      mediaPlanPlacements,
      eq(mediaPlanPlacements.mediaPlanPublisherId, mediaPlanPublishers.id),
    )
    .where(and(...conds))
    .groupBy(mediaPlans.id, projects.id, clients.id);

  // 2. Sólo planes vigentes hoy (hoy dentro del período).
  const live = planRows.filter(
    (r) =>
      r.periodStart &&
      r.periodEnd &&
      today >= r.periodStart &&
      today <= r.periodEnd,
  );
  if (live.length === 0) return [];

  // 3. Último cierre de tracking por plan (agregado aparte → 1 fila por plan,
  //    sin fan-out contra placements).
  const liveIds = live.map((r) => r.planId);
  const closeRows = await db
    .select({
      planId: campaignActualSnapshots.mediaPlanId,
      lastClose: sql<string | null>`max(${campaignActualSnapshots.snapshotDate})::text`,
    })
    .from(campaignActualSnapshots)
    .where(inArray(campaignActualSnapshots.mediaPlanId, liveIds))
    .groupBy(campaignActualSnapshots.mediaPlanId);
  const lastCloseByPlan = new Map(closeRows.map((c) => [c.planId, c.lastClose]));

  const out: PendingTracking[] = [];
  for (const r of live) {
    const lastClose = lastCloseByPlan.get(r.planId) ?? null;
    // Ya cerró hoy → no pendiente.
    if (lastClose && lastClose >= today) continue;
    out.push({
      planId: r.planId,
      planName: r.planName,
      projectCode: r.projectCode,
      projectName: r.projectName,
      clientName: r.clientName,
      lastCloseDate: lastClose,
      daysSinceClose: lastClose ? daysBetween(lastClose, today) : null,
    });
  }
  // Más rezagados (más días sin cerrar / nunca) primero.
  out.sort((a, b) => (b.daysSinceClose ?? 9999) - (a.daysSinceClose ?? 9999));
  return out;
}

// ── 4. Facturas impagas ──────────────────────────────────────────────────────
// "Cualquier billing sin pagar": todo plan_billing con paid_at = null (incluye
// draft / ready / sent / invoiced). Se excluyen sólo los ya pagados.

async function getPendingInvoices(
  clientId: string | null | undefined,
  today: string,
): Promise<PendingInvoice[]> {
  const conds = [isNull(planBillings.paidAt), isNull(mediaPlans.deletedAt)];
  if (clientId) conds.push(eq(projects.clientId, clientId));

  const rows = await db
    .select({
      billingId: planBillings.id,
      planId: mediaPlans.id,
      planName: mediaPlans.name,
      projectCode: projects.code,
      projectName: projects.name,
      clientName: clients.name,
      month: planBillings.month,
      status: planBillings.status,
      invoiceNumber: planBillings.invoiceNumber,
      totalUsd: planBillings.totalUsd,
      dueDate: planBillings.dueDate,
    })
    .from(planBillings)
    .innerJoin(mediaPlans, eq(planBillings.mediaPlanId, mediaPlans.id))
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(and(...conds));

  const out = rows.map((r) => ({
    billingId: r.billingId,
    planId: r.planId,
    planName: r.planName,
    projectCode: r.projectCode,
    projectName: r.projectName,
    clientName: r.clientName,
    month: r.month,
    status: r.status,
    invoiceNumber: r.invoiceNumber,
    totalUsd: Number.parseFloat(r.totalUsd ?? "0"),
    dueDate: r.dueDate,
    overdue: r.dueDate != null && r.dueDate < today,
  }));
  // Vencidas primero, luego por due date / mes.
  out.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    return (a.dueDate ?? a.month).localeCompare(b.dueDate ?? b.month);
  });
  return out;
}
