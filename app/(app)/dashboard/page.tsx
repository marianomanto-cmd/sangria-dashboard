import { PageShell } from "@/components/page-shell";
import { DashboardV2View } from "@/components/dashboard-v2/view";
import { getDashboardV2, type DashboardV2 } from "@/db/queries/dashboard-v2";
import {
  resolveClientFromSearchParams,
  type ResolvedClientFilter,
} from "@/lib/client-filter.server";

type Props = {
  searchParams: Promise<{ client?: string }>;
};

// ════════════════════════════════════════════════════════════════════════════
// Dashboard v2 — cableado de cero (ver db/queries/dashboard-v2.ts).
//
// A diferencia del dashboard viejo, acá NO hay caché. Es a propósito: la
// lectura entera es UNA tanda de 4 queries, así que cachearla ahorraría poco y
// agrega el modo de falla que nos mordió toda la noche — `unstable_cache` sólo
// guarda resultados exitosos, así que si el camino frío falla, la caché NUNCA
// se llena y la página queda reintentando el camino caro para siempre.
//
// Si más adelante se demuestra que hace falta, se cachea con su tag como el
// resto (ver README → "Caché de lecturas e invalidación"). Primero que ande.
// ════════════════════════════════════════════════════════════════════════════

export const maxDuration = 30;

const EMPTY: DashboardV2 = {
  kpis: {
    pipelineActiveUsd: 0,
    activeClients: 0,
    invoicedYtdUsd: 0,
    consumptionPct: 0,
  },
  projects: [],
  clients: [],
  monthly: [],
  plansInFlight: [],
  pendingBillings: [],
  pendingReports: [],
  receivables: [],
  staleTracking: [],
};

export default async function DashboardV2Page({ searchParams }: Props) {
  const sp = await searchParams;

  let client: ResolvedClientFilter = null;
  try {
    client = await resolveClientFromSearchParams(sp);
  } catch (e) {
    console.error("DASH2[client]:", e instanceof Error ? e.message : e);
  }

  // Una sola lectura, un solo punto de falla. Si falla, lo decimos: mostrar
  // ceros como si fueran datos reales es peor que mostrar el error.
  let data = EMPTY;
  let failed: string | null = null;
  try {
    data = await getDashboardV2(client?.id ?? null);
  } catch (e) {
    failed = e instanceof Error ? e.message : String(e);
    console.error("DASH2[data]:", failed);
  }

  return (
    <PageShell
      eyebrow="Dashboard"
      title={client ? `Dashboard · ${client.name}` : "Dashboard"}
      subtitle="Estado de la cartera: presupuesto comprometido, facturación real por mes y planes en curso."
    >
      <DashboardV2View data={data} failed={failed} />
    </PageShell>
  );
}
