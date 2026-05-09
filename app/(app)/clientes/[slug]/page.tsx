import Link from "next/link";
import { notFound } from "next/navigation";
import { Sparkline } from "@/components/sparkline";
import { StatusBadge } from "@/components/status-badge";
import { getClientDetail } from "@/db/queries/client-detail";
import { formatPct, formatUsd, formatUsdCompact } from "@/lib/format";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string; origin?: string }>;
};

type Tab = "resumen" | "timeline";

export default async function ClientDetailPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const tab: Tab = sp.tab === "timeline" ? "timeline" : "resumen";
  const originParam = sp.origin ?? null;

  const detail = await getClientDetail(slug, originParam);
  if (!detail) notFound();

  return (
    <main className="px-8 py-10 max-w-[1380px] mx-auto w-full">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="text-xs text-muted flex items-center gap-1.5 mb-3">
        <Link href="/clientes" className="hover:text-ink">
          Clientes
        </Link>
        <span className="text-stone-300">/</span>
        <span className="text-ink font-medium">{detail.client.name}</span>
      </nav>

      {/* Header */}
      <header className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] uppercase text-accent">
            Cliente
          </p>
          <h1 className="text-3xl font-semibold tracking-tight mt-2 flex items-center gap-3">
            {detail.client.name}
            <StatusBadgeAdapter status={detail.client.status} />
          </h1>
          <p className="text-sm text-muted mt-1 font-mono">{detail.client.slug}</p>
        </div>
      </header>

      {/* Budget Origin segmented control */}
      <div className="mb-4">
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted mb-2">
          Budget Origin
        </p>
        <div className="inline-flex flex-wrap border border-line rounded-md p-0.5 bg-paper-2 gap-0.5">
          <OriginTab
            slug={slug}
            tab={tab}
            originId={null}
            currentOriginId={detail.selectedOriginId}
            label="Todos"
            count={null}
          />
          {detail.origins.map((o) => (
            <OriginTab
              key={o.id}
              slug={slug}
              tab={tab}
              originId={o.id}
              currentOriginId={detail.selectedOriginId}
              label={o.name}
              count={null}
            />
          ))}
        </div>
      </div>

      {/* Resumen / Timeline tabs */}
      <div className="border-b border-line mb-6 flex gap-0">
        <TabLink slug={slug} originId={detail.selectedOriginId} target="resumen" current={tab}>
          Resumen
        </TabLink>
        <TabLink slug={slug} originId={detail.selectedOriginId} target="timeline" current={tab}>
          Línea de tiempo
        </TabLink>
      </div>

      {tab === "resumen" ? (
        <ResumenTab detail={detail} />
      ) : (
        <TimelineEmptyPlaceholder />
      )}
    </main>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Resumen tab
// ────────────────────────────────────────────────────────────────────────────

