import Link from "next/link";
import { PageShell } from "@/components/page-shell";
import { MarketAnalysis } from "@/components/market-analysis";
import {
  getAnalysisFilterOptions,
  getMarketActivations,
} from "@/db/queries/analysis";
import { resolveClientFromSearchParams } from "@/lib/client-filter.server";
import { DEFAULT_LANGUAGE, type Language } from "@/lib/i18n";

type SearchParams = {
  client?: string | string[];
  pub?: string;
  mkt?: string;
  bo?: string;
  from?: string;
  to?: string;
};

export default async function AnalisisPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const client = await resolveClientFromSearchParams(sp);
  const lang: Language = client?.language ?? DEFAULT_LANGUAGE;

  if (!client) {
    return (
      <PageShell
        eyebrow="Análisis"
        title="Elegí un cliente"
        subtitle="El análisis por publisher y mercado trabaja sobre los planes aprobados de un cliente. Seleccioná un cliente en el filtro superior para empezar."
      >
        <div className="rounded-lg border border-dashed border-line bg-paper-2 p-8 text-center text-sm text-muted">
          Una vez que filtres por cliente vas a ver el mapa de activaciones por
          mercado y el detalle filtrable por publisher, mercado y período.
          <div className="mt-4">
            <Link href="/" className="text-xs text-accent hover:underline">
              ← Volver al dashboard
            </Link>
          </div>
        </div>
      </PageShell>
    );
  }

  const list = (v: string | undefined) =>
    v ? v.split(",").filter(Boolean) : null;

  const [data, options] = await Promise.all([
    getMarketActivations({
      clientId: client.id,
      publisherIds: list(sp.pub),
      marketIds: list(sp.mkt),
      budgetOriginIds: list(sp.bo),
      fromMonth: sp.from || null,
      toMonth: sp.to || null,
    }),
    getAnalysisFilterOptions(client.id),
  ]);

  return (
    <PageShell
      eyebrow="Análisis"
      title={`${client.name} · activaciones por mercado`}
      subtitle="Mapa de América con la inversión por mercado y el detalle de activaciones (placements de planes aprobados). Filtrá por publisher, mercado, budget origin y período."
    >
      <MarketAnalysis
        rows={data.rows}
        markets={data.markets}
        options={options}
        lang={lang}
      />
    </PageShell>
  );
}
