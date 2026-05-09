import Link from "next/link";
import type { BudgetOriginOption } from "@/db/queries/budget-origins";

type Props = {
  origins: BudgetOriginOption[];
  current: string | null;
  basePath: string; // e.g., "/proyectos" o "/planes"
  // Otras searchParams a preservar al navegar (ej. status=draft en /planes)
  preserveParams?: Record<string, string | undefined>;
};

export function BudgetOriginSelector({
  origins,
  current,
  basePath,
  preserveParams = {},
}: Props) {
  if (origins.length === 0) return null;

  // Multi-cliente: agrupar por cliente
  const byClient = new Map<string, BudgetOriginOption[]>();
  for (const o of origins) {
    const list = byClient.get(o.clientName) ?? [];
    list.push(o);
    byClient.set(o.clientName, list);
  }
  const showClientPrefix = byClient.size > 1;

  const buildHref = (originId: string | null): string => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(preserveParams)) {
      if (v !== undefined) params.set(k, v);
    }
    if (originId) params.set("origin", originId);
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  return (
    <div className="mb-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted mb-2">
        Budget Origin
      </p>
      <div className="inline-flex flex-wrap items-center gap-1 border border-line rounded-md p-0.5 bg-paper-2">
        <OriginPill
          href={buildHref(null)}
          isActive={current === null}
          label="Todos"
        />
        {origins.map((o) => (
          <OriginPill
            key={o.id}
            href={buildHref(o.id)}
            isActive={current === o.id}
            label={showClientPrefix ? `${o.clientName} · ${o.name}` : o.name}
            colorHex={o.colorHex}
          />
        ))}
      </div>
    </div>
  );
}

function OriginPill({
  href,
  isActive,
  label,
  colorHex,
}: {
  href: string;
  isActive: boolean;
  label: string;
  colorHex?: string | null;
}) {
  return (
    <Link
      href={href}
      data-active={isActive}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-muted hover:text-ink data-[active=true]:bg-white data-[active=true]:text-ink data-[active=true]:shadow-sm transition-colors"
    >
      {colorHex && (
        <span
          aria-hidden
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{ background: colorHex }}
        />
      )}
      {label}
    </Link>
  );
}