function ResumenTab({
  detail,
}: {
  detail: NonNullable<Awaited<ReturnType<typeof getClientDetail>>>;
}) {
  const { kpis, projects } = detail;

  return (
    <>
      {/* KPIs banda */}
      <section className="rounded-lg border border-line bg-white px-5 py-4 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 mb-6">
        <Kpi label="Proyectos" value={String(kpis.totalProjects)} />
        <Kpi label="Activos" value={String(kpis.activeProjects)} />
        <Kpi
          label="Pipeline activo"
          value={formatUsdCompact(kpis.pipelineActiveUsd)}
        />
        <Kpi
          label="Avance"
          value={formatPct(kpis.consumptionPct)}
        />
      </section>

      {/* Projects table */}
      <section className="rounded-lg border border-line bg-white overflow-hidden">
        <div className="px-5 py-3 border-b border-line flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Proyectos</h2>
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
            {projects.length} {detail.selectedOriginId ? "en este origen" : "totales"}
          </span>
        </div>
        {projects.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-muted">
            No hay proyectos para esta selección.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-paper">
              <tr className="text-[11px] uppercase tracking-[0.06em] text-muted">
                <th className="text-left font-medium px-5 py-2.5">Proyecto</th>
                <th className="text-left font-medium px-5 py-2.5">Estado</th>
                <th className="text-left font-medium px-5 py-2.5">Período</th>
                <th className="text-right font-medium px-5 py-2.5">Budget</th>
                <th className="text-right font-medium px-5 py-2.5">Gastado</th>
                <th className="text-left font-medium px-5 py-2.5 w-[140px]">
                  Spark
                </th>
                <th className="text-left font-medium px-5 py-2.5 w-[180px]">
                  Avance
                </th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => {
                const overConsumed = p.consumptionPct > 100;
                const barWidth = Math.min(p.consumptionPct, 100);
                return (
                  <tr
                    key={p.id}
                    className="border-t border-line-soft hover:bg-paper-2 transition-colors"
                  >
                    <td className="px-5 py-3">
                      <Link
                        href={`/proyectos/${p.code}`}
                        className="font-medium text-ink hover:underline"
                      >
                        {p.name}
                      </Link>
                      <div className="font-mono text-[11px] text-muted">
                        {p.code}
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="px-5 py-3 text-ink-2 font-mono text-xs">
                      {p.startDate} → {p.endDate}
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-ink-2">
                      {formatUsd(p.totalBudgetUsd)}
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-ink-2">
                      {p.spentUsd > 0 ? formatUsd(p.spentUsd) : "—"}
                    </td>
                    <td className="px-5 py-3">
                      <Sparkline values={p.monthlySpend} />
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-1.5 rounded-full bg-paper-2 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              overConsumed ? "bg-warn" : "bg-ink"
                            }`}
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                        <span
                          className={`font-mono text-xs ${
                            overConsumed ? "text-warn font-medium" : "text-ink-2"
                          }`}
                        >
                          {formatPct(p.consumptionPct, 0)}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function TimelineEmptyPlaceholder() {
  return (
    <div className="rounded-lg border border-line border-dashed bg-paper-2 px-5 py-12 text-center text-sm text-muted">
      Línea de tiempo · próximo commit
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function buildHref(
  slug: string,
  originId: string | null,
  tab: Tab,
): string {
  const params = new URLSearchParams();
  if (originId) params.set("origin", originId);
  if (tab !== "resumen") params.set("tab", tab);
  const qs = params.toString();
  return `/clientes/${slug}${qs ? `?${qs}` : ""}`;
}

function OriginTab({
  slug,
  tab,
  originId,
  currentOriginId,
  label,
}: {
  slug: string;
  tab: Tab;
  originId: string | null;
  currentOriginId: string | null;
  label: string;
  count: number | null;
}) {
  const isActive = originId === currentOriginId;
  return (
    <Link
      href={buildHref(slug, originId, tab)}
      data-active={isActive}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-muted hover:text-ink data-[active=true]:bg-white data-[active=true]:text-ink data-[active=true]:shadow-sm transition-colors"
    >
      {label}
    </Link>
  );
}

function TabLink({
  slug,
  originId,
  target,
  current,
  children,
}: {
  slug: string;
  originId: string | null;
  target: Tab;
  current: Tab;
  children: React.ReactNode;
}) {
  const isActive = current === target;
  return (
    <Link
      href={buildHref(slug, originId, target)}
      data-active={isActive}
      className="-mb-px px-3.5 py-2 text-[13px] font-medium text-muted hover:text-ink-2 border-b-2 border-transparent data-[active=true]:text-ink data-[active=true]:border-accent transition-colors"
    >
      {children}
    </Link>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted truncate">
        {label}
      </span>
      <span className="font-mono text-lg font-semibold tabular-nums text-ink">
        {value}
      </span>
    </div>
  );
}

// StatusBadge para client.status (no es ProjectStatus). Render mínimo.
function StatusBadgeAdapter({
  status,
}: {
  status: "active" | "paused" | "archived";
}) {
  const map = {
    active: { label: "activo", cls: "bg-success-soft text-success border-success-soft", dot: "bg-success" },
    paused: { label: "pausado", cls: "bg-warn-soft text-warn border-warn-soft", dot: "bg-warn" },
    archived: { label: "archivado", cls: "bg-paper-2 text-muted border-line", dot: "bg-muted" },
  } as const;
  const s = map[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[11px] font-medium ${s.cls}`}
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}
