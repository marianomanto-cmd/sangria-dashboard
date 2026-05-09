type SparklineProps = {
  values: number[];
  width?: number;
  height?: number;
  barWidth?: number;
  gap?: number;
  className?: string;
};

export function Sparkline({
  values,
  height = 22,
  barWidth = 4,
  gap = 2,
  className = "",
}: SparklineProps) {
  if (values.length === 0 || values.every((v) => v === 0)) {
    return (
      <span className="text-stone-300 font-mono text-xs">—</span>
    );
  }

  const max = Math.max(...values);
  const totalWidth = values.length * (barWidth + gap) - gap;

  return (
    <svg
      width={totalWidth}
      height={height}
      className={`inline-block align-middle ${className}`}
      aria-hidden
    >
      {values.map((v, i) => {
        const h = max > 0 ? Math.max((v / max) * height, v > 0 ? 1 : 0) : 0;
        return (
          <rect
            key={i}
            x={i * (barWidth + gap)}
            y={height - h}
            width={barWidth}
            height={h}
            rx={1}
            className="fill-ink"
          />
        );
      })}
    </svg>
  );
}
