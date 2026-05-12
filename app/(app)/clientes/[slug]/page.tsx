import Link from "next/link";
import { notFound } from "next/navigation";
import { Sparkline } from "@/components/sparkline";
import { StatusBadge } from "@/components/status-badge";
import { getClientDetail } from "@/db/queries/client-detail";
import { formatPct, formatUsd, formatUsdCompact } from "@/lib/format";
import {
  DEFAULT_LANGUAGE,
  formatDate,
  type Language,
  shortMonthName,
} from "@/lib/i18n";

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
  const lang: Language = detail.client.language ?? DEFAULT_LANGUAGE;

  return (
    <main className="px-8 py-10 max-w-[1380px] mx-auto w-full">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="text-xs text-muted flex items-center gap-1.5 mb-3">
        <Link href="/clientes" className="hover:text-ink">
          {lang === "es" ? "Clientes" : "Clients"}
        </Link>
        <span className="text-stone-300">/</span>
        <span className="text-ink font-medium">{detail.client.name}</span>
      </nav>

      {/* Header */}
      <header className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] uppercase text-accent">
            {lang === "es" ? "Cliente" : "Client"}
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
            label={lang === "es" ? "Todos" : "All"}
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
          {lang === "es" ? "Resumen" : "Summary"}
        </TabLink>
        <TabLink slug={slug} originId={detail.selectedOriginId} target="timeline" current={tab}>
          {lang === "es" ? "Línea de tiempo" : "Timeline"}
        </TabLink>
      </div>

      {tab === "resumen" ? (
        <ResumenTab detail={detail} lang={lang} />
      ) : (
        <TimelineTab detail={detail} lang={lang} />
      )}
    </main>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Resumen tab
// ────────────────────────────────────────────────────────────────────────────

