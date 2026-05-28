import Link from "next/link";
import { Plus } from "lucide-react";
import { BudgetOriginSelector } from "@/components/budget-origin-selector";
import { ProjectsTableExpandable } from "@/components/projects-table-expandable";
import { PageShell } from "@/components/page-shell";
import { listAllBudgetOrigins } from "@/db/queries/budget-origins";
import { getDashboardProjects } from "@/db/queries/dashboard";
import { resolveClientFromSearchParams } from "@/lib/client-filter.server";
import { DEFAULT_LANGUAGE } from "@/lib/i18n";

type Props = {
  searchParams: Promise<{ origin?: string; client?: string }>;
};

export default async function ProyectosPage({ searchParams }: Props) {
  const sp = await searchParams;
  const client = await resolveClientFromSearchParams(sp);
  const clientId = client?.id ?? null;
  const lang = client?.language ?? DEFAULT_LANGUAGE;
  const allOrigins = await listAllBudgetOrigins({ clientId });
  const validOrigin =
    sp.origin && allOrigins.some((o) => o.id === sp.origin) ? sp.origin : null;
  const data = await getDashboardProjects({ budgetOriginId: validOrigin, clientId });

  const filterDescriptors = [
    client ? client.name : null,
    validOrigin ? (lang === "es" ? "origen" : "origin") : null,
  ].filter(Boolean);
  const projectsWord =
    lang === "es"
      ? `${data.rows.length} proyecto${data.rows.length === 1 ? "" : "s"}`
      : `${data.rows.length} project${data.rows.length === 1 ? "" : "s"}`;
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
          className="inline-flex items-center gap-1.5 rounded-md bg-ink text-white px-3 py-1.5 text-sm font-medium hover:bg-ink-2 transition-colors"
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
        preserveParams={{ client: client?.slug }}
      />

      {data.rows.length === 0 ? (
        <div className="rounded-lg border border-line border-dashed bg-paper-2 px-5 py-12 text-center text-sm text-muted">
          {lang === "es"
            ? "Sin proyectos para esta selección."
            : "No projects match this selection."}
        </div>
      ) : (
        <ProjectsTableExpandable rows={data.rows} showClient lang={lang} searchable />
      )}
    </PageShell>
  );
}
