import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, Plus } from "lucide-react";
import { BillingEstimateCard } from "@/components/billing-estimate-card";
import { StatusBadge } from "@/components/status-badge";
import { getBillingEstimate } from "@/db/queries/dashboard";
import { getProjectWithPlans, type ProjectPlanSummary } from "@/db/queries/project-detail";
import { formatPct, formatUsd, formatUsdCompact } from "@/lib/format";

function nextMonths(count: number): string[] {
  const out: string[] = [];
  const now = new Date();
  let y = now.getFullYear();
  let m = now.getMonth() + 1;
  for (let i = 0; i < count; i++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

function previousMonth(): string {
  const now = new Date();
  let y = now.getFullYear();
  let m = now.getMonth(); // 0-indexed → ya es "mes anterior"
  if (m === 0) {
    y -= 1;
    m = 12;
  }
  return `${y}-${String(m).padStart(2, "0")}`;
}

type Props = { params: Promise<{ code: string }> };

const PLAN_STATUS_STYLE: Record<
  string,
  { label: string; cls: string; dot: string }
> = {
  draft: {
    label: "draft",
    cls: "bg-paper-2 text-muted border-line",
    dot: "bg-muted",
  },
  ready_to_send: {
    label: "ready to send",
    cls: "bg-warn-soft text-warn border-warn-soft",
    dot: "bg-warn",
  },
  approved: {
    label: "approved",
    cls: "bg-success-soft text-success border-success-soft",
    dot: "bg-success",
  },
  archived: {
    label: "archived",
    cls: "bg-paper-2 text-stone-400 border-line",
    dot: "bg-stone-400",
  },
};

export default async function ProjectDetailPage({ params }: Props) {
  const { code } = await params;
  const detail = await getProjectWithPlans(code);
  if (!detail) notFound();

  const { project, client, budgetOrigin, plans } = detail;

  const months = nextMonths(2);
  const prevMonth = previousMonth();
  const allEstimates = await getBillingEstimate({
    months: [prevMonth, ...months],
    projectId: project.id,
  });
  const previousEstimate = allEstimates.find((e) => e.month === prevMonth) ?? null;
  const estimates = allEstimates.filter((e) => e.month !== prevMonth);

  const totalPlanned = plans.reduce((s, p) => s + p.totalUsd, 0);
  const totalSpent = plans.reduce((s, p) => s + p.spentRealUsd, 0);
  const totalBudget = Number.parseFloat(project.totalGrossBudgetUsd ?? "0");
  const planningCoveragePct =
    totalBudget > 0 ? (totalPlanned / totalBudget) * 100 : 0;

  return (
    <main className="px-8 py-10 max-w-[1380px] mx-auto w-full">
      <nav
        aria-label="Breadcrumb"
        className="text-xs text-muted flex items-center gap-1.5 mb-3"
      >
        <Link href="/proyectos" className="hover:text-ink">
          Proyectos
        </Link>
        <span className="text-stone-300">/</span>
        <Link href={`/clientes/${client.slug}`} className="hover:text-ink">
          {client.name}
        </Link>
        <span className="text-stone-300">/</span>
        <span className="text-ink font-medium">{project.name}</span>
      </nav>

      <header className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] uppercase text-accent">
            Proyecto
          </p>
          <h1 className="text-3xl font-semibold tracking-tight mt-2 flex items-center gap-3 flex-wrap">
            {project.name}
            <StatusBadge status={project.status} />
          </h1>
          <p className="text-sm text-muted mt-1 font-mono">{project.code}</p>
        </div>
        <Link
          href={`/proyectos/${project.code}/planes/nuevo`}
          className="inline-flex items-center gap-1.5 rounded-md bg-ink text-white px-3 py-1.5 text-sm font-medium hover:bg-ink-2 transition-colors"
        >
          <Plus size={14} strokeWidth={2.5} />
          Nuevo plan
        </Link>
      </header>

      {/* Metadata strip */}
      <section className="rounded-lg border border-line bg-white px-5 py-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-6 gap-y-3 mb-6">
        <Meta label="Cliente">
          <Link
            href={`/clientes/${client.slug}`}
            className="text-ink hover:underline font-medium text-sm"
          >
            {client.name}
          </Link>
        </Meta>
        <Meta label="Budget Origin">
          <span className="inline-flex items-center gap-1.5 text-ink font-medium text-sm">
            {budgetOrigin.colorHex && (
              <span
                aria-hidden
                className="inline-block w-2 h-2 rounded-full"
                style={{ background: budgetOrigin.colorHex }}
              />
            )}
            {budgetOrigin.name}
          </span>
        </Meta>
        <Meta label="Período">
          <span className="font-mono text-sm text-ink-2">
            {project.startDate ?? "—"}
            <span className="text-stone-300"> → </span>
            {(() => {
              const ends = plans.map((p) => p.periodEnd).filter((d): d is string => !!d).sort();
              return ends.length > 0 ? ends[ends.length - 1] : "—";
            })()}
          </span>
          <p className="text-[10px] text-muted mt-0.5">
            fin derivado del último placement
          </p>
        </Meta>
        <Meta label="Total gross budget">
          <span className="font-mono text-sm font-semibold tabular-nums text-ink">
            {totalBudget > 0 ? formatUsd(totalBudget) : "—"}
          </span>
        </Meta>
        <Meta label="Cobertura planificada">
          <span
            className={`font-mono text-sm font-semibold tabular-nums ${
              planningCoveragePct > 100 ? "text-warn" : "text-ink"
            }`}
          >
            {totalBudget > 0 ? formatPct(planningCoveragePct, 0) : "—"}
            {totalBudget > 0 && (
              <span className="text-muted text-xs font-normal ml-1">
                ({formatUsdCompact(totalPlanned)} de {formatUsdCompact(totalBudget)})
              </span>
            )}
          </span>
        </Meta>
      </section>

      {/* Lista de planes peer */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">
            Planes
            <span className="ml-2 text-xs font-normal text-muted">
              ({plans.length} peer{plans.length === 1 ? "" : "s"})
            </span>
          </h2>
          <span className="text-[11px] uppercase tracking-[0.08em] text-muted font-medium">
            gastado: {formatUsdCompact(totalSpent)}
          </span>
        </div>

        {plans.length === 0 ? (
          <div className="rounded-lg border border-line border-dashed bg-paper-2 px-5 py-12 text-center">
            <p className="text-sm font-medium text-ink-2">Sin planes todavía</p>
            <p className="text-xs text-muted mt-1 max-w-md mx-auto">
              El media planner crea acá los planes del proyecto (Awareness,
              Consideration, Performance, etc.). Cada plan tiene su lifecycle
              de aprobación independiente.
            </p>
            <Link
              href={`/proyectos/${project.code}/planes/nuevo`}
              className="inline-flex items-center gap-1.5 mt-4 rounded-md bg-ink text-white px-3 py-1.5 text-sm font-medium hover:bg-ink-2"
            >
              <Plus size={14} strokeWidth={2.5} />
              Crear primer plan
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {plans.map((p) => (
              <PlanCard
                key={p.id}
                plan={p}
                projectCode={project.code}
                clientName={client.name}
              />
            ))}
          </div>
        )}
      </section>

      <BillingEstimateCard
        estimates={estimates}
        previousMonth={previousEstimate}
        hideProjectBreakdown
      />
    </main>
  );
}

function PlanCard({
  plan,
  projectCode,
}: {
  plan: ProjectPlanSummary;
  projectCode: string;
  clientName: string;
}) {
  const style = PLAN_STATUS_STYLE[plan.status] ?? PLAN_STATUS_STYLE.draft;
  const consumption =
    plan.totalMediaUsd > 0
      ? (plan.spentRealUsd / plan.totalMediaUsd) * 100
      : 0;

  return (
    <Link
      href={`/proyectos/${projectCode}/planes/${plan.id}`}
      className="group rounded-lg border border-line bg-white p-4 hover:border-ink-2 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-ink truncate">{plan.name}</h3>
            <span
              className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[10px] font-medium ${style.cls}`}
            >
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${style.dot}`}
              />
              {style.label}
            </span>
            {plan.currentVersion > 0 && (
              <span className="font-mono text-[10px] text-muted">
                v{plan.currentVersion}
              </span>
            )}
          </div>
          <p className="font-mono text-[11px] text-muted mt-1 truncate">
            {projectCode}.{plan.name}
          </p>
        </div>
        <ArrowUpRight
          size={14}
          strokeWidth={2}
          className="text-muted group-hover:text-ink transition-colors shrink-0 mt-1"
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
            Período
          </p>
          <p className="font-mono text-[12px] text-ink-2 mt-0.5">
            {plan.periodStart ?? "—"}
            <span className="text-stone-300"> → </span>
            {plan.periodEnd ?? "—"}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
            Inversión
          </p>
          <p className="font-mono text-sm font-semibold tabular-nums mt-0.5">
            {formatUsdCompact(plan.totalMediaUsd)}
            <span className="text-muted text-xs font-normal ml-1">
              + {formatUsdCompact(plan.totalFeesUsd)} fees
            </span>
          </p>
        </div>
      </div>

      <div className="mt-3">
        <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted mb-1">
          {plan.publishersCount} publishers · {plan.placementsCount} placements
          {plan.spentRealUsd > 0 && (
            <span>
              {" · "}
              <span className={consumption > 100 ? "text-warn" : ""}>
                {formatPct(consumption, 0)} consumido
              </span>
            </span>
          )}
        </p>
        {plan.totalMediaUsd > 0 && (
          <div className="h-1 rounded-full bg-paper-2 overflow-hidden">
            <div
              className={`h-full rounded-full ${
                consumption > 100 ? "bg-warn" : "bg-ink"
              }`}
              style={{ width: `${Math.min(consumption, 100)}%` }}
            />
          </div>
        )}
      </div>

      {plan.lastSnapshotAt && (
        <p className="text-[10px] text-muted mt-3 font-mono">
          última aprobación: {plan.lastSnapshotAt.toISOString().slice(0, 10)}
        </p>
      )}
    </Link>
  );
}

function Meta({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
        {label}
      </dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}
