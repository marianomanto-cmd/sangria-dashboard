import Link from "next/link";
import { PageShell } from "@/components/page-shell";
import {
  getAuditLog,
  getAuditLogStats,
  type AuditLogRow,
} from "@/db/queries/audit-log";

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

  return (
    <PageShell
      eyebrow="Auditoría"
      title="Log de cambios"
      subtitle={`${stats.total} eventos registrados · mostrando los últimos ${rows.length}`}
    >
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
              label={`${e.entityType} (${e.count})`}
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
              label={`${a.action} (${a.count})`}
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
              ? "El log está vacío. Editá un gasto en /proyectos/[code]?tab=gastos para generar el primer evento."
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

// ────────────────────────────────────────────────────────────────────────────
// Entry — un evento del log con diff de campos cambiados
// ────────────────────────────────────────────────────────────────────────────

function AuditEntry({ row }: { row: AuditLogRow }) {
  const diff = computeDiff(row.beforeJson, row.afterJson);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2 flex-wrap">
        <ActionBadge action={row.action} />
        <span className="text-sm font-medium text-ink">{row.entityType}</span>
        <span className="font-mono text-[11px] text-muted truncate max-w-[260px]">
          {row.entityId.slice(0, 8)}…
        </span>
        <span className="ml-auto font-mono text-[11px] text-muted">
          {row.createdAt.toISOString().replace("T", " ").slice(0, 19)}
        </span>
      </div>
      {diff.length > 0 && (
        <ul className="ml-1 text-xs flex flex-col gap-0.5">
          {diff.map((d) => (
            <li key={d.field} className="font-mono text-[11.5px]">
              <span className="text-muted">{d.field}:</span>{" "}
              {d.before !== undefined && (
                <span className="text-warn">
                  {formatValue(d.before)}
                </span>
              )}
              {d.before !== undefined && d.after !== undefined && (
                <span className="text-line mx-1">→</span>
              )}
              {d.after !== undefined && (
                <span className="text-success">{formatValue(d.after)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ActionBadge({ action }: { action: string }) {
  const styles: Record<string, string> = {
    create: "bg-success-soft text-success border-success-soft",
    update: "bg-info-soft text-info border-info-soft",
    delete: "bg-danger-soft text-danger border-danger-soft",
  };
  const cls = styles[action] ?? "bg-paper-2 text-muted border-line";
  return (
    <span
      className={`inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] ${cls}`}
    >
      {action}
    </span>
  );
}

type FieldDiff = { field: string; before?: unknown; after?: unknown };

const FIELD_BLACKLIST = new Set(["id", "recordedAt", "createdAt", "updatedAt"]);

function computeDiff(
  before: unknown,
  after: unknown,
): FieldDiff[] {
  if (before === null && after !== null && typeof after === "object" && after) {
    // Create — listamos campos relevantes del nuevo objeto.
    const obj = after as Record<string, unknown>;
    return Object.entries(obj)
      .filter(([k]) => !FIELD_BLACKLIST.has(k))
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([field, v]) => ({ field, after: v }));
  }
  if (
    before &&
    typeof before === "object" &&
    after &&
    typeof after === "object"
  ) {
    const b = before as Record<string, unknown>;
    const a = after as Record<string, unknown>;
    const keys = Array.from(
      new Set([...Object.keys(b), ...Object.keys(a)]),
    ).filter((k) => !FIELD_BLACKLIST.has(k));
    return keys
      .filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]))
      .map((k) => ({ field: k, before: b[k], after: a[k] }));
  }
  return [];
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

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
      className="px-2 py-0.5 rounded text-muted hover:text-ink data-[active=true]:bg-white dark:data-[active=true]:bg-paper-2 dark:bg-paper-2 data-[active=true]:text-ink data-[active=true]:shadow-sm transition-colors"
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
