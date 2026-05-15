import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { PageShell } from "@/components/page-shell";

// El catálogo global de métricas dejó de existir: cada cliente tiene su
// propia lista (incluyendo conversiones custom). Esta página queda como
// pointer al admin per-cliente para no romper bookmarks viejos.
export default async function MetricsRedirectPage() {
  const allClients = await db
    .select({ slug: clients.slug, name: clients.name })
    .from(clients)
    .orderBy(asc(clients.name));

  return (
    <PageShell
      eyebrow="Configuración"
      title="Métricas e indicadores"
      subtitle="El catálogo de métricas ahora es por cliente. Cada cliente puede definir conversiones custom, renombrar y deshabilitar las que no usa. Entrá al cliente para editar las suyas."
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {allClients.map((c) => (
          <Link
            key={c.slug}
            href={`/configuracion/clientes/${c.slug}#metricas`}
            className="rounded-lg border border-line bg-white dark:bg-paper-2 px-5 py-4 flex items-center justify-between hover:border-accent transition-colors group"
          >
            <span className="font-medium text-ink group-hover:text-accent">
              {c.name}
            </span>
            <ArrowRight size={16} className="text-muted group-hover:text-accent" />
          </Link>
        ))}
      </div>
    </PageShell>
  );
}
