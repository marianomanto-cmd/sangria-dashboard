import Link from "next/link";
import { PageShell } from "@/components/page-shell";
import { SimulatorClient } from "@/components/simulator/simulator-client";
import {
  getBenchmarks,
  getSimulatorCatalogs,
  listScenarios,
} from "@/db/queries/simulator";
import { resolveClientFromSearchParams } from "@/lib/client-filter.server";

type Props = {
  searchParams: Promise<{ client?: string | string[] }>;
};

export default async function SimuladorPage({ searchParams }: Props) {
  const sp = await searchParams;
  const client = await resolveClientFromSearchParams(sp);

  // Sin cliente seleccionado: el simulador es por cliente (escenarios y
  // markets viven en ese scope). Mostramos un empty state que invita a
  // elegir cliente desde el topbar.
  if (!client) {
    return (
      <PageShell
        eyebrow="Simulador"
        title="Elegí un cliente"
        subtitle="El simulador trabaja sobre la data histórica de un cliente y guarda los escenarios en su scope. Seleccioná un cliente en el filtro superior para empezar."
      >
        <div className="rounded-lg border border-dashed border-line bg-paper-2 p-8 text-center">
          <p className="text-sm text-muted">
            Una vez que filtres por cliente vas a ver:
          </p>
          <ul className="text-xs text-muted mt-3 space-y-1 max-w-md mx-auto text-left list-disc list-inside">
            <li>
              <strong className="text-ink-2">Benchmarks</strong> agregados de
              CPM/CPC/CPV/CTR por publisher × mercado × cost method.
            </li>
            <li>
              Un <strong className="text-ink-2">builder de escenarios</strong>{" "}
              que autocompleta métricas esperadas usando esos benchmarks.
            </li>
            <li>
              <strong className="text-ink-2">Comparativa</strong> lado a lado
              de hasta 3 escenarios.
            </li>
          </ul>
          <Link
            href="/reportes"
            className="inline-block mt-6 text-xs text-accent hover:underline"
          >
            ← Volver a Reportes
          </Link>
        </div>
      </PageShell>
    );
  }

  // Carga inicial: benchmarks sin filtros adicionales + catálogos + lista de
  // escenarios. El cliente filtra/refresca interactivamente.
  const [benchmarks, catalogs, scenarios] = await Promise.all([
    getBenchmarks({ clientId: client.id }),
    getSimulatorCatalogs(client.id),
    listScenarios(client.id),
  ]);

  return (
    <PageShell
      eyebrow="Simulador"
      title={client.name}
      subtitle="Benchmarks históricos · Builder · Comparativa"
      compact
    >
      <SimulatorClient
        clientId={client.id}
        initialBenchmarks={benchmarks}
        catalogs={catalogs}
        initialScenarios={scenarios}
      />
    </PageShell>
  );
}
