// ════════════════════════════════════════════════════════════════════════════
// Envoltorios cacheados de las lecturas MÁS pesadas de la app.
//
// Por qué existe este módulo: `getDashboardProjects` sola son 12 round-trips a
// la DB, y la usan DOS de las rutas más cargadas (`/` y `/proyectos`). Sin
// caché, cada carga de cualquiera de las dos abre y ocupa conexiones del pooler
// de Supabase — que es el recurso escaso (ver README → "Pool de conexiones").
// Con caché, la segunda carga y las siguientes hacen CERO queries.
//
// Antes esto vivía inline en `app/(app)/page.tsx`, así que `/proyectos` pagaba
// el costo completo aunque el dashboard ya tuviera la misma data cacheada.
//
// ── Staleness e invalidación ────────────────────────────────────────────────
//
// El TTL NO es el mecanismo de frescura: las server actions invalidan su tag
// con `updateTag(...)` apenas mutan (ver lib/cache-tags.ts). El TTL es sólo la
// red de seguridad para lo que se nos escape.
//
// Por eso es largo. Con TTL corto, cada expiración manda a UN usuario por el
// camino frío —el fan-out completo contra la DB—, y si en ese momento el pooler
// está apretado, ese usuario ve la vista rota. Es exactamente lo que pasaba con
// 60s. Con 10 minutos + invalidación explícita, el camino frío es raro y la
// data igual se actualiza al instante cuando alguien cambia algo.
//
// `updateTag` (no `revalidateTag`) porque en Next 16 revalidateTag(tag,"max")
// es stale-while-revalidate: seguiría mostrando el valor viejo justo después de
// editarlo. Ver lib/cache-tags.ts.
// ════════════════════════════════════════════════════════════════════════════

import { unstable_cache } from "next/cache";
import {
  getDashboardKpis,
  getDashboardProjects,
  getMonthlyTotals,
} from "@/db/queries/dashboard";
import { getDashboardPendings } from "@/db/queries/pendings";
import { listAllBudgetOrigins } from "@/db/queries/budget-origins";
import { getReportingCalendar, getSentReports } from "@/db/queries/reports";
import { getClientOptions } from "@/db/queries/clients";
import { getCampaignTrackerHub, type CampaignHubFilter } from "@/db/queries/campaign-tracker";
import { listBudgetOriginsForClient } from "@/db/queries/budget-origins";
import { getBillingFilterOptions } from "@/db/queries/billing";

export {
  ANALYSIS_TAG,
  BILLING_TAG,
  CATALOG_TAG,
  DASHBOARD_TAG,
  PLANS_TAG,
  REPORTS_TAG,
  TRACKER_TAG,
} from "@/lib/cache-tags";

import {
  BILLING_TAG,
  CATALOG_TAG,
  DASHBOARD_TAG,
  REPORTS_TAG,
  TRACKER_TAG,
} from "@/lib/cache-tags";

const REVALIDATE = 600;

export const cachedKpis = unstable_cache(
  (clientId: string | null) => getDashboardKpis({ clientId }),
  ["dash-kpis-v1"],
  { revalidate: REVALIDATE, tags: [DASHBOARD_TAG] },
);

// Keyada por clientId + budgetOriginId: `/` la pide sin origin y `/proyectos`
// filtrada, y son entradas distintas del caché.
export const cachedProjects = unstable_cache(
  (clientId: string | null, budgetOriginId: string | null = null) =>
    getDashboardProjects({ clientId, budgetOriginId }),
  ["dash-projects-v2"],
  { revalidate: REVALIDATE, tags: [DASHBOARD_TAG] },
);

export const cachedMonthly = unstable_cache(
  (clientId: string | null) => getMonthlyTotals({ clientId }),
  ["dash-monthly-v1"],
  { revalidate: REVALIDATE, tags: [DASHBOARD_TAG] },
);

export const cachedPendings = unstable_cache(
  (clientId: string | null) => getDashboardPendings(clientId),
  ["dash-pendings-v1"],
  { revalidate: REVALIDATE, tags: [DASHBOARD_TAG] },
);

export const cachedBudgetOrigins = unstable_cache(
  (clientId: string | null) => listAllBudgetOrigins({ clientId }),
  ["budget-origins-v1"],
  { revalidate: REVALIDATE, tags: [DASHBOARD_TAG] },
);

