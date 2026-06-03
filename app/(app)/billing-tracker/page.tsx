import Link from "next/link";
import { Building2, ChevronRight, Receipt, TrendingUp } from "lucide-react";
import { EmptyState, PageShell } from "@/components/page-shell";
import { BillingTrackerFilters } from "@/components/billing-tracker-filters";
import { BillingEstimateCard } from "@/components/billing-estimate-card";
import { BillingStatusBadge } from "@/components/billing-status-badge";
import {
  getBillingTracker,
  getBillingTrackerFilterOptions,
} from "@/db/queries/billing-tracker";
import { getBillingEstimate } from "@/db/queries/dashboard";
import { resolveClientFromSearchParams } from "@/lib/client-filter.server";
import { formatUsd } from "@/lib/format";
import { DEFAULT_LANGUAGE, formatMonth, type Language } from "@/lib/i18n";

type Tab = "tracker" | "estimates";

type SearchParams = {
  client?: string;
  project?: string;
  from?: string;
  to?: string;
  tab?: string;
};

type Props = {
  searchParams: Promise<SearchParams>;
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

// Helpers para la pestaña Estimates: previo + 2 próximos meses (mismo
// criterio que tenía /planes antes de mover la sección acá).
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
  let m = now.getMonth();
  if (m === 0) {
    y -= 1;
    m = 12;
  }
  return `${y}-${String(m).padStart(2, "0")}`;
}

export default async function BillingTrackerPage({ searchParams }: Props) {
  const sp = await searchParams;
  const client = await resolveClientFromSearchParams(sp);
  const lang = client?.language ?? DEFAULT_LANGUAGE;
  const tab: Tab = sp.tab === "estimates" ? "estimates" : "tracker";

  const baseTitle =
    lang === "es"
      ? client
        ? `Billing Tracker · ${client.name}`
        : "Billing Tracker"
      : client
        ? `Billing Tracker · ${client.name}`
        : "Billing Tracker";

  // El contenido + subtitle dependen de la tab.
  if (tab === "estimates") {
    const months = nextMonths(2);
    const prevMonth = previousMonth();
    const allEstimates = await getBillingEstimate({
      months: [prevMonth, ...months],
      clientId: client?.id ?? null,
    });
    const previousEstimate =
      allEstimates.find((e) => e.month === prevMonth) ?? null;
    const estimates = allEstimates.filter((e) => e.month !== prevMonth);

    const subtitle =
      lang === "es"
        ? "Estimación de facturación próxima vs lo ya emitido. Se suma cada placement de planes vigentes prorrateado por días."
        : "Upcoming billing estimate vs what's already invoiced. Each placement of active plans is prorated by days.";

    return (
      <PageShell
        eyebrow="Billing Tracker"
        title={baseTitle}
        subtitle={subtitle}
      >
        <TabsNav current={tab} lang={lang} search={sp} />
        {estimates.length === 0 && !previousEstimate ? (
          <EmptyState
            title={
              lang === "es"
                ? "Sin planes vigentes para estimar"
                : "No active plans to estimate"
            }
            hint={
              lang === "es"
                ? "Aparecen acá los planes con status approved o ready_to_send dentro del período."
                : "Plans with status approved or ready_to_send within the period show here."
            }
          />
        ) : (
          <BillingEstimateCard
            estimates={estimates}
            previousMonth={previousEstimate}
            lang={lang}
          />
        )}
      </PageShell>
    );
  }

  // Tab "tracker" (default).
  const filterOptions = await getBillingTrackerFilterOptions(
    client?.id ?? null,
  );
  const projects = await getBillingTracker({
    clientId: client?.id ?? null,
    projectId: sp.project || null,
    fromMonth: sp.from || null,
    toMonth: sp.to || null,
  });

  const monthsList =
    filterOptions.minMonth && filterOptions.maxMonth
      ? enumerateMonths(filterOptions.minMonth, filterOptions.maxMonth)
      : [];

  const invoiceCount = projects.reduce(
    (acc, p) => acc + p.plans.reduce((a, pl) => a + pl.invoices.length, 0),
    0,
  );

  const subtitle =
    lang === "es"
      ? `${invoiceCount} factura${invoiceCount === 1 ? "" : "s"} emitida${invoiceCount === 1 ? "" : "s"} en el rango. Desglose por proyecto y plan, con media vs fee por factura.`
      : `${invoiceCount} emitted invoice${invoiceCount === 1 ? "" : "s"} in range. Breakdown by project and plan, with media vs fee per invoice.`;

  return (
    <PageShell eyebrow="Billing Tracker" title={baseTitle} subtitle={subtitle}>
      <TabsNav current={tab} lang={lang} search={sp} />
      <BillingTrackerFilters
        projects={filterOptions.projects}
        monthsList={monthsList}
        lang={lang}
      />

      {projects.length === 0 ? (
        <EmptyState
          title={
            lang === "es"
              ? "Sin facturas emitidas para los filtros aplicados"
              : "No emitted invoices for the current filters"
          }
          hint={
            lang === "es"
              ? "Solo aparecen las facturas que ya tienen número cargado (estado facturado o pagado)."
              : "Only invoices with a loaded number (status invoiced or paid) are shown."
          }
        />
      ) : (
        <div className="flex flex-col gap-6">
          {projects.map((proj) => (
            <ProjectCard key={proj.id} project={proj} lang={lang} />
          ))}
        </div>
      )}
    </PageShell>
  );
}

