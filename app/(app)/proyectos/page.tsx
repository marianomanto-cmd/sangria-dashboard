import Link from "next/link";
import { Plus } from "lucide-react";
import { BillingEstimateCard } from "@/components/billing-estimate-card";
import { BudgetOriginSelector } from "@/components/budget-origin-selector";
import { ProjectsTableExpandable } from "@/components/projects-table-expandable";
import { PageShell } from "@/components/page-shell";
import { listAllBudgetOrigins } from "@/db/queries/budget-origins";
import {
  getBillingEstimate,
  getDashboardProjects,
} from "@/db/queries/dashboard";

type Props = {
  searchParams: Promise<{ origin?: string }>;
};

function nextMonths(count: number): string[] {
  const out: string[] = [];
  const now = new Date();
  let y = now.getFullYear();
  let m = now.getMonth() + 1;
  for (let i = 0; i < count; i++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export default async function ProyectosPage({ searchParams }: Props) {
  const sp = await searchParams;
  const allOrigins = await listAllBudgetOrigins();
  const validOrigin =
    sp.origin && allOrigins.some((o) => o.id === sp.origin) ? sp.origin : null;
  const months = nextMonths(2);
  const [data, estimates] = await Promise.all([
    getDashboardProjects({ budgetOriginId: validOrigin }),
    getBillingEstimate({ months, budgetOriginId: validOrigin }),
  ]);

  return (
    <PageShell
      eyebrow="Proyectos"
      title="Todos los proyectos"
      subtitle={`${data.rows.length} proyecto${data.rows.length === 1 ? "" : "s"}${validOrigin ? " · filtrado" : ""}. Click en la flecha para ver los planes adentro.`}
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
      <BudgetOriginSelector
        origins={allOrigins}
        current={validOrigin}
        basePath="/proyectos"
      />

      {data.rows.length === 0 ? (
        <div className="rounded-lg border border-line border-dashed bg-paper-2 px-5 py-12 text-center text-sm text-muted">
          Sin proyectos para esta selección.
        </div>
      ) : (
        <section className="rounded-lg border border-line bg-white overflow-hidden">
          <ProjectsTableExpandable rows={data.rows} showClient />
        </section>
      )}

      <BillingEstimateCard estimates={estimates} />
    </PageShell>
  );
}
