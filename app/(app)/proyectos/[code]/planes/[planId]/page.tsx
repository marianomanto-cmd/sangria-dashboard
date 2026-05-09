import Link from "next/link";
import { notFound } from "next/navigation";
import { getPlanDetail } from "@/db/queries/project-detail";
import { listPublishers } from "@/app/actions/plans";
import { PlanEditor } from "./editor";

type Props = {
  params: Promise<{ code: string; planId: string }>;
};

export default async function PlanDetailPage({ params }: Props) {
  const { code, planId } = await params;
  const [detail, allPublishers] = await Promise.all([
    getPlanDetail(planId),
    listPublishers(),
  ]);

  if (!detail) notFound();
  if (detail.project.code !== code) notFound();

  return (
    <main className="px-8 py-10 max-w-[1380px] mx-auto w-full">
      <nav
        aria-label="Breadcrumb"
        className="text-xs text-muted flex items-center gap-1.5 mb-3"
      >
        <Link href="/proyectos" className="hover:text-ink">
          Proyectos
        </Link>
        <span className="text-stone-300">/</span>
        <Link href={`/clientes/${detail.client.slug}`} className="hover:text-ink">
          {detail.client.name}
        </Link>
        <span className="text-stone-300">/</span>
        <Link href={`/proyectos/${detail.project.code}`} className="hover:text-ink">
          {detail.project.name}
        </Link>
        <span className="text-stone-300">/</span>
        <span className="text-ink font-medium">{detail.plan.name}</span>
      </nav>

      <PlanEditor detail={detail} allPublishers={allPublishers} />
    </main>
  );
}
