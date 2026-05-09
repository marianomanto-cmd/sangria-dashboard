import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  budgetOrigins,
  clients,
  mediaPlanFees,
  mediaPlanPublishers,
  mediaPlans,
  planBillingFees,
  planBillingPublishers,
  planBillings,
  projects,
  publishers,
} from "@/db/schema";
import { formatUsd, formatUsdCompact } from "@/lib/format";
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
    .where(eq(mediaPlans.id, planId))
    .limit(1);

  if (!planRow || planRow.project.code !== code) notFound();

  const plan = planRow.plan;

  // Months en el período del plan.
  const months =
    plan.periodStart && plan.periodEnd
      ? enumerateMonths(plan.periodStart.slice(0, 7), plan.periodEnd.slice(0, 7))
      : [];

  // Existing billings for this plan.
  const existingBillings = await db
    .select()
    .from(planBillings)
    .where(eq(planBillings.mediaPlanId, planId))
    .orderBy(asc(planBillings.month));

  const billingByMonth = new Map(existingBillings.map((b) => [b.month, b]));
  const selectedMonth = sp.month && months.includes(sp.month) ? sp.month : null;

  // Plan publishers (catálogo del plan)
  const planPubs = await db
    .select({
      id: mediaPlanPublishers.id,
      publisherId: mediaPlanPublishers.publisherId,
      publisherName: publishers.name,
      publisherSlug: publishers.slug,
      agencyPaysDefault: publishers.agencyPaysDefault,
      agencyPaysOverride: mediaPlanPublishers.agencyPaysOverride,
      totalPlannedUsd: mediaPlanPublishers.totalPlannedUsd,
      sortOrder: publishers.sortOrder,
    })
    .from(mediaPlanPublishers)
    .innerJoin(publishers, eq(mediaPlanPublishers.publisherId, publishers.id))
    .where(eq(mediaPlanPublishers.mediaPlanId, planId))
    .orderBy(asc(mediaPlanPublishers.sortOrder));

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

    publisherLines = planPubs.map((p) => {
      const r = pubMap.get(p.publisherId);
      return {
        publisherId: p.publisherId,
        publisherName: p.publisherName,
        publisherSlug: p.publisherSlug,
        agencyPays: p.agencyPaysOverride ?? p.agencyPaysDefault,
        totalPlannedUsd: Number.parseFloat(p.totalPlannedUsd),
        amountThisMonthUsd: r ? Number.parseFloat(r.amountRealUsd) : 0,
        isBillable: r?.isBillable ?? (p.agencyPaysOverride ?? p.agencyPaysDefault),
        notes: r?.notes ?? null,
      };
    });

    const feeRows = await db
      .select()
      .from(planBillingFees)
      .where(eq(planBillingFees.planBillingId, selectedBilling.id));
    const feeRowsMap = new Map(feeRows.map((r) => [r.mediaPlanFeeId, r]));

    // For each fee, compute accumulated imputation across all months.
    const accumByFee = new Map<string, number>();
    for (const f of planFees) {
      const allImputations = await db
        .select({ amount: planBillingFees.amountImputedUsd })
        .from(planBillingFees)
        .innerJoin(planBillings, eq(planBillingFees.planBillingId, planBillings.id))
        .where(eq(planBillings.mediaPlanId, planId));
      const total = allImputations.reduce(
        (s, r) => s + Number.parseFloat(r.amount),
        0,
      );
      accumByFee.set(f.id, total);
    }

    feeLines = planFees.map((f) => {
      const r = feeRowsMap.get(f.id);
      const accumTotal = accumByFee.get(f.id) ?? 0;
      const thisMonth = r ? Number.parseFloat(r.amountImputedUsd) : 0;
      return {
        mediaPlanFeeId: f.id,
        feeName: f.name,
        feeType: f.feeType,
        totalAmountUsd: Number.parseFloat(f.amountUsd),
        accumulatedBeforeUsd: accumTotal - thisMonth,
        amountThisMonthUsd: thisMonth,
        notes: r?.notes ?? null,
      };
    });
  }

  return (
    <main className="px-8 py-10 max-w-[1380px] mx-auto w-full">
      <nav
        aria-label="Breadcrumb"
        className="text-xs text-muted flex items-center gap-1.5 mb-3"
      >
        <Link href="/proyectos" className="hover:text-ink">Proyectos</Link>
        <span className="text-stone-300">/</span>
        <Link href={`/clientes/${planRow.client.slug}`} className="hover:text-ink">
          {planRow.client.name}
        </Link>
        <span className="text-stone-300">/</span>
        <Link href={`/proyectos/${planRow.project.code}`} className="hover:text-ink">
          {planRow.project.name}
        </Link>
        <span className="text-stone-300">/</span>
        <Link
          href={`/proyectos/${planRow.project.code}/planes/${planId}`}
          className="hover:text-ink"
        >
          {plan.name}
        </Link>
        <span className="text-stone-300">/</span>
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
          <aside className="rounded-lg border border-line bg-white overflow-hidden h-fit">
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
                        <BillingStatusPill status={billing.status} compact />
                      ) : (
                        <span className="text-[10px] text-stone-300">sin cargar</span>
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

export function BillingStatusPill({
  status,
  compact = false,
}: {
  status: string;
  compact?: boolean;
}) {
  const styles: Record<string, { label: string; cls: string; dot: string }> = {
    draft: { label: "draft", cls: "bg-paper-2 text-muted border-line", dot: "bg-muted" },
    ready: { label: "listo", cls: "bg-warn-soft text-warn border-warn-soft", dot: "bg-warn" },
    sent: { label: "emitida", cls: "bg-info-soft text-info border-info-soft", dot: "bg-info" },
    paid: { label: "pagada", cls: "bg-success-soft text-success border-success-soft", dot: "bg-success" },
  };
  const s = styles[status] ?? styles.draft;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5 ${compact ? "text-[10px]" : "text-[11px]"} font-medium ${s.cls}`}
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

void formatUsd;
void formatUsdCompact;
