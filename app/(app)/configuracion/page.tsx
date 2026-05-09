import { EmptyState, PageShell } from "@/components/page-shell";

export default function ConfiguracionPage() {
  return (
    <PageShell
      eyebrow="Configuración"
      title="Ajustes"
      subtitle="Preferencias de usuario, integraciones y permisos por rol"
    >
      <EmptyState
        title="Próximamente"
        hint="Llega después de Auth (Fase 9). Por ahora la única preferencia persistida es el layout del Dashboard, en localStorage."
      />
    </PageShell>
  );
}
