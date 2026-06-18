import Link from "next/link";
import { Plus } from "lucide-react";
import { BudgetOriginSelector } from "@/components/budget-origin-selector";
import { ProjectsTableExpandable } from "@/components/projects-table-expandable";
import { YearSelector } from "@/components/year-selector";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/button";
import { listAllBudgetOrigins } from "@/db/queries/budget-origins";
import { getDashboardProjects, type DashboardProjectRow } from "@/db/queries/dashboard";
import { resolveClientFromSearchParams } from "@/lib/client-filter.server";
import { DEFAULT_LANGUAGE } from "@/lib/i18n";
import { availableYears, periodMatchesYear, resolveYearParam } from "@/lib/year-filter";

type Props = {
  searchParams: Promise<{ origin?: string; client?: string; year?: string }>;
};

// Período del proyecto = min/max de los períodos de sus planes (placements).
function projectPeriod(r: DashboardProjectRow): { start: string | null; end: string | null } {
  let start: string | null = null;
  let end: string | null = null;
  for (const pl of r.plans) {
    if (pl.periodStart && (!start || pl.periodStart < start)) start = pl.periodStart;
    if (pl.periodEnd && (!end || pl.periodEnd > end)) end = pl.periodEnd;
  }
  return { start, end };
}

export default async function ProyectosPage({ searchParams }: Props) {
  const sp = await searchParams;
  const client = await resolveClientFromSearchParams(sp);
  const clientId = client?.id ?? null;
  const lang = client?.language ?? DEFAULT_LANGUAGE;
  const allOrigins = await listAllBudgetOrigins({ clientId });
  const validOrigin =
    sp.origin && allOrigins.some((o) => o.id === sp.origin) ? sp.origin : null;
  const data = await getDashboardProjects({ budgetOriginId: validOrigin, clientId });

  // Filtro de año (default: año actual). Se calcula en memoria sobre el período
  // derivado de los planes de cada proyecto.
  const currentYear = new Date().getFullYear();
  const selectedYear = resolveYearParam(sp.year, currentYear);
  const years = availableYears(data.rows.map(projectPeriod), currentYear);
  const rows =
    selectedYear == null
      ? data.rows
      : data.rows.filter((r) =>
          periodMatchesYear(projectPeriod(r), selectedYear, currentYear),
        );

  const filterDescriptors = [
    client ? client.name : null,
    validOrigin ? (lang === "es" ? "origen" : "origin") : null,
    selectedYear != null ? String(selectedYear) : (lang === "es" ? "todos los años" : "all years"),
  ].filter(Boolean);
  const projectsWord =
    lang === "es"
      ? `${rows.length} proyecto${rows.length === 1 ? "" : "s"}`
      : `${rows.length} project${rows.length === 1 ? "" : "s"}`;
  const filteredText =
    filterDescriptors.length > 0
      ? lang === "es"
        ? ` · filtrado por ${filterDescriptors.join(" + ")}`
        : ` · filtered by ${filterDescriptors.join(" + ")}`
      : "";
  const subtitleTail =
    lang === "es"
      ? ". Click en la flecha para ver los planes adentro."
      : ". Click the arrow to expand the plans inside.";

  return (
    <PageShell
      eyebrow={lang === "es" ? "Proyectos" : "Projects"}
      title={
        client
          ? lang === "es"
            ? `Proyectos · ${client.name}`
            : `Projects · ${client.name}`
          : lang === "es"
            ? "Todos los proyectos"
            : "All projects"
      }
      subtitle={`${projectsWord}${filteredText}${subtitleTail}`}
      actions={
        <Link
          href="/proyectos/nuevo"
          className={buttonVariants({ size: "md" })}
        >
          <Plus size={14} strokeWidth={2.5} />
          {lang === "es" ? "Nuevo proyecto" : "New project"}
        </Link>
      }
    >
      <BudgetOriginSelector
        origins={allOrigins}
        current={validOrigin}
        basePath="/proyectos"
        preserveParams={{ client: client?.slug, year: sp.year }}
      />

      <div className="mb-4">
        <YearSelector
          years={years}
          current={selectedYear}
          currentYear={currentYear}
          basePath="/proyectos"
          preserveParams={{ origin: validOrigin ?? undefined, client: client?.slug }}
          lang={lang}
        />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-line border-dashed bg-paper-2 px-5 py-12 text-center text-sm text-muted">
          {lang === "es"
            ? "Sin proyectos para esta selección."
            : "No projects match this selection."}
        </div>
      ) : (
        <ProjectsTableExpandable rows={rows} showClient lang={lang} searchable />
      )}
    </PageShell>
  );
}
