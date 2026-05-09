type SangriaMarkProps = {
  size?: number;
  className?: string;
};

export function SangriaMark({ size = 22, className = "" }: SangriaMarkProps) {
  return (
    <span
      aria-hidden
      className={`inline-block rounded-full shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        background:
          "radial-gradient(circle at 35% 35%, #b03a5b 0%, var(--color-accent) 55%, var(--color-accent-strong) 100%)",
        boxShadow: "inset -2px -3px 6px rgba(0,0,0,0.25)",
      }}
    />
  );
}
