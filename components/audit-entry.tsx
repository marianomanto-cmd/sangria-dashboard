// Render de un evento del audit_log como oración legible + diff de campos:
// "<actor> <verbo> el/la <entidad> '<nombre>' · <cuando>". Compartido entre
// /auditoria (server) y el modal de cambios del plan (client) — presentacional
// puro, sin "use client".

import type { AuditLogRow } from "@/db/queries/audit-log";
import {
  actionVerb,
  actorLabel,
  computeAuditDiff,
  entityLabel,
  entityNoun,
  formatAbsoluteDateTime,
  formatAuditValue,
  formatRelativeDateTime,
} from "@/lib/audit-format";

export function AuditEntry({ row }: { row: AuditLogRow }) {
  const noun = entityNoun(row.entityType);
  const verb = actionVerb(row.action);
  const actor = actorLabel(row.userEmail, row.userId);
  const label = entityLabel(row.entityType, row.beforeJson, row.afterJson);
  const relative = formatRelativeDateTime(row.createdAt);
  const absolute = formatAbsoluteDateTime(row.createdAt);
  const diff = computeAuditDiff(row.beforeJson, row.afterJson);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2 flex-wrap">
        <ActionBadge action={row.action} verb={verb} />
        <p className="text-sm text-ink-2 leading-relaxed">
          <span className="font-medium text-ink">{actor}</span>{" "}
          {verb} {noun.article} <span className="text-ink-2">{noun.singular}</span>
          {label && (
            <>
              {" "}
              <span className="font-medium text-ink">&ldquo;{label}&rdquo;</span>
            </>
          )}
        </p>
        <span
          className="ml-auto font-mono text-[11px] text-muted whitespace-nowrap"
          title={absolute}
        >
          {relative}
        </span>
      </div>
      {diff.length > 0 && (
        <ul className="ml-1 mt-0.5 text-xs flex flex-col gap-0.5">
          {diff.map((d) => (
            <li key={d.field} className="font-mono text-[11.5px]">
              <span className="text-muted">{d.field}:</span>{" "}
              {d.before !== undefined && (
                <span className="text-warn">{formatAuditValue(d.before)}</span>
              )}
              {d.before !== undefined && d.after !== undefined && (
                <span className="text-line mx-1">→</span>
              )}
              {d.after !== undefined && (
                <span className="text-success">{formatAuditValue(d.after)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ActionBadge({ action, verb }: { action: string; verb: string }) {
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
      {verb}
    </span>
  );
}
