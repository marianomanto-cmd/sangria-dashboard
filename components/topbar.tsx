import { Calendar, ChevronDown, Moon } from "lucide-react";

export function Topbar() {
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-white">
      <div className="px-6 h-12 flex items-center gap-4">
        <Breadcrumbs trail={["Sangria", "Dashboard"]} />

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-2.5 py-1 text-xs text-ink hover:bg-paper-2 hover:border-ink-2 transition-colors"
          >
            <Calendar size={13} strokeWidth={2} />
            <span>Abr — Jun 2026</span>
          </button>

          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-2.5 py-1 text-xs text-ink hover:bg-paper-2 hover:border-ink-2 transition-colors"
          >
            <span>Cliente: Todos</span>
            <ChevronDown size={12} strokeWidth={2} />
          </button>

          <button
            type="button"
            aria-label="Cambiar a modo oscuro"
            className="inline-flex items-center justify-center w-7 h-7 rounded-md text-muted hover:bg-paper-2 hover:text-ink transition-colors"
          >
            <Moon size={14} strokeWidth={2} />
          </button>

          <div
            aria-label="Tu cuenta"
            className="w-7 h-7 rounded-full bg-accent shrink-0"
          />
        </div>
      </div>
    </header>
  );
}

function Breadcrumbs({ trail }: { trail: readonly string[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-muted flex items-center gap-1.5">
      {trail.map((segment, i) => {
        const last = i === trail.length - 1;
        return (
          <span key={`${segment}-${i}`} className="flex items-center gap-1.5">
            <span className={last ? "text-ink font-medium" : undefined}>
              {segment}
            </span>
            {!last && <span className="text-stone-300">/</span>}
          </span>
        );
      })}
    </nav>
  );
}
