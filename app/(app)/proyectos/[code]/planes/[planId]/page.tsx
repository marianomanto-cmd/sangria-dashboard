import Link from "next/link";
import { notFound } from "next/navigation";
import { getPlanDetail } from "@/db/queries/project-detail";
import { getPlanQaState, getPlanVersionList } from "@/db/queries/plan-qa";
import {
  getPlanningQaRows,
  getPlanningQaState,
  planningQaVersion,
} from "@/db/queries/plan-planning-qa";
import {
  listMarketsForClient,
  listMetricsForClient,
  listPublishersForClient,
} from "@/app/actions/plans";
import { DEFAULT_LANGUAGE, type Language } from "@/lib/i18n";
import { getCurrentUser } from "@/lib/auth";
import { canApprovePlans } from "@/lib/permissions";
import { PlanEditor } from "./editor";

type Props = {
  params: Promise<{ code: string; planId: string }>;
};

export default async function PlanDetailPage({ params }: Props) {
  const { code, planId } = await params;
  const detail = await getPlanDetail(planId);
  if (!detail) notFound();
  if (detail.project.code !== code) notFound();
  const lang: Language = detail.client.language ?? DEFAULT_LANGUAGE;

  const [
    allPublishers,
    allMarkets,
    allMetrics,
    user,
    qaState,
    versionHistory,
    planningQaState,
    planningRows,
  ] = await Promise.all([
    listPublishersForClient(detail.client.id),
    listMarketsForClient(detail.client.id),
    listMetricsForClient(detail.client.id),
    getCurrentUser(),
    // Estado del QA de la versión vigente (alimenta el modal de QA) y la LISTA
    // de versiones para el desplegable de abajo del editor.
    //
    // Es `getPlanVersionList`, no `getPlanVersionHistory`: la lista no toca
    // `snapshot_json`. El diff de cada versión lo pide el componente al
    // desplegarla. Traer los snapshots de todas las versiones acá era
    // transferir megabytes por una conexión del pooler en CADA render —
    // incluido el `router.refresh()` de después de guardar, y peor con cada
    // versión nueva. Era lo que colgaba esta página (incidente 02/sep/2026).
    getPlanQaState(planId, detail.plan.currentVersion),
    getPlanVersionList(planId),
    // QA de planificación de la versión que este draft va a ser: el estado del
    // run y las líneas que el modal lista para tildar.
    getPlanningQaState(planId, planningQaVersion(detail.plan.currentVersion)),
    getPlanningQaRows(planId),
  ]);

  const canApprove = canApprovePlans(user?.email);


  return (
    <main className="px-8 py-10 max-w-[1800px] mx-auto w-full">
      <nav
        aria-label="Breadcrumb"
        className="text-xs text-muted flex items-center gap-1.5 mb-3"
      >
        <Link href="/proyectos" className="hover:text-ink">
          {lang === "es" ? "Proyectos" : "Projects"}
        </Link>
        <span className="text-line">/</span>
        <Link href={`/clientes/${detail.client.slug}`} className="hover:text-ink">
          {detail.client.name}
        </Link>
        <span className="text-line">/</span>
        <Link href={`/proyectos/${detail.project.code}`} className="hover:text-ink">
          {detail.project.name}
        </Link>
        <span className="text-line">/</span>
        <span className="text-ink font-medium">{detail.plan.name}</span>
      </nav>

      <PlanEditor
        detail={detail}
        allPublishers={allPublishers}
        allMarkets={allMarkets}
        allMetrics={allMetrics}
        lang={lang}
        canApprove={canApprove}
        // TEMPORAL (02/sep/2026): el indicador de "última edición" queda
        // apagado. `getPlanAuditEvents` hace un scan de audit_log —que crece
        // sin techo— con un OR de condiciones sobre jsonb que ningún índice
        // puede servir (filtra por claves DENTRO de before_json/after_json, una
        // de ellas envuelta en coalesce). Acaparaba una conexión varios
        // segundos en CADA render de la página del plan, dejando al resto de
        // las queries en cola hasta el timeout: por eso fallaban TODOS los
        // planes mientras /proyectos andaba bien.
        //
        // Se reactiva pidiéndolo aparte (como el diff de versiones), no en el
        // render. Ver HANDOFF 02/sep/2026.
        qaState={qaState}
        versionHistory={versionHistory}
        planningQa={planningQaState}
        planningRows={planningRows}
      />
    </main>
  );
}
