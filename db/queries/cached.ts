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
