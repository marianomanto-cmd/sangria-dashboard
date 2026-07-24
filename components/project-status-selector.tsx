import Link from "next/link";
import { type Language, t } from "@/lib/i18n";

// Filtro de estado del proyecto (pills, URL-based, server component — mismo
// patrón que YearSelector). `current` = estado seleccionado, o null = "Todos".
// Los colores de dot espejan StatusBadge. Preserva el resto de los filtros.
const STATUSES = [
  { value: "planning", dot: "bg-info" },
  { value: "active", dot: "bg-success" },
  { value: "paused", dot: "bg-warn" },
  { value: "closed", dot: "bg-muted" },
  { value: "reportado", dot: "bg-accent" },
] as const;

// Estados válidos para el filtro — usable también por la página para validar el
// searchParam antes de filtrar.
export const PROJECT_STATUS_VALUES = STATUSES.map((s) => s.value);

type Props = {
  current: string | null; // estado seleccionado, o null = todos
  basePath: string;
  preserveParams?: Record<string, string | undefined>;
  lang: Language;
};

export function ProjectStatusSelector({
  current,
  basePath,
  preserveParams = {},
  lang,
}: Props) {
  const buildHref = (status: string | null): string => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(preserveParams)) {
      if (v !== undefined) params.set(k, v);
    }
    if (status) params.set("status", status);
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  return (
    <div className="inline-flex flex-wrap items-center gap-1 px-2 py-1 rounded-md bg-paper-2 border border-line">
      <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted mr-1">
        {lang === "es" ? "Estado" : "Status"}
      </span>
      <div className="flex flex-wrap items-center gap-0.5">
        <StatusChoice
          href={buildHref(null)}
          label={lang === "es" ? "Todos" : "All"}
          active={current === null}
        />
        {STATUSES.map((s) => (
          <StatusChoice
            key={s.value}
            href={buildHref(s.value)}
            label={t(`status.${s.value}`, lang)}
            dot={s.dot}
            active={current === s.value}
          />
        ))}
      </div>
    </div>
  );
}

function StatusChoice({
  href,
  label,
  dot,
  active,
}: {
  href: string;
  label: string;
  dot?: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      data-active={active}
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs capitalize text-muted hover:text-ink data-[active=true]:bg-white dark:data-[active=true]:bg-paper data-[active=true]:text-ink data-[active=true]:shadow-sm transition-colors"
    >
      {dot && (
        <span
          aria-hidden
          className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`}
        />
      )}
      {label}
    </Link>
  );
}
