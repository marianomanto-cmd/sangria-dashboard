import { asc } from "drizzle-orm";
import { PageShell } from "@/components/page-shell";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { ClientsAdmin } from "./admin";

export default async function ConfiguracionClientesPage() {
  const rows = await db
    .select()
    .from(clients)
    .orderBy(asc(clients.name));

  return (
    <PageShell
      eyebrow="Configuración"
      title="Clientes"
      subtitle="Alta y edición de clientes. Cada cliente tiene un idioma que afecta las fechas y los exports (PDF/Excel). El default global es inglés."
    >
      <ClientsAdmin initialRows={rows} />
    </PageShell>
  );
}
