import Link from "next/link";
import { PageShell } from "@/components/page-shell";
import { HardDeletePlanButton } from "@/components/hard-delete-plan-button";
import { RestorePlanButton } from "@/components/restore-plan-button";
import { getDeletedPlans } from "@/db/queries/plan-trash";
import { resolveClientFromSearchParams } from "@/lib/client-filter.server";
import { formatDate } from "@/lib/i18n";

type Props = {
  searchParams: Promise<{ client?: string }>;
};

export default async function PlanTrashPage({ searchParams }: Props) {
  const sp = await searchParams;
  const client = await resolveClientFromSearchParams(sp);
  const plans = await getDeletedPlans(client?.id ?? null);

  return (
    <PageShell
      eyebrow="Configuración"
      title="Plan trash"
      subtitle="Plans deleted from the project view are kept here permanently. Restore any of them back to its project."
    >
      {plans.length === 0 ? (
        <div className="rounded-lg border border-line border-dashed bg-paper-2 px-5 py-8 text-center text-sm text-muted">
          No deleted plans yet.
        </div>
      ) : (
        <>
        {/* Desktop: tabla. Mobile: tarjetas (abajo). */}
        <div className="hidden lg:block rounded-lg border border-line bg-white dark:bg-paper-2 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-paper-2 border-b border-line">
              <tr className="text-left text-[10px] uppercase tracking-[0.08em] text-muted font-medium">
                <th className="px-4 py-2.5">Plan</th>
                <th className="px-4 py-2.5">Project</th>
                <th className="px-4 py-2.5">Client</th>
                <th className="px-4 py-2.5">Deleted on</th>
                <th className="px-4 py-2.5 text-right" />
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr
                  key={p.planId}
                  className="border-t border-line-soft hover:bg-paper-2 transition-colors"
                >
                  <td className="px-4 py-2.5">
                    <span className="font-medium text-ink">{p.planName}</span>
                    <p className="text-[11px] text-muted font-mono">
                      {p.projectCode}.{p.planName}
                    </p>
                  </td>
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/proyectos/${p.projectCode}`}
                      className="text-ink-2 hover:text-accent"
                    >
                      {p.projectName}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-muted">{p.clientName}</td>
                  <td className="px-4 py-2.5 text-muted font-mono">
                    {formatDate(p.deletedAt.slice(0, 10), "en")}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-2">
                      <RestorePlanButton planId={p.planId} />
                      <HardDeletePlanButton
                        planId={p.planId}
                        planName={p.planName}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Mobile: tarjetas */}
        <div className="lg:hidden rounded-lg border border-line bg-white dark:bg-paper-2 divide-y divide-line-soft overflow-hidden">
          {plans.map((p) => (
            <div key={p.planId} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-ink">{p.planName}</p>
                  <p className="text-[11px] text-muted font-mono">
                    {p.projectCode}.{p.planName}
                  </p>
                </div>
                <span className="font-mono text-[11px] text-muted shrink-0">
                  {formatDate(p.deletedAt.slice(0, 10), "en")}
                </span>
              </div>
              <p className="text-[13px] mt-1.5">
                <Link
                  href={`/proyectos/${p.projectCode}`}
                  className="text-ink-2 hover:text-accent"
                >
                  {p.projectName}
                </Link>
                <span className="text-muted"> · {p.clientName}</span>
              </p>
              <div className="flex items-center gap-2 mt-3">
                <RestorePlanButton planId={p.planId} />
                <HardDeletePlanButton planId={p.planId} planName={p.planName} />
              </div>
            </div>
          ))}
        </div>
        </>
      )}
    </PageShell>
  );
}
