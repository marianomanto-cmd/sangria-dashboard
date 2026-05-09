import { EmptyState, PageShell } from "@/components/page-shell";

export default function GastosPage() {
  return (
    <PageShell
      eyebrow="Gastos Reales"
      title="Carga global de gastos"
      subtitle="Vista cross-proyectos para cargar y revisar gastos del mes"
    >
      <EmptyState
        title="Próximamente"
        hint="Por ahora cargá los gastos desde el tab Gastos Reales de cada proyecto. Acá vendrá la vista consolidada con grilla mensual."
      />
    </PageShell>
  );
}
