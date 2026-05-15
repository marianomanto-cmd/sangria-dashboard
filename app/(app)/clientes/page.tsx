import Link from "next/link";
import { ArrowUpRight, Building2 } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { getClientsList } from "@/db/queries/clients";
import { formatUsdCompact } from "@/lib/format";

export default async function ClientesPage() {
  const clientsList = await getClientsList();

  return (
    <PageShell
      eyebrow="Clientes"
      title="Cuentas activas"
      subtitle={`${clientsList.length} cliente${clientsList.length === 1 ? "" : "s"} en el sistema`}
    >
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {clientsList.map((c) => (
          <Link
            key={c.id}
            href={`/clientes/${c.slug}`}
            className="group rounded-lg border border-line bg-white dark:bg-paper-2 p-5 hover:border-ink-2 transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-8 h-8 rounded-md bg-paper-2 border border-line flex items-center justify-center shrink-0">
                  <Building2 size={14} strokeWidth={2} className="text-ink-2" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-ink truncate">{c.name}</h3>
                  <p className="font-mono text-[11px] text-muted">{c.slug}</p>
                </div>
              </div>
              <ArrowUpRight
                size={14}
                strokeWidth={2}
                className="text-muted group-hover:text-ink transition-colors shrink-0 mt-1"
              />
            </div>

            <dl className="mt-4 grid grid-cols-3 gap-3">
              <div>
                <dt className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
                  Proyectos
                </dt>
                <dd className="mt-0.5 font-mono text-base font-semibold tabular-nums">
                  {c.totalProjects}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
                  Activos
                </dt>
                <dd className="mt-0.5 font-mono text-base font-semibold tabular-nums">
                  {c.activeProjects}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
                  Pipeline
                </dt>
                <dd className="mt-0.5 font-mono text-base font-semibold tabular-nums">
                  {c.activePipelineUsd > 0
                    ? formatUsdCompact(c.activePipelineUsd)
                    : "—"}
                </dd>
              </div>
            </dl>
          </Link>
        ))}
      </section>
    </PageShell>
  );
}
