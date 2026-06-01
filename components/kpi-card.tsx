type KpiCardProps = {
  label: string;
  value: string;
  hint?: string;
  variant?: "default" | "ink" | "empty";
};

export function KpiCard({ label, value, hint, variant = "default" }: KpiCardProps) {
  // En dark mode `bg-white dark:bg-paper-2` reventa el contraste. Usamos `paper-2`
  // (que swappea correctamente) para que el card se distinga del `paper`
  // de fondo en ambos modos.
  const surface = {
    default:
      "bg-white dark:bg-paper-2 border-line hover:shadow-[var(--shadow-card-hover)] hover:border-line/80 hover:-translate-y-px",
    ink: "bg-ink border-ink text-paper dark:bg-rail-2 dark:border-rail-2 dark:text-paper hover:shadow-[var(--shadow-card-hover)] hover:-translate-y-px",
    empty: "bg-paper-2 border-line border-dashed",
  }[variant];

  const valueColor =
    variant === "empty"
      ? "text-line"
      : variant === "ink"
        ? "text-paper"
        : "text-ink";

  return (
    <div
      className={`rounded-lg border p-5 transition-all duration-200 ease-out ${surface}`}
    >
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
        {label}
      </p>
      <p
        className={`font-mono text-3xl font-semibold tracking-tight mt-2 tabular-nums ${valueColor}`}
      >
        {value}
      </p>
      {hint && <p className="text-xs mt-2 text-muted">{hint}</p>}
    </div>
  );
}
