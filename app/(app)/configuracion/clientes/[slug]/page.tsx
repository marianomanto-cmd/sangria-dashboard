import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  budgetOrigins,
  clients,
  markets,
  metricsCatalog,
  publishers,
} from "@/db/schema";
import { PageShell } from "@/components/page-shell";
import { ClientConfigSections } from "./sections";

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function ClientConfigPage({ params }: Props) {
  const { slug } = await params;
  const [client] = await db
    .select()
    .from(clients)
    .where(eq(clients.slug, slug))
    .limit(1);
  if (!client) notFound();

  // Publishers del cliente (todos, incluso deshabilitados). Cada cliente tiene
  // su propia lista — se crean/editan acá, no hay catálogo global.
  const pubRows = await db
    .select()
    .from(publishers)
    .where(eq(publishers.clientId, client.id))
    .orderBy(asc(publishers.sortOrder), asc(publishers.name));
  const publisherRows = pubRows.map((p) => ({
    publisherId: p.id,
    publisherName: p.name,
    publisherSlug: p.slug,
    enabled: p.enabled,
    agencyPays: p.agencyPays,
  }));

  // Métricas del cliente (todas, incluso deshabilitadas).
  const metricRows = await db
    .select()
    .from(metricsCatalog)
    .where(eq(metricsCatalog.clientId, client.id))
    .orderBy(asc(metricsCatalog.sortOrder), asc(metricsCatalog.name));

  // Markets del cliente.
  const marketRows = await db
    .select()
    .from(markets)
    .where(eq(markets.clientId, client.id))
    .orderBy(asc(markets.sortOrder), asc(markets.name));

  // Budget origins del cliente.
  const budgetOriginRows = await db
    .select()
    .from(budgetOrigins)
    .where(eq(budgetOrigins.clientId, client.id))
    .orderBy(asc(budgetOrigins.name));

  return (
    <PageShell
      eyebrow="Configuración / Clientes"
      title={`Configuración · ${client.name}`}
      subtitle={`Publishers, métricas, mercados y budget origins habilitados para ${client.name}. Cada cliente tiene su set propio — podés crear conversiones custom, renombrar mercados, etc.`}
    >
      <nav
        aria-label="Breadcrumb"
        className="text-xs text-muted -mt-6 mb-6"
      >
        <Link href="/configuracion/clientes" className="hover:text-accent">
          ← volver al listado de clientes
        </Link>
      </nav>
      <ClientConfigSections
        clientId={client.id}
        clientSlug={client.slug}
        clientName={client.name}
        publishers={publisherRows}
        metrics={metricRows}
        markets={marketRows}
        budgetOrigins={budgetOriginRows}
      />
    </PageShell>
  );
}
