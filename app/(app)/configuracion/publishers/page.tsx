import { asc } from "drizzle-orm";
import { db } from "@/db";
import { publishers } from "@/db/schema";
import { PageShell } from "@/components/page-shell";
import { PublishersAdmin } from "./admin";

export default async function PublishersPage() {
  const rows = await db
    .select()
    .from(publishers)
    .orderBy(asc(publishers.sortOrder), asc(publishers.name));

  return (
    <PageShell
      eyebrow="Configuración"
      title="Publishers"
      subtitle="Catálogo editable de publishers que el media planner puede usar al armar un plan."
    >
      <PublishersAdmin initialRows={rows} />
    </PageShell>
  );
}
