import Link from "next/link";
import type { Language } from "@/lib/i18n";

// Primitivas visuales del dashboard. Todas server components: no mandan nada
// al bundle del browser.

export function Kpi({
  label,
  value,
  hint,
  accent = false,
  bar,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
  bar?: number;
}) {
  return (
    <div
      className={`rounded-lg border p-5 ${
        accent
          ? "border-transparent bg-ink text-white"
          : "border-line bg-white dark:bg-paper-2"
      }`}
    >
      <p
        className={`text-[11px] uppercase tracking-[0.08em] font-medium ${
          accent ? "text-white/60" : "text-muted"
        }`}
      >
        {label}
      </p>
      <p className="text-3xl font-semibold mt-2 tabular-nums">{value}</p>
      {bar !== undefined && <Progress pct={bar} onDark={accent} />}
      {hint && (
        <p className={`text-xs mt-1 ${accent ? "text-white/60" : "text-muted"}`}>
          {hint}
        </p>
      )}
    </div>
  );
}

export function Progress({ pct, onDark = false }: { pct: number; onDark?: boolean }) {
  const over = pct > 100;
  return (
    <div
      className={`h-1.5 rounded-full overflow-hidden mt-2 ${
        onDark ? "bg-white/15" : "bg-paper-2"
      }`}
    >
      <div
        className={`h-full rounded-full ${
          over ? "bg-danger" : onDark ? "bg-white" : "bg-accent"
        }`}
        style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }}
      />
    </div>
  );
}

// Sparkline de barras. El dashboard viejo lo usaba para el gasto mensual de
// cada cliente y de cada proyecto; acá se reusa para los dos.
export function Sparkline({
  values,
  className = "",
  barClass = "bg-accent/70",
}: {
  values: number[];
  className?: string;
  barClass?: string;
}) {
  if (values.length === 0) return null;
  const max = Math.max(1, ...values);
  return (
    <div className={`flex items-end gap-[2px] h-8 ${className}`} aria-hidden>
      {values.map((v, i) => (
        <span
          key={i}
          className={`flex-1 rounded-sm ${barClass}`}
          style={{ height: `${Math.max(6, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

// Badge con las iniciales del cliente.
export function ClientMark({ mark }: { mark: string }) {
  return (
    <span className="w-8 h-8 rounded-md bg-paper-2 border border-line flex items-center justify-center text-[10px] font-semibold tracking-wide text-ink-2 shrink-0">
      {mark}
    </span>
  );
}

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

// Fila de pendiente. Es un LINK al detalle: el dashboard viejo permitía saltar
// desde cada pendiente a la pantalla donde se resuelve, y sin eso el tablero
// obliga a buscar la cosa a mano.
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

// Chips de filtro por cliente. El dashboard viejo los tenía arriba de la vista
// de cuentas y son la forma más rápida de pasar de la cartera a un cliente.
export function ClientFilter({
  clients,
  current,
  lang,
}: {
  clients: { slug: string; name: string }[];
  current: string | null;
  lang: Language;
}) {
  if (clients.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      <Chip href="/dashboard" label={lang === "es" ? "Todos" : "All"} on={!current} />
      {clients.map((c) => (
        <Chip
          key={c.slug}
          href={`/dashboard?client=${encodeURIComponent(c.slug)}`}
          label={c.name}
          on={current === c.slug}
        />
      ))}
    </div>
  );
}

function Chip({ href, label, on }: { href: string; label: string; on: boolean }) {
  return (
    <Link
      href={href}
      prefetch={false}
      className={`px-3 py-1 rounded-full text-xs border transition-colors ${
        on
          ? "bg-ink text-white border-ink"
          : "border-line text-muted hover:text-ink hover:border-ink-2"
      }`}
    >
      {label}
    </Link>
  );
}
