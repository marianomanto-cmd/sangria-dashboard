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
// Staleness: 60s, aceptable para uso interno. Para invalidar al instante desde
// una server action: `revalidateTag("dashboard")`.
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

export const DASHBOARD_TAG = "dashboard";
const REVALIDATE = 60;

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

export const REPORTS_TAG = "reports";

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
