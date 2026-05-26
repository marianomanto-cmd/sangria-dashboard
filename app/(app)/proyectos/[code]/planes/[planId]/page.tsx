import Link from "next/link";
import { notFound } from "next/navigation";
import { getPlanDetail } from "@/db/queries/project-detail";
import {
  listMarketsForClient,
  listMetricsForClient,
  listPublishersForClient,
} from "@/app/actions/plans";
import { DEFAULT_LANGUAGE, type Language } from "@/lib/i18n";
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

  const [allPublishers, allMarkets, allMetrics] = await Promise.all([
    listPublishersForClient(detail.client.id),
    listMarketsForClient(detail.client.id),
    listMetricsForClient(detail.client.id),
  ]);

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
      />
    </main>
  );
}
