import Link from "next/link";
import { Building2, ChevronRight } from "lucide-react";
import { EmptyState, PageShell } from "@/components/page-shell";
import { BillingTrackerFilters } from "@/components/billing-tracker-filters";
import {
  getBillingTracker,
  getBillingTrackerFilterOptions,
} from "@/db/queries/billing-tracker";
import { resolveClientFromSearchParams } from "@/lib/client-filter.server";
import { formatUsd } from "@/lib/format";
import { DEFAULT_LANGUAGE, formatMonth } from "@/lib/i18n";

type SearchParams = {
  client?: string;
  project?: string;
  from?: string;
  to?: string;
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

export default async function BillingTrackerPage({ searchParams }: Props) {
  const sp = await searchParams;
  const client = await resolveClientFromSearchParams(sp);
  const lang = client?.language ?? DEFAULT_LANGUAGE;

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

  const title =
    lang === "es"
      ? client
        ? `Billing Tracker · ${client.name}`
        : "Billing Tracker"
      : client
        ? `Billing Tracker · ${client.name}`
        : "Billing Tracker";
  const subtitle =
    lang === "es"
      ? `${invoiceCount} factura${invoiceCount === 1 ? "" : "s"} emitida${invoiceCount === 1 ? "" : "s"} en el rango. Desglose por proyecto y plan, con media vs fee por factura.`
      : `${invoiceCount} emitted invoice${invoiceCount === 1 ? "" : "s"} in range. Breakdown by project and plan, with media vs fee per invoice.`;

  return (
    <PageShell eyebrow="Billing Tracker" title={title} subtitle={subtitle}>
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

function ProjectCard({
  project,
  lang,
}: {
  project: Awaited<ReturnType<typeof getBillingTracker>>[number];
  lang: "en" | "es";
}) {
  return (
    <section className="rounded-lg border border-line bg-white overflow-hidden">
      <header className="flex items-start justify-between gap-4 px-5 py-4 border-b border-line bg-paper">
        <div className="min-w-0 flex items-start gap-3">
          <div className="w-9 h-9 rounded-md bg-white border border-line flex items-center justify-center shrink-0">
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
          <tr className="text-[11px] uppercase tracking-[0.06em] text-muted bg-white">
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
            const statusLabel =
              lang === "es"
                ? inv.status === "paid"
                  ? "pagado"
                  : "facturado"
                : inv.status === "paid"
                  ? "paid"
                  : "invoiced";
            const statusCls =
              inv.status === "paid"
                ? "bg-success-soft text-success border-success-soft"
                : "bg-accent-soft text-accent border-accent-soft";
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
                  <span
                    className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-[11px] font-medium ${statusCls}`}
                  >
                    {statusLabel}
                  </span>
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
