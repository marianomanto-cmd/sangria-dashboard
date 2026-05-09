import { asc } from "drizzle-orm";
import { db } from "@/db";
import { markets } from "@/db/schema";
import { PageShell } from "@/components/page-shell";
import { MarketsAdmin } from "./admin";

export default async function MarketsPage() {
  const rows = await db
    .select()
    .from(markets)
    .orderBy(asc(markets.sortOrder), asc(markets.name));

  return (
    <PageShell
      eyebrow="Configuración"
      title="Mercados"
      subtitle="Catálogo editable de mercados que el media planner puede asignar a un placement. Incluye países individuales y agrupaciones (Centroamérica, LATAM, etc.)."
    >
      <MarketsAdmin initialRows={rows} />
    </PageShell>
  );
}
