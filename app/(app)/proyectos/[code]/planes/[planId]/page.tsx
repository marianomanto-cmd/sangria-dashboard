import Link from "next/link";
import { notFound } from "next/navigation";
import { getPlanDetail } from "@/db/queries/project-detail";
import { getPlanAuditEvents } from "@/db/queries/audit-log";
import {
  listMarketsForClient,
  listMetricsForClient,
  listPublishersForClient,
} from "@/app/actions/plans";
import { DEFAULT_LANGUAGE, formatDate, type Language } from "@/lib/i18n";
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

  // Ventana de la "versión vigente" para el historial de cambios:
  // - draft / ready_to_send → el borrador en curso: cambios desde la última
  //   aprobación (o desde la creación si nunca se aprobó).
  // - approved / archived → los cambios que produjeron la versión aprobada
  //   vigente: desde la aprobación ANTERIOR (v−1), incluida la aprobación.
  const locked =
    detail.plan.status === "approved" || detail.plan.status === "archived";
  const sinceVersion = locked
    ? detail.plan.currentVersion - 1
    : detail.plan.currentVersion;
  const sinceSnap =
    detail.snapshots.find((s) => s.versionNumber === sinceVersion) ?? null;

  const [allPublishers, allMarkets, allMetrics, user, editEvents] =
    await Promise.all([
      listPublishersForClient(detail.client.id),
      listMarketsForClient(detail.client.id),
      listMetricsForClient(detail.client.id),
      getCurrentUser(),
      getPlanAuditEvents(planId, { since: sinceSnap?.approvedAt ?? null }),
    ]);
  const canApprove = canApprovePlans(user?.email);

  const windowNote = sinceSnap
    ? `Desde la aprobación de v${sinceSnap.versionNumber} (${formatDate(
        sinceSnap.approvedAt.toISOString().slice(0, 10),
        lang,
      )})`
    : "Desde la creación del plan";

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
        editHistory={{ events: editEvents, windowNote }}
      />
    </main>
  );
}
