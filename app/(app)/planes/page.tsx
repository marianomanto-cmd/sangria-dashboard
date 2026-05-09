import { EmptyState, PageShell } from "@/components/page-shell";

export default function PlanesPage() {
  return (
    <PageShell
      eyebrow="Planes de Medios"
      title="Planes vigentes"
      subtitle="Vista cross-proyectos de todos los planes activos"
    >
      <EmptyState
        title="Próximamente"
        hint="Por ahora accedé al plan desde la vista del proyecto. Esta vista agregará planes de todos los proyectos para revisión global."
      />
    </PageShell>
  );
}
