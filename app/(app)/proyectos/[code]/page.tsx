import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronDown, FileSpreadsheet } from "lucide-react";
import { ActualsGridEditable } from "@/components/actuals-grid-editable";
import { StatusBadge } from "@/components/status-badge";
import { getProjectActuals } from "@/db/queries/project-actuals";
import {
  getProjectBillings,
  getProjectPlanVersions,
  type ProjectBillingRow,
} from "@/db/queries/project-billings";
import {
  getProjectDetail,
  type PublisherGroup,
} from "@/db/queries/project-detail";
import { formatPct, formatUsd, formatUsdCompact } from "@/lib/format";

type Tab = "plan" | "gastos" | "billing" | "diff";

type Props = {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ tab?: string }>;
};

export default async function ProjectDetailPage({ params, searchParams }: Props) {
  const { code } = await params;
  const sp = await searchParams;
  const tab: Tab =
    sp.tab === "gastos" || sp.tab === "billing" || sp.tab === "diff"
      ? sp.tab
      : "plan";

  const detail = await getProjectDetail(code);
  if (!detail) notFound();

  // Cargas dependientes de la tab activa — evitamos fetchear todo en cada
  // request para no penalizar la latencia hacia Supabase São Paulo.
  const tabPayload =
    tab === "gastos"
      ? { actuals: await getProjectActuals(detail.project.id) }
      : tab === "billing"
        ? { billings: await getProjectBillings(detail.project.id) }
        : tab === "diff"
          ? { versions: await getProjectPlanVersions(detail.project.id) }
          : null;

  return (
    <main className="px-8 py-10 max-w-[1380px] mx-auto w-full">
      {/* Breadcrumb */}
      <nav
        aria-label="Breadcrumb"
        className="text-xs text-muted flex items-center gap-1.5 mb-3"
      >
        <Link href="/proyectos" className="hover:text-ink">
          Proyectos
        </Link>
        <span className="text-stone-300">/</span>
        <Link href={`/clientes/${detail.client.slug}`} className="hover:text-ink">
          {detail.client.name}
        </Link>
        <span className="text-stone-300">/</span>
        <span className="text-ink font-medium">{detail.project.name}</span>
      </nav>

      {/* Header */}
      <header className="mb-5 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] uppercase text-accent">
            Proyecto
          </p>
          <h1 className="text-3xl font-semibold tracking-tight mt-2 flex items-center gap-3 flex-wrap">
            {detail.project.name}
            <StatusBadge status={detail.project.status} />
          </h1>
          <p className="text-sm text-muted mt-1 font-mono">{detail.project.code}</p>
        </div>
        <Link
          href={`/proyectos/${detail.project.code}/importar`}
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper-2 transition-colors"
        >
          <FileSpreadsheet size={14} strokeWidth={2} />
          Importar plan
        </Link>
      </header>

      {/* Metadata strip */}
      <section className="rounded-lg border border-line bg-white px-5 py-4 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-x-6 gap-y-3 mb-6">
        <Meta label="Cliente">
          <Link
            href={`/clientes/${detail.client.slug}`}
            className="text-ink hover:underline font-medium text-sm"
          >
            {detail.client.name}
          </Link>
        </Meta>
        <Meta label="Budget Origin">
          <span className="inline-flex items-center gap-1.5 text-ink font-medium text-sm">
            {detail.budgetOrigin.colorHex && (
              <span
                aria-hidden
                className="inline-block w-2 h-2 rounded-full"
                style={{ background: detail.budgetOrigin.colorHex }}
              />
            )}
            {detail.budgetOrigin.name}
          </span>
        </Meta>
        <Meta label="Período">
          <span className="font-mono text-sm text-ink-2">
            {detail.project.startDate ?? "—"}
            <span className="text-stone-300"> → </span>
            {detail.project.endDate ?? "—"}
          </span>
        </Meta>
        <Meta label="Budget total">
          <span className="font-mono text-sm font-semibold tabular-nums text-ink">
            {detail.project.totalBudgetUsd
              ? formatUsd(Number.parseFloat(detail.project.totalBudgetUsd))
              : "—"}
          </span>
        </Meta>
        <Meta label="Plan vigente">
          {detail.activePlan ? (
            <span className="font-mono text-sm text-ink-2">
              v{detail.activePlan.version}
              <span className="text-muted"> · approved</span>
            </span>
          ) : (
            <span className="text-sm text-muted">sin plan aprobado</span>
          )}
        </Meta>
      </section>

      {/* Tabs */}
      <div className="border-b border-line mb-6 flex gap-0 overflow-x-auto">
        <ProjectTabLink code={code} target="plan" current={tab}>
          Plan de Medios
        </ProjectTabLink>
        <ProjectTabLink code={code} target="gastos" current={tab}>
          Gastos Reales
        </ProjectTabLink>
        <ProjectTabLink code={code} target="billing" current={tab}>
          Billing
        </ProjectTabLink>
        <ProjectTabLink code={code} target="diff" current={tab}>
          Diff
        </ProjectTabLink>
      </div>

      {tab === "plan" && <PlanTab detail={detail} />}
      {tab === "gastos" &&
        (tabPayload && "actuals" in tabPayload && tabPayload.actuals ? (
          <ActualsGridEditable data={tabPayload.actuals} />
        ) : (
          <NoPlanForActuals />
        ))}
      {tab === "billing" &&
        tabPayload &&
        "billings" in tabPayload && (
          <BillingTab rows={tabPayload.billings} />
        )}
      {tab === "diff" &&
        tabPayload &&
        "versions" in tabPayload && (
          <DiffTab versions={tabPayload.versions} />
        )}
    </main>
  );
}

