import Link from "next/link";
import { PageShell } from "@/components/page-shell";
import { getNewProjectFormData } from "@/app/actions/projects";
import { NewProjectForm } from "./form";

export default async function NuevoProyectoPage() {
  const data = await getNewProjectFormData();

  if (data.clients.length === 0) {
    return (
      <PageShell
        eyebrow="Proyectos"
        title="Nuevo proyecto"
      >
        <div className="rounded-lg border border-line border-dashed bg-paper-2 px-5 py-12 text-center">
          <p className="text-sm font-medium text-ink-2">No hay clientes activos</p>
          <p className="text-xs text-muted mt-1">
            Cargá un cliente primero. La gestión de clientes llega después de Auth — por ahora se hace por seed.
          </p>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      eyebrow="Proyectos"
      title="Crear nuevo proyecto"
      subtitle="El AM define cliente, budget origin, código y total gross budget. Después el media planner crea los planes adentro."
    >
      <nav className="text-xs text-muted mb-3">
        <Link href="/proyectos" className="hover:text-ink">
          ← Volver a Proyectos
        </Link>
      </nav>
      <NewProjectForm
        clients={data.clients}
        origins={data.origins}
        currentYear={data.currentYear}
      />
    </PageShell>
  );
}
