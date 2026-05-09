import { EmptyState, PageShell } from "@/components/page-shell";

export default function BillingPage() {
  return (
    <PageShell
      eyebrow="Billing"
      title="Generador de facturas"
      subtitle="Cierre mensual: gastos reales × fee → factura por proyecto + budget origin"
    >
      <EmptyState
        title="Próximamente"
        hint="Fase 7 del prompt. Selector de proyecto + mes, cálculo automático desde gastos, editor de líneas, generación de PDF."
      />
    </PageShell>
  );
}
