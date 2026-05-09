import Link from "next/link";
import { Plus } from "lucide-react";
import { ProjectsTableExpandable } from "@/components/projects-table-expandable";
import { PageShell } from "@/components/page-shell";
import { getDashboardProjects } from "@/db/queries/dashboard";

export default async function ProyectosPage() {
  const data = await getDashboardProjects();

  return (
    <PageShell
      eyebrow="Proyectos"
      title="Todos los proyectos"
      subtitle={`${data.rows.length} proyecto${data.rows.length === 1 ? "" : "s"} en el sistema. Click en la flecha para ver los planes adentro.`}
      actions={
        <Link
          href="/proyectos/nuevo"
          className="inline-flex items-center gap-1.5 rounded-md bg-ink text-white px-3 py-1.5 text-sm font-medium hover:bg-ink-2 transition-colors"
        >
          <Plus size={14} strokeWidth={2.5} />
          Nuevo proyecto
        </Link>
      }
    >
      <section className="rounded-lg border border-line bg-white overflow-hidden">
        <ProjectsTableExpandable rows={data.rows} showClient />
      </section>
    </PageShell>
  );
}