function ResumenTab({
  detail,
  lang,
}: {
  detail: NonNullable<Awaited<ReturnType<typeof getClientDetail>>>;
  lang: Language;
}) {
  const { kpis, projects } = detail;

  return (
    <>
      {/* KPIs banda */}
      <section className="rounded-lg border border-line bg-white px-5 py-4 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 mb-6">
        <Kpi
          label={lang === "es" ? "Proyectos" : "Projects"}
          value={String(kpis.totalProjects)}
        />
        <Kpi
          label={lang === "es" ? "Activos" : "Active"}
          value={String(kpis.activeProjects)}
        />
        <Kpi
          label={lang === "es" ? "Pipeline activo" : "Active pipeline"}
          value={formatUsdCompact(kpis.pipelineActiveUsd)}
        />
        <Kpi
          label={lang === "es" ? "Avance" : "Progress"}
          value={formatPct(kpis.consumptionPct)}
        />
      </section>

      {/* Projects table */}
      <section className="rounded-lg border border-line bg-white overflow-hidden">
        <div className="px-5 py-3 border-b border-line flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">
            {lang === "es" ? "Proyectos" : "Projects"}
          </h2>
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
            {projects.length}{" "}
            {detail.selectedOriginId
              ? lang === "es"
                ? "en este origen"
                : "in this origin"
              : lang === "es"
                ? "totales"
                : "total"}
          </span>
        </div>
        {projects.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-muted">
            {lang === "es"
              ? "No hay proyectos para esta selección."
              : "No projects match this selection."}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-paper">
              <tr className="text-[11px] uppercase tracking-[0.06em] text-muted">
                <th className="text-left font-medium px-5 py-2.5">
                  {lang === "es" ? "Proyecto" : "Project"}
                </th>
                <th className="text-left font-medium px-5 py-2.5">
                  {lang === "es" ? "Estado" : "Status"}
                </th>
                <th className="text-left font-medium px-5 py-2.5">
                  {lang === "es" ? "Período" : "Period"}
                </th>
                <th className="text-right font-medium px-5 py-2.5">Budget</th>
                <th className="text-right font-medium px-5 py-2.5">
                  {lang === "es" ? "Gastado" : "Spent"}
                </th>
                <th className="text-left font-medium px-5 py-2.5 w-[140px]">
                  Spark
                </th>
                <th className="text-left font-medium px-5 py-2.5 w-[180px]">
                  {lang === "es" ? "Avance" : "Progress"}
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
                      {formatDate(p.startDate, lang)} →{" "}
                      {formatDate(p.endDate, lang)}
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

// ────────────────────────────────────────────────────────────────────────────
// Timeline tab — gantt chart con consumo en la barra
// ────────────────────────────────────────────────────────────────────────────

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

function dateToMonthFraction(date: string, months: string[]): number {
  // date = 'YYYY-MM-DD' → posición fraccional dentro del array de meses.
  const month = date.slice(0, 7);
  const idx = months.indexOf(month);
  if (idx < 0) return idx < 0 && month < months[0] ? -0.05 : months.length - 0.95;
  const day = Number.parseInt(date.slice(8, 10), 10);
  const [yStr, mStr] = month.split("-");
  const daysInMonth = new Date(
    Number.parseInt(yStr, 10),
    Number.parseInt(mStr, 10),
    0,
  ).getDate();
  return idx + Math.max(0, Math.min(1, (day - 1) / daysInMonth));
}

function TimelineTab({
  detail,
  lang,
}: {
  detail: NonNullable<Awaited<ReturnType<typeof getClientDetail>>>;
  lang: Language;
}) {
  const dated = detail.projects.filter((p) => p.startDate && p.endDate);

  if (dated.length === 0) {
    return (
      <div className="rounded-lg border border-line border-dashed bg-paper-2 px-5 py-12 text-center text-sm text-muted">
        {lang === "es"
          ? "No hay proyectos con fechas para mostrar en la línea de tiempo."
          : "No projects with dates available for the timeline."}
      </div>
    );
  }

  let minMonth = dated[0].startDate!.slice(0, 7);
  let maxMonth = dated[0].endDate!.slice(0, 7);
  for (const p of dated) {
    const sm = p.startDate!.slice(0, 7);
    const em = p.endDate!.slice(0, 7);
    if (sm < minMonth) minMonth = sm;
    if (em > maxMonth) maxMonth = em;
  }
  const months = enumerateMonths(minMonth, maxMonth);
  const totalMonths = months.length;

  return (
    <section className="rounded-lg border border-line bg-white p-5">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-sm font-semibold">
          {lang === "es" ? "Línea de tiempo" : "Timeline"}
        </h2>
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
          {dated.length}{" "}
          {lang === "es"
            ? `proyecto${dated.length === 1 ? "" : "s"}`
            : `project${dated.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {/* Header de meses */}
      <div className="grid grid-cols-[260px_1fr] gap-3 mb-2">
        <div />
        <div className="relative h-5">
          {months.map((m, i) => (
            <span
              key={m}
              className="absolute top-0 text-[10px] font-medium uppercase tracking-[0.06em] text-muted -translate-x-1/2"
              style={{ left: `${((i + 0.5) / totalMonths) * 100}%` }}
            >
              {shortMonthName(
                Number.parseInt(m.slice(5, 7), 10) - 1,
                lang,
              )}{" "}
              <span className="text-stone-400">{m.slice(2, 4)}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Filas de proyectos */}
      <div className="flex flex-col gap-1">
        {dated.map((p) => {
          const startFr = dateToMonthFraction(p.startDate!, months);
          const endFr = dateToMonthFraction(p.endDate!, months);
          const leftPct = (startFr / totalMonths) * 100;
          const widthPct = Math.max(0.5, ((endFr - startFr) / totalMonths) * 100);
          const overConsumed = p.consumptionPct > 100;
          const fillPct = Math.min(p.consumptionPct, 100);

          return (
            <div
              key={p.id}
              className="grid grid-cols-[260px_1fr] gap-3 items-center hover:bg-paper-2 rounded px-1 py-1 -mx-1 transition-colors"
            >
              <div className="min-w-0">
                <Link
                  href={`/proyectos/${p.code}`}
                  className="font-medium text-ink hover:underline truncate block text-sm"
                >
                  {p.name}
                </Link>
                <div className="font-mono text-[10px] text-muted">{p.code}</div>
              </div>
              <div className="relative h-7">
                {/* Grid lines */}
                <div className="absolute inset-0 flex">
                  {months.map((m) => (
                    <div
                      key={m}
                      className="flex-1 border-l border-line-soft first:border-l-0"
                    />
                  ))}
                </div>
                {/* Project bar */}
                <div
                  className="absolute top-1 h-5 rounded bg-paper-2 border border-line overflow-hidden"
                  style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                  title={`${formatDate(p.startDate, lang)} → ${formatDate(p.endDate, lang)} · ${p.consumptionPct.toFixed(0)}%`}
                >
                  <div
                    className={`absolute inset-y-0 left-0 ${
                      overConsumed ? "bg-warn" : "bg-ink"
                    }`}
                    style={{ width: `${fillPct}%` }}
                  />
                  {p.status !== "active" && (
                    <div className="absolute inset-0 bg-paper-2/40" />
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-[11px] text-muted">
        {lang === "es"
          ? "Las barras muestran el rango de fechas del proyecto; el fill es el % de consumo de budget. Proyectos no activos quedan tenues."
          : "Bars show the project date range; the fill is the budget consumption %. Non-active projects appear dimmed."}
      </p>
    </section>
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
