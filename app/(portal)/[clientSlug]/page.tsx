import Link from "next/link";
import { notFound } from "next/navigation";
import {
  BarChart3,
  CalendarClock,
  FolderKanban,
  Gauge,
  Globe2,
  Receipt,
  TrendingUp,
} from "lucide-react";
import { isReservedTopLevelSlug } from "@/lib/client-portal";
import { hasPortalAccess } from "@/lib/client-portal.server";
import {
  getPortalClient,
  getPortalFilterOptions,
} from "@/db/queries/client-portal";
import { DEFAULT_LANGUAGE } from "@/lib/i18n";
import { PortalLogin } from "./portal-login";
import { PortalLogout } from "./portal-logout";
import { PortalFilters } from "./portal-filters";
import {
  type AnalysisParams,
  AnalysisSection,
  type BenchmarkParams,
  BenchmarksSection,
  BillingSection,
  EstimateSection,
  estimationMonthOptions,
  type PortalParams,
  ProjectsSection,
  ReportsSection,
  ResumenSection,
} from "./portal-content";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ clientSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const TABS = [
  { id: "resumen", labelEs: "Resumen", labelEn: "Summary", icon: BarChart3 },
  { id: "billing", labelEs: "Billing Tracker", labelEn: "Billing Tracker", icon: Receipt },
  { id: "estimacion", labelEs: "Estimación", labelEn: "Estimate", icon: TrendingUp },
  { id: "proyectos", labelEs: "Proyectos", labelEn: "Projects", icon: FolderKanban },
  { id: "analisis", labelEs: "Análisis", labelEn: "Analysis", icon: Globe2 },
  { id: "reportes", labelEs: "Reportes", labelEn: "Reports", icon: CalendarClock },
  { id: "benchmarks", labelEs: "Benchmarks", labelEn: "Benchmarks", icon: Gauge },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default async function ClientPortalPage({ params, searchParams }: Props) {
  const { clientSlug } = await params;
  if (isReservedTopLevelSlug(clientSlug)) notFound();

  const client = await getPortalClient(clientSlug);
  if (!client) notFound();

  // Gate del portal (cookie). Sin acceso → form de login.
  if (!(await hasPortalAccess(client.slug))) {
    return <PortalLogin slug={client.slug} clientName={client.name} />;
  }

  const sp = await searchParams;
  const one = (v: string | string[] | undefined) =>
    Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
  const requestedTab = one(sp.tab);
  const tab: TabId = TABS.some((t) => t.id === requestedTab)
    ? (requestedTab as TabId)
    : "resumen";

  const portalParams: PortalParams = {
    tab,
    bo: one(sp.bo),
    proj: one(sp.proj),
    month: one(sp.month),
    dateFrom: one(sp.pfrom),
    dateTo: one(sp.pto),
    plan: one(sp.plan),
    pstatus: one(sp.pstatus),
    camp: one(sp.camp),
  };

  const benchParams: BenchmarkParams = {
    publisherId: one(sp.bp),
    marketId: one(sp.bm),
    costMethod: one(sp.bcm),
    dateFrom: one(sp.bfrom),
    dateTo: one(sp.bto),
  };

  const analysisParams: AnalysisParams = {
    pub: one(sp.pub),
    mkt: one(sp.mkt),
    bo: one(sp.bo),
    from: one(sp.from),
    to: one(sp.to),
  };

  const lang = client.language ?? DEFAULT_LANGUAGE;
  const opts = await getPortalFilterOptions(client.id);

  return (
    // Contenedor de scroll propio del portal con la barra oculta (el cliente
    // pidió no ver la scrollbar). Sigue scrolleable con rueda/trackpad/drag.
    // Scoped al portal: no afecta la app interna.
    <div className="h-[100dvh] overflow-y-auto overflow-x-hidden bg-paper [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
      {/* Header */}
      <header className="border-b border-line bg-white dark:bg-paper-2">
        <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-[0.18em] uppercase text-accent">
              Sangria
            </p>
            <h1 className="text-xl font-semibold tracking-tight truncate">
              {client.name}
            </h1>
          </div>
          <PortalLogout />
        </div>

        {/* Tabs */}
        <nav
          role="tablist"
          aria-label={lang === "es" ? "Vistas" : "Views"}
          className="max-w-[1400px] mx-auto px-6 flex gap-1 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        >
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = t.id === tab;
            // Cambiar de tab limpia los filtros para no arrastrarlos a otra vista.
            return (
              <Link
                key={t.id}
                href={`?tab=${t.id}`}
                role="tab"
                aria-selected={active}
                className={`px-3.5 py-2.5 text-sm flex items-center gap-1.5 border-b-2 -mb-px whitespace-nowrap transition-colors ${
                  active
                    ? "border-accent text-ink font-medium"
                    : "border-transparent text-muted hover:text-ink-2"
                }`}
              >
                <Icon size={14} strokeWidth={2} />
                {lang === "es" ? t.labelEs : t.labelEn}
              </Link>
            );
          })}
        </nav>
      </header>

      {/* Content */}
      <main className="max-w-[1400px] mx-auto px-6 py-6">
        {tab === "billing" && (
          <PortalFilters
            fields={["origin", "project", "month"]}
            budgetOrigins={opts.budgetOrigins}
            projects={opts.projects}
            months={opts.months}
            lang={lang}
          />
        )}
        {tab === "estimacion" && (
          <PortalFilters
            fields={["origin", "project", "month"]}
            budgetOrigins={opts.budgetOrigins}
            projects={opts.projects}
            months={estimationMonthOptions()}
            lang={lang}
          />
        )}
        {tab === "proyectos" && (
          <PortalFilters
            fields={["pstatus", "campaign", "origin", "daterange"]}
            budgetOrigins={opts.budgetOrigins}
            projects={opts.projects}
            campaigns={opts.campaigns}
            months={opts.months}
            lang={lang}
          />
        )}

        {tab === "resumen" && (
          <ResumenSection clientId={client.id} lang={lang} />
        )}
        {tab === "billing" && (
          <BillingSection clientId={client.id} lang={lang} params={portalParams} />
        )}
        {tab === "estimacion" && (
          <EstimateSection clientId={client.id} lang={lang} params={portalParams} />
        )}
        {tab === "proyectos" && (
          <ProjectsSection
            clientId={client.id}
            clientSlug={client.slug}
            lang={lang}
            params={portalParams}
          />
        )}
        {tab === "analisis" && (
          <AnalysisSection
            clientId={client.id}
            lang={lang}
            analysis={analysisParams}
          />
        )}
        {tab === "reportes" && (
          <ReportsSection clientId={client.id} lang={lang} />
        )}
        {tab === "benchmarks" && (
          <BenchmarksSection
            clientId={client.id}
            lang={lang}
            bench={benchParams}
          />
        )}

        <footer className="mt-10 pt-4 border-t border-line text-center">
          <p className="text-[11px] text-muted">
            {lang === "es"
              ? "Vista de solo lectura · Sangria"
              : "Read-only view · Sangria"}
          </p>
        </footer>
      </main>
    </div>
  );
}
