// ════════════════════════════════════════════════════════════════════════════
// Tags de caché, por área de la app.
//
// Cada lectura cacheada en db/queries/cached.ts lleva uno de estos tags, y cada
// server action que muta algo de esa área lo invalida con `updateTag`. Están
// acá, sin dependencias, para que los puedan importar tanto las queries como
// las actions sin ciclos.
//
// POR QUÉ `updateTag` Y NO `revalidateTag`: en Next 16 la firma pasó a ser
// `revalidateTag(tag, profile)` y con "max" el comportamiento es
// stale-while-revalidate — sirve el valor VIEJO y refresca en segundo plano.
// Para una app interna donde alguien edita y espera ver su cambio, eso se lee
// como "no se guardó". `updateTag` expira la entrada de una (read-your-own-
// writes) y sólo se puede llamar desde server actions, que es justo donde
// mutamos. Verificado en la fuente: next/dist/server/web/spec-extension/
// revalidate.js — updateTag llama a revalidate() con profile undefined
// (expiración inmediata) sin el warning de deprecación.
//
// Granularidad: un tag por área, no por entidad. Invalidar de más cuesta un
// recálculo; invalidar de menos muestra data vieja. Para el tamaño de esta app
// el recálculo es barato.
// ════════════════════════════════════════════════════════════════════════════

// KPIs, totales mensuales, pendientes y la grilla de proyectos (`/` y
// `/proyectos`). Lo toca casi cualquier cambio de plan, billing o proyecto.
export const DASHBOARD_TAG = "dashboard";

// Calendario de reportes y reportes enviados.
export const REPORTS_TAG = "reports";

// Listado de planes y detalle de proyecto.
export const PLANS_TAG = "plans";

// Billing, billing tracker y facturación de creativos.
export const BILLING_TAG = "billing";

// Campaign tracker (consumo real vs planeado).
export const TRACKER_TAG = "tracker";

// Análisis por publisher × mercado.
export const ANALYSIS_TAG = "analysis";

// Catálogos: clientes, publishers, mercados, métricas, orígenes de presupuesto.
// Cambian poco y los usan casi todas las vistas como opciones de filtro.
export const CATALOG_TAG = "catalog";

// Todo lo que una mutación "grande" (crear/borrar plan o proyecto) debería
// tocar. Se exporta como lista para no olvidarse ninguno.
export const ALL_TAGS = [
  DASHBOARD_TAG,
  REPORTS_TAG,
  PLANS_TAG,
  BILLING_TAG,
  TRACKER_TAG,
  ANALYSIS_TAG,
  CATALOG_TAG,
] as const;