// ─── Tabs nav (URL-based, server-rendered con <Link>) ──────────────────────

function TabsNav({
  current,
  lang,
  search,
}: {
  current: Tab;
  lang: Language;
  search: SearchParams;
}) {
  // El tab "tracker" preserva los filtros del tracker (project/from/to); el
  // tab "estimates" no los necesita y los descarta para limpiar la URL.
  const trackerParams = new URLSearchParams();
  if (search.client) trackerParams.set("client", search.client);
  if (search.project) trackerParams.set("project", search.project);
  if (search.from) trackerParams.set("from", search.from);
  if (search.to) trackerParams.set("to", search.to);
  const trackerQs = trackerParams.toString();
  const trackerHref = trackerQs
    ? `/billing-tracker?${trackerQs}`
    : "/billing-tracker";

  const estimateParams = new URLSearchParams();
  if (search.client) estimateParams.set("client", search.client);
  estimateParams.set("tab", "estimates");
  const estimateHref = `/billing-tracker?${estimateParams.toString()}`;

  const tabs = [
    {
      id: "tracker" as const,
      href: trackerHref,
      label: lang === "es" ? "Tracker" : "Tracker",
      icon: Receipt,
    },
    {
      id: "estimates" as const,
      href: estimateHref,
      label: lang === "es" ? "Estimación" : "Estimates",
      icon: TrendingUp,
    },
  ];

  return (
    <nav
      role="tablist"
      aria-label={lang === "es" ? "Vistas" : "Views"}
      className="border-b border-line mb-6 flex gap-1"
    >
      {tabs.map((t) => {
        const Icon = t.icon;
        const active = current === t.id;
        return (
          <Link
            key={t.id}
            href={t.href}
            role="tab"
            aria-selected={active}
            className={`px-4 py-2 text-sm flex items-center gap-2 border-b-2 -mb-px transition-colors ${
              active
                ? "border-accent text-ink font-medium"
                : "border-transparent text-muted hover:text-ink-2"
            }`}
          >
            <Icon size={14} strokeWidth={2} />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

function ProjectCard({
  project,
  lang,
}: {
  project: Awaited<ReturnType<typeof getBillingTracker>>[number];
  lang: "en" | "es";
}) {
  return (
    <section className="rounded-lg border border-line bg-white dark:bg-paper-2 overflow-hidden">
      <header className="flex items-start justify-between gap-4 px-5 py-4 border-b border-line bg-paper">
        <div className="min-w-0 flex items-start gap-3">
          <div className="w-9 h-9 rounded-md bg-white dark:bg-paper-2 border border-line flex items-center justify-center shrink-0">
            <Building2 size={15} strokeWidth={2} className="text-ink-2" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                href={`/proyectos/${project.code}`}
                className="font-semibold text-ink hover:text-accent transition-colors truncate"
              >
                {project.name}
              </Link>
              <span className="font-mono text-[11px] text-muted">
                {project.code}
              </span>
            </div>
            <p className="text-xs text-muted mt-0.5">
              <Link
                href={`/clientes/${project.clientSlug}`}
                className="hover:text-ink transition-colors"
              >
                {project.clientName}
              </Link>
            </p>
          </div>
        </div>
        <Totals
          media={project.mediaSubtotalUsd}
          fee={project.feeSubtotalUsd}
          total={project.totalUsd}
          lang={lang}
        />
      </header>

      <div className="flex flex-col">
        {project.plans.map((plan, i) => (
          <PlanBlock
            key={plan.id}
            plan={plan}
            projectCode={project.code}
            isLast={i === project.plans.length - 1}
            lang={lang}
          />
        ))}
      </div>
    </section>
  );
}

function PlanBlock({
  plan,
  projectCode,
  isLast,
  lang,
}: {
  plan: Awaited<ReturnType<typeof getBillingTracker>>[number]["plans"][number];
  projectCode: string;
  isLast: boolean;
  lang: "en" | "es";
}) {
  return (
    <div className={isLast ? undefined : "border-b border-line"}>
      <div className="flex items-center justify-between gap-4 px-5 py-2.5 bg-paper-2">
        <p className="text-sm font-medium text-ink-2">
          <span className="text-[10px] font-semibold tracking-[0.08em] uppercase text-muted mr-2">
            Plan
          </span>
          {plan.name}
        </p>
        <Totals
          media={plan.mediaSubtotalUsd}
          fee={plan.feeSubtotalUsd}
          total={plan.totalUsd}
          lang={lang}
          small
        />
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-[0.06em] text-muted bg-white dark:bg-paper-2">
            <th className="text-left font-medium px-5 py-2">
              {lang === "es" ? "N° factura" : "Invoice #"}
            </th>
            <th className="text-left font-medium px-5 py-2">
              {lang === "es" ? "Mes" : "Month"}
            </th>
            <th className="text-right font-medium px-5 py-2">
              {lang === "es" ? "Subtotal medios" : "Media subtotal"}
            </th>
            <th className="text-right font-medium px-5 py-2">
              {lang === "es" ? "Subtotal fees" : "Fees subtotal"}
            </th>
            <th className="text-right font-medium px-5 py-2">Total</th>
            <th className="text-left font-medium px-5 py-2">
              {lang === "es" ? "Estado" : "Status"}
            </th>
            <th className="px-2 py-2" aria-label="abrir" />
          </tr>
        </thead>
        <tbody>
          {plan.invoices.map((inv) => {
            const href = `/proyectos/${projectCode}/planes/${plan.id}/billing?month=${inv.month}`;
            return (
              <tr
                key={inv.id}
                className="border-t border-line-soft group hover:bg-paper-2 transition-colors"
              >
                <RowCell href={href}>
                  <span className="font-mono text-ink-2">
                    {inv.invoiceNumber}
                  </span>
                </RowCell>
                <RowCell href={href}>
                  <span className="text-ink-2">
                    {formatMonth(inv.month, lang)}
                  </span>
                </RowCell>
                <RowCell href={href} align="right">
                  <span className="font-mono text-ink-2">
                    {formatUsd(inv.mediaSubtotalUsd)}
                  </span>
                </RowCell>
                <RowCell href={href} align="right">
                  <span className="font-mono text-muted text-xs">
                    {formatUsd(inv.feeSubtotalUsd)}
                  </span>
                </RowCell>
                <RowCell href={href} align="right">
                  <span className="font-mono font-semibold text-ink">
                    {formatUsd(inv.totalUsd)}
                  </span>
                </RowCell>
                <RowCell href={href}>
                  <BillingStatusBadge status={inv.status} lang={lang} />
                </RowCell>
                <td className="px-2 py-2.5 align-middle">
                  <Link
                    href={href}
                    aria-label={lang === "es" ? "Abrir" : "Open"}
                    className="inline-flex items-center justify-center w-7 h-7 rounded-md text-muted group-hover:text-ink group-hover:bg-paper transition-colors"
                  >
                    <ChevronRight size={16} />
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Totals({
  media,
  fee,
  total,
  lang,
  small,
}: {
  media: number;
  fee: number;
  total: number;
  lang: "en" | "es";
  small?: boolean;
}) {
  const labelMedia = lang === "es" ? "Medios" : "Media";
  const labelFee = lang === "es" ? "Fees" : "Fees";
  return (
    <div className="flex items-center gap-4 text-right shrink-0">
      <Stat label={labelMedia} value={media} small={small} />
      <Stat label={labelFee} value={fee} small={small} muted />
      <Stat label="Total" value={total} small={small} strong />
    </div>
  );
}

function Stat({
  label,
  value,
  small,
  muted,
  strong,
}: {
  label: string;
  value: number;
  small?: boolean;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
        {label}
      </p>
      <p
        className={`font-mono tabular-nums ${small ? "text-xs" : "text-sm"} ${
          strong ? "font-semibold text-ink" : muted ? "text-muted" : "text-ink-2"
        }`}
      >
        {formatUsd(value)}
      </p>
    </div>
  );
}

function RowCell({
  children,
  href,
  align,
}: {
  children: React.ReactNode;
  href: string;
  align?: "right";
}) {
  return (
    <td className="p-0">
      <Link
        href={href}
        className={`block px-5 py-2.5 ${align === "right" ? "text-right" : ""}`}
      >
        {children}
      </Link>
    </td>
  );
}