// ════════════════════════════════════════════════════════════════════════════
// Calendario de reportes (`/reportes/calendario`).
//
// Son 7 round-trips (3 de `getReportingCalendar`, 3 de `getSentReports`, 1 de
// `getClientOptions`) que se pagaban ENTEROS en cada carga y, sobre todo, otra
// vez en cada mutación: las acciones de `app/actions/reports.ts` llaman a
// `revalidatePath("/reportes/calendario")`, así que cambiar UNA fecha
// re-renderizaba la página completa contra la DB. Ahí saltaba el timeout de 8s
// (digest 268176261 en Vercel: `getSentReports` sin respuesta).
//
// Tag propio: a diferencia del dashboard, acá NO alcanza con el `revalidate` de
// 60s — quien acaba de mover una fecha tiene que verla al instante o parece que
// no se guardó. Toda mutación de reportes invalida REPORTS_TAG explícitamente.
// ════════════════════════════════════════════════════════════════════════════

export const cachedReportingCalendar = unstable_cache(
  (clientId: string | null) => getReportingCalendar(clientId),
  ["reporting-calendar-v1"],
  { revalidate: REVALIDATE, tags: [REPORTS_TAG] },
);

export const cachedSentReports = unstable_cache(
  (clientId: string | null) => getSentReports(clientId),
  ["sent-reports-v1"],
  { revalidate: REVALIDATE, tags: [REPORTS_TAG] },
);

// La lista de clientes cambia muy de vez en cuando y la usan varias vistas
// como opciones de filtro. Se invalida con REPORTS_TAG y con el revalidate.
export const cachedClientOptions = unstable_cache(
  () => getClientOptions(),
  ["client-options-v1"],
  { revalidate: REVALIDATE, tags: [REPORTS_TAG, DASHBOARD_TAG] },
);

// ════════════════════════════════════════════════════════════════════════════
// Detalle de proyecto (`/proyectos/[code]`) y hub del Campaign Tracker.
//
// El detalle de proyecto son ~6 round-trips y es de las vistas más abiertas
// (se entra a un proyecto para llegar a sus planes). Se cachea por `code`, que
// es la clave de la URL. Cualquier cambio de plan o de proyecto invalida
// PLANS_TAG desde la action, así que no se ve data vieja.
// ════════════════════════════════════════════════════════════════════════════

// ⚠️ `getProjectWithPlans` NO se cachea, y no es un olvido.
//
// Su payload incluye la fila cruda de la tabla (`typeof projects.$inferSelect`)
// y un `lastSnapshotAt: Date`. `unstable_cache` serializa a JSON: los Date
// entran como objeto y vuelven como STRING en el cache hit, así que
// `plan.lastSnapshotAt.toISOString()` en la página explota — con un
// TypeError que TypeScript no puede ver, porque el tipo sigue diciendo `Date`.
//
// Hacerlo cacheable exige reescribir su tipo público para que sea JSON-safe.
// Hasta entonces, sus ~6 round-trips son un precio más barato que una mina
// que estalla sólo cuando la caché acierta. Ver README → "Caché de lecturas".

export const cachedClientBudgetOrigins = unstable_cache(
  (clientId: string) => listBudgetOriginsForClient(clientId),
  ["client-budget-origins-v1"],
  { revalidate: REVALIDATE, tags: [CATALOG_TAG] },
);

export const cachedTrackerHub = unstable_cache(
  (clientId: string | null, filter: CampaignHubFilter) =>
    getCampaignTrackerHub(clientId, filter),
  ["tracker-hub-v1"],
  { revalidate: REVALIDATE, tags: [TRACKER_TAG] },
);

// Opciones de filtro de /billing: baja cardinalidad (una entrada por cliente)
// y cambian sólo cuando se crea o borra un billing, así que cachean bien. El
// LISTADO no se cachea: sus filtros (origen, proyecto, estado, rango de meses)
// tienen demasiadas combinaciones y el hit rate sería casi cero.
export const cachedBillingFilterOptions = unstable_cache(
  (clientId: string | null) => getBillingFilterOptions(clientId),
  ["billing-filter-options-v1"],
  { revalidate: REVALIDATE, tags: [BILLING_TAG] },
);
