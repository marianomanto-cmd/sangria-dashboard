import Link from "next/link";
import { ArrowLeft, Trash2 } from "lucide-react";
import { and, desc, eq, inArray } from "drizzle-orm";
import { PageShell } from "@/components/page-shell";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import {
  actorLabel,
  entityLabel,
  entityNoun,
  formatAbsoluteDateTime,
  formatRelativeDateTime,
} from "@/lib/audit-format";

// Las entidades que aparecen en la papelera. Limitado a las que el usuario
// suele borrar a mano (no las del catálogo, ni las cascada-borradas de
// joins internos). Si querés ver TODOS los deletes, /auditoria con
// filtro acción=eliminó.
const TRASH_ENTITIES = [
  "project",
  "media_plan",
  "media_plan_publisher",
  "media_plan_placement",
  "media_plan_fee",
  "publisher",
  "market",
  "metric",
  "budget_origin",
  "client",
] as const;

type Props = {
  searchParams: Promise<{ type?: string }>;
};

export default async function PapeleraPage({ searchParams }: Props) {
  const sp = await searchParams;
  const typeFilter =
    sp.type && (TRASH_ENTITIES as readonly string[]).includes(sp.type)
      ? sp.type
      : null;

  const conds = [eq(auditLog.action, "delete")];
  if (typeFilter) conds.push(eq(auditLog.entityType, typeFilter));
  else conds.push(inArray(auditLog.entityType, [...TRASH_ENTITIES]));

  const rows = await db
    .select()
    .from(auditLog)
    .where(and(...conds))
    .orderBy(desc(auditLog.createdAt))
    .limit(500);

  // Counts por tipo (sobre TODOS los deletes, no sólo los filtrados).
  const allDeletes = await db
    .select({
      entityType: auditLog.entityType,
      id: auditLog.id,
    })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.action, "delete"),
        inArray(auditLog.entityType, [...TRASH_ENTITIES]),
      ),
    );
  const countsByType = new Map<string, number>();
  for (const r of allDeletes) {
    countsByType.set(r.entityType, (countsByType.get(r.entityType) ?? 0) + 1);
  }

  return (
    <PageShell
      eyebrow="Auditoría · Papelera"
      title="Papelera"
      subtitle={`Histórico de items eliminados. ${rows.length} item${rows.length === 1 ? "" : "s"}${typeFilter ? ` · filtro: ${entityNoun(typeFilter).singular}` : ""}. Los datos del item al momento del borrado quedan guardados acá para consulta.`}
    >
      <div className="mb-4 flex items-center gap-2">
        <Link
          href="/auditoria"
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-1.5 text-xs font-medium text-ink hover:bg-paper-2 transition-colors"
        >
          <ArrowLeft size={13} strokeWidth={2} />
          Volver al log
        </Link>
      </div>

      {/* Filtros por tipo */}
      <section className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <FilterPill label="Tipo">
          <FilterChoice
            active={typeFilter === null}
            href="/auditoria/papelera"
            label={`Todos (${allDeletes.length})`}
          />
          {TRASH_ENTITIES.map((e) => {
            const count = countsByType.get(e) ?? 0;
            if (count === 0) return null;
            return (
              <FilterChoice
                key={e}
                active={typeFilter === e}
                href={`/auditoria/papelera?type=${e}`}
                label={`${entityNoun(e).singular} (${count})`}
              />
            );
          })}
        </FilterPill>
      </section>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-line border-dashed bg-paper-2 px-5 py-12 text-center">
          <Trash2 size={28} className="mx-auto text-muted mb-2" strokeWidth={1.5} />
          <p className="text-sm font-medium text-ink-2">La papelera está vacía</p>
          <p className="text-xs text-muted mt-1">
            {typeFilter
              ? "Ningún item de este tipo fue eliminado todavía."
              : "Cuando borres un proyecto, plan, publisher o placement, aparece acá su snapshot."}
          </p>
        </div>
      ) : (
        <>
        {/* Desktop: tabla. Mobile: tarjetas (abajo). */}
        <section className="hidden lg:block rounded-lg border border-line bg-white dark:bg-paper-2 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-paper">
              <tr className="text-[11px] uppercase tracking-[0.06em] text-muted">
                <th className="text-left font-medium px-5 py-2.5">Tipo</th>
                <th className="text-left font-medium px-5 py-2.5">Nombre</th>
                <th className="text-left font-medium px-5 py-2.5">Eliminado por</th>
                <th className="text-left font-medium px-5 py-2.5">Cuándo</th>
                <th className="text-left font-medium px-5 py-2.5">Detalle</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const noun = entityNoun(row.entityType);
                const label = entityLabel(
                  row.entityType,
                  row.beforeJson,
                  row.afterJson,
                );
                const actor = actorLabel(row.userEmail, row.userId);
                const relative = formatRelativeDateTime(row.createdAt);
                const absolute = formatAbsoluteDateTime(row.createdAt);
                const detail = extractDetail(row.entityType, row.beforeJson);
                return (
                  <tr
                    key={row.id}
                    className="border-t border-line-soft hover:bg-paper-2 transition-colors"
                  >
                    <td className="px-5 py-2.5">
                      <span className="text-ink-2">{noun.singular}</span>
                    </td>
                    <td className="px-5 py-2.5">
                      <span className="font-medium text-ink">
                        {label ?? <span className="text-muted">— sin nombre —</span>}
                      </span>
                      <div className="font-mono text-[10px] text-muted">
                        {row.entityId.slice(0, 8)}…
                      </div>
                    </td>
                    <td className="px-5 py-2.5">
                      <span className="text-ink-2">{actor}</span>
                    </td>
                    <td
                      className="px-5 py-2.5 font-mono text-[12px] text-ink-2"
                      title={absolute}
                    >
                      {relative}
                    </td>
                    <td className="px-5 py-2.5 text-xs text-muted max-w-[420px]">
                      {detail.length === 0 ? (
                        "—"
                      ) : (
                        <ul className="space-y-0.5">
                          {detail.map((d) => (
                            <li key={d.label}>
                              <span className="text-muted">{d.label}:</span>{" "}
                              <span className="text-ink-2">{d.value}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
        {/* Mobile: tarjetas */}
        <div className="lg:hidden rounded-lg border border-line bg-white dark:bg-paper-2 divide-y divide-line-soft overflow-hidden">
          {rows.map((row) => {
            const noun = entityNoun(row.entityType);
            const label = entityLabel(
              row.entityType,
              row.beforeJson,
              row.afterJson,
            );
            const actor = actorLabel(row.userEmail, row.userId);
            const relative = formatRelativeDateTime(row.createdAt);
            const absolute = formatAbsoluteDateTime(row.createdAt);
            const detail = extractDetail(row.entityType, row.beforeJson);
            return (
              <div key={row.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">
                      {label ?? <span className="text-muted">— sin nombre —</span>}
                    </p>
                    <p className="font-mono text-[10px] text-muted">
                      {noun.singular} · {row.entityId.slice(0, 8)}…
                    </p>
                  </div>
                  <span
                    className="font-mono text-[11px] text-ink-2 shrink-0"
                    title={absolute}
                  >
                    {relative}
                  </span>
                </div>
                <p className="text-[11px] text-muted mt-1">{actor}</p>
                {detail.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-xs">
                    {detail.map((d) => (
                      <li key={d.label}>
                        <span className="text-muted">{d.label}:</span>{" "}
                        <span className="text-ink-2">{d.value}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
        </>
      )}

      <p className="mt-4 text-[11px] text-muted">
        Nota: por ahora la papelera es <b>consulta histórica</b> — no hay
        botón de restaurar. Los datos quedan guardados en el log de
        auditoría para poder reconstruir manualmente lo que se borró.
      </p>
    </PageShell>
  );
}

// Saca campos relevantes del beforeJson según el tipo de entidad para
// mostrar detalle en la tabla. Mantenemos esto chico: 2-3 campos clave.
function extractDetail(
  entityType: string,
  beforeJson: unknown,
): Array<{ label: string; value: string }> {
  if (!beforeJson || typeof beforeJson !== "object") return [];
  const o = beforeJson as Record<string, unknown>;
  const get = (k: string) =>
    typeof o[k] === "string" || typeof o[k] === "number"
      ? String(o[k])
      : null;

  switch (entityType) {
    case "project": {
      const code = get("code");
      const status = get("status");
      const budget = get("totalGrossBudgetUsd");
      return [
        code ? { label: "código", value: code } : null,
        status ? { label: "estado", value: status } : null,
        budget ? { label: "presupuesto", value: `$${budget}` } : null,
      ].filter((x): x is { label: string; value: string } => x !== null);
    }
    case "media_plan": {
      const status = get("status");
      const ver = get("currentVersion");
      return [
        status ? { label: "estado", value: status } : null,
        ver ? { label: "versión", value: `v${ver}` } : null,
      ].filter((x): x is { label: string; value: string } => x !== null);
    }
    case "media_plan_placement": {
      const amt = get("amountUsd");
      const cm = get("costMethod");
      const start = get("startDate");
      const end = get("endDate");
      return [
        amt ? { label: "monto", value: `$${amt}` } : null,
        cm ? { label: "cost method", value: cm } : null,
        start && end ? { label: "período", value: `${start} → ${end}` } : null,
      ].filter((x): x is { label: string; value: string } => x !== null);
    }
    case "media_plan_publisher": {
      const total = get("totalPlannedUsd");
      return total ? [{ label: "total planeado", value: `$${total}` }] : [];
    }
    case "media_plan_fee": {
      const type = get("feeType");
      const amt = get("amountUsd");
      return [
        type ? { label: "tipo", value: type } : null,
        amt ? { label: "monto", value: `$${amt}` } : null,
      ].filter((x): x is { label: string; value: string } => x !== null);
    }
    case "publisher":
    case "market":
    case "metric":
    case "client":
    case "budget_origin": {
      const slug = get("slug");
      return slug ? [{ label: "slug", value: slug }] : [];
    }
    default:
      return [];
  }
}

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
  active,
  href,
  label,
}: {
  active: boolean;
  href: string;
  label: string;
}) {
  return (
    <Link
      href={href}
      data-active={active}
      className="px-2 py-0.5 rounded text-muted hover:text-ink data-[active=true]:bg-white dark:data-[active=true]:bg-paper-2 dark:bg-paper-2 data-[active=true]:text-ink data-[active=true]:shadow-sm transition-colors"
    >
      {label}
    </Link>
  );
}
