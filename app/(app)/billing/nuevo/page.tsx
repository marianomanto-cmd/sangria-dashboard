import { PageShell } from "@/components/page-shell";
import { getBillingCandidates } from "@/db/queries/billing";
import { NuevoBillingForm } from "./form";

export default async function NuevoBillingPage() {
  const candidates = await getBillingCandidates();

  return (
    <PageShell
      eyebrow="Billing · Nuevo"
      title="Generar factura"
      subtitle="Seleccioná proyecto + mes con gastos cargados. El sistema arma el draft desde actual_spend × fee_pct del plan."
    >
      {candidates.length === 0 ? (
        <div className="rounded-lg border border-line border-dashed bg-paper-2 px-5 py-12 text-center">
          <p className="text-sm font-medium text-ink-2">
            No hay proyectos con gastos cargados
          </p>
          <p className="text-xs text-muted mt-1">
            Cargá actuals desde un proyecto antes de generar una factura.
          </p>
        </div>
      ) : (
        <NuevoBillingForm candidates={candidates} />
      )}
    </PageShell>
  );
}
