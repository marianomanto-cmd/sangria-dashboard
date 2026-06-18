import Link from "next/link";
import type { Language } from "@/lib/i18n";

// Selector de año (pills, URL-based) para las tabs de Planes y Proyectos.
// `current` = año seleccionado, o null = "Todos". El año actual usa URL limpia
// (sin param) porque es el default. Preserva el resto de los filtros.
type Props = {
  years: number[]; // disponibles, ya ordenados desc
  current: number | null;
  currentYear: number;
  basePath: string;
  preserveParams?: Record<string, string | undefined>;
  lang: Language;
};

export function YearSelector({
  years,
  current,
  currentYear,
  basePath,
  preserveParams = {},
  lang,
}: Props) {
  const buildHref = (y: number | "all"): string => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(preserveParams)) {
      if (v !== undefined) params.set(k, v);
    }
    if (y === "all") params.set("year", "all");
    else if (y !== currentYear) params.set("year", String(y)); // actual → sin param
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  return (
    <div className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-paper-2 border border-line">
      <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted mr-1">
        {lang === "es" ? "Año" : "Year"}
      </span>
      <div className="flex items-center gap-0.5">
        {years.map((y) => (
          <YearChoice
            key={y}
            href={buildHref(y)}
            label={String(y)}
            active={current === y}
          />
        ))}
        <YearChoice
          href={buildHref("all")}
          label={lang === "es" ? "Todos" : "All"}
          active={current === null}
        />
      </div>
    </div>
  );
}

function YearChoice({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      data-active={active}
      className="px-2 py-0.5 rounded text-xs text-muted hover:text-ink data-[active=true]:bg-white dark:data-[active=true]:bg-paper-2 dark:bg-paper-2 data-[active=true]:text-ink data-[active=true]:shadow-sm transition-colors"
    >
      {label}
    </Link>
  );
}
