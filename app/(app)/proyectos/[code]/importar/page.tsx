import { notFound } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { ExcelImporter } from "./importer";

type Props = { params: Promise<{ code: string }> };

export default async function ImportarPage({ params }: Props) {
  const { code } = await params;
  const [project] = await db
    .select({ id: projects.id, name: projects.name, code: projects.code })
    .from(projects)
    .where(eq(projects.code, code))
    .limit(1);

  if (!project) notFound();

  return (
    <main className="px-8 py-10 max-w-[1180px] mx-auto w-full">
      <nav
        aria-label="Breadcrumb"
        className="text-xs text-muted flex items-center gap-1.5 mb-3"
      >
        <Link href="/proyectos" className="hover:text-ink">
          Proyectos
        </Link>
        <span className="text-stone-300">/</span>
        <Link href={`/proyectos/${project.code}`} className="hover:text-ink">
          {project.name}
        </Link>
        <span className="text-stone-300">/</span>
        <span className="text-ink font-medium">Importar Excel</span>
      </nav>

      <header className="mb-6">
        <p className="text-xs font-semibold tracking-[0.16em] uppercase text-accent">
          Importador
        </p>
        <h1 className="text-3xl font-semibold tracking-tight mt-2">
          Importar plan desde Excel
        </h1>
        <p className="text-sm text-muted mt-1 max-w-2xl">
          Subí el Excel del cliente. El parser detecta columnas estándar
          (publisher, placement, fechas, budget, fee). Si crea una nueva
          versión y ya hay un plan approved, ese plan pasa a superseded.
        </p>
      </header>

      <ExcelImporter projectId={project.id} projectCode={project.code} />
    </main>
  );
}
