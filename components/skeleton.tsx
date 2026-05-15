// Skeletons reutilizables — usar para SSR placeholders y Suspense
// fallbacks. La animación shimmer está definida en globals.css.

type SkeletonProps = {
  className?: string;
};

export function Skeleton({ className = "" }: SkeletonProps) {
  return <div aria-hidden className={`skeleton rounded ${className}`} />;
}

// Skeleton de fila para tablas — replica el padding y la línea separadora
// para que el placeholder calce visualmente con la tabla real.
export function SkeletonRow({ cols = 6 }: { cols?: number }) {
  return (
    <tr className="border-t border-line-soft">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-5 py-3">
          <Skeleton className="h-3 w-full max-w-[120px]" />
        </td>
      ))}
    </tr>
  );
}

// Skeleton para KPI cards — mantiene la misma altura visual que `KpiCard`
// para evitar layout shift al cargar datos.
export function SkeletonKpiCard() {
  return (
    <div className="rounded-lg border border-line bg-white dark:bg-paper-2 p-5">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-8 w-32 mt-3" />
      <Skeleton className="h-3 w-40 mt-3" />
    </div>
  );
}