function NoPlanForActuals() {
  return (
    <div className="rounded-lg border border-line border-dashed bg-paper-2 px-5 py-12 text-center">
      <p className="text-sm font-medium text-ink-2">Sin plan vigente</p>
      <p className="text-xs text-muted mt-1">
        No hay un plan aprobado para este proyecto, así que no hay grilla de
        gastos para mostrar.
      </p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Billing tab — historial de facturas del proyecto
// ────────────────────────────────────────────────────────────────────────────

function BillingTab({ rows }: { rows: ProjectBillingRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-line border-dashed bg-paper-2 px-5 py-12 text-center">
        <p className="text-sm font-medium text-ink-2">Sin facturas emitidas</p>
        <p className="text-xs text-muted mt-1">
          El generador de billing llega en Fase 7. Vas a poder seleccionar mes
          + proyecto, revisar las líneas y emitir la factura desde acá.
        </p>
      </div>
    );
  }

  return (
    <section className="rounded-lg border border-line bg-white overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-paper">
          <tr className="text-[11px] uppercase tracking-[0.06em] text-muted">
            <th className="text-left font-medium px-5 py-2.5">Mes</th>
            <th className="text-left font-medium px-5 py-2.5">N° factura</th>
            <th className="text-left font-medium px-5 py-2.5">Estado</th>
            <th className="text-right font-medium px-5 py-2.5">Net</th>
            <th className="text-right font-medium px-5 py-2.5">Fee</th>
            <th className="text-right font-medium px-5 py-2.5">Total</th>
            <th className="text-left font-medium px-5 py-2.5">PDF</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr
              key={b.id}
              className="border-t border-line-soft hover:bg-paper-2 transition-colors"
            >
              <td className="px-5 py-3 font-mono">{b.month}</td>
              <td className="px-5 py-3 font-mono text-ink-2">
                {b.invoiceNumber ?? "—"}
              </td>
              <td className="px-5 py-3 text-ink-2">{b.status}</td>
              <td className="px-5 py-3 text-right font-mono text-ink-2">
                {formatUsd(Number.parseFloat(b.totalNetUsd))}
              </td>
              <td className="px-5 py-3 text-right font-mono text-ink-2">
                {formatUsd(Number.parseFloat(b.totalFeeUsd))}
              </td>
              <td className="px-5 py-3 text-right font-mono font-semibold text-ink">
                {formatUsd(Number.parseFloat(b.totalUsd))}
              </td>
              <td className="px-5 py-3">
                {b.pdfUrl ? (
                  <a
                    href={b.pdfUrl}
                    className="text-accent hover:underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    descargar
                  </a>
                ) : (
                  <span className="text-muted text-xs">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Diff tab — comparación entre versiones del plan
// ────────────────────────────────────────────────────────────────────────────

function DiffTab({
  versions,
}: {
  versions: { id: string; version: number; status: string; approvedAt: Date | null }[];
}) {
  if (versions.length === 0) {
    return (
      <div className="rounded-lg border border-line border-dashed bg-paper-2 px-5 py-12 text-center">
        <p className="text-sm font-medium text-ink-2">Sin planes</p>
        <p className="text-xs text-muted mt-1">
          Cuando importes un Excel del cliente vas a tener un plan v1 acá.
        </p>
      </div>
    );
  }

  if (versions.length === 1) {
    return (
      <section className="rounded-lg border border-line bg-white px-5 py-8 text-center">
        <p className="text-sm font-medium text-ink-2">
          Solo hay una versión del plan
        </p>
        <p className="text-xs text-muted mt-1 max-w-md mx-auto">
          Cuando se importe una v2 (revisión del cliente), el diff se calcula
          contra la versión anterior: líneas agregadas, eliminadas o
          modificadas (presupuesto, fechas).
        </p>
        <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded border border-line bg-paper-2 text-xs">
          <span className="font-mono">v{versions[0].version}</span>
          <span className="text-muted">{versions[0].status}</span>
          {versions[0].approvedAt && (
            <>
              <span className="text-stone-300">·</span>
              <span className="font-mono text-muted">
                {versions[0].approvedAt.toISOString().slice(0, 10)}
              </span>
            </>
          )}
        </div>
      </section>
    );
  }

  // 2+ versiones: el cómputo del diff llega en el commit del importador
  // de Excel (Fase 6) cuando ya tengamos múltiples versiones reales.
  return (
    <section className="rounded-lg border border-line bg-white px-5 py-8 text-center">
      <p className="text-sm font-medium text-ink-2">
        {versions.length} versiones del plan
      </p>
      <p className="text-xs text-muted mt-1">
        El cómputo del diff (added / removed / modified) se implementa en Fase 6
        junto con el importador de Excel.
      </p>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Plan tab
// ────────────────────────────────────────────────────────────────────────────

function PlanTab({
  detail,
}: {
  detail: NonNullable<Awaited<ReturnType<typeof getProjectDetail>>>;
}) {
  if (!detail.activePlan) {
    return (
      <div className="rounded-lg border border-line border-dashed bg-paper-2 px-5 py-12 text-center">
        <p className="text-sm font-medium text-ink-2">Sin plan aprobado</p>
        <p className="text-xs text-muted mt-1">
          Importá un Excel del cliente o creá un plan desde cero (Fase 6).
        </p>
      </div>
    );
  }

  return (
    <section className="rounded-lg border border-line bg-white overflow-hidden">
      <div className="px-5 py-3 border-b border-line flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Plan agrupado por publisher</h2>
        <div className="flex items-center gap-4 text-[11px] text-muted uppercase tracking-[0.06em] font-medium">
          <span>{detail.totalLines} placements</span>
          <span>{detail.publishers.length} publishers</span>
          <span className="text-ink font-mono normal-case tracking-normal">
            {formatUsd(detail.totalBudget)}
          </span>
        </div>
      </div>

      <div className="divide-y divide-line-soft">
        {detail.publishers.map((pg, idx) => (
          <PublisherRow key={pg.publisher} group={pg} defaultOpen={idx === 0} />
        ))}
      </div>
    </section>
  );
}

function PublisherRow({
  group,
  defaultOpen,
}: {
  group: PublisherGroup;
  defaultOpen: boolean;
}) {
  return (
    <details open={defaultOpen} className="group">
      <summary className="flex items-center gap-3 px-5 py-3 cursor-pointer list-none hover:bg-paper-2 transition-colors [&::-webkit-details-marker]:hidden">
        <ChevronDown
          size={14}
          strokeWidth={2}
          className="text-muted shrink-0 transition-transform -rotate-90 group-open:rotate-0"
        />
        <div className="flex-1 min-w-0">
          <span className="font-medium text-ink">{group.publisher}</span>
          <span className="ml-2 text-xs text-muted">
            {group.lines.length} placement{group.lines.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="font-mono text-xs text-muted tabular-nums">
          {group.minStart && group.maxEnd
            ? `${group.minStart} → ${group.maxEnd}`
            : "—"}
        </div>
        <div className="font-mono text-sm font-semibold tabular-nums text-ink min-w-[100px] text-right">
          {formatUsdCompact(group.totalBudget)}
        </div>
      </summary>

      <div className="px-5 pb-4 pt-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-[0.06em] text-muted">
              <th className="text-left font-medium py-2 pl-7">Placement</th>
              <th className="text-left font-medium py-2">Audiencia / Mercado</th>
              <th className="text-left font-medium py-2">Período</th>
              <th className="text-right font-medium py-2">Net</th>
              <th className="text-right font-medium py-2">Fee</th>
              <th className="text-right font-medium py-2">Total</th>
            </tr>
          </thead>
          <tbody>
            {group.lines.map((l) => {
              const fee = l.budgetNetUsd * (l.feePct / 100);
              return (
                <tr
                  key={l.id}
                  className="border-t border-line-soft hover:bg-paper-2 transition-colors"
                >
                  <td className="py-2 pl-7 text-ink">{l.placementName}</td>
                  <td className="py-2 text-ink-2 text-xs">
                    {l.audienceMarket ?? "—"}
                  </td>
                  <td className="py-2 text-ink-2 font-mono text-[11px]">
                    {l.startDate} → {l.endDate}
                  </td>
                  <td className="py-2 text-right font-mono text-ink-2">
                    {formatUsd(l.budgetNetUsd)}
                  </td>
                  <td className="py-2 text-right font-mono text-muted text-xs">
                    {formatPct(l.feePct, 0)}{" "}
                    <span className="text-stone-400">·</span>{" "}
                    {formatUsd(fee)}
                  </td>
                  <td className="py-2 text-right font-mono text-ink font-medium">
                    {formatUsd(l.budgetNetUsd + fee)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function ProjectTabLink({
  code,
  target,
  current,
  children,
}: {
  code: string;
  target: Tab;
  current: Tab;
  children: React.ReactNode;
}) {
  const href =
    target === "plan" ? `/proyectos/${code}` : `/proyectos/${code}?tab=${target}`;
  return (
    <Link
      href={href}
      data-active={current === target}
      className="-mb-px px-3.5 py-2 text-[13px] font-medium text-muted hover:text-ink-2 border-b-2 border-transparent data-[active=true]:text-ink data-[active=true]:border-accent transition-colors whitespace-nowrap"
    >
      {children}
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
