import Link from "next/link";

// Primitivas visuales del tablero de pendientes. Todas server components: no
// mandan nada al bundle del browser.
//
// Acá vivían también Kpi, Progress, Sparkline, ClientMark y ClientFilter, que
// alimentaban los KPIs, el gráfico y la tabla de proyectos del dashboard
// anterior. Se fueron con ellos (ver db/queries/dashboard-v2.ts). El filtro por
// cliente no se perdió: lo sirve el selector global del topbar, que está en
// todas las pantallas.

export function Panel({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count?: number;
  action?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-line overflow-hidden">
      <header className="px-5 py-3.5 border-b border-line bg-paper-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">
          {title}
          {count !== undefined && count > 0 && (
            <span className="ml-2 text-xs font-normal text-muted tabular-nums">
              {count}
            </span>
          )}
        </h2>
        {action && (
          <Link
            href={action.href}
            prefetch={false}
            className="text-xs text-accent hover:underline shrink-0"
          >
            {action.label} →
          </Link>
        )}
      </header>
      {children}
    </section>
  );
}

export type Tone = "danger" | "warn" | "ok";

export function StatusDot({ tone }: { tone: Tone }) {
  const color =
    tone === "danger" ? "bg-danger" : tone === "warn" ? "bg-warn" : "bg-success";
  return <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${color}`} />;
}

// Fila de pendiente. Es un LINK al detalle: sin eso el tablero dice qué falta
// pero obliga a buscar la cosa a mano.
export function PendingRow({
  href,
  title,
  sub,
  badge,
  tone,
}: {
  href: string;
  title: string;
  sub: string;
  badge?: string;
  tone?: Tone;
}) {
  return (
    <li>
      <Link
        href={href}
        prefetch={false}
        className="px-5 py-3 flex items-center justify-between gap-3 bg-white dark:bg-paper-2 hover:bg-paper-2 transition-colors group"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {tone && <StatusDot tone={tone} />}
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-ink truncate group-hover:text-accent">
              {title}
            </p>
            <p className="text-xs text-muted truncate">{sub}</p>
          </div>
        </div>
        {badge && (
          <span
            className={`text-[11px] tabular-nums shrink-0 ${
              tone === "danger"
                ? "text-danger font-medium"
                : tone === "warn"
                  ? "text-warn font-medium"
                  : "text-muted"
            }`}
          >
            {badge}
          </span>
        )}
      </Link>
    </li>
  );
}

export function EmptyRow({ text }: { text: string }) {
  return <p className="px-5 py-8 text-center text-[13px] text-muted">{text}</p>;
}
