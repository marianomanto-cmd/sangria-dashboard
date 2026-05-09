type KpiCardProps = {
  label: string;
  value: string;
  hint?: string;
  variant?: "default" | "ink" | "empty";
};

export function KpiCard({ label, value, hint, variant = "default" }: KpiCardProps) {
  const surface = {
    default: "bg-white border-line",
    ink: "bg-ink border-ink text-white",
    empty: "bg-paper-2 border-line border-dashed",
  }[variant];

  const labelColor = variant === "ink" ? "text-stone-400" : "text-muted";
  const valueColor =
    variant === "empty" ? "text-stone-300" : variant === "ink" ? "text-white" : "text-ink";
  const hintColor = variant === "ink" ? "text-stone-400" : "text-muted";

  return (
    <div className={`rounded-lg border p-5 ${surface}`}>
      <p
        className={`text-[11px] font-medium uppercase tracking-[0.08em] ${labelColor}`}
      >
        {label}
      </p>
      <p
        className={`font-mono text-3xl font-semibold tracking-tight mt-2 ${valueColor}`}
      >
        {value}
      </p>
      {hint && <p className={`text-xs mt-2 ${hintColor}`}>{hint}</p>}
    </div>
  );
}
