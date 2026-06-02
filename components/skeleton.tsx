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

// Placeholder genérico de página: header (eyebrow + título) + fila de KPIs +
// un bloque tipo tabla. Lo usa el loading.tsx del grupo (app) como fallback de
// navegación. No intenta calcar cada página — da estructura y feedback para
// que la UI no quede congelada/en blanco.
export function PageSkeleton() {
  return (
    <div className="px-8 py-10 max-w-[1380px] mx-auto w-full" aria-hidden>
      <div className="mb-10">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-72 mt-3" />
        <Skeleton className="h-4 w-96 mt-3" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonKpiCard key={i} />
        ))}
      </div>
      <div className="rounded-lg border border-line bg-white dark:bg-paper-2 overflow-hidden">
        <div className="border-b border-line px-5 py-3">
          <Skeleton className="h-3 w-32" />
        </div>
        <table className="w-full">
          <tbody>
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonRow key={i} cols={6} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
