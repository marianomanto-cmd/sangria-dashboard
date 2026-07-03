import { and, asc, eq, isNull, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  budgetOrigins,
  clients,
  mediaPlanFees,
  mediaPlanPlacements,
  mediaPlanPublishers,
  mediaPlans,
  planBillingFees,
  planBillingPublishers,
  planBillings,
  projects,
  publishers,
} from "@/db/schema";
import { formatUsd, formatUsdCompact } from "@/lib/format";
import { getPlanBillingProgress } from "@/db/queries/billing";
import { BillingStatusBadge } from "@/components/billing-status-badge";
import { PlanBillingProgressCard } from "@/components/plan-billing-progress";
import { BillingMonthEditor } from "./editor";

type Props = {
  params: Promise<{ code: string; planId: string }>;
  searchParams: Promise<{ month?: string }>;
};

function enumerateMonths(start: string, end: string): string[] {
  const out: string[] = [];
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export default async function PlanBillingPage({ params, searchParams }: Props) {
  const { code, planId } = await params;
  const sp = await searchParams;

  // Load plan + context.
  const [planRow] = await db
    .select({
      plan: mediaPlans,
      project: { id: projects.id, code: projects.code, name: projects.name },
      client: { id: clients.id, name: clients.name, slug: clients.slug },
      origin: { id: budgetOrigins.id, name: budgetOrigins.name },
    })
    .from(mediaPlans)
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .innerJoin(budgetOrigins, eq(projects.budgetOriginId, budgetOrigins.id))
    .where(and(eq(mediaPlans.id, planId), isNull(mediaPlans.deletedAt)))
    .limit(1);

  if (!planRow || planRow.project.code !== code) notFound();

  const plan = planRow.plan;

  // El período del plan se deriva de min(placement.start) → max(placement.end)
  const [periodRow] = await db
    .select({
      periodStart: sql<string | null>`min(${mediaPlanPlacements.startDate})::text`,
      periodEnd: sql<string | null>`max(${mediaPlanPlacements.endDate})::text`,
    })
    .from(mediaPlanPlacements)
    .innerJoin(
      mediaPlanPublishers,
      eq(mediaPlanPlacements.mediaPlanPublisherId, mediaPlanPublishers.id),
    )
    .where(eq(mediaPlanPublishers.mediaPlanId, planId));

  const months =
    periodRow?.periodStart && periodRow?.periodEnd
      ? enumerateMonths(
          periodRow.periodStart.slice(0, 7),
          periodRow.periodEnd.slice(0, 7),
        )
      : [];

  // Existing billings for this plan.
  const existingBillings = await db
    .select()
    .from(planBillings)
    .where(eq(planBillings.mediaPlanId, planId))
    .orderBy(asc(planBillings.month));

  const billingByMonth = new Map(existingBillings.map((b) => [b.month, b]));
  const selectedMonth = sp.month && months.includes(sp.month) ? sp.month : null;

  // Avance de facturación del plan (para el gráfico "dónde estoy parado"). Solo
  // si el plan tiene período/meses — si no, la card no se muestra y evitamos las
  // queries.
  const billingProgress =
    months.length > 0 ? await getPlanBillingProgress(planId) : null;

  // Plan publishers (catálogo del plan). Un mismo publisher puede tener N
  // bloques: para la vista de billing los agregamos a UNA línea por
  // publisher con totalPlannedUsd = suma y agencyPays = OR de los overrides.
  const planPubRows = await db
    .select({
      publisherId: mediaPlanPublishers.publisherId,
      publisherName: publishers.name,
      publisherSlug: publishers.slug,
      agencyPaysDefault: publishers.agencyPays,
      agencyPaysOverride: mediaPlanPublishers.agencyPaysOverride,
      totalPlannedUsd: mediaPlanPublishers.totalPlannedUsd,
      sortOrder: publishers.sortOrder,
    })
    .from(mediaPlanPublishers)
    .innerJoin(publishers, eq(mediaPlanPublishers.publisherId, publishers.id))
    .where(eq(mediaPlanPublishers.mediaPlanId, planId))
    .orderBy(asc(mediaPlanPublishers.sortOrder));

  const planPubs = Array.from(
    planPubRows
      .reduce(
        (
          acc,
          r,
        ) => {
          const agencyPays = r.agencyPaysOverride ?? r.agencyPaysDefault;
          const existing = acc.get(r.publisherId);
          if (existing) {
            existing.totalPlanned += Number.parseFloat(r.totalPlannedUsd);
            existing.anyAgencyPays = existing.anyAgencyPays || agencyPays;
          } else {
            acc.set(r.publisherId, {
              publisherId: r.publisherId,
              publisherName: r.publisherName,
              publisherSlug: r.publisherSlug,
              sortOrder: r.sortOrder,
              totalPlanned: Number.parseFloat(r.totalPlannedUsd),
              anyAgencyPays: agencyPays,
            });
          }
          return acc;
        },
        new Map<
          string,
          {
            publisherId: string;
            publisherName: string;
            publisherSlug: string;
            sortOrder: number;
            totalPlanned: number;
            anyAgencyPays: boolean;
          }
        >(),
      )
      .values(),
  ).sort((a, b) => a.sortOrder - b.sortOrder);

  // Plan fees (catálogo del plan)
  const planFees = await db
    .select()
    .from(mediaPlanFees)
    .where(eq(mediaPlanFees.mediaPlanId, planId))
    .orderBy(asc(mediaPlanFees.sortOrder));

  // For selected month: load the consumption + imputations.
  const selectedBilling = selectedMonth ? billingByMonth.get(selectedMonth) : null;

  let publisherLines: Array<{
    publisherId: string;
    publisherName: string;
    publisherSlug: string;
    agencyPays: boolean;
    totalPlannedUsd: number;
    consumedBeforeUsd: number;
    amountThisMonthUsd: number;
    isBillable: boolean;
    notes: string | null;
  }> = [];
  let feeLines: Array<{
    mediaPlanFeeId: string;
    feeName: string;
    feeType: string;
    totalAmountUsd: number;
    accumulatedBeforeUsd: number;
    amountThisMonthUsd: number;
    notes: string | null;
  }> = [];

  if (selectedBilling) {
    const pubRows = await db
      .select()
      .from(planBillingPublishers)
      .where(eq(planBillingPublishers.planBillingId, selectedBilling.id));
    const pubMap = new Map(pubRows.map((r) => [r.publisherId, r]));

    // Total consumido por publisher en TODOS los billings de este plan
    // (incluye este mes; restamos el este mes después para obtener "antes").
    const totalByPub = await db
      .select({
        publisherId: planBillingPublishers.publisherId,
        total: sql<string>`coalesce(sum(${planBillingPublishers.amountRealUsd}), 0)`,
      })
      .from(planBillingPublishers)
      .innerJoin(planBillings, eq(planBillingPublishers.planBillingId, planBillings.id))
      .where(eq(planBillings.mediaPlanId, planId))
      .groupBy(planBillingPublishers.publisherId);
    const totalByPubMap = new Map(
      totalByPub.map((r) => [r.publisherId, Number.parseFloat(r.total)]),
    );

    publisherLines = planPubs.map((p) => {
      const r = pubMap.get(p.publisherId);
      const thisMonth = r ? Number.parseFloat(r.amountRealUsd) : 0;
      const totalAcrossAll = totalByPubMap.get(p.publisherId) ?? 0;
      const consumedBefore = totalAcrossAll - thisMonth;
      return {
        publisherId: p.publisherId,
        publisherName: p.publisherName,
        publisherSlug: p.publisherSlug,
        agencyPays: p.anyAgencyPays,
        totalPlannedUsd: p.totalPlanned,
        consumedBeforeUsd: consumedBefore,
        amountThisMonthUsd: thisMonth,
        isBillable: r?.isBillable ?? p.anyAgencyPays,
        notes: r?.notes ?? null,
      };
    });

    const feeRows = await db
      .select()
      .from(planBillingFees)
      .where(eq(planBillingFees.planBillingId, selectedBilling.id));
    const feeRowsMap = new Map(feeRows.map((r) => [r.mediaPlanFeeId, r]));

    // Total imputado por fee en TODOS los billings del plan, en una query.
    const totalByFee = await db
      .select({
        mediaPlanFeeId: planBillingFees.mediaPlanFeeId,
        total: sql<string>`coalesce(sum(${planBillingFees.amountImputedUsd}), 0)`,
      })
      .from(planBillingFees)
      .innerJoin(planBillings, eq(planBillingFees.planBillingId, planBillings.id))
      .where(eq(planBillings.mediaPlanId, planId))
      .groupBy(planBillingFees.mediaPlanFeeId);
    const totalByFeeMap = new Map(
      totalByFee.map((r) => [r.mediaPlanFeeId, Number.parseFloat(r.total)]),
    );

    // Total media del plan: base para derivar management fees por %.
    // amount = TM × ratePct / (100 - ratePct) (ver db/schema.ts:357-359)
    const totalMedia = planPubs.reduce((s, p) => s + p.totalPlanned, 0);

    feeLines = planFees.map((f) => {
      const r = feeRowsMap.get(f.id);
      const thisMonth = r ? Number.parseFloat(r.amountImputedUsd) : 0;
      const accumTotal = totalByFeeMap.get(f.id) ?? 0;
      const ratePct = f.ratePct ? Number.parseFloat(f.ratePct) : null;
      let totalAmountUsd = Number.parseFloat(f.amountUsd);
      if (
        f.feeType === "management" &&
        ratePct != null &&
        ratePct > 0 &&
        ratePct < 100
      ) {
        totalAmountUsd = (totalMedia * ratePct) / (100 - ratePct);
      }
      return {
        mediaPlanFeeId: f.id,
        feeName: f.name,
        feeType: f.feeType,
        totalAmountUsd,
        accumulatedBeforeUsd: accumTotal - thisMonth,
        amountThisMonthUsd: thisMonth,
        notes: r?.notes ?? null,
      };
    });
  }

  return (
    <main className="px-8 py-10 max-w-[1800px] mx-auto w-full">
      <nav
        aria-label="Breadcrumb"
        className="text-xs text-muted flex items-center gap-1.5 mb-3"
      >
        <Link href="/proyectos" className="hover:text-ink">Proyectos</Link>
        <span className="text-line">/</span>
        <Link href={`/clientes/${planRow.client.slug}`} className="hover:text-ink">
          {planRow.client.name}
        </Link>
        <span className="text-line">/</span>
        <Link href={`/proyectos/${planRow.project.code}`} className="hover:text-ink">
          {planRow.project.name}
        </Link>
        <span className="text-line">/</span>
        <Link
          href={`/proyectos/${planRow.project.code}/planes/${planId}`}
          className="hover:text-ink"
        >
          {plan.name}
        </Link>
        <span className="text-line">/</span>
        <span className="text-ink font-medium">Billing</span>
      </nav>

      <header className="mb-5 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] uppercase text-accent">
            Billing del plan
          </p>
          <h1 className="text-3xl font-semibold tracking-tight mt-2">
            {plan.name}
          </h1>
          <p className="text-sm text-muted mt-1 font-mono">
            {planRow.project.code}.{plan.name}
          </p>
        </div>
      </header>

      {billingProgress && (
        <PlanBillingProgressCard
          progress={billingProgress}
          planMonths={months}
        />
      )}

      {months.length === 0 ? (
        <div className="rounded-lg border border-line border-dashed bg-paper-2 px-5 py-12 text-center">
          <p className="text-sm font-medium text-ink-2">
            El plan no tiene período definido
          </p>
          <p className="text-xs text-muted mt-1">
            Cargá Período inicio + Período fin en el editor del plan para
            habilitar la carga mensual de billing.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-5">
          {/* Sidebar de meses */}
          <aside className="rounded-lg border border-line bg-white dark:bg-paper-2 overflow-hidden h-fit">
            <div className="px-4 py-2.5 border-b border-line text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
              Meses del plan
            </div>
            <ul className="divide-y divide-line-soft">
              {months.map((m) => {
                const billing = billingByMonth.get(m);
                const isSelected = selectedMonth === m;
                return (
                  <li key={m}>
                    <Link
                      href={`?month=${m}`}
                      data-selected={isSelected}
                      className="flex items-center justify-between gap-2 px-4 py-2 hover:bg-paper-2 data-[selected=true]:bg-paper-2 data-[selected=true]:border-l-2 data-[selected=true]:border-accent transition-colors"
                    >
                      <span className="font-mono text-sm text-ink-2">{m}</span>
                      {billing ? (
                        <BillingStatusBadge status={billing.status} size="sm" />
                      ) : (
                        <span className="text-[10px] text-line">sin cargar</span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </aside>

          {/* Editor del mes seleccionado */}
          <div>
            {selectedMonth ? (
              <BillingMonthEditor
                planId={planId}
                projectCode={planRow.project.code}
                month={selectedMonth}
                billing={selectedBilling ?? null}
                publisherLines={publisherLines}
                feeLines={feeLines}
              />
            ) : (
              <div className="rounded-lg border border-line border-dashed bg-paper-2 px-5 py-12 text-center text-sm text-muted">
                Seleccioná un mes a la izquierda para cargar el consumo.
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

void formatUsd;
void formatUsdCompact;
