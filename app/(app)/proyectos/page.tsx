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
import { resolveClientFromSearchParams } from "@/lib/client-filter.server";

type Props = {
  searchParams: Promise<{ origin?: string; client?: string }>;
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

function previousMonth(): string {
  const now = new Date();
  let y = now.getFullYear();
  let m = now.getMonth(); // 0-indexed month → ya es "mes anterior"
  if (m === 0) {
    y -= 1;
    m = 12;
  }
  return `${y}-${String(m).padStart(2, "0")}`;
}

export default async function ProyectosPage({ searchParams }: Props) {
  const sp = await searchParams;
  const client = await resolveClientFromSearchParams(sp);
  const clientId = client?.id ?? null;
  const allOrigins = await listAllBudgetOrigins({ clientId });
  const validOrigin =
    sp.origin && allOrigins.some((o) => o.id === sp.origin) ? sp.origin : null;
  const months = nextMonths(2);
  const prevMonth = previousMonth();
  // Una sola query con [mes anterior, ...futuros]; separamos el resultado
  // después porque el mes anterior se muestra como "real vs estimado".
  const [data, allEstimates] = await Promise.all([
    getDashboardProjects({ budgetOriginId: validOrigin, clientId }),
    getBillingEstimate({
      months: [prevMonth, ...months],
      budgetOriginId: validOrigin,
      clientId,
    }),
  ]);
  const previousEstimate = allEstimates.find((e) => e.month === prevMonth) ?? null;
  const estimates = allEstimates.filter((e) => e.month !== prevMonth);

  const filterDescriptors = [
    client ? client.name : null,
    validOrigin ? "origen" : null,
  ].filter(Boolean);

  return (
    <PageShell
      eyebrow="Proyectos"
      title={client ? `Proyectos · ${client.name}` : "Todos los proyectos"}
      subtitle={`${data.rows.length} proyecto${data.rows.length === 1 ? "" : "s"}${filterDescriptors.length ? ` · filtrado por ${filterDescriptors.join(" + ")}` : ""}. Click en la flecha para ver los planes adentro.`}
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
        preserveParams={{ client: client?.slug }}
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

      <BillingEstimateCard
        estimates={estimates}
        previousMonth={previousEstimate}
      />
    </PageShell>
  );
}
