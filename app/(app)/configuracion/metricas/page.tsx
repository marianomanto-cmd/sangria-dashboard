import { asc } from "drizzle-orm";
import { db } from "@/db";
import { metricsCatalog } from "@/db/schema";
import { PageShell } from "@/components/page-shell";
import { MetricsAdmin } from "./admin";

export default async function MetricsPage() {
  const rows = await db
    .select()
    .from(metricsCatalog)
    .orderBy(asc(metricsCatalog.sortOrder), asc(metricsCatalog.name));

  return (
    <PageShell
      eyebrow="Configuración"
      title="Métricas e indicadores"
      subtitle="Catálogo editable de métricas que el media planner puede asociar a un placement. Direct = el planner ingresa el valor. Calculated = se deriva con una fórmula desde direct + amount."
    >
      <MetricsAdmin initialRows={rows} />
    </PageShell>
  );
}
