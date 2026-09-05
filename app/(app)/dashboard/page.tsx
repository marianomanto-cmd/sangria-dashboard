import { PageShell } from "@/components/page-shell";
import { DashboardV2View } from "@/components/dashboard-v2/view";
import { getDashboardV2, type DashboardV2 } from "@/db/queries/dashboard-v2";
import {
  resolveClientFromSearchParams,
  type ResolvedClientFilter,
} from "@/lib/client-filter.server";
import { DEFAULT_LANGUAGE, type Language } from "@/lib/i18n";

type Props = {
  searchParams: Promise<{ client?: string }>;
};

// ════════════════════════════════════════════════════════════════════════════
// Dashboard — tablero de pendientes. Ver db/queries/dashboard-v2.ts para el
// porqué de las cuatro listas y de las tres queries.
//
// NO hay caché, a propósito: la lectura entera es UNA tanda de tres queries,
// así que cachearla ahorraría poco y agrega el modo de falla que ya mordió una
// vez — `unstable_cache` sólo guarda resultados exitosos, así que si el camino
// frío falla, la caché NUNCA se llena y la página queda reintentando el camino
// caro para siempre.
// ════════════════════════════════════════════════════════════════════════════

// 45s, igual que el layout (app/(app)/layout.tsx). NO bajarlo sin bajar también
// el presupuesto de reintentos de db/index.ts: el peor caso de una query ahí
// son 30,3s, y si Vercel mata la función antes de que lleguemos a lanzar el
// error, la instancia se congela con la conexión abierta y esa conexión queda
// colgada en el pooler de Supabase (la "espiral de zombies" documentada en
// db/index.ts). Estuvo en 30 hasta el 05/sep/2026, o sea: por debajo del peor
// caso que el propio código se permite.
export const maxDuration = 45;

const EMPTY: DashboardV2 = {
  pendingBillings: [],
  pendingTracking: [],
  plansPendingQa: [],
  plansPendingApproval: [],
};

// El error que llega de drizzle es un wrapper cuyo `message` es sólo
// "Failed query: <sql>": el motivo real (timeout de conexión, 57014, error de
// postgres) viaja en `cause`, a veces anidado. Sin esto, los logs de prod y el
// cartel de la pantalla muestran la query pero no por qué falló — que es
// exactamente lo único que hacía falta saber.
function describeError(e: unknown): string {
  const parts: string[] = [];
  let cur: unknown = e;
  for (let depth = 0; cur instanceof Error && depth < 4; depth++) {
    parts.push(cur.message);
    cur = (cur as { cause?: unknown }).cause;
  }
  if (parts.length === 0) return String(e);
  return parts.join("\n↳ ");
}

export default async function DashboardPage({ searchParams }: Props) {
  const sp = await searchParams;

  let client: ResolvedClientFilter = null;
  try {
    client = await resolveClientFromSearchParams(sp);
  } catch (e) {
    console.error("DASH[client]:", e instanceof Error ? e.message : e);
  }

  const lang: Language = client?.language ?? DEFAULT_LANGUAGE;

  // Una sola lectura, un solo punto de falla. Si falla, lo decimos: mostrar
  // listas vacías como si no hubiera pendientes es peor que mostrar el error.
  let data = EMPTY;
  let failed: string | null = null;
  try {
    data = await getDashboardV2(client?.id ?? null);
  } catch (e) {
    failed = describeError(e);
    console.error("DASH[data]:", failed);
  }

  const es = lang === "es";
  return (
    <PageShell
      eyebrow="Dashboard"
      title={client ? `Pendientes · ${client.name}` : "Pendientes"}
      subtitle={
        es
          ? "Lo que falta hacer hoy: billings sin cerrar, tracking del día, planes esperando QA y planes esperando firma."
          : "What's left to do today: unbilled months, today's tracking, plans waiting for QA and plans waiting for signature."
      }
    >
      <DashboardV2View data={data} failed={failed} lang={lang} />
    </PageShell>
  );
}
