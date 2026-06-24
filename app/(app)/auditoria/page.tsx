import Link from "next/link";
import { Trash2 } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { AuditEntry } from "@/components/audit-entry";
import { getAuditLog, getAuditLogStats } from "@/db/queries/audit-log";
import { actionVerb, entityNoun } from "@/lib/audit-format";

type Props = {
  searchParams: Promise<{
    type?: string;
    action?: string;
    since?: string;
  }>;
};

export default async function AuditoriaPage({ searchParams }: Props) {
  const sp = await searchParams;
  const filters = {
    entityType: sp.type || undefined,
    action: sp.action || undefined,
    sinceDate: sp.since || undefined,
  };

  const [rows, stats] = await Promise.all([
    getAuditLog(filters, 200),
    getAuditLogStats(),
  ]);

  const trashCount =
    stats.byAction.find((a) => a.action === "delete")?.count ?? 0;

  return (
    <PageShell
      eyebrow="Auditoría"
      title="Log de cambios"
      subtitle={`${stats.total} eventos registrados · mostrando los últimos ${rows.length}`}
    >
      {/* Acceso a papelera */}
      <div className="mb-4">
        <Link
          href="/auditoria/papelera"
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-1.5 text-xs font-medium text-ink hover:bg-paper-2 transition-colors"
        >
          <Trash2 size={13} strokeWidth={2} />
          Papelera ({trashCount})
        </Link>
      </div>

      {/* Filtros */}
      <section className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <FilterPill label="Tipo">
          <FilterChoice
            current={filters.entityType ?? null}
            value={null}
            label="Todos"
            buildHref={(v) => buildAuditHref({ ...filters, entityType: v ?? undefined })}
          />
          {stats.byEntityType.map((e) => (
            <FilterChoice
              key={e.entityType}
              current={filters.entityType ?? null}
              value={e.entityType}
              label={`${entityNoun(e.entityType).singular} (${e.count})`}
              buildHref={(v) => buildAuditHref({ ...filters, entityType: v ?? undefined })}
            />
          ))}
        </FilterPill>

        <FilterPill label="Acción">
          <FilterChoice
            current={filters.action ?? null}
            value={null}
            label="Todas"
            buildHref={(v) => buildAuditHref({ ...filters, action: v ?? undefined })}
          />
          {stats.byAction.map((a) => (
            <FilterChoice
              key={a.action}
              current={filters.action ?? null}
              value={a.action}
              label={`${actionVerb(a.action)} (${a.count})`}
              buildHref={(v) => buildAuditHref({ ...filters, action: v ?? undefined })}
            />
          ))}
        </FilterPill>

        {(filters.entityType || filters.action || filters.sinceDate) && (
          <Link
            href="/auditoria"
            className="px-2 py-0.5 rounded text-muted hover:text-ink underline-offset-2 hover:underline"
          >
            Limpiar filtros
          </Link>
        )}
      </section>

      {/* Lista */}
      {rows.length === 0 ? (
        <div className="rounded-lg border border-line border-dashed bg-paper-2 px-5 py-12 text-center">
          <p className="text-sm font-medium text-ink-2">Sin eventos</p>
          <p className="text-xs text-muted mt-1">
            {stats.total === 0
              ? "El log está vacío. Cualquier cambio en proyectos, planes o catálogos queda registrado acá."
              : "Ningún evento matchea los filtros seleccionados."}
          </p>
        </div>
      ) : (
        <section className="rounded-lg border border-line bg-white dark:bg-paper-2 overflow-hidden">
          <ul className="divide-y divide-line-soft">
            {rows.map((row) => (
              <li key={row.id} className="px-5 py-3 hover:bg-paper-2 transition-colors">
                <AuditEntry row={row} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageShell>
  );
}

// El render de cada evento (oración + diff de campos) vive en
// components/audit-entry.tsx, compartido con el modal de cambios del plan.

// ────────────────────────────────────────────────────────────────────────────
// Filter pills
// ────────────────────────────────────────────────────────────────────────────

function FilterPill({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-paper-2 border border-line">
      <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted mr-1">
        {label}
      </span>
      <div className="flex items-center gap-0.5">{children}</div>
    </div>
  );
}

function FilterChoice({
  current,
  value,
  label,
  buildHref,
}: {
  current: string | null;
  value: string | null;
  label: string;
  buildHref: (v: string | null) => string;
}) {
  const isActive = current === value;
  return (
    <Link
      href={buildHref(value)}
      data-active={isActive}
      className="px-2 py-0.5 rounded text-muted hover:text-ink data-[active=true]:bg-white dark:data-[active=true]:bg-paper data-[active=true]:text-ink data-[active=true]:shadow-sm transition-colors"
    >
      {label}
    </Link>
  );
}

function buildAuditHref(filters: {
  entityType?: string;
  action?: string;
  sinceDate?: string;
}): string {
  const params = new URLSearchParams();
  if (filters.entityType) params.set("type", filters.entityType);
  if (filters.action) params.set("action", filters.action);
  if (filters.sinceDate) params.set("since", filters.sinceDate);
  const qs = params.toString();
  return `/auditoria${qs ? `?${qs}` : ""}`;
}
