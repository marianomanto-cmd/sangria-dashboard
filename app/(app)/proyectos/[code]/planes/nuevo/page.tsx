import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { NewPlanForm } from "./form";

type Props = { params: Promise<{ code: string }> };

export default async function NuevoPlanPage({ params }: Props) {
  const { code } = await params;
  const [project] = await db
    .select({
      id: projects.id,
      code: projects.code,
      name: projects.name,
    })
    .from(projects)
    .where(eq(projects.code, code))
    .limit(1);

  if (!project) notFound();

  return (
    <main className="px-8 py-10 max-w-[800px] mx-auto w-full">
      <nav
        aria-label="Breadcrumb"
        className="text-xs text-muted flex items-center gap-1.5 mb-3"
      >
        <Link href="/proyectos" className="hover:text-ink">Proyectos</Link>
        <span className="text-line">/</span>
        <Link href={`/proyectos/${project.code}`} className="hover:text-ink">
          {project.name}
        </Link>
        <span className="text-line">/</span>
        <span className="text-ink font-medium">Nuevo plan</span>
      </nav>

      <header className="mb-6">
        <p className="text-xs font-semibold tracking-[0.16em] uppercase text-accent">
          Nuevo plan
        </p>
        <h1 className="text-3xl font-semibold tracking-tight mt-2">
          Crear plan dentro de {project.name}
        </h1>
        <p className="text-sm text-muted mt-1 font-mono">{project.code}</p>
      </header>

      <NewPlanForm projectId={project.id} projectCode={project.code} />
    </main>
  );
}
