import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { clients, mediaPlans, projects } from "@/db/schema";
import { getPlanTraffic } from "@/db/queries/plan-traffic";
import { listAdTypesForClient } from "@/app/actions/ad-types";
import { PlanStatusBadge } from "@/components/plan-status-badge";
import { PlanTrafficEditor } from "./traffic-editor";

type Props = {
  params: Promise<{ code: string; planId: string }>;
};

// ════════════════════════════════════════════════════════════════════════════
// Ventana de TRÁFICO del plan.
//
// El plan dice QUÉ se compra; acá se define CÓMO se arma, en dos capas y con
// dos roles: el media planner designa los ADSETS de cada placement (requisito
// para marcar el plan Listo para enviar) y el AM/PM completa los ADS de cada
// adset (requisito para cerrar el QA que habilita Live).
//
// Reglas en lib/plan-traffic.ts; barreras en `transitionPlanStatus` y
// `completePlanQa`.
// ════════════════════════════════════════════════════════════════════════════

export default async function PlanTrafficPage({ params }: Props) {
  const { code, planId } = await params;

  const [planRow] = await db
    .select({
      plan: {
        id: mediaPlans.id,
        name: mediaPlans.name,
        status: mediaPlans.status,
        currentVersion: mediaPlans.currentVersion,
      },
      project: { code: projects.code, name: projects.name },
      client: { id: clients.id, name: clients.name, slug: clients.slug },
    })
    .from(mediaPlans)
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(and(eq(mediaPlans.id, planId), isNull(mediaPlans.deletedAt)))
    .limit(1);

  if (!planRow || planRow.project.code !== code) notFound();

  const [rows, adTypeRows] = await Promise.all([
    getPlanTraffic(planId),
    // Catálogo de tipos de ad del cliente: alimenta el desplegable del AM/PM.
    listAdTypesForClient(planRow.client.id),
  ]);
  const adTypes = adTypeRows.map((t) => ({
    id: t.id,
    name: t.name,
    requiresDetail: t.requiresDetail,
    enabled: t.enabled,
  }));

  return (
    <main className="px-8 py-10 max-w-[1800px] mx-auto w-full">
      <nav
        aria-label="Breadcrumb"
        className="text-xs text-muted flex items-center gap-1.5 mb-3"
      >
        <Link href="/proyectos" className="hover:text-ink">
          Proyectos
        </Link>
        <span className="text-line">/</span>
        <Link href={`/clientes/${planRow.client.slug}`} className="hover:text-ink">
          {planRow.client.name}
        </Link>
        <span className="text-line">/</span>
        <Link href={`/proyectos/${planRow.project.code}`} className="hover:text-ink">
          {planRow.project.name}
        </Link>
        <span className="text-line">/</span>
        <Link
          href={`/proyectos/${planRow.project.code}/planes/${planId}`}
          className="hover:text-ink"
        >
          {planRow.plan.name}
        </Link>
        <span className="text-line">/</span>
        <span className="text-ink font-medium">Tráfico</span>
      </nav>

      <header className="mb-5 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] uppercase text-accent">
            Tráfico del plan
          </p>
          <div className="flex items-center gap-3 mt-2">
            <h1 className="text-3xl font-semibold tracking-tight">
              {planRow.plan.name}
            </h1>
            <PlanStatusBadge status={planRow.plan.status} />
            {planRow.plan.currentVersion > 0 && (
              <span className="font-mono text-xs text-muted">
                v{planRow.plan.currentVersion}
              </span>
            )}
          </div>
          <p className="text-sm text-muted mt-1 font-mono">
            {planRow.project.code}.{planRow.plan.name}
          </p>
        </div>
        <a
          href={`/api/plans/${planId}/traffic.xlsx`}
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper-2"
          title="Descargar el brief de tráfico en Excel"
        >
          Excel de tráfico
        </a>
      </header>

      <PlanTrafficEditor
        planId={planId}
        projectCode={planRow.project.code}
        clientSlug={planRow.client.slug}
        planStatus={planRow.plan.status}
        rows={rows}
        adTypes={adTypes}
      />
    </main>
  );
}
