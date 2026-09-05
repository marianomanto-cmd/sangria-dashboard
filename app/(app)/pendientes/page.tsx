import { PageShell } from "@/components/page-shell";
import { PendientesView } from "@/components/pendientes/view";
import { getPendientes, type Pendientes } from "@/db/queries/pendientes";
import {
  resolveClientFromSearchParams,
  type ResolvedClientFilter,
} from "@/lib/client-filter.server";
import { DEFAULT_LANGUAGE, type Language } from "@/lib/i18n";

type Props = {
  searchParams: Promise<{ client?: string }>;
};

// ════════════════════════════════════════════════════════════════════════════
// PENDIENTES (`/pendientes`) — la pantalla de entrada de la app. Ver
// db/queries/pendientes.ts para el porqué de las cuatro listas y de las tres
// queries, y next.config.ts para el redirect de `/dashboard`, que es donde
// vivía cuando se llamaba así.
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

const EMPTY: Pendientes = {
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

export default async function PendientesPage({ searchParams }: Props) {
  const sp = await searchParams;

  let client: ResolvedClientFilter = null;
  try {
    client = await resolveClientFromSearchParams(sp);
  } catch (e) {
    console.error("PEND[client]:", e instanceof Error ? e.message : e);
  }

  const lang: Language = client?.language ?? DEFAULT_LANGUAGE;

  // Una sola lectura, un solo punto de falla. Si falla, lo decimos: mostrar
  // listas vacías como si no hubiera pendientes es peor que mostrar el error.
  let data = EMPTY;
  let failed: string | null = null;
  try {
    data = await getPendientes(client?.id ?? null);
  } catch (e) {
    failed = describeError(e);
    console.error("PEND[data]:", failed);
  }

  const es = lang === "es";

  // El subtítulo cuenta lo que hay. Si la lectura falló, `data` es EMPTY y un
  // "0 pendientes" sería mentira que además contradice al cartel de error, así
  // que ahí se muestra la descripción a secas.
  const total =
    data.pendingBillings.length +
    data.pendingTracking.length +
    data.plansPendingQa.length +
    data.plansPendingApproval.length;
  const descripcion = es
    ? "Billings sin cerrar, tracking del día, planes esperando QA y planes esperando firma."
    : "Unbilled months, today's tracking, plans waiting for QA and plans waiting for signature.";
  const subtitle = failed
    ? descripcion
    : total === 0
      ? es
        ? `No queda nada pendiente. ${descripcion}`
        : `Nothing pending. ${descripcion}`
      : es
        ? `${total} cosa${total === 1 ? "" : "s"} para resolver. ${descripcion}`
        : `${total} thing${total === 1 ? "" : "s"} to resolve. ${descripcion}`;

  return (
    <PageShell
      eyebrow="Pendientes"
      title={client ? `Pendientes · ${client.name}` : "Pendientes"}
      subtitle={subtitle}
    >
      <PendientesView data={data} failed={failed} lang={lang} />
    </PageShell>
  );
}
