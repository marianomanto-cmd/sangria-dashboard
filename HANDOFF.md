# Handoff — viernes 26/jun/2026

Estado del repo al cierre y plan para retomar en otra sesión.

### Cambios de la sesión 26/jun/2026 — Billing Tracker (Estimación): filtro multi-select de clientes (#174)

La tab **Estimación** del Billing Tracker solo se podía acotar al cliente único
del topbar. Ahora tiene un filtro propio **multi-select de clientes** para ver
la estimación de varias cuentas juntas.

- **`db/queries/dashboard.ts`** — `getBillingEstimate` acepta `clientIds?: string[]`.
  Se arma un único `clientCond` (`inArray(projects.clientId, clientIds)` si hay
  multi, `eq(...)` si hay single, `[]` si ninguno) y se spreadea en las **3**
  subqueries de cliente (placements + ya facturado media/fees). Tiene prioridad
  sobre `clientId`; vacío → cae al cliente global / todos.
- **`components/estimate-clients-filter.tsx`** (nuevo) — popover con checkboxes,
  URL-based (`?clients=slug1,slug2`), portal-safe vía GET. Cierra con click-afuera
  / Escape.
- **`app/(app)/billing-tracker/page.tsx`** — la tab estimates trae
  `getClientsList()`, resuelve los slugs del filtro a IDs y los pasa como
  `clientIds` (override) o `clientId` (fallback global). `TabsNav` preserva
  `?clients` al cambiar de tab.
- **Decisión de diseño**: el filtro local y el picker global del topbar
  coexisten; el local manda en esta vista. El título/idioma de la página siguen
  derivando del cliente global (cosmético, consistente con el resto de la app).
- **Revisión**: diff revisado adversarialmente (workflow) antes de mergear — 0
  hallazgos confirmados. `tsc` + `eslint` + `next build` en verde. **Sin cambios
  de schema. No requiere acción en prod.**

### Cambios de la sesión 26/jun/2026 — Campaign Tracker: cargar todas las métricas del plan desde el catálogo (#171)

El Campaign Tracker clasificaba las métricas direct (cargables) vs calculated
(derivadas) contra una **lista hardcodeada** (`DIRECT_METRIC_RATES` en
`lib/cost-methods.ts`), así que solo se podían cargar `amount`/`impressions`/
`clicks`/etc. y las métricas custom del cliente quedaban invisibles. En Copa,
`tickets`, `tickets_stopover`, `lc_tickets` y `revenue` están en el catálogo
como `direct` pero no eran cargables. (Era la deuda técnica anotada en este
HANDOFF.)

- **Clasificación catalog-driven**: ahora sale del `metrics_catalog` de cada
  cliente — la misma fuente que el editor de planes y los exports. Toda métrica
  `direct` habilitada presente en el `metrics_json` del placement es cargable;
  las `calculated` se derivan con su fórmula (incl. custom como ROAS / CPT /
  CPT STO). Aplica a **todos** los planes de **todos** los clientes.
- **`lib/campaign-metrics.ts`**: `buildMetricRows` recibe `calcDefs` (requerido,
  del catálogo) — sin fallback hardcodeado. Las `%` del catálogo (fracción) se
  escalan ×100 para el display. `formulaDirectInputs` (en `lib/plan-metrics.ts`)
  devuelve `null` para fórmulas no parseables (evita filas fantasma). Se
  eliminan `isDirectMetricKey` / `directKeysFromMetricsJson`.
- **`db/queries/campaign-tracker.ts`**: clasifica direct/calc por catálogo
  (`directSlugs` / `calcDefs`) y expone `calcDefs` en `CampaignTrackerPlan`.
- **`app/actions/campaign-tracker.ts`**: `setPlacementActual` valida la métrica
  contra el catálogo del cliente (`amount` o slug `direct` habilitado);
  `closeDailyLoad` snapshotea todas las direct del catálogo.
- **`pacing.xlsx` del portal** (consumidor de `getCampaignTrackerPlan`): los
  subtotales/totales/por-mercado agregan las calculadas del catálogo
  (`unionCalcDefs`) para no quedar en blanco bajo columnas con datos.
- **Revisión**: el diff se revisó adversarialmente (workflow multi-agente) antes
  de mergear; se detectaron y corrigieron una regresión (alta) en `pacing.xlsx`
  y dos issues menores. `tsc` + `eslint` + `next build` en verde.
- **Sin cambios de schema. No requiere acción en prod** — la persistencia
  (`campaign_placement_actuals.metric_key`, snapshots) ya guardaba por slug.
- **Data fix aplicado en prod (26/jun)**: varias calculadas custom de Copa
  (`CPT`, `CPT LC`, `CPT STO`, `cpa_cc_mexico`, `cpa_cc_destino_san_diego`,
  `roas`) tenían `unit = null`, así que se mostraban como entero en vez de
  `$`/`x` (igual que ya pasaba en el editor/exports). Se corrigió con un UPDATE
  manual sobre `metrics_catalog` del cliente Copa: `unit = '$'` para las
  "amount / X" y `'x'` para `roas`. Solo display — el formato se deriva del
  catálogo en runtime, sin redeploy. (Si se crean nuevas calculadas sin unidad
  vuelve a pasar: `createMetric`/`updateMetric` no la exigen; follow-up abierto
  agregar validación/default de unidad.)

### Cambios de la sesión 24/jun/2026 — Revisión estética/cosmética + bugs (varios)

Revisión completa del sitio (shell, dashboard, tablas, editor de plan, portal,
reportes/config/auditoría) buscando mejoras cosméticas y bugs. Se aplicaron los
arreglos de alto valor y bajo riesgo; quedan recomendaciones de mayor alcance
documentadas abajo (no implementadas en esta sesión).

- **Bug (crash): `StatusBadge` sin fallback** (`components/status-badge.tsx`): un
  `status` fuera del enum tiraba `TypeError` y, sin boundary granular en la tabla
  de Operaciones, tumbaba toda la vista. Se agregó `STYLES[status] ?? STYLES.closed`
  (mismo patrón que `PlanStatusBadge`/`BillingStatusBadge`).
- **Bug: timers de toast sin cleanup** (`components/toast.tsx`): el `setTimeout`
  de auto-cierre nunca se limpiaba (leak + `setState` tras desmontar + timers
  huérfanos al cerrar a mano). Ahora se trackean por id en un `useRef<Map>`, se
  limpian en `remove()` y en el unmount del provider.
- **Bug cosmético: chevron del column-picker no rotaba** (`components/report-generator-form.tsx`):
  `group-open:rotate-180` sin la clase `group` en el `<details>`. Agregada.
- **Bug: sort no estable** (`plans-table-client.tsx`, `projects-table-expandable.tsx`):
  `localeCompare` con `sensitivity:"base"` dejaba indefinido el orden de empates
  (reordenamientos entre renders). Tie-breaker determinístico por `id`/`code`.
- **Dark mode (sistémico): pill activa invisible**: el patrón
  `dark:data-[active=true]:bg-paper-2 dark:bg-paper-2` dejaba la opción activa con
  el mismo fondo que el contenedor en dark. Corregido a
  `dark:data-[active=true]:bg-paper` en: `year-selector`, `/planes` (FilterChoice),
  `/clientes/[slug]` (OriginTab), `/campaign-tracker`, `reporting-calendar-client`
  (2), `/auditoria`, `/auditoria/papelera`.
- **Cosmético: barras de progreso consistentes**: `/planes` ahora marca
  sobre-consumo en `bg-warn` (antes se veía igual que 100%); `/clientes/[slug]`
  pasó de `bg-ink` (negro) al gradiente de marca `from-accent to-accent-2` (tabla,
  tarjetas mobile y Gantt); el dashboard ("Avance promedio") vira a `bg-warn`
  cuando supera 100% para no contradecir el número.
- **Cosmético: tokens en vez de hardcode**: glow del dashboard
  (`rgba(168,52,95,.55)` → `color-mix(... var(--color-accent-2) ...)`, dark-aware);
  muestra baja del portal (`text-amber-*` → `text-warn`).
- **Cosmético/legibilidad**: `tabular-nums` + `whitespace-nowrap` en las celdas
  numéricas/período de `/clientes/[slug]`; track de la barra por mercado en
  `market-analysis` (`bg-paper-2` → `bg-line`, visible en dark) + guard de
  división por cero.
- **a11y menores**: `KpiCard` de `/campaign-tracker` (label/hint legibles sobre
  fondo `bg-ink`, antes `text-muted` ilegible); `focus-visible` en las tarjetas de
  `/clientes`; `transition-colors` + `aria-label` dinámico en la hamburguesa mobile.
- **Lint (pre-existente, arreglado)**: `setState` síncrono en effect en
  `proyectos/nuevo/form.tsx` → derivado en render (`effectiveOriginId`, sin
  cascading renders); `LABELS` muerto en `project-status-changer.tsx` eliminado.
- **Verificación**: `tsc` + `eslint` + `next build` en verde. **Sin cambios de
  schema. No requiere acción en prod.**

**Recomendaciones — implementadas en esta sesión (2da tanda)**:
- **Hojas auxiliares (`aux-sheet.tsx`)**: `writeMatrixAt` ahora normaliza la matriz
  pegada a `w` columnas (rellena `""`), así un bloque "dentado" de Excel/Sheets
  limpia todas las columnas del rect y no borra uniones de más; `onCellMouseDown`
  setea `skipBlurRef` para no comitear dos veces (mousedown + onBlur del input);
  guard de composición IME al empezar a editar (no abre con un caracter muerto);
  el toast de fallo de `save` es explícito ("No se pudo guardar el cambio: …").
- **Editor de plan**: `NumberInput`/`RateInput`/`DeliveryInput` rechazan negativos
  (restauran el previo, como una fórmula inválida); `RatePctInput` además rechaza
  `≥100` (rompería la fórmula del fee `TM×r/(100−r)`).
- **Portal Estimación**: el filtro "Mes" se desacopló del de Billing — ahora ofrece
  meses **futuros** (mes anterior + próximos 6) vía `estimationMonthOptions()`, así
  elegir un mes ya no cae siempre al estado vacío.
- **Marca**: `topbar` y `sidebar` reusan `<SangriaMark>` (tokenizado) en vez de
  re-pegar el `radial-gradient` con hex; avatar del sidebar unificado al gradiente
  accent; el drawer mobile cerrado lleva `inert` (sus links ya no son tabulables).

**Pendiente intencional (no implementado, con motivo)**:
- Refactor stale-closure del estado del grid de `aux-sheet.tsx` (updaters
  funcionales / `stateRef`): evaluado de **bajo impacto real** (una sola mutación
  por evento del usuario, con re-render entre medio → no se encadenan lecturas
  obsoletas) y **alto riesgo** sin poder testear el grid a mano. Mejor abordarlo
  con cobertura de tests.
- Migración masiva `bg-white dark:bg-paper-2` → `bg-surface` (226 usos, 62
  archivos): **visualmente idéntico** (mismo `#fff`/`#15100e`), mejor como cambio
  mecánico aparte para no inflar este diff.

### Cambios de la sesión 23/jun/2026 — Portal (Proyectos): filtro de rango de fechas Desde/Hasta

- **Pedido**: en la vista de cliente, sección **Proyectos**, poder filtrar por un
  **rango específico de fechas** (no solo un mes suelto).
- **Implementación**: el filtro **"Mes"** de la tab Proyectos se reemplazó por un
  **rango Desde/Hasta** (dos `<input type="date">`, params URL `?pfrom=`/`?pto=`
  en `YYYY-MM-DD`). Un proyecto queda visible si **alguno de sus planes aprobados
  tiene un período que INTERSECTA** el rango (intersección de intervalos, con
  rango abierto de un lado soportado). El filtro **"Mes"** sigue igual en las tabs
  **Billing Tracker** y **Estimación** (no se tocaron).
  - `portal-filters.tsx`: nuevo field `"daterange"` (dos date inputs con
    `min`/`max` cruzados); `reset()` e `isFiltered` contemplan `pfrom`/`pto`.
  - `portal-content.tsx`: `PortalParams` suma `dateFrom`/`dateTo`; helper
    `periodIntersectsRange` (reemplaza `monthInRange`); `ProjectsSection` filtra
    por intersección; `hrefWith` **preserva** `pfrom`/`pto` (mismo cuidado que con
    `pstatus`/`camp` para no perder el filtro al expandir el pacing). Con campañas
    seleccionadas, la selección sigue mandando (ignora el rango).
  - `page.tsx`: lee `sp.pfrom`/`sp.pto` en `portalParams` y la tab Proyectos usa
    `fields=["pstatus","campaign","origin","daterange"]`.
- **Verificación**: `tsc` + `eslint` + `next build` en verde; test unitario de
  `periodIntersectsRange` (10 casos: dentro, antes, después, rangos abiertos,
  sin fechas, borde) todos OK. **Sin cambios de schema. No requiere acción en prod.**
- Archivos: `app/(portal)/[clientSlug]/{portal-filters,portal-content,page}.tsx`,
  README.

### Cambios de la sesión 23/jun/2026 — Hojas auxiliares: la columna "NET TOTAL" nunca se trunca (regla)

- **Pedido**: en las hojas auxiliares, una columna llamada **`NET TOTAL`** (la
  que tiene el monto de inversión) **siempre tiene que quedar legible** — muchas
  veces el número era largo y se truncaba con `…`. **Agregado como regla.**
- **Implementación**:
  - `lib/aux-sheet.ts`: nuevo helper **`isProtectedAuxLabel(raw)`** (reconoce
    `NET TOTAL` / `TOTAL NETO`) como fuente única de la regla, compartido por
    PDF y Excel.
  - `lib/plan-pdf.ts` (`drawAuxTable`): el reparto de ancho de columnas pasó a
    distinguir **columnas protegidas**: toman su ancho **completo** (el que
    necesita su celda más ancha, medido con la fuente real de cada fila —bold en
    header/subtotal/total/grand) y el resto del ancho usable se reparte entre las
    demás. Sin columnas protegidas, el comportamiento es el de antes (todo escala
    a llenar el ancho). Edge case: si las protegidas solas no entran, se escala
    todo (best-effort).
  - `app/api/plans/[planId]/export.xlsx/route.ts` (`buildAuxSheet`): a las
    columnas protegidas se les sube el tope de ancho de 48→80 chars (misma regla,
    consistencia con el PDF).
- **Verificación**: `tsc` + `eslint` + `next build` en verde; render real a PNG
  de una hoja con 9 columnas (forzando el escalado) + columna `NET TOTAL` con
  `1,234,567.89` → se muestra **completa, sin `…`**, mientras las demás absorben
  el ancho. **Sin cambios de schema. No requiere acción en prod.**
- Archivos: `lib/aux-sheet.ts`, `lib/plan-pdf.ts`,
  `app/api/plans/[planId]/export.xlsx/route.ts`, README.

### Cambios de la sesión 23/jun/2026 — PDF del plan: incluir las hojas auxiliares (formato del plan + firma/fecha)

- **Pedido**: el PDF imprimible del plan de medios debía **también incluir las
  hojas auxiliares**, con el formato del plan y con espacio para **firma del
  cliente + fecha**. Hasta ahora el PDF NO las incluía (solo el Excel).
- **Implementación** (`lib/plan-pdf.ts`): después del plan principal,
  `renderPlanPdf` agrega **una página por tab auxiliar** (`detail.auxSheets`, en
  orden). Cada página lleva: label `PLAN DE MEDIOS · Hoja auxiliar` + nombre del
  tab + metadata (proyecto / período / budget origin) → la grilla como **tabla a
  todo el ancho** con el formato del plan (header accent, filas subtotal/total/
  grand resaltadas, banding alterno, números a la derecha, **uniones** vía
  rowSpan/colSpan y **fórmulas resueltas** con `evalAuxFormula`) → **bloque de
  firma del cliente + fecha + disclaimer** + footer. Así cada anexo se firma por
  separado.
- **DRY con el Excel**: se extrajeron a `lib/aux-sheet.ts` los helpers de layout
  que estaban locales en `export.xlsx/route.ts` —`auxContentBounds`,
  `classifyAuxRow`, `detectAuxHeaderRow` (+ `firstAuxLabel`)— y ahora los usan
  **PDF y Excel** para clasificar filas y detectar el rectángulo con contenido
  igual. El route Excel se actualizó para importarlos (borró sus copias).
- **Iniciales por página**: la pasada final pasó de "todas menos la última" a
  "todas las que **no** tienen bloque de firma" (set `signedPages`), porque ahora
  hay varias páginas firmadas (la última del plan + cada hoja auxiliar).
- **i18n**: nueva clave `export.auxSheet` ("Auxiliary sheet" / "Hoja auxiliar").
- **Verificación**: `tsc` + `eslint` (archivos tocados) en verde + render real a
  PNG (pypdfium2) de un plan con 2 tabs (fórmulas + uniones), edge cases de tab
  vacío y plan sin tabs. **Sin cambios de schema. No requiere acción en prod.**
- Archivos: `lib/plan-pdf.ts`, `lib/aux-sheet.ts`, `lib/i18n.ts`,
  `app/api/plans/[planId]/export.xlsx/route.ts`, README.

### Cambios de la sesión 19/jun/2026 — MP Excel: mercado de cada placement en columna propia (Tab 1)

- **Excel del plan (Tab 1 "Plan de medios")**: el mercado de cada placement
  ahora va en una **columna dedicada** ("Mercado"/"Market", entre "Publisher /
  Placement" e "Inicio"), en vez de anexarse al nombre del placement con ` · `.
  En `app/api/plans/[planId]/export.xlsx/route.ts` se sube `baseCols` 7→8, se
  inserta la columna y se corren los índices de las columnas siguientes
  (start/end/audience/notes/cost method/investment) y de los montos en las filas
  de subtotal por publisher, `TOTAL MEDIA` y `GRAND TOTAL`. Las columnas de
  métricas siguen al final vía `baseCols`, así que se reubican solas.
- **Preview en espejo**: el `ExcelPreview` del editor del plan (`editor.tsx`) se
  actualizó con la misma columna para no divergir del archivo descargado.
- **Docs**: README — enumeración de columnas del Tab 1 + nota del preview +
  descripción de la ruta `export.xlsx`.
- **Sin cambios de schema.** **No requiere acción en prod.** `tsc` + `eslint` +
  `next build` en verde.

### Cambios de la sesión 18/jun/2026 — MP: formato de tabs auxiliares en el Excel + insert/delete filas/columnas + nav al header (desktop)

- **Excel — tabs auxiliares con formato parecido al Tab 1** (`app/api/plans/[planId]/export.xlsx/route.ts`,
  `buildAuxSheet`): antes salían sin estilo. Ahora se formatea solo el
  rectángulo con contenido: 1ra fila de texto → **header** (fondo ACCENT),
  filas cuya etiqueta arranca con `total`/`subtotal`/`grand total` → fondos
  ACCENT/ACCENT_SOFT/INK con **negrita**, resto con **banding** alterno; bordes
  finos, alto de fila (interlineado) 20/22, **ancho de columna auto-ajustado**,
  números a la derecha y metadata + header congelados. Heurística por la 1ra
  celda (no confunde un header con columnas tipo "Total impresiones").
- **Editor de tabs auxiliares — insertar/eliminar filas y columnas en cualquier
  posición** (`aux-sheet.tsx` + helpers puros en `lib/aux-sheet.ts`): **click
  derecho** en el N° de fila / letra de columna abre un menú estilo Excel
  (insertar arriba/abajo, izquierda/derecha, eliminar); click izquierdo
  selecciona la línea. `insertAuxRow/Col` y `deleteAuxRow/Col` corren la data,
  mueven/encogen las uniones y **reescriben las refs de las fórmulas**
  (`shiftAuxFormula`, con conciencia de rangos: `SUM(A5:A10)` se encoge/agranda,
  una ref suelta a una línea borrada queda `#REF!`). Pasa por el historial +
  autosave. **Sin cambios de schema.**
- **Navegación al header en desktop** (`components/top-nav.tsx` nuevo +
  `lib/nav.ts` nuevo): en `≥ lg` la nav vive en el header (tira horizontal
  ícono+label) para liberar el ancho de la ventana al contenido; el `<aside>`
  lateral ya no se renderiza ahí. En `< lg` **no cambia**: sigue el drawer
  (`sidebar.tsx`) + hamburguesa. Entradas compartidas en `lib/nav.ts`
  (`PRIMARY_NAV`/`FOOTER_NAV`/`isNavActive`). `tsc` + `eslint` + `next build` en verde.

### Cambios de la sesión 18/jun/2026 — Filtro de año en Planes, Proyectos y Calendario (#156, #157)

- Las tabs de **Planes** (`/planes`), **Proyectos** (`/proyectos`) y
  **Calendario de reportes** (`/reportes/calendario`) ahora filtran por **año**,
  con default **año actual**.
- **Semántica**: en planes/proyectos un ítem pertenece a un año si su **período
  de placements lo intersecta** (una campaña 2024→2025 aparece en ambos); filas
  sin fechas cuentan como año actual. En el calendario, cada reporte se ubica por
  su **fecha representativa** (entrega programada/real; si no tiene, el cierre del
  proyecto). En los tres, opción **"Todos"**.
- **Reutilizable**: `lib/year-filter.ts` — helpers puros `periodMatchesYear`,
  `availableYears`, `resolveYearParam`. Planes/Proyectos usan
  `components/year-selector.tsx` (pills URL-based; el año actual usa URL limpia
  sin param). El Calendario lo hace **client-side** (useState + useMemo, mismo
  patrón que su filtro de budget origin) con pills propias.
- Filtrado **en memoria** sobre filas ya traídas (sin tocar queries); en
  planes/proyectos cross-preserva con los filtros de origin/estado/cliente y los
  KPIs/counts/subtítulo reflejan el set filtrado. **Sin cambios de schema.**
  `next build` en verde.

### Cambios de la sesión 16/jun/2026 — Mobile: listas/tablas → tarjetas (sin scroll horizontal) (#152)

- **Patrón** (consistente en todo el sitio): cada tabla-lista que scrolleaba
  horizontal en mobile pasa a tabla `hidden lg:block` (desktop) + bloque
  `lg:hidden` de **tarjetas** (misma data, badges, links y acciones). Breakpoint
  `lg`. Referencia: `components/dashboard/view-operaciones.tsx`.
- **Convertidas**: `/planes` (plans-table-client: Lista + Por proyecto →
  PlanCard), `/proyectos` + tab Proyectos de `/clientes` (projects-table-
  expandable: tarjeta de proyecto nivel-superior con link al detalle; drill-down
  queda desktop-only), `/billing`, `/billing-tracker` (tabla interna de
  facturas), `/campaign-tracker` (grupos cliente→planes), `/clientes/[slug]`
  (tab Resumen), estimación (billing-estimate-card), **portal** (Billing
  Tracker / Reportes enviados / Benchmarks —mobile muestra la mediana p50—),
  reporting-calendar-client, market-analysis (tabla de activaciones; mapa/ranking
  intactos), config de clientes (admin + sections: publishers/métricas/mercados,
  edición inline preservada), y las **papeleras** (planes borrados + auditoría).
- **Dejadas como tabla a propósito**: preview del generador de reportes (espeja
  el Excel), tablas analíticas del simulador, y matrices/resúmenes fijos que ya
  entran en mobile (budget origins de config, matriz del mes previo en billing).
- Hecho en paralelo con 3 subagentes + integración/build local. **Sin cambios de
  schema.** `tsc` + `eslint` + `next build` en verde.

### Cambios de la sesión 16/jun/2026 — Rediseño Sangria OS: shell + dashboard de 3 vistas (mergeado a main)

Rediseño completo del look & feel (identidad sangria.agency) + dashboard nuevo
que reemplaza al viejo. El dashboard viejo (`components/dashboard-view.tsx`,
`pending-board.tsx`, `kpi-card.tsx`) se **borró**.

- **Identidad nueva (tokens)**: `app/globals.css` re-skin completo a la paleta
  del rediseño (negro+crema cálido, vino Sangría) en `@theme` + `.dark` (Round
  03). Se agregó `--color-surface` (blanco de cards), `--font-display`
  (Archivo) y keyframes `sngRise`/`sngGrow`/`sngMarquee`. Como toda la app usa
  tokens, **re-skin-ea todo el sitio**.
- **Fuente Archivo** (`app/layout.tsx`, `next/font/google`, pesos 700/800/900)
  para titulares (`font-display`).
- **Shell**: `sidebar.tsx` restyle (228px, dot vino + wordmark Archivo, barra
  activa 5px, texto white-alpha, fijo oscuro en ambos temas). `topbar.tsx`
  restyle (`bg-surface`) + `topbar-nav.tsx` (nuevo): título de sección por
  pathname.
- **Dashboard nuevo** (`components/dashboard/`): contenedor `dashboard-view.tsx`
  (**"use client"**) con el **toggle de 3 vistas como estado de cliente →
  cambio INSTANTÁNEO** (sin re-fetch; refleja la vista en la URL con
  `history.replaceState`). `types.ts` + `view-context.tsx` (el "Ver todos →"
  conmuta de vista vía contexto). Cada vista en su `SectionBoundary`. 3 vistas:
  - **Cuentas** (default): bento por cliente (portfolio en `bg-rail`, pipeline,
    avance) + card de pendientes + tarjetas de cliente con sparkline.
  - **Operaciones**: strip de KPIs + board de pendientes (4 columnas) + tabla
    densa de proyectos.
  - **Ejecutivo**: header editorial ("Buenas tardes, {nombre}") + banda de KPIs
    + chart `FacturacionChart` (reusado) + "Requiere atención" + "Clientes activos".
  - `shared.tsx`: `groupPendings` (cada pendiente → **href real** a su detalle),
    `deriveClients`, `MiniBars`, `PendingRow`.
- **Confiabilidad** (clave — el dashboard es la página MÁS pesada, ~15-20 queries
  por carga; los logs del preview mostraban saturación del pooler:
  `Postgres.js: Unknown Message`, `Failed query`, Runtime Timeouts):
  - **Cache** de las 4 queries del dashboard vía `unstable_cache` (revalida 60s,
    por cliente) en `page.tsx` → tras la 1ª carga salen del Data Cache: 0
    queries, instantáneo, sin presión sobre la conexión.
  - `page.tsx` resiliente: `resolveClientFromSearchParams` en `try/catch` (no
    tira el error boundary de ruta si la DB falla un instante) + `allSettled` +
    fallbacks vacíos por sección + `maxDuration = 60` (aire para la 1ª carga en
    frío que puebla el cache).
- **Datos**: misma firma de queries (`getDashboard*`); **único cambio aditivo**:
  `db/queries/pendings.ts` trae `clientSlug` en cada pendiente (para routear
  `?client=`).
- **Pendiente p/ próxima sesión**: la sección "Tablero de pendientes del
  dashboard" más abajo en el README describe el board VIEJO (ya borrado) →
  actualizar. Los "deltas" de los mocks (YoY/trimestre) se omitieron (no hay esa
  métrica en las queries). Si el primer golpe en frío sigue costando, evaluar
  bajar el fan-out de queries del dashboard o tunear el pool (`db/index.ts`).
- `tsc` + `eslint` + `next build` en verde. **Sin cambios de schema.**

### Cambios de la sesión 16/jun/2026 — Portal Proyectos: filtro de campañas + multi-pacing + export ejecutivo + fix "Ver pacing"

- **Bug arreglado**: en el portal (`/<slug>` → Proyectos), "Ver pacing" de una
  campaña **cerrada** reseteaba el filtro a "Abiertos" y no mostraba el pacing.
  Causa: `hrefWith` (en `portal-content.tsx`) reconstruía la URL del link sin
  `pstatus` → se perdía `pstatus=cerrados`. Fix: `hrefWith` ahora preserva
  `pstatus` (y `camp`).
- **Filtro multi-select de campañas (con buscador)**: nuevo `CampaignMultiSelect`
  en `portal-filters.tsx` (popover con search + checkboxes, URL-based vía
  `?camp=<planIds>`). La pestaña Proyectos suma el campo `"campaign"`. Cuando hay
  campañas elegidas, **la selección manda**: se ignoran estado/budget origin/mes
  para que no las escondan. Opciones nuevas en `getPortalFilterOptions`
  (`campaigns` = planes aprobados del cliente).
- **Pacing de varias campañas a la vez**: `?plan=` pasó de un id a una **lista**
  (set de planIds separados por coma); cada "Ver pacing" togglea su id en el set.
- **Export ejecutivo consolidado**: nueva ruta
  `GET /api/portal/pacing.xlsx?client=<slug>&plans=<ids>` → un solo Excel con el
  pacing de **varias campañas**. Tres hojas con el look del Excel del plan:
  **Resumen** (fila por campaña + total), **Detalle** (campaña → publisher →
  placement con métricas goal/real en columnas, "detalle amplio") y **Por
  mercado** (desglose agregado). Pública en el proxy (`/api/portal/*`); valida
  `canAccessClientExport` + ownership de cada plan; tope `MAX_PLANS` (40),
  `maxDuration=60`. Reusa `getCampaignTrackerPlan` por plan + `buildMetricRows`
  para re-derivar calculadas en los subtotales. Botón "Descargar pacing (Excel)"
  arriba de la lista (todas las visibles) y uno por campaña en el panel de pacing.
- **Sin cambios de schema.** `tsc` + `eslint` + `next build` en verde. **No
  requiere acción en prod** salvo el deploy (merge a `main`).
- Archivos: `app/api/portal/pacing.xlsx/route.ts` (nuevo),
  `app/(portal)/[clientSlug]/{portal-filters,portal-content,page}.tsx`,
  `db/queries/client-portal.ts`, `lib/supabase/middleware.ts` (comentario).

### Cambios de la sesión 16/jun/2026 — Dashboard caído: resiliencia por sección + fallbacks

- **Incidente**: el Dashboard (`/`) tiraba el error boundary ("Ocurrió un error
  al cargar esta vista", `ref/digest 3865035138`) de forma **determinística**;
  el resto de la app andaba bien. En los logs de Vercel: primero una tanda de
  `Vercel Runtime Timeout Error` en `/` y `/planes` (pico de carga — el
  prefetch del sidebar dispara ~30 requests de golpe mientras el dashboard corre
  ~12 queries en paralelo; se recuperó solo) y, **por separado y persistente**,
  un `TypeError: Cannot read prop…` SOLO en el render del dashboard (mensaje
  truncado por la observabilidad; sin acceso a la DB de prod desde la sesión no
  se pudo reproducir el stack completo).
- **Causa raíz**: aún **sin pinpoint exacto**. El path de queries del dashboard
  está blindado, y `getDashboardProjects` / `ProjectsTableExpandable` los
  comparte `/proyectos` (que funciona) → el throw está en el render de un widget
  **exclusivo del dashboard**. Pendiente: leer el log `DASHERR[<seccion>]` /
  `DASHQ[<query>]` (o la consola del browser, que muestra el TypeError sin
  truncar porque `DashboardView` es client component) para ubicar la propiedad y
  sección exactas.
- **Mitigación (esta sesión)** — el dashboard ya no se cae entero:
  - `components/section-boundary.tsx` (**nuevo**): error boundary a nivel
    sección. Aísla cada widget del dashboard — si uno tira excepción, muestra un
    placeholder ("No se pudo cargar esta sección") y el resto de la página sigue
    funcionando (no más pantalla en blanco). Loguea
    `DASHERR[<seccion>]:<propiedad>` para ubicar la causa.
  - `components/dashboard-view.tsx`: cada sección (pendientes, KPIs, chart,
    proyectos) va envuelta en `<SectionBoundary>`.
  - `app/(app)/page.tsx`: las 4 queries pasan de `Promise.all` a
    `Promise.allSettled` con fallbacks vacíos por sección (si una query falla,
    degrada esa parte en vez de tumbar la vista) + loguea `DASHQ[<query>]`.
    Se agregó `export const maxDuration = 30` como headroom para los picos de
    timeout vistos en `/` y `/planes`.
- **Sin cambios de schema.** `tsc` + `eslint` (archivos tocados) + `next build`
  en verde. **No requiere acción en prod** salvo el deploy (merge a `main`).
- **Próximo paso**: con el dashboard ya usable, leer `DASHERR[...]` (logs de
  Vercel o consola del browser) para el fix preciso del widget que rompe.

### Cambios de la sesión 11/jun/2026 — Tabs auxiliares: deshacer / rehacer (Ctrl+Z)

- El editor de tabs auxiliares (`aux-sheet.tsx`) suma **deshacer / rehacer**:
  `Ctrl/Cmd+Z` y `Ctrl/Cmd+Shift+Z` (o `Ctrl+Y`, o botones Deshacer/Rehacer).
- Historial **por tab** de hasta 50 snapshots `{grid, merges}` (en estado local):
  cada mutación (editar celda, pegar, borrar, combinar/separar, +fila/+columna)
  apila el estado previo con `pushHistory()`; una edición nueva limpia el redo.
  Deshacer/rehacer restaura grilla + uniones, recorta la selección a las nuevas
  dimensiones y **persiste** vía el mismo `updateAuxSheet`.
- Mientras se edita una celda, `Ctrl+Z` queda como el undo de texto nativo del
  input (el handler de la grilla sólo lo toma fuera de edición).
- **Sin cambios de schema**, todo en el cliente. **No requiere acción en prod.**
- Archivo: `app/(app)/proyectos/[code]/planes/[planId]/aux-sheet.tsx`. `tsc`,
  `eslint` (archivo tocado) y `next build` en verde.

### Cambios de la sesión 11/jun/2026 — Tabs auxiliares estilo Excel: copy/paste + combinar celdas

> **ACCIÓN REQUERIDA EN PROD**: este cambio agrega la columna `merges_json` a
> `media_plan_aux_sheets`. Correr **`npm run db:push`** después del deploy o
> pegar el SQL de abajo en el SQL Editor de Supabase (idempotente, aditivo, sin
> backfill). La tabla **ya tiene RLS** habilitado (es a nivel tabla), así que
> **no** hay que tocar `db/rls.sql`. La lectura es defensiva: si la columna
> todavía no existe, los tabs se siguen mostrando (con `merges: []`).
>
> ```sql
> alter table public.media_plan_aux_sheets
>   add column if not exists merges_json jsonb not null default '[]'::jsonb;
> ```

- El editor de tabs auxiliares (`aux-sheet.tsx`) pasó de inputs celda-por-celda
  a una grilla **estilo Excel** con:
  - **Selección de rango** (arrastrar mouse / Shift+click / flechas /
    Shift+flechas / `Ctrl/Cmd+A`). Editar con doble click, Enter, F2 o tipeando;
    dentro de la edición Enter baja, Tab a la derecha, Escape cancela.
  - **Copiar / cortar / pegar / borrar** rangos (`Ctrl/Cmd+C/X/V`, `Supr` o
    botones). Portapapeles **TSV** → se puede pegar desde/hacia Excel/Sheets;
    pegar agranda la grilla hasta los topes y un valor 1×1 rellena la selección.
  - **Combinar / separar celdas** (botones sobre la selección). Las uniones se
    guardan en la columna nueva `merges_json` (`{r0,c0,r1,c1}[]` en coords de la
    grilla); al combinar sobrevive el valor del top-left y las tapadas quedan
    vacías (así fórmulas y export las tratan como vacías). El export las escribe
    con `ws.mergeCells` y el editor con `rowSpan/colSpan`.
- **Fórmulas y sumatorias ya existían** (`=B5*2`, `=SUM(A5:A10)`, AVERAGE/MIN/
  MAX/COUNT) — esta sesión sumó la interacción que faltaba (copy/paste + merge).
- **Schema**: `media_plan_aux_sheets.merges_json` (jsonb, default `'[]'`).
  Helpers puros nuevos en `lib/aux-sheet.ts` (`AuxMerge`, `sanitizeMerges`,
  `findMerge`, `rectsIntersect`, `AUX_SHEET_MAX_MERGES`), saneados server-side en
  `updateAuxSheet`. `getPlanDetail` devuelve `merges` por tab (lectura defensiva
  ante la ventana deploy→migración). Export en `export.xlsx/route.ts`.
- **Archivos**: `lib/aux-sheet.ts`, `db/schema.ts`, `db/queries/project-detail.ts`,
  `app/actions/aux-sheets.ts`, `app/api/plans/[planId]/export.xlsx/route.ts`,
  `app/(app)/proyectos/[code]/planes/[planId]/aux-sheet.tsx`. `tsc`, `eslint`
  (sobre los archivos tocados) y `next build` en verde.

### Cambios de la sesión 11/jun/2026 — Reporting Calendar: comentarios por reporte

- **Botoncito "Comentarios (N)"** en cada reporte del calendario — pendientes,
  filas del Gantt y enviados; project y manual por igual. Abre un **modalcito**
  con la lista de comentarios (**autor + fecha y hora**, "(editado)" si se
  modificó), edición/borrado inline (borrar pide confirm) y un compose box
  abajo. El **primer comentario de un reporte manual es su descripción**:
  `createManualReport` la siembra al crear (con el creador como autor); las
  descripciones de manuales pre-existentes se backfillean por SQL (abajo).
- **Schema**: tabla nueva `report_comments` — polimórfica vía dos FKs nullable
  (`project_report_id` / `manual_report_id`, exactamente una seteada — lo
  valida la action), `body`, autor denormalizado (`author_user_id` /
  `author_email`, como audit_log), timestamps. Cascade al borrar el reporte.
- **Counts server-side**: `CalendarReport` y `SentReport` ahora traen
  `commentsCount` (query agrupada en `db/queries/reports.ts`, defensiva si la
  tabla no existe aún → 0). El modal refresca con `router.refresh()`.
- **Archivos**: `app/actions/report-comments.ts` (list/add/update/delete con
  audit), `components/report-comments.tsx` (botón + modal), `ReportingGantt`
  expone `onOpenComments` (el portal read-only no lo pasa → sin botón).
- **Acción en prod**: ✅ **ya aplicada** (11/jun/2026) — SQL para el editor
  de Supabase, idempotente (queda acá por referencia / otros entornos):

  ```sql
  create table if not exists public.report_comments (
    id uuid primary key default gen_random_uuid(),
    project_report_id uuid references public.project_reports(id) on delete cascade,
    manual_report_id uuid references public.manual_reports(id) on delete cascade,
    body text not null,
    author_user_id uuid,
    author_email text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create index if not exists idx_report_comments_project
    on public.report_comments (project_report_id, created_at);
  create index if not exists idx_report_comments_manual
    on public.report_comments (manual_report_id, created_at);
  alter table public.report_comments enable row level security;

  -- Backfill: la descripción de los reportes manuales existentes entra como
  -- primer comentario (solo si el reporte aún no tiene ninguno).
  insert into public.report_comments (manual_report_id, body, created_at, updated_at)
  select mr.id, btrim(mr.description), mr.created_at, mr.created_at
  from public.manual_reports mr
  where mr.description is not null
    and btrim(mr.description) <> ''
    and not exists (
      select 1 from public.report_comments rc where rc.manual_report_id = mr.id
    );
  ```

### Cambios de la sesión 10/jun/2026 — Preview del plan: toggle Budget por mercado

- El **preview tipo Excel** del editor del plan (`ExcelPreview`) suma un
  **toggle de pills** "Plan de medios" / "Budget por mercado" para
  previsualizar también el **Tab 2 del Excel**: tabla mercado × mes con
  prorrateo por días, columna "Sin fecha" si aplica, totales por fila/columna
  y grand total.
- **Refactor anti-divergencia**: el prorrateo (`prorateByMonth`) y la
  agregación (`buildBudgetSplit`) se movieron de `export.xlsx/route.ts` a
  **`lib/budget-split.ts`** — el Tab 2 del export y el preview
  (`BudgetSplitPreview` en `editor.tsx`) consumen exactamente la misma
  función.
- Sin cambios de schema. **No requiere acción en prod.**

### Cambios de la sesión 10/jun/2026 — "Última edición" del plan + modal de cambios

- **Chip "Última edición"** en el header del editor del plan (debajo del
  nombre): quién y cuándo editó por última vez la **versión vigente** —
  derivado del `audit_log`, sin schema nuevo. Click → **modal read-only** con
  la lista de cambios (oración + diff de campos, mismo render que /auditoria).
- **Query nueva** `getPlanAuditEvents(planId, {since})` en
  `db/queries/audit-log.ts`: junta los eventos del plan y de su contenido
  (publishers / placements / fees / tabs auxiliares), **incluyendo hijos ya
  borrados** — se buscan por el `mediaPlanId` / `mediaPlanPublisherId` que
  viaja en los JSON del audit, no por las tablas vivas. Los updates de tabs
  auxiliares se compactan a "filas×cols · N celdas cambiadas" (guardan la
  grilla completa por evento y inflarían el payload de la página).
- **Ventana "versión vigente"** (la computa `page.tsx` con los snapshots):
  draft/ready → cambios desde la última aprobación (o creación si v0);
  approved/archived → desde la aprobación anterior (los cambios que
  produjeron la versión vigente, aprobación incluida).
- **Refactor**: el render de un evento (`AuditEntry` + diff) se movió de
  `/auditoria/page.tsx` a `components/audit-entry.tsx`, y `computeAuditDiff` /
  `formatAuditValue` a `lib/audit-format.ts` — compartidos por ambas vistas.
- Sin cambios de schema. **No requiere acción en prod.**

### Cambios de la sesión 10/jun/2026 — Tabs auxiliares del plan (tabs extra del Excel, con fórmulas)

- **Nueva feature**: cada media plan puede tener **N tabs auxiliares** — grillas
  libres tipo Excel que el planner edita a mano desde el editor del plan (botón
  **"Crear tab auxiliar"**, una sección colapsable por tab, debajo del preview).
  Arriba muestran la metadata del plan read-only (proyecto, período, budget
  origin); debajo, filas vacías editables (Enter/Shift+Enter navegan como en la
  grilla de placements, Enter en la última fila agrega una; botones "+ Fila" /
  "+ Columna"; autosave por celda al blur). Nombre del tab editable inline
  (default "Auxiliar", "Auxiliar 2", …); eliminar con confirm.
- **Fórmulas**: celdas que empiezan con `=` — aritmética, refs A1 (`=B5*2`) y
  `SUM/AVERAGE/MIN/MAX/COUNT` sobre rangos (`=SUM(A5:A10)`). La numeración del
  editor coincide con la del tab exportado (grilla arranca en fila 5). El
  editor muestra el resultado (fórmula cruda al enfocar) y errores `#REF!` /
  `#VALUE!` / `#DIV/0!` / `#CIRC!` / `#ERROR!`. Evaluador propio de descenso
  recursivo en `lib/aux-sheet.ts` (sin `eval()`).
- **Export Excel**: cada tab sale **después del "Budget por mercado"** (en
  orden), con el nombre del planner (sanitizado a nombre válido de tab Excel)
  y la misma metadata arriba. Celdas numéricas US van como número; las
  fórmulas que resuelven van como **fórmulas reales de Excel** (uppercased,
  con resultado cacheado). El PDF no los incluye.
- **Schema**: tabla nueva `media_plan_aux_sheets` (`media_plan_id` FK cascade,
  `name`, `grid_json` jsonb `string[][]`, `sort_order`; index
  `(media_plan_id, sort_order)`). No participa de snapshots/aprobación
  (aprobar o descartar borrador no la toca); delete duro, sin papelera.
  `getPlanDetail` es **defensivo**: si la tabla no existe aún en prod, devuelve
  `auxSheets: []` en vez de romper el editor (ventana deploy → migración).
- **Archivos**: `lib/aux-sheet.ts` (límites + helpers + evaluador de fórmulas),
  `app/actions/aux-sheets.ts` (CRUD con audit), `aux-sheet.tsx` junto al
  editor, `getPlanDetail` ahora devuelve `auxSheets[]`, tabs 3+ en
  `export.xlsx/route.ts`, noun nuevo en `lib/audit-format.ts`.
- **Acción en prod**: ✅ **ya aplicada** (10/jun/2026) — SQL para el editor
  de Supabase, idempotente, equivalente a `npm run db:push` + la línea de
  RLS ya agregada a `db/rls.sql` (queda acá por referencia / otros entornos):

  ```sql
  create table if not exists public.media_plan_aux_sheets (
    id uuid primary key default gen_random_uuid(),
    media_plan_id uuid not null references public.media_plans(id) on delete cascade,
    name text not null default 'Auxiliar',
    grid_json jsonb not null default '[]'::jsonb,
    sort_order integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create index if not exists idx_mpas_plan
    on public.media_plan_aux_sheets (media_plan_id, sort_order);
  alter table public.media_plan_aux_sheets enable row level security;
  ```

### Cambios de la sesión 04/jun/2026 — Proyectos: período + aviso "termina pronto"

- **Fecha de inicio y fin del proyecto** en: la **lista** de proyectos
  (`components/projects-table-expandable.tsx`, nueva columna "Período" — la usan
  `/proyectos` y el dashboard), la vista interna de detalle (`/proyectos/[code]`,
  ya estaba) y la **vista de cliente** (tab Proyectos del portal, header de cada
  card). El fin se deriva del último placement de los planes (no hay columna de
  fin en `projects`).
- **Aviso a ≤7 días del fin**: leyenda en `text-warn` debajo de la fecha
  ("Termina en N días" / "Termina hoy" / "mañana") cuando el proyecto está a 7
  días o menos de terminar.
- Helper compartido `lib/project-period.ts` (`projectPeriod`, `daysUntilEnd`,
  `endingSoonDays`, `endingSoonLabel`). Sin cambios de schema, todo en la UI.
  **No requiere acción en prod.**

### Cambios de la sesión 04/jun/2026 — Benchmarks (portal): descargar Excel / PDF

- El tab **Benchmarks** del portal suma botones **Excel** y **PDF** que bajan lo
  que está **filtrado** (mismos params que la query: pub/mkt/cm/from/to).
- Nuevo route `app/api/benchmarks/export/route.ts`: corre `getBenchmarks` con los
  filtros y arma el archivo. **Excel** (ExcelJS) con p25/p50/p75 de CPM/CPC/CPV/
  CTR + N/Spend/Delivery; **PDF** (pdf-lib, landscape) resumen con la mediana
  (p50). Público en el proxy (GET) y autovalidado con `canAccessClientExport`
  (sesión interna O cookie de portal del cliente).
- Reusa deps existentes (exceljs/pdf-lib). Sin schema. **No requiere acción en
  prod.**

### Cambios de la sesión 04/jun/2026 — Análisis: filtros multi-select

- Los filtros de publisher / mercado / budget origin pasan a **selección
  múltiple** (varios a la vez). Los params `pub`/`mkt`/`bo` ahora guardan listas
  separadas por coma en la URL; `getMarketActivations` filtra con `inArray`.
- Nuevo componente `MultiSelect` (popover con checkboxes, cierra al click afuera)
  en `components/market-analysis.tsx`. Click en una burbuja del mapa o en el
  ranking **togglea** ese mercado en la selección. El mapa (`americas-map.tsx`)
  pasa de `selectedId` a `selectedIds` (resalta todos los seleccionados).
- Sin cambios de schema. **No requiere acción en prod.**

### Cambios de la sesión 04/jun/2026 — Mapa de análisis: 3 columnas + Leaflet

- **Layout en 3 columnas** (`components/market-analysis.tsx`): filtros (izquierda,
  vertical) · mapa (centro) · "Por mercado" (derecha); la tabla de activaciones
  full-width abajo. Totales full-width arriba.
- **Mapa → Leaflet** (`components/americas-map.tsx`): el SVG propio con d3-geo
  quedaba angosto/blanco según el footprint. Se reemplazó por **Leaflet** (tiles
  CARTO, zoom/pan nativos), importado dinámico dentro de un effect (vanilla, sin
  react-leaflet → sin conflicto con React 19). Cada mercado es una burbuja
  `divIcon` (tamaño = inversión, número = activaciones), auto-`fitBounds` a lo
  filtrado, llena el ancho de la columna. Estilos `.mkt-bubble` en `globals.css`.
  Dep nueva: `leaflet` (+ `@types/leaflet`). `d3-geo`/`topojson-client`/
  `world-atlas` quedaron sin uso (se pueden quitar en una limpieza futura).
- Sin cambios de schema. **No requiere acción en prod** (sí `npm install`).

### Cambios de la sesión 04/jun/2026 — Mapa de análisis: escala del recuadro + zoom con rueda

- **Escala rota** (mapa chiquito en una caja ancha): la causa era el viewBox
  portrait fijo dentro de una celda ancha → la proyección fiteaba por alto y
  quedaba angosto/centrado. Ahora el recuadro se **dimensiona al aspect del
  contenido** (`computeBBox` + `bboxAspect` en `americas-map.tsx`): se mide el
  ancho disponible, se calcula el alto desde el aspect (cap `MAX_H`), y la
  proyección se fitea a esos píxeles → el mapa **llena la caja**.
- **Zoom con la rueda del mouse** + **pan arrastrando**: un `<g transform>`
  aplica `scale/translate`; la rueda hace zoom hacia el cursor (clamp 1–8x),
  arrastrar panea (clamp para no perder el mapa), botón de reset arriba a la
  derecha. Listener `wheel` nativo non-passive para `preventDefault`. Las
  burbujas mantienen tamaño constante (se separan al hacer zoom); el stroke de
  países es `non-scaling`. El zoom se resetea al cambiar el filtro.
- Sin cambios de schema, todo UI. **No requiere acción en prod.**

### Cambios de la sesión 04/jun/2026 — Mapa de análisis: match de mercados + zoom (todo UI)

Ajustes al mapa, **sin tocar la DB** (todo en `lib/market-geo.ts` + el componente):

- **Match por token**: un mercado como "Estados Unidos - Varios" no matcheaba
  (solo había match exacto) → caía a "Sin ubicación" y el mapa quedaba vacío.
  `resolveMarketGeo` ahora hace (1) match exacto y (2) match por token (la clave
  conocida aparece como palabra dentro del nombre normalizado). Cubre suffixes
  típicos (" - Varios", " - Nacional", " - CABA", etc.) + alias (eeuu/ee-uu).
- **Zoom a lo filtrado**: la proyección se re-`fitea` al bounding box de los
  mercados visibles (`computeProjection` en `americas-map.tsx`): silueta real
  del país para países normales, centroide + span fijo para los enormes (US/
  Canadá con Alaska) o agrupaciones. Sin filtro encuadra todo el footprint.
  Cada país lleva su `feature` (nombre en world-atlas) en `GEO`.
- **Groenlandia excluida** (hasta Canadá alcanza; no tira el encuadre al NE).
- Sin cambios de schema, sin deps nuevas. **No requiere acción en prod.**

### Cambios de la sesión 04/jun/2026 — Análisis por publisher × mercado con mapa de América

- **Nueva vista** que mapea las activaciones (placements de planes aprobados)
  por mercado sobre un **mapa de América** + tabla filtrable. Filtros: publisher,
  mercado, budget origin, período. Click en burbuja/ranking → filtra a ese mercado.
  Vive en **`/analisis`** (interna, con el filtro global de cliente) y en el tab
  **Análisis** del portal de cliente — ambas usan `components/market-analysis.tsx`.
- **Mapa** `components/americas-map.tsx`: SVG con **d3-geo** (react-simple-maps no
  soporta React 19). Topología `world-atlas/countries-110m.json` bundleada,
  filtrada al hemisferio occidental, proyectada con `geoMercator().fitSize`;
  dibujamos paths + burbujas (gradiente de marca, glow, anillo de pulso SMIL).
  Burbuja: tamaño = inversión, número = activaciones. Dark-aware vía `useChartColors`.
- **Geocoding** `lib/market-geo.ts` (`resolveMarketGeo`): mapea slug/nombre de
  mercado → centroide (países LATAM + agrupaciones). Los no reconocidos van a una
  lista "Sin ubicación". **Mercado nuevo → agregar centroide a `GEO`.**
- **Query** `db/queries/analysis.ts`: `getMarketActivations(filters)` (rows por
  placement + agregado por mercado) y `getAnalysisFilterOptions(clientId)`.
  Activación = placement de plan `approved`.
- **Deps nuevas**: `d3-geo`, `d3-scale`, `topojson-client`, `world-atlas` (+ types).
- Wiring: sidebar "Análisis x mercado" (icono Globe2), `/analisis` en
  `CLIENT_FILTER_ROUTES` y en `RESERVED_TOP_LEVEL_SLUGS`.
- Sin cambios de schema. **No requiere acción en prod** (sí `npm install` por las
  deps nuevas — ya en package.json/lock).

### Cambios de la sesión 04/jun/2026 — Polish de charts (recharts) + planeado vs real por publisher

- **Chart kit compartido** `components/chart-kit.tsx`: `useChartColors()` (un solo
  hook de tokens/dark-mode, antes duplicado en facturacion-chart y portal-charts),
  `tooltipStyle()` (card de tooltip único con sombra) y `<ChartGradient>` (defs de
  gradiente reusable). `facturacion-chart.tsx` y `portal-charts.tsx` ahora lo usan.
- **Polish visual**: barras con **fill de gradiente** (accent → accent-2) y esquinas
  redondeadas, grid más sutil (horizontal-only, dasharray `2 4`, opacity 0.6),
  tooltips consistentes. El "Facturado acumulado vs estimado" pasó de línea a
  **área** (fill degradé bajo la curva de facturado + estimado como línea punteada).
- **Inversión por publisher** ahora muestra **planeado vs real** (dos barras por
  publisher). `getClientSpendByPublisher` devuelve `{name, planned, real}`:
  planned = `media_plan_publishers.total_planned_usd` (planes no-draft), real =
  `plan_billing_publishers.amount_real_usd`.
- Sin cambios de schema. **No requiere acción en prod.**

### Cambios de la sesión 04/jun/2026 — Portal Resumen: 2 charts nuevos

- **Inversión por publisher** (barras horizontales, top 8 + "Otros"): consumo
  real acumulado del cliente. Query nueva `getClientSpendByPublisher(clientId)`
  en `db/queries/client-portal.ts` (suma `plan_billing_publishers.amount_real_usd`
  por publisher).
- **Facturado acumulado vs estimado (YTD)** (línea): acumulado corrido de real
  vs estimado del año en curso (cae a todos los meses si no hay data del año).
  Deriva de `getMonthlyTotals` (sin query nueva).
- Componentes en `components/portal-charts.tsx` (`SpendByPublisherChart`,
  `CumulativeBillingChart`) — recharts, dark-aware con el mismo patrón de
  `useThemeColors` que `facturacion-chart.tsx`. Se montan en el tab Resumen del
  portal.
- Sin cambios de schema. **No requiere acción en prod.**

### Cambios de la sesión 04/jun/2026 — Portal de cliente: ajustes (Gantt, proyectos abiertos, scrollbar)

Ajustes pedidos sobre el portal recién mergeado:

- **Reportes → Gantt**: la tab Reportes ahora muestra el **Gantt de entregas**
  (read-only) en vez de la tabla de "próximas entregas"; debajo sigue la tabla
  de **Reportes enviados** con link al PPT. `ReportingGantt`
  (`components/reporting-gantt.tsx`) ganó un prop **`readOnly`**: oculta los
  botones de edición (editar fecha / entregado / eliminar) y no linkea al
  detalle interno del proyecto. Los callbacks pasaron a opcionales.
- **Proyectos solo abiertos**: la tab Proyectos filtra a proyectos con status
  **planning / active / paused** (excluye closed y reportado). Sigue mostrando
  solo planes **aprobados**.
- **Scrollbar del encabezado**: la nav de tabs (`overflow-x-auto`) mostraba un
  scrollbar; se ocultó visualmente (sigue scrolleable en mobile) con
  `[scrollbar-width:none]` + `[&::-webkit-scrollbar]:hidden`.
- Sin cambios de schema. **No requiere acción en prod.**

### Cambios de la sesión 04/jun/2026 — Portal de cliente público (read-only) + favicon

- **Nuevo portal de cliente** en `/<slug>` (ej. `/copa-airlines`, reusa el slug
  interno): vista **solo lectura** para compartir con el cliente, con tabs
  Resumen (KPIs + chart) · Billing Tracker · Estimación · Proyectos · Reportes ·
  Benchmarks. Todo scopeado al cliente reusando las queries internas (dashboard,
  billing-tracker, estimate, reports, campaign-tracker para pacing, simulator
  para benchmarks). La tab Proyectos lista los planes **aprobados** con descarga
  PDF/Excel y, al expandir, el pacing por placement agrupado por publisher
  (con la fecha de última actualización en azul). Filtros por budget origin /
  proyecto / mes (URL-based).
- **Acceso**: usuario = nombre o slug del cliente; password compartido
  `sangriaagency` (`CLIENT_PORTAL_PASSWORD` en `lib/client-portal.ts`). En
  `/configuracion/clientes` se agregaron columnas **Portal / Usuario /
  Contraseña** con botones de copiar para pasárselos al cliente.
- **Seguridad (clave)**: el portal vive fuera del gate de Supabase. El proxy
  (`lib/supabase/middleware.ts`) abre como público **solo GET** a `/<slug>` +
  `/api/portal/*` (login/logout autovalidantes) + la descarga de export (GET).
  **Solo GET a propósito**: los Server Actions se despachan por POST sin importar
  el path y la app confía en el proxy como gate de mutaciones; por eso el portal
  **no usa Server Actions** (login/logout = route handlers, todo lo demás es
  URL-based). Slugs reservados en `RESERVED_TOP_LEVEL_SLUGS` — **toda ruta
  top-level nueva de la app hay que sumarla ahí**. El export valida
  `canAccessClientExport` (sesión interna O cookie de portal del cliente dueño).
- **Favicon**: ahora es una "S" blanca sobre fondo negro (`app/icon.svg`); se
  removió `app/favicon.ico`.
- Archivos nuevos: `app/(portal)/[clientSlug]/*`, `app/api/portal/{login,logout}/route.ts`,
  `lib/client-portal.ts`, `lib/client-portal.server.ts`, `db/queries/client-portal.ts`,
  `app/icon.svg`. Extendido `getBillingTracker` con `budgetOriginId`.
- Sin cambios de schema (reusa `clients.slug`). **No requiere acción en prod.**

### Cambios de la sesión 04/jun/2026 — Fix: crear reporte manual sin depender del filtro global

- **Bug**: en `/reportes/calendario` el botón "Crear reporte" estaba griseado
  cuando no había un cliente seleccionado en el filtro global del topbar — no se
  podía crear un reporte manual sin antes elegir cliente arriba.
- **Fix**: el cliente ahora se elige **dentro del modal** de creación. Nueva
  query liviana `getClientOptions()` (`db/queries/clients.ts`, `{id,name}` de
  clientes no archivados) que la page pasa al `ReportingCalendarClient`. El
  `CreateManualReportForm` agrega un `<select>` de cliente (preseleccionado con
  el `?client=` global si lo hay). El botón sólo se deshabilita si no existe
  ningún cliente activo; `submitCreateManual` usa el `clientId` del form.
- Sin cambios de schema. **No requiere acción en prod.**

### Cambios de la sesión 04/jun/2026 — /billing: filtro por estado

- Se agregó un dropdown **Estado** a los filtros de `/billing`
  (`components/billing-filters.tsx`), junto a Budget Origin / Proyecto / Rango
  de meses. URL-based (`?status=`), preserva el `?client=` global.
- Fuente única de los labels/orden: `BILLING_STATUSES` + `billingStatusLabel`
  exportados desde `components/billing-status-badge.tsx` (mismo texto que el
  badge, lang-aware es/en).
- Query: `getBillingsList` (`db/queries/billing.ts`) acepta `status` y filtra
  por `plan_billings.status`. La page valida `?status=` contra el enum
  (draft/ready/sent/invoiced/paid) antes de pasarlo.
- Sin cambios de schema. **No requiere acción en prod.**

### Cambios de la sesión 04/jun/2026 — Billing: editar o quitar el número de factura

- **Pedido**: poder cambiar el número de factura de un billing (sin permitir uno
  ya ocupado) o quitarle el número y dejarlo vacío.
- **Editar**: ya funcionaba — `markBillingInvoiced` pre-chequea unicidad contra
  los demás billings y devuelve error legible (toast) si el número está tomado.
  El botón "Editar número" está en los estados `invoiced` y `paid`.
- **Quitar (nuevo)**: nueva action `clearBillingInvoiceNumber` en
  `app/actions/plan-billing.ts`: pone `invoice_number = null` y revierte el
  billing `invoiced → sent` (reportado) — un billing facturado sin número sería
  inconsistente. Sólo se permite desde `invoiced`; si está `paid` pide revertir
  el pago primero ("Revertir a facturado"). El `due_date` se conserva.
- **UI**: botón "Quitar número" junto a "Editar número" en el estado `invoiced`
  (`BillingStatusActions` en el editor de billing del plan), con confirm dialog.
- Sin cambios de schema. **No requiere acción en prod.**

### Cambios de la sesión 04/jun/2026 — Reporte PDF de billing: usar el nombre del plan en la descripción

- **Pedido**: cada línea "Media Placement" del PDF debe incluir el **nombre del
  media plan** en vez del code del proyecto. Ej: en vez de
  `tarifas-mexico - Tarifas Mexico - Meta - May 2026` →
  `COPA.m1188 - Tarifas Mexico - Meta - May 2026` (donde `COPA.m1188` es el
  nombre del plan).
- **Fix** en `app/api/billings/[id]/report.pdf/route.ts`: la descripción de
  cada fila pasó de `${project.code} - ${project.name} - ${publisher} - ${mes}`
  a `${plan.name} - ${project.name} - ${publisher} - ${mes}`. El code del
  proyecto era redundante con el nombre (es su slug); el nombre del plan es más
  útil. `getBillingDetail` ya devolvía `detail.plan.name`.
- Sin cambios de schema. **No requiere acción en prod.**

### Cambios de la sesión 04/jun/2026 — Fix: error al descartar el borrador de un MP

- **Bug**: al "Descartar borrador" (volver al plan aprobado) la vista crasheaba
  con el error boundary ("Ocurrió un error al cargar esta vista"), no un toast.
- **Causa raíz**: el snapshot de la versión aprobada es JSONB congelado. Si un
  placement referenciaba un `market_id` que **se borró** después de la
  aprobación (los markets se editan/borran desde config; la FK live es
  `onDelete: set null`), al reinsertar ese placement se violaba la FK a
  `markets` → la transacción reventaba → la excepción se propagaba sin atrapar
  (no había try/catch) y disparaba el error boundary en vez de un toast.
- **Fix** en `revertPlanToApprovedSnapshot` (`app/actions/plans.ts`):
  - Antes de la transacción, se consultan los markets vivos entre los
    `market_id` del snapshot; al reinsertar, un `market_id` que ya no existe se
    deja en `null` (lo mismo que hizo la FK al borrarse).
  - Se saltean placements cuyo publisher del snapshot no se pudo reinsertar
    (idMap sin parent), por las dudas.
  - La transacción va envuelta en try/catch: cualquier fallo inesperado vuelve
    como `{ok:false}` (toast legible) en vez de romper la vista.
  - El `publisher_id` es seguro (`onDelete: restrict`).
- Sin cambios de schema. **No requiere acción en prod.**

### Cambios de la sesión 04/jun/2026 — Reporte PDF de billing: excluir publishers que paga el cliente

- **Pedido**: los publishers que el cliente paga directo (`agency_pays=false`)
  no deben facturarse ni reportarse. Su inversión de medios **no** debe estar
  en el PDF de finanzas. (Sí se siguen cargando en el billing: su consumo
  alimenta el cálculo del management fee, que el cliente sí paga.)
- **Fix** en `app/api/billings/[id]/report.pdf/route.ts`: el filtro de líneas
  de "Media Placement" pasó de `p.isBillable && amount > 0` a
  `p.agencyPays && p.isBillable && amount > 0`. `agencyPays` es la verdad
  estructural (override del bloque ?? default del publisher); con esto un
  publisher client-pays nunca entra al reporte, aunque su `isBillable` haya
  quedado en `true` (default del insert path o checkbox tildado por error).
  Se conserva `isBillable` para poder marcar no-facturable un publisher de
  agencia en un mes puntual.
- **No se tocó** el cálculo del management fee ni el editor de billing: los
  publishers client-pays siguen visibles y cargables en la vista mensual.
- Sin cambios de schema. **No requiere acción en prod.**

### Cambios de la sesión 04/jun/2026 — Actualización completa de la documentación

- **README.md — Estructura del proyecto**: actualizados los bloques de `app/(app)/`, `components/` y `lib/` con todos los archivos nuevos de las sesiones de junio:
  - `app/(app)/loading.tsx`, `error.tsx`, `not-found.tsx` (esqueleto de página, error boundary, 404).
  - `components/button.tsx`, `plan-status-badge.tsx`, `billing-status-badge.tsx`, `toast.tsx`, `confirm-dialog.tsx`, `app-providers.tsx`, `mobile-nav.tsx`, `billing-filters.tsx`.
  - `lib/permissions.ts` (allowlist de aprobación de planes).
  - Sección nueva `.claude/skills/` (`ui-ux-pro-max`, `context7`).
  - Descripción de `layout.tsx` actualizada (ahora es async y monta providers).
- **HANDOFF.md**: encabezado actualizado a 04/jun/2026; se agrega `c1ba37c` (#109) a "Commits recientes".
- Todos los cambios de código de la sesión 01/jun/2026 ya estaban documentados en las entradas anteriores de este HANDOFF. **No requiere acción en prod.**

### Cambios de la sesión 01/jun/2026 — Unificar el badge de estado de billing

- Se extrajo **`components/billing-status-badge.tsx`** (`BillingStatusBadge`)
  como fuente de verdad única del label + color del estado de un billing
  (draft/ready/sent/invoiced/paid), lang-aware (es/en), prop `size` `md`/`sm`.
- Reemplaza los **3 mapas de estilos duplicados** que existían (lista de meses
  del plan, detalle del editor, vista global `/billing`) + el pill inline del
  `/billing-tracker`. Esto resuelve la deuda anotada en el fix anterior: el bug
  de "facturado → draft" venía justo de tener el mapa repetido y desincronizado.
- Labels unificados (mismo estado, mismo texto en todas las vistas): la lista
  de meses ahora dice `borrador/reportado/facturado/pagado` (antes
  `draft/emitida/pagada`).
- Sin cambios de schema. **No requiere acción en prod.**

### Cambios de la sesión 01/jun/2026 — Fix: billing facturado se mostraba como "draft" en la lista de meses

- **Bug**: en el billing del plan, un mes en estado `invoiced` (facturado)
  aparecía como **"draft"** en la lista lateral "Meses del plan", aunque el
  detalle lo mostraba bien como "facturado".
- Causa: `BillingStatusPill` (en `…/billing/page.tsx`) tenía el mapa de
  estilos sin la key `invoiced`, así que caía al fallback `styles.draft`. El
  pill del detalle (`BillingStatusPillInline` en `editor.tsx`) sí la tenía.
- Fix: se agregó `invoiced` ("facturado", accent) al mapa del pill de la lista.
- **Nota / deuda**: hay dos mapas de estilos de estado de billing duplicados
  (lista vs. detalle) con labels que aún difieren (emitida/reportado,
  pagada/pagado). Conviene unificarlos en un `BillingStatusBadge` compartido
  (como `PlanStatusBadge`) para que no se repita este tipo de bug.
- Sin cambios de schema. **No requiere acción en prod.**

### Cambios de la sesión 01/jun/2026 — UX hardening (toasts, confirm, loading/error, a11y, mobile)

Auditoría UI/UX (apoyada en el skill `ui-ux-pro-max`) → implementación de los
gaps transversales:

- **Toasts** (`components/toast.tsx`, `useToast`): feedback no bloqueante
  (success/error/info) con live-region (role=alert/status) y auto-dismiss.
  Reemplazan los `alert()` nativos. Toasts de éxito en acciones clave
  (aprobar/listo/descartar plan, guardar/eliminar proyecto, restaurar, etc.).
- **Diálogo de confirmación** (`components/confirm-dialog.tsx`, `useConfirm`):
  modal accesible promise-based (`await confirm({title, body, danger})`) con
  focus-trap, Escape, backdrop, scroll-lock, restauración de foco. Reemplaza
  los `confirm()` nativos en los 8 archivos que los usaban.
- Ambos se montan en `components/app-providers.tsx` (en el layout, envolviendo
  el contenido).
- **Estados de carga**: `app/(app)/loading.tsx` + `PageSkeleton`
  (`components/skeleton.tsx`) → skeleton de página durante la navegación (la
  chrome persiste). Antes el `Skeleton` existía pero no se usaba.
- **Errores de UI**: `app/(app)/error.tsx` (boundary con retry) y
  `app/(app)/not-found.tsx` (404 con `EmptyState`).
- **a11y de errores de formulario**: `role="alert"` en los contenedores de
  error (forms de proyecto/plan, config de cliente, calendario, login, etc.)
  para que los lectores de pantalla los anuncien.
- **Responsive / mobile**: el sidebar ahora es un **drawer** deslizable en
  `< lg` (oculto por default, hamburguesa en el topbar, backdrop, cierra al
  navegar/Escape) y mantiene su comportamiento sticky/colapsable en `≥ lg`.
  Estado compartido en `components/mobile-nav.tsx` (`MobileNavProvider` +
  `MobileNavToggle`). La tabla de `/planes` (lista) scrollea horizontal en vez
  de aplastarse (la de proyectos ya era responsive).
- Keyframes `toast-in` / `fade-in` / `dialog-in` en `globals.css` (con
  `prefers-reduced-motion`). Sin cambios de schema; **no requiere acción en prod**.

### Cambios de la sesión 01/jun/2026 — Skills de Claude Code versionados (ui-ux-pro-max + context7)

- Se agregaron skills de Claude Code al repo en **`.claude/skills/`** para que
  estén disponibles en las **sesiones de Claude Code on the web** (que solo
  cargan skills bundled + los commiteados en el repo; no heredan los locales).
  - **`ui-ux-pro-max`**: design intelligence (estilos, paletas, tipografías,
    99 guías UX, charts). Trae `scripts/*.py` (BM25 search) + `data/*.csv`.
    Uso: `python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<query>"
    --domain <style|color|chart|ux|typography|...>`. Fuente:
    github.com/nextlevelbuilder/ui-ux-pro-max-skill.
  - **`context7`**: docs de librerías al día vía la API pública de Context7
    (curl, sin API key). Fuente: github.com/intellectronica/agent-skills.
- `.gitignore`: se cambió `.claude/` → `.claude/*` + `!.claude/skills/` para
  versionar solo los skills (el resto de `.claude/` sigue ignorado). El
  `__pycache__` de los scripts queda ignorado.
- **No es código de la app** (no afecta el build de Vercel); es tooling de dev.

### Cambios de la sesión 01/jun/2026 — Aprobar planes restringido a una allowlist

- Aprobar un plan (ready_to_send → approved) ahora está limitado a
  **mariano.mantovani@sangria.agency** y **herman.grabosky@sangria.agency**.
- Allowlist + helper en **`lib/permissions.ts`** (`PLAN_APPROVER_EMAILS`,
  `canApprovePlans(email)`, case-insensitive; sin imports server-only).
- **Barrera real** (server-side): `transitionPlanStatus` en
  `app/actions/plans.ts` chequea `canApprovePlans(getCurrentUser().email)` cuando
  `to === "approved"` y devuelve error si no está autorizado.
- **UI**: la page del plan (`…/[planId]/page.tsx`) pasa `canApprove` al
  `PlanEditor`; el botón "Aprobar (firmado)" solo se muestra si es true; al
  resto le aparece un "Aprobación restringida" (con tooltip de los emails).
- Es el **primer permiso por rol** del sistema. Cuando se arme el modelo de
  roles general, migrar esta allowlist. Sin cambios de schema; **no requiere
  acción en prod**.

### Cambios de la sesión 01/jun/2026 — Fix: un billing en draft no debe sacar el mes del tablero

- **Bug**: en el tablero de pendientes, abrir un billing de un mes cerrado y
  dejarlo en `draft` (sin terminar) lo borraba de "Billing reports a completar".
  Debería seguir pendiente hasta marcarlo **`ready` ("listo")**.
- Fix en `getPendingBillings` (`db/queries/pendings.ts`): el set de "meses ya
  facturados" ahora solo cuenta filas de `plan_billings` con
  `status != 'draft'` (ready/sent/invoiced/paid). Un `draft` ya no cuenta como
  completado, así que el mes vuelve a aparecer hasta que se marca listo.
- Sin cambios de schema. **No requiere acción en prod.**
- **Pendiente (aparte, NO incluido)**: reportado que hay MPs que finalizan en
  Junio y no aparecen en el Dashboard. El usuario confirmó que es un tema
  distinto a este; queda para una próxima sesión (no es la categoría "Billings a
  completar").

### Cambios de la sesión 01/jun/2026 — Cosmético: primitivo Button + usuario real en el sidebar

- **Primitivo `Button`** (`components/button.tsx`): el botón primario `bg-ink`
  estaba inline, repetido en ~13 archivos, y driftaba en padding/tamaño/estados.
  Ahora hay una fuente única, estilo shadcn:
  - `Button` para `<button>`; `buttonVariants()` devuelve el className para
    reusar el mismo look en `<Link>`/`<a>`.
  - Variantes `primary` (default) / `secondary` / `ghost` / `danger`; tamaños
    `xs` / `sm` / `md` (default) / `lg`.
  - Migrados ~26 botones primarios en 12 archivos (proyectos, planes, editor,
    billing, reportes, config de clientes, tracker, calendario). El focus ring
    sigue saliendo del `*:focus-visible` global. **Excluido a propósito**: el
    toggle segmentado de `campaign-tracker/page.tsx` (no es un CTA).
- **Usuario real en el sidebar**: el footer mostraba `"Mariano Manto / admin"`
  hardcodeado. Ahora el layout (`app/(app)/layout.tsx`) lee `getCurrentUser()`
  **una sola vez** y se lo pasa a `Sidebar` (footer: avatar de Google o
  iniciales + nombre + email) y a `Topbar` (que antes lo leía por su cuenta —
  se eliminó esa 2ª llamada redundante).
- Sin cambios de schema ni de comportamiento. **No requiere acción en prod.**

### Cambios de la sesión 01/jun/2026 — Cosmético: badge de estado de plan unificado

- **Bug visible**: el mismo estado `ready_to_send` se mostraba como
  **"ready to send"** en el editor y el detalle de proyecto, pero como
  **"ready"** en las tablas de Planes y Proyectos. El mapa de estilos del badge
  vivía duplicado en 4 archivos y el label había driftado.
- Nuevo componente **`components/plan-status-badge.tsx`** (`PlanStatusBadge`):
  fuente de verdad única del label + color + dot del estado de un plan. Espejo
  de `StatusBadge` (estados de proyecto). Prop `size`: `md` (default, headers +
  tabla de planes) y `sm` (filas compactas del breakdown de proyectos).
- Reemplazados los 4 mapas locales (`editor.tsx`,
  `proyectos/[code]/page.tsx`, `projects-table-expandable.tsx`,
  `plans-table-client.tsx`) por el componente. Neto −86 líneas. El badge del
  card de proyecto pasa de `text-[10px]` a `text-[11px]` (diferencia de 1px,
  más consistente con el resto).
- Limpieza de **código muerto cosmético**: ternarios con ambas ramas idénticas
  en `kpi-card.tsx` (`labelColor`/`hintColor` siempre `text-muted`) y en
  `planes/page.tsx` (hint de la KPI "Vigentes", `lang === "es" ? X : X`).
- Sin cambios de schema ni de comportamiento. **No requiere acción en prod.**

### Cambios de la sesión 01/jun/2026 — Editor: descartar borrador y volver al plan aprobado

- Al editar un plan que viene de una versión aprobada (el botón "Editar (nueva
  versión)" pasa `approved` → `draft`), el editor ahora muestra un botón
  **"Descartar borrador"** junto a "Marcar listo para enviar". Aparece **solo
  cuando `currentVersion > 0`** (hay un snapshot aprobado al cual volver). Tira
  todos los cambios del borrador y restaura el plan al **snapshot de la versión
  aprobada vigente** (`version_number = currentVersion`), dejándolo de nuevo en
  `approved`.
- Nueva action `revertPlanToApprovedSnapshot` en `app/actions/plans.ts`:
  restaura **en transacción** — borra publishers/placements/fees del draft (los
  placements cascadean) y reinserta los del snapshot mapeando old→new ids —,
  restaura nombre + notas y vuelve a `approved`. `currentVersion` no cambia.
  Pre-chequea colisión de nombre contra el partial unique index
  `(project_id, name) WHERE deleted_at IS NULL` si el draft había renombrado el
  plan, devolviendo un error legible. Irreversible: los cambios del draft se
  pierden.
- UI en `editor.tsx`: handler `onDiscardDraft` con un `confirm` que aclara la
  versión a la que se vuelve. Reusa los snapshots ya cargados por
  `getPlanDetail`.
- Sin cambios de schema. **No requiere acción en prod.**

### Cambios de la sesión 27/may/2026 — Reporting Calendar: reportes manuales

> **ACCIÓN REQUERIDA EN PROD**: este cambio agrega la tabla `manual_reports`.
> Hay que correr **`npm run db:push`** después del deploy (o pegar el SQL de
> abajo en el SQL Editor de Supabase). Es aditivo, sin backfill. Después
> aplicá `db/rls.sql` (también actualizado) para habilitar RLS en la tabla
> nueva.

- Botón **"Crear reporte"** en `/reportes/calendario` (esquina sup. derecha,
  al lado del filtro de Budget Origin). Abre un modal con **cliente, nombre,
  descripción, fecha de entrega**. El selector de cliente vive en el modal
  (poblado por `getClientOptions`), así que NO depende del filtro global del
  topbar: si hay un cliente en `?client=` viene preseleccionado, sino se elige
  ahí. El botón sólo se deshabilita si no hay ningún cliente activo.
  (Antes exigía un cliente en el filtro global y el botón quedaba griseado.)
- El reporte manual aparece en el Gantt como cualquiera de los otros, con
  badge "manual" y la descripción opcional inline. Se puede editar fecha,
  marcar entregado, asignar link al PPT y **eliminar** (los project_reports
  no se pueden eliminar — los maneja el lifecycle del proyecto).
- Cuando se marca como entregado, va a la lista de "Reportes enviados"
  debajo del Gantt. Soporta link al PPT igual que los project_reports.
- Schema: nueva tabla `manual_reports` (id, client_id FK, name, description,
  delivery_date, delivery_date_assigned_at, delivered_at, report_ppt_url,
  notes, created_at, updated_at) + dos índices (pending por
  delivered_at+delivery_date, y client_id).
- Tipos `CalendarReport` y `SentReport` ahora tienen un discriminador
  `kind: "project" | "manual"` + `description` (solo manual) +
  `projectId`/`projectCode`/`closedAt`/`budgetOriginName` nullable (null para
  manual).
- Actions actualizadas en `app/actions/reports.ts`:
  `setReportDeliveryDate`, `markReportDelivered` y `setReportPptUrl` ahora
  reciben `kind` y rutean a la tabla correspondiente. Nuevas:
  `createManualReport` y `deleteManualReport`.
- Pendings (`db/queries/pendings.ts`): `PendingReport.projectCode` pasa a
  `string | null` para que los manuales también caigan en el tablero del
  dashboard. La UI ya usa `projectName`/`clientName`, no necesitaba cambios.

### Cambios de la sesión 27/may/2026 — Generador de reportes: column picker

- Agregado al form de `/reportes/generador` un **column picker** (collapsible)
  para elegir qué columnas mostrar en el preview y descargar en el Excel.
  Tres categorías de checkboxes:
  - **Identidad**: client, project, budget origin, plan, publisher, placement,
    market, cost method, dates, audience.
  - **Monto**: planned (USD), billed share (USD).
  - **Métricas**: una checkbox por cada métrica del catálogo del cliente
    (ej. impressions, clicks, views, CPM, CTR, etc.).
- URL-based via `?cols=client,plan,placement,planned,impressions,...`
  (comma-separated slugs). **Default sin `cols`** = todas las columnas
  (back-compat con links viejos). Al primer toggle el form materializa el
  set completo en la URL y empieza a destildar/tildar desde ahí.
- Botón "Reset" devuelve a default. La selección preserva los filtros
  existentes (project/plan/etc.) y viaja al Excel via los mismos query
  params → preview y archivo siempre coinciden.
- Si el usuario destilda todo, el resolver muestra al menos `placement` como
  fallback (no tiene sentido un Excel sin columnas).
- Implementación compartida en `lib/historical-report-columns.ts`
  (`IDENTITY_COL_IDS`, `MONEY_COL_IDS`, `parseColsParam`,
  `resolveReportColumns`) que usan los tres puntos: form, page y route
  handler del Excel.
- `getReportFilterOptions` ahora devuelve también el catálogo de métricas
  (`metrics: {slug, name, unit, kind}[]`) del cliente para alimentar los
  checkboxes.
- **Sin cambios de schema** → no requiere acciones en prod.

### Cambios de la sesión 27/may/2026 — Fixes UI: client picker en /reportes/generador + sacar BillingEstimateCard de /proyectos

- **Fix (mismo patrón que /reportes/simulador en su momento)**: al cambiar de
  cliente desde el topbar estando en `/reportes/generador`, el picker
  redirigía al dashboard porque la ruta no estaba registrada en
  `CLIENT_FILTER_ROUTES` (`lib/client-filter.ts`). Se la agregó. Ahora el
  picker se queda en `/reportes/generador?client=slug`.
- **Cleanup**: removimos las cards de `BillingEstimateCard` de `/proyectos`
  (lista) y `/proyectos/[code]` (detalle). Esa estimación ya vive en
  `/billing-tracker?tab=estimates` desde el PR #77; no tiene sentido
  duplicarla en proyectos. Se sacaron también las queries y helpers
  `nextMonths`/`previousMonth` que quedaron huérfanos.
- **Sin cambios de schema** → no requiere acciones en prod.

### Cambios de la sesión 27/may/2026 — Generador de reportes históricos (Excel)

- Nueva ruta `/reportes/generador` que arma un Excel con los datos ya cargados
  (billing + campaign tracker) filtrando por **cliente** (filtro global),
  **budget origin**, **proyecto**, **plan**, **placement** y rango **from/to**
  (YYYY-MM). 1 fila por placement con data histórica en la ventana.
- **Preview en vivo**: la página renderiza la misma tabla que el Excel a medida
  que cambian los filtros (URL-based, server-rendered). El botón "Descargar
  Excel" usa los mismos query params, garantizando que preview y archivo sean
  idénticos.
- Granularidad:
  - **Tracker**: último snapshot por (placement, metric) dentro de la ventana
    (`campaign_actual_snapshots.value_accumulated` ordenado por
    `snapshot_date` desc).
  - **Billing**: suma de `plan_billing_publishers.amount_real_usd` por
    (plan, publisher) dentro de la ventana, **prorrateado** a cada placement
    por `placement.amount_usd / Σ amount_usd de placements del publisher en
    el plan`. Única manera honesta de bajar billing (publisher×mes) a
    granularidad de placement.
- Columnas del Excel: cliente, proyecto + code, budget origin, plan,
  publisher, placement, mercado, cost method, start/end, audiencia, planeado
  USD, facturado share USD, + una columna por métrica del catálogo del cliente
  que aparezca en algún snapshot.
- Filtros cascading client-side desde una sola fetch server-side de
  `getReportFilterOptions(clientId)`: origin → projects → plans → placements.
  Cambiar un filtro padre limpia los hijos.
- Archivos nuevos:
  - `db/queries/historical-report.ts` (`getHistoricalReport` +
    `getReportFilterOptions`).
  - `app/api/reports/historical.xlsx/route.ts` (route handler que llama la
    misma query y arma el Excel con ExcelJS, mismo estilo que el export de
    plan: logo, banner, header con filtros, freeze, números formateados por
    `unit` del catálogo).
  - `app/(app)/reportes/generador/page.tsx` (server component con form +
    preview).
  - `components/report-generator-form.tsx` (client, URL-based, cascading).
- Card nueva en la landing `/reportes`. Sidebar no se tocó — se llega vía la
  landing.
- **Sin cambios de schema** → no requiere acciones en prod.

### Cambios de la sesión 27/may/2026 — /planes: KPIs, density toggle, sort, agrupado, consumo

Cinco mejoras al listado de Planes de Medios para que deje de ser un catálogo
plano:

- **Strip de KPIs** arriba del listado: total media + consumido (con barra de
  progreso al accent) + cantidad de planes vigentes (approved + ready) +
  drafts. Computado server-side desde el set ya filtrado por status / origen
  / cliente.
- **Toggle de densidad** (Normal / Compacta), persistido en localStorage
  (`sangria:planes:density`). En compacta cambian padding y tamaño de tabla;
  deja entrar ~50% más de filas por viewport.
- **Sort por columnas**: Plan / Proyecto / Cliente / Estado / Período /
  Media·Consumido son clickeables, alternan asc↔desc; default name asc.
- **Vista "Por proyecto"** (toggle alternativo a Lista): cada proyecto es una
  card con sus planes anidados y un mini-resumen (cantidad de planes + total
  media + consumido). Preferencia persistida en `sangria:planes:view`.
- **Columna Media·Consumido**: en cada plan se muestra el total media, una
  barra de progreso del consumo real (basado en
  `plan_billing_publishers.amount_real_usd`) y el % consumido. Para no
  expandir el listado se queda en una sola columna.
- Query nueva en `app/(app)/planes/page.tsx` (sum de `amount_real_usd` por
  plan), en paralelo con las queries de total y período (sin cartesian con
  placements/billings).
- **Sin cambios de schema** → no requiere acciones en prod.

### Cambios de la sesión 27/may/2026 — Billing Tracker: tabs "Tracker" + "Estimates"

- Movimos las cards de **Billing Estimate** de `/planes` a `/billing-tracker`.
  La sección ahora tiene **dos pestañas URL-based** (default `tracker`,
  `?tab=estimates` para el otro):
  - **Tracker**: lo que tenía antes (proyectos → planes → facturas emitidas,
    con filtros project/from/to via `BillingTrackerFilters`).
  - **Estimates**: el `BillingEstimateCard` con el mes previo + próximos 2,
    filtrado por `?client=` global.
- Tabs renderizadas server-side con `<Link>` (mismo patrón que los chips de
  filtros del proyecto) — preservan estado al refrescar y son shareables.
  Estilo `border-b-2 -mb-px` con `border-accent` activo (mismo patrón que
  `components/simulator/simulator-client.tsx`).
- Se borró de `/planes/page.tsx` la lógica de `nextMonths`/`previousMonth`,
  el import de `BillingEstimateCard`/`getBillingEstimate` y el render. La
  página queda focused en el listado + filtros.
- **Sin cambios de schema** → no requiere acciones en prod. Es puro UI.

### Cambios de la sesión 27/may/2026 — Fix bug: /planes inflaba el total media (cartesian publishers × placements)

- Bug reportado por el usuario: un plan de 780K (real ~702K) en el listado
  `/planes` aparecía como ~7M. Dentro del plan se veía bien.
- Causa: la query de `app/(app)/planes/page.tsx` (y `getPlansSummaryForProjects`
  en `db/queries/dashboard.ts`) joineaba `media_plan_publishers` **y**
  `media_plan_placements` en la misma query y hacía
  `sum(publisher.total_planned_usd)`. Como placements cuelga 1:N de publishers,
  cada `total_planned_usd` se repetía una vez por placement → total inflado por
  el factor "placements promedio por publisher". (min/max de fechas no
  afectaban porque min/max son idempotentes.)
- Fix: separar el `sum` del total media (en una query sobre
  `media_plan_publishers` sola) del cálculo de `period` (min/max sobre
  `placements`, joineando publishers solo para filtrar por plan). Se mergea en
  JS. Mismo patrón ya usado en `db/queries/project-detail.ts` y en
  `app/actions/plans.ts:1147`.
- Verificado con SQL contra prod (13 planes afectados, factor 1.88x–11x). Tras
  el fix, los totales del listado coinciden con los del editor del plan.
- **Sin cambios de schema** → no requiere acciones en prod. Es un fix de
  display; los datos en DB siempre fueron correctos.

### Cambios de la sesión 27/may/2026 — Billing del plan: management fee se autoprorratea por consumo

- Pedido del usuario: cuando la analista carga el billing mensual de un plan,
  el management fee del mes debería autopoblar como
  `(gasto del mes / total media del plan) × total del fee`. Editable a mano,
  respetando el cap del remanente.
- Implementación: nuevo helper privado `autoRecomputeMgmtFees(billingId,
  mediaPlanId)` en `app/actions/plan-billing.ts`. Se llama dentro de
  `setPublisherConsumption` (después de upsertear la fila del publisher, antes
  de `recalcBillingTotals`), así cada cambio de consumo recalcula la imputación
  del management fee del mes.
  - Cubre **todos** los `media_plan_fees` de `fee_type='management'` con
    `rate_pct` válido (>0 y <100) del plan.
  - Total del fee = `TM × ratePct / (100 − ratePct)` (misma fórmula que en el
    schema y en el editor de plan).
  - Gasto del mes = suma de `plan_billing_publishers.amount_real_usd` con
    `is_billable=true` de este billing.
  - Cap por remanente = `total − sum(otros meses)`. La proración se clampea
    a `[0, remanente]`.
  - Upsert con `onConflictDoUpdate` por las dudas (la fila normalmente la
    pre-crea `ensureBillingForMonth` en cero).
- **Modelo de override**: si la analista edita a mano vía `setFeeImputation`
  (que ya existía y mantiene su validación de cap), el valor manual queda
  guardado, pero el próximo cambio en un publisher de ese mes vuelve a
  prorratearlo. Es el modelo más simple (sin flag de "manual override"); el
  user-flow esperado es que la analista ajuste a mano al **final**, después de
  cargar todos los consumos.
- UI: en la fila del management fee del editor de billing del plan se muestra
  un badge `auto` con tooltip explicando el comportamiento.
- **Sin cambios de schema** → no requiere acciones en prod.

### Cambios de la sesión 27/may/2026 — Editor: tarifa/delivery rate-anchored al cambiar el monto

- Bug que reportó el usuario: una vez que tarifa y delivery tenían valor,
  tocar el monto del placement los dejaba inconsistentes (el inspector mostraba
  el warning "Tarifa y delivery cargados no coinciden") y forzaba a re-editar a
  mano para que volviera a calcular.
- Fix: nuevo helper `recomputeMetricsForAmount(metricsJson, newAmount)` en
  `editor.tsx`. Al editar el monto del placement, **mantiene la tarifa** y
  recalcula el delivery proporcionalmente para todo pair con rate cargado —
  principal y secundarios. Es el modelo "rate-anchored" típico de planificación
  (la tarifa es lo negociado, el delivery escala con el budget). Se pasan los
  dos campos (`amountUsd` + `metricsJson`) en el mismo `updatePlacement` para
  que quede atómico.
- Para que las filas de `MetricsEditor` (métricas secundarias) reflejen el
  recálculo sin recargar, sincronicé el draft con `metrics` usando el patrón
  **render-phase setState** (`if (prevMetrics !== metrics) { … }`). El linter
  del repo bloquea `setState` dentro de `useEffect` y la guía de React
  recomienda este patrón para "Adjusting state when a prop changes". Las filas
  nuevas en progreso (slug vacío) se preservan.
- El comportamiento "edita uno → recalcula el otro" ya estaba en
  `applyPrimaryPairChange` / `onChangeRate`/`onChangeDelivery` — no hizo falta
  cambiarlo, pero queda más visible ahora porque ya nunca se llega al estado
  inconsistente que disparaba la sensación de "tengo que borrar ambos".
- **Sin cambios de schema** → no requiere acciones en prod.

### Cambios de la sesión 27/may/2026 — Reportes enviados: link al PPT final

> **ACCIÓN REQUERIDA EN PROD**: este cambio agrega la columna
> `project_reports.report_ppt_url` (text, nullable). Hay que correr
> **`npm run db:push`** después del deploy. Es aditiva, sin backfill (las filas
> existentes quedan con `report_ppt_url = null`). Hasta que se corra, la query
> `getSentReports` (que ahora selecciona la columna) y la página
> `/reportes/calendario` fallan.

- En el listado de **Reportes enviados** (debajo del Gantt en
  `/reportes/calendario`) cada fila ahora tiene una columna **"Reporte (PPT)"**:
  - si no hay link → botón "Agregar link";
  - si hay → link "Ver PPT" (abre en pestaña nueva) + lápiz para editar.
- El analista carga/edita/quita la URL desde un modal (`LinkForm` en
  `components/reporting-calendar-client.tsx`). Es **opcional**; sirve para
  encontrar el PPT final (en Drive) rápido a futuro. Solo se guarda la URL, no
  se sube ni valida el contenido.
- Server action nueva `setReportPptUrl({ reportId, url })` en
  `app/actions/reports.ts`: valida que sea `http(s)` (con `new URL`), url vacío
  = quitar el link, audita (`ppt_url_set` / `ppt_url_clear`) y revalida
  `/reportes/calendario`. `getSentReports` + el tipo `SentReport` ahora incluyen
  `reportPptUrl`.
- **Schema**: `project_reports.report_ppt_url` (`db/schema.ts`).

### Cambios de la sesión 26/may/2026 — Editor: preview tipo Excel (read-only)

- Nuevo componente `ExcelPreview` en `editor.tsx`: una tabla **read-only** debajo
  del workspace de Publishers que replica el Tab 1 del Excel — cada placement con
  **todas las métricas en columnas**, subtotal por publisher (fechas + monto +
  métricas) y fila `TOTAL MEDIA`. Es colapsable (chevron) y scrollea horizontal.
  Audiencia, notas y fees se omiten en el preview (sí salen en Excel/PDF).
- **No cambia la edición**: la grilla + inspector siguen igual; el preview es solo
  visualización. La "planilla 100% editable" se evaluará aparte en **otra branch**.
- Reusa los mismos helpers que los exports para no divergir
  (`resolveMetricColumns`, `placementMetricValue`, `evalFormula`,
  `placementsPeriod` y el nuevo `sumDirectMetrics`, todos en `lib/plan-metrics.ts`).
- De paso se **deduplicó `sumDirects`**: estaba copiado en el route del Excel y en
  `plan-pdf.ts`; ahora ambos usan `sumDirectMetrics` compartido.
- **Sin cambios de schema** → no requiere acciones en prod.

### Cambios de la sesión 26/may/2026 — Exports (Excel + PDF): fechas en los tres niveles

- Los exports del plan ahora muestran fechas en **plan / publisher / placement**,
  tanto en Excel como en PDF:
  1. **Período general del plan** (más temprana/más tardía de todos los
     placements) — Excel: ya estaba en la metadata; PDF: se agregó la línea
     `Período` en el encabezado (antes faltaba).
  2. **Fecha de cada publisher** = más temprana/más tardía de sus placements —
     Excel: en las columnas start/end de la fila de subtotal; PDF: sub-línea gris
     bajo el nombre del publisher (la fila crece a 24pt cuando hay fechas).
  3. **Fecha de cada placement** — ya estaba en ambos (columnas en Excel,
     sub-línea en PDF).
- Helper compartido nuevo `placementsPeriod(placements)` en `lib/plan-metrics.ts`
  (min start / max end; las ISO ordenan cronológicamente). El cálculo inline del
  período del plan en el Excel se reemplazó por este helper.
- Verificado con un smoke test de `renderPlanPdf` (fixture con un publisher con
  fechas y otro sin fechas) → PDF válido, sin romper.
- **Sin cambios de schema** → no requiere acciones en prod.

### Cambios de la sesión 26/may/2026 — Planilla: achicar tarifa/delivery de la métrica principal

- En la grilla de placements las cajas de **Tarifa** y **Delivery** (métrica
  principal) eran `w-full` y se comían el ancho de la fila. Ahora `RateInput` y
  `DeliveryInput` aceptan un prop `className` (default `w-full`, así el inspector
  y la tabla de indicadores no cambian) y en la **planilla** se angostan a
  `w-24` (tarifa) / `w-28` (delivery), right-aligned. Recupera espacio horizontal
  por fila sin tocar las cajas del inspector.
- **Sin cambios de schema** → no requiere acciones en prod.

### Cambios de la sesión 26/may/2026 — Inspector del placement: más ancho + textareas más altas

- **Continuación del cambio de inputs**: faltaba el panel inspector. Las métricas
  secundarias ya usaban `RateInput`/`DeliveryInput` (caja + fórmulas), pero el
  inspector medía `380px` y los apretaba; audiencia y notas eran textareas de 2
  filas.
- **Inspector más ancho**: `lg:grid-cols-[1fr_380px]` → `lg:grid-cols-[1fr_440px]`
  en el workspace del editor, para que las métricas secundarias y las textareas
  respiren. Se subieron las columnas Tarifa/Delivery de la tabla de indicadores a
  `26%` y el `<select>` de métrica pasó a `text-sm`.
- **Audiencia y notas**: `rows={2}` → `rows={3}`, `resize-y`, `min-h-[4.5rem]` y
  un poco más de padding/interlínea para ver bien lo que se escribe.
- **Sin cambios de schema** → no requiere acciones en prod.

### Cambios de la sesión 26/may/2026 — Inputs del plan: legibilidad + fórmulas tipo Excel + más ancho de página

- **Campos numéricos más legibles**: en el editor del plan los inputs `RateInput`
  y `DeliveryInput` ya eran caja blanca con borde; el `NumberInput` (monto del
  placement, total del publisher, monto de fee) era un underline transparente a
  `text-xs` que recortaba las cifras grandes. Ahora `NumberInput` usa la misma
  caja blanca (`text-sm`, borde, `rounded`) y se le ensancharon los anchos
  (monto/total `w-32`, fee `w-36`) para que entren miles/millones sin cortarse.
  Quedó consistente con las columnas de tarifa/delivery.
- **Fórmulas estilo Excel en cualquier campo numérico**: nuevo helper
  `evalNumberInput` en `lib/format.ts`. Si tipeás una expresión aritmética
  (`+2*2`, `=1000*12`, `(1500+500)*3`) y salís del campo o apretás **Enter**, se
  evalúa y queda el resultado formateado. Soporta `+ - * /`, paréntesis y signos
  unarios; coma de miles y símbolo de moneda se descartan. Es un parser propio de
  descenso recursivo (**no usa `eval()`**). Fórmula inválida (incl. división por
  cero) → `NaN` y el input **restaura el valor previo** sin commitear. Cableado en
  `editor.tsx` (`NumberInput`, `RateInput`, `DeliveryInput`, `RatePctInput`) y en
  `billing/editor.tsx` (`NumInput`, respetando el cap de gasto). `parseNumberInput`
  queda como fallback interno de `evalNumberInput`.
- **Enter en la grilla de placements**: el handler de teclado de la tabla
  (`moveGridFocus`) ya hacía blur+commit y bajaba a la fila siguiente; el nuevo
  `onKeyDown` de los inputs es compatible (evalúa la fórmula en el commit y la
  navegación tipo planilla se mantiene).
- **Aprovechar el ancho horizontal**: las páginas data-densas estaban
  encolumnadas a `max-w-[1380px]` centradas, dejando mucho aire a los costados
  (peor con la sidebar colapsada). Se subió el tope a `max-w-[1800px]` en las 5
  páginas que lo usaban: detalle de plan, billing del plan, campaign-tracker,
  detalle de proyecto y detalle de cliente. (Ajustable; se puede ir a fluido si
  se prefiere.)
- **Sin cambios de schema** → no requiere acciones en prod.

### Cambios de la sesión 26/may/2026 — Tablero de pendientes: compacto + colapsable

- **Colapsar todo el board**: el "Pendientes" del dashboard ahora se colapsa/
  expande desde su encabezado (chevron que rota). La preferencia se persiste en
  `localStorage` (`sangria:pending-board-collapsed`) para que se mantenga entre
  visitas (el dashboard es lo primero de la página). Se lee con
  `useSyncExternalStore` (server siempre arranca abierto) para no romper la
  hidratación ni disparar setState en un effect.
- **Más compacto**: densidad reducida en las cards (`px-3.5 py-2.5`), filas
  (`px-3.5 py-1.5`), botones "+ N más"/"ver menos" y gap del grid (`gap-2.5`).
- La `AlertBar` de vencidos sigue siempre visible (arriba del encabezado), aun
  con el board colapsado, porque es el resumen urgente.
- Solo se tocó `components/pending-board.tsx`; el resto del dashboard queda igual.

### Cambios de la sesión 26/may/2026 — Buscador + orden A-Z en Planes y Proyectos

- **Tabs Planes (`/planes`) y Proyectos (`/proyectos`)**: ahora abren ordenadas
  **A-Z por nombre** (antes Planes ordenaba por `project.code` + fecha de alta y
  Proyectos por `project.code`). El orden se hace en cliente y es locale-aware
  (respeta acentos), estable sin importar el orden de la query.
- **Buscador en vivo (nombre o código)**: ambas tabs anteponen un input que
  filtra las filas en tiempo real. En Planes matchea por nombre del plan o
  código del proyecto; en Proyectos por nombre o `code` del proyecto.
  Case-insensitive y sin pegarle a la DB (filtra el array ya cargado).
- **Componentes**:
  - `components/plans-table-client.tsx` (nuevo): client component que recibe las
    filas de `/planes` (server) y rinde buscador + tabla. La tabla salió del
    server component a este client para poder ordenar/filtrar sin recargar.
  - `components/projects-table-expandable.tsx`: nuevo prop `searchable` (default
    `false`). En `true` (tab Proyectos) muestra buscador + orden A-Z y envuelve
    la tabla en su card. El dashboard lo deja en `false`, así que queda igual
    que antes (sin buscador, con el orden de la query).
- El filtro de **status** y el selector de **budget origin** de `/planes` siguen
  resolviéndose server-side por querystring; el buscador opera sobre ese
  subconjunto ya filtrado.

### Cambios de la sesión 26/may/2026 — Métricas completas en exports + PDF apaisado

- **Todas las métricas por placement (Excel y PDF)**: las calculated (CTR, VTR,
  engagement rate, CPM, etc.) **no se guardan** en `metrics_json` (el editor las
  computa al vuelo), así que antes no salían en los exports. Ahora se computan
  por placement y cada métrica tiene su columna/celda. Se muestran las
  calculated que **resuelven** (sus inputs existen) en al menos un placement;
  donde faltan inputs, la celda queda en blanco.
- **Lógica compartida nueva**: `lib/plan-metrics.ts` (`evalFormula`,
  `placementMetricValue`, `resolveMetricColumns`) — fuente única para PDF y
  Excel. Se eliminó la copia local de `evalFormula` del XLSX.
- **PDF ahora apaisado (landscape) con tabla de métricas**: una fila por
  placement, una columna por métrica, subtotales por publisher + fila MEDIA
  TOTAL (antes el PDF listaba las métricas como texto inline y sin calculated).
  El render se extrajo a `lib/plan-pdf.ts` (`renderPlanPdf(detail, allMetrics)`)
  para poder testearlo sin DB; `export.pdf/route.ts` quedó como thin handler.
- **Excel**: las columnas de métricas ahora incluyen las calculated; cada
  placement, subtotal y TOTAL MEDIA las computan con la fórmula del catálogo.
- **Fix de interlineado del PDF**: el nombre del placement y su sub-línea
  (mercado · audiencia · cost method · fechas) se pisaban (gap 8pt < alto de la
  fuente). Se separó a 10pt + filas más altas; el título se trunca al ancho
  libre a la izquierda del logo. Verificado rasterizando el PDF (incluido el
  salto de página: el header de la tabla se repite).
- **Fix HTTP 500 del PDF en prod**: una `audience`/`placementName` con salto de
  línea o tab hacía explotar el encoder WinAnsi de pdf-lib (`WinAnsi cannot
  encode 0x000a`) → 500. `sanitize()` ahora también mapea los caracteres de control y C1 (newline, tab, etc.) a espacio. (El Excel no se veía afectado;
  por eso uno andaba y el otro no.)
- **Polish layout PDF + GRAND TOTAL bajo fees**: la línea de `writeSeparator()`
  cortaba los títulos de sección (size 12) y el label "PLAN DE MEDIOS" se pisaba
  con el nombre del plan (interlínea < alto de fuente). Más aire en ambos.
  Además se agregó una barra GRAND TOTAL (media + fees) debajo de la sección
  Fees. Verificado rasterizando (es/en).
- **Iniciales por página (multipágina)**: en planes que ocupan más de una
  página, cada página menos la última lleva una línea "Client initials: ___"
  abajo a la derecha (la última conserva la firma completa). Key i18n
  `export.initials`. Se dibuja al final iterando `pdf.getPages()` (recién ahí
  se sabe el total de páginas).
- **Nombre de archivo de los exports**: ahora es `{nombre del plan}-V{versión}`
  (antes `{project.code}.{plan.name}`). Sin el nombre/código del proyecto. Aplica
  a PDF y XLSX.
- **Sacar el tag de pago del publisher**: se quitó `[agency pays]`/`[client
  pays]` de las filas de publisher en el PDF (el XLSX nunca lo mostró). El campo
  `agencyPays` sigue en el modelo, solo no se imprime en el MP.

### Cambios de la sesión 26/may/2026 — Logo + disclaimer legal en los exports del plan

- **Logo de marca en PDF y XLSX**: ambos exports dibujan el logo en la esquina
  superior derecha. Se lee de `public/sangria-logo.png` (o `.jpg`/`.jpeg`) vía
  el helper nuevo `lib/brand-logo.ts`. Si el archivo no existe, el export se
  genera igual, sin logo (no rompe la descarga). En el XLSX se ancla sobre el
  área blanca de la metadata (no sobre el banner de color) para que un JPG opaco
  no muestre un recuadro blanco sobre el acento.
- **PDF: línea de firma + disclaimer**: el PDF antes no tenía firma (sí la tenía
  el XLSX). Ahora el PDF cierra con `Signature: ___ / Date: ___` y, debajo, el
  disclaimer legal. En el XLSX el disclaimer se agregó debajo del bloque de
  firma existente.
- **Texto legal (exacto, provisto por el cliente)**: nueva key i18n
  `export.signatureDisclaimer`. Se mantiene en inglés en ambos idiomas (nombra a
  "Sangria, LLC" e "Insertion Order"); no traducir sin aprobación legal.
- **`next.config.ts`**: `outputFileTracingIncludes` incluye
  `./public/sangria-logo.*` en el bundle de `/api/plans/**` para que el asset
  viaje a las funciones de export al desplegar.
- **Acción requerida (una vez)**: subir el logo a `public/sangria-logo.png`
  (PNG con transparencia es lo ideal; `.jpg`/`.jpeg` también sirve). Hasta que
  exista el archivo, los exports salen sin logo.

### Cambios de la sesión 22/may/2026 — Tablero + rediseño dashboard/editor + fix del cuelgue

Todo esto se probó aislado en la rama `tablero-alertas` (con login deshabilitado
y un Preview de Vercel) y se integró a `main` al final, con el login re-activado.

- **Fix raíz del cuelgue (crítico)**: `getPendingBillings` entraba en loop
  infinito en `enumerateMonths` cuando un placement tenía una fecha malformada
  (mes que parsea a `NaN`, p.ej. `-infinity`): la función colgaba 300s, Vercel
  la mataba y filtraba conexiones hasta agotar el pooler (cualquier query
  trivial colgaba después → parecía "la DB caída"). Se blindó `enumerateMonths`
  (en `pendings.ts` y `dashboard.ts`): valida año/mes enteros finitos + tope
  duro de 1200 iteraciones. Diagnóstico vía `console.log` por query (ya quitados).
- **Dashboard "Operativo"**: pendientes/alertas arriba (hero, grid 2×2 con ítems
  inline + barra de alerta de vencidos), KPIs como strip compacto, chart y tabla
  abajo. Sin toggle A/C. (`components/dashboard-view.tsx`, `pending-board.tsx`.)
- **Editor de planes "Planilla + Inspector"** (`editor.tsx`): pantalla partida
  en vez de acordeones + expand. Planilla con campos esenciales inline (incl.
  tarifa⇄delivery de la métrica principal) + inspector lateral sticky del
  placement seleccionado. Jerarquía de color Publisher>Placement, totales en
  vivo, subtotal por publisher + botón "Balancear", navegación por teclado
  (Enter baja/crea fila). El Excel/PDF NO se tocó (mismo formato).
- **Caché del dashboard sacada**: `unstable_cache` se probó y se removió (no era
  la causa del cuelgue). Resiliencia del pooler vía `max: 8` (era 3) +
  `statement_timeout` a nivel rol.
- **Pendientes (follow-ups del editor)**: drag-reorder, recordar última tarifa
  por método, fill-down.
- **Acción requerida en prod (una vez)**: setear timeouts a nivel rol (si no se
  hizo): `ALTER ROLE postgres SET statement_timeout = '15s';` y
  `... idle_in_transaction_session_timeout = '20s';`. Ver README → "Si Vercel
  falla con statement_timeout".

### Cambios de la sesión 22/may/2026 — Incidente prod: pooler saturado + caché del dashboard

- **Síntoma**: dashboard caído en prod con `57014 statement timeout` (en
  distintas queries) y luego `504 FUNCTION_INVOCATION_TIMEOUT`, pese a que las
  queries corridas solas en el SQL Editor tardaban <1ms (datos chicos: 9
  billings, 11 planes).
- **Causa raíz**: la query lenta original (fan-out de tracking, ver entrada de
  abajo) hacía que los renders del dashboard se pasaran del timeout de la
  función de Vercel (504). Cada Lambda muerta dejaba su conexión colgada en
  `active/ClientRead` (visto en `pg_stat_activity` con `xact_age` de 1-2 min)
  ocupando un slot del Transaction Pooler. Al acumularse, el pool se agotó →
  hasta queries triviales colgaban o daban 57014 → más 504 → más fugas
  (espiral). El SQL Editor seguía instantáneo porque usa otro path de conexión.
- **Fixes de código (este commit)**:
  - **Caché del dashboard**: `app/(app)/page.tsx` envuelve sus 4 bloques de
    datos en `unstable_cache` (`revalidate: 60`, tag `"dashboard"`, keyado por
    `clientId`). ~20x menos carga sobre el pooler. Staleness ≤60s (ok interno);
    invalidar al instante con `revalidateTag("dashboard")`.
  - **Menos conexiones por instancia**: `db/index.ts` `max: 5 → 3`.
- **Acciones requeridas en prod** (las hace el usuario, NO son código):
  1. **Reiniciar el proyecto** en Supabase (Settings → Restart) para limpiar
     las conexiones colgadas y cortar el espiral — esto es lo que levanta la
     página ya.
  2. Setear timeouts moderados a nivel rol para reapear conexiones colgadas a
     futuro (NO subir a 60s, que las hace linger más):
     ```sql
     ALTER ROLE postgres SET statement_timeout = '15s';
     ALTER ROLE postgres SET idle_in_transaction_session_timeout = '20s';
     ```
- Detalle completo en README → "Si Vercel falla con statement_timeout".

### Cambios de la sesión 22/may/2026 — Pendientes: criterio de facturas + fix timeout de tracking

- **Facturas impagas**: el card ahora lista **cualquier `plan_billing` con
  `paid_at` null** (draft/ready/sent/invoiced), no sólo `status='invoiced'`.
  Cada fila muestra el status del billing. (`db/queries/pendings.ts`,
  `components/pending-board.tsx`).
- **Fix prod (statement timeout)**: `getPendingTracking` joineaba
  `campaign_actual_snapshots` como una segunda rama 1:N sobre `media_plans`
  mientras `media_plan_placements` cuelga de publishers → producto cartesiano
  `placements × snapshots` por plan, que en campañas trackeadas a diario
  disparaba `57014 canceling statement due to statement timeout`. Ahora el
  último cierre de tracking se calcula en una query aparte (agregada por plan)
  y se mergea en JS → sin fan-out. **Sin cambios de schema, sin acción en prod.**

### Cambios de la sesión 21/may/2026 — Tablero de pendientes en el dashboard

- **Nuevo "Tablero de pendientes"** debajo de la tabla de proyectos del
  dashboard (`components/pending-board.tsx`, alimentado por
  `getDashboardPendings` en `db/queries/pendings.ts`). Cuatro cards colapsables,
  cada una con badge de conteo y filas que linkean al área correspondiente:
  1. Billing reports a completar (meses cerrados de planes aprobados sin billing).
  2. Tracking del día pendiente (campañas vigentes sin cierre hoy).
  3. Entregas de reportes (próximas a ≤7 días + vencidas sin entregar).
  4. Facturas impagas (cualquier billing con `paid_at` null; vencidas resaltadas).
- Todo se deriva de columnas existentes → **sin cambios de schema, sin acción
  en prod**. Respeta el filtro global `?client=`.
- Ver detalle de las reglas en README → "Tablero de pendientes del dashboard".

### Cambios de la sesión 21/may/2026 — Filtro budget origin en reporting calendar + fix leak de planes borrados

- **Filtro de Budget Origin en el reporting calendar**: dropdown client-side en
  `reporting-calendar-client.tsx` que filtra las tres secciones (pendientes,
  Gantt, enviados) por budget origin. Aparece sólo si hay >1 origin en los datos.
- **Fix: planes borrados aparecían en "Planes de Medios" (`/planes`)**. Esa
  página arma su query de `media_plans` inline (no usa `db/queries/`), así que
  se le había escapado el filtro `deleted_at IS NULL`. Agregado. De paso se
  cerró el mismo filtro en otros accesos por-id / write-paths que faltaban:
  `billing/page.tsx` (loader del editor de billing), `plan-billing.ts`
  (getOrCreate billing) y `simulator.ts` (chequeo de nombre único al promover).
- **Lección**: si agregás una query nueva sobre `media_plans` (en page o action,
  no sólo en `db/queries/`), acordate del `deleted_at IS NULL`.
- Sin cambios de schema → no requiere acciones en prod.

### Cambios de la sesión 21/may/2026 — Borrar planes → papelera (soft delete)

> **ACCIÓN REQUERIDA EN PROD**: este cambio agrega la columna
> `media_plans.deleted_at` y convierte la unique constraint de nombre en un
> **partial unique index**. Hay que correr **`npm run db:push`** después del
> deploy. Hasta que se corra, las queries que filtran `deleted_at` van a
> fallar (rompe varias páginas). No hay backfill: los planes existentes quedan
> con `deleted_at = null` (vivos), como corresponde.

- **Borrar un plan desde la vista de proyecto**: cada `PlanCard` tiene un botón
  de tacho (`components/delete-plan-button.tsx`) que abre un modal de
  confirmación **en inglés** ("Delete plan?"). Al confirmar llama a `deletePlan`.
- **Soft delete + papelera**: `deletePlan` (`app/actions/plans.ts`) no borra
  físicamente: setea `deleted_at = now()`. El plan (con sus publishers /
  placements / fees / billings) se conserva ad eternum y deja de aparecer
  porque **todas las queries de listado ahora filtran `deleted_at IS NULL`**
  (billing, billing-tracker, dashboard, client-detail, campaign-tracker,
  project-detail, reports, simulator). El filtro se agregó en el ON de los
  joins a `media_plans` o en el WHERE según el caso.
- **Papelera en configuración**: nueva página `/configuracion/papelera-planes`
  (card en `/configuracion`) que lista los planes borrados (`getDeletedPlans`
  en `db/queries/plan-trash.ts`) y permite **restaurarlos**
  (`restorePlan` + `components/restore-plan-button.tsx`) o **borrarlos
  definitivamente** (`hardDeletePlan` + `components/hard-delete-plan-button.tsx`,
  con modal de confirmación irreversible). El hard delete sólo se permite si el
  plan ya está en la papelera y cascadea a publishers/placements/fees/billings.
  UI en inglés.
- **Unicidad de nombre**: ahora es un partial unique index
  `(project_id, name) WHERE deleted_at IS NULL` — se puede re-crear un nombre
  cuyo plan fue borrado, y hay varios borrados con el mismo nombre. `createPlan`
  y `duplicatePlan` chequean colisión sólo contra planes vivos. `restorePlan`
  pre-chequea colisión y devuelve error legible si ya hay un plan vivo igual.
- `deletePlan` queda en el audit_log como `action: "delete"`, así que el plan
  también aparece en `/auditoria/papelera` (consulta histórica). La papelera de
  configuración es la que permite restaurar.

### Cambios de la sesión 21/may/2026 — N° de factura: editable + único

- **Unicidad del número de factura**: `plan_billings.invoice_number` ya tenía
  unique constraint global, pero `markBillingInvoiced` no pre-chequeaba, así
  que un duplicado reventaba con error crudo de la DB. Ahora:
  - `markBillingInvoiced` (`app/actions/plan-billing.ts`) hace un pre-check
    contra otros billings (excluyendo el propio) y devuelve un error legible
    (`"El número de factura "X" ya está asignado a otro billing (mes YYYY-MM)…"`).
  - `persistTransition` envuelve el UPDATE en try/catch para el caso de carrera
    (dos cargas concurrentes que pasan el pre-check) y devuelve error amigable
    en vez de tirar la unique violation cruda.
  - El alert ya existía en la UI (`onFacturar` → `alert(r.error)`).
- **Editable también en `paid`**: el editor de billing sólo mostraba "Editar
  número" en estado `invoiced`. La action ya permitía editar en `paid`, así que
  se agregó el botón "Editar número" en el branch `paid` de `BillingStatusActions`
  (`billing/editor.tsx`).
- Sin cambios de schema → no requiere acciones en prod.

### Cambios de la sesión 21/may/2026 — Cifras siempre en formato US + listado de reportes enviados

- **Cifras en formato US (punto decimal, coma de miles)**: los inputs numéricos
  del plan de medios y del billing confundían punto/coma. El caso roto era el
  input de *delivery* (impresiones) que se mostraba con `Intl.NumberFormat("es-AR")`
  → "1.500.000"; al re-parsear quedaba `1.5` (corrupción de dato).
  - Nuevos helpers en `lib/format.ts`: `formatIntInput`, `formatAmountInput`
    (ambos `en-US`) y `parseNumberInput` (descarta la coma de miles, conserva el
    punto decimal). **Regla**: todo input numérico nuevo debe usarlos.
  - `editor.tsx` (plan): `DeliveryInput` ahora muestra `en-US`; `NumberInput`
    muestra montos con coma de miles (`15,000.00`) y remonta vía `key`; todos los
    parseos pasan por `parseNumberInput`.
  - `billing/editor.tsx`: `NumInput` igual (coma de miles + `parseNumberInput`).
  - **Simulador**: sin cambios — ya usaba `<input type="number">` (cuyo `.value`
    es siempre US, punto decimal, independiente del locale del browser) + display
    `en-US` (`formatInt`/`toFixed`). No tenía la corrupción punto/coma.
- **Reporting calendar — listado de "Reportes enviados"**: nueva sección en
  `/reportes/calendario` (debajo del Gantt) que lista los reports con
  `delivered_at` (proyecto = `reportado`), con fecha de envío real + fecha
  objetivo, y un **filtro de texto libre** que matchea por proyecto (nombre/código)
  o campaña (nombre de plan).
  - `db/queries/reports.ts`: se reemplazó el placeholder `getDeliveredReports`
    por `getSentReports(clientId?)`, que además trae `deliveredAt` y `planNames`
    (nombres de campañas vía `media_plans`) para el filtro.
  - `reporting-calendar-client.tsx`: nuevo componente `SentReportsSection` con el
    input de búsqueda (filtrado client-side, case-insensitive).
  - No requiere acciones en prod (sin cambios de schema).

### Cambios de la sesión 21/may/2026 — Fix: el simulador rebotaba al dashboard al elegir cliente

- **Síntoma**: al entrar a `/reportes/simulador` sin cliente, el empty-state
  invita a elegir uno en el picker del topbar. Al elegirlo, el picker
  redirigía al **dashboard** (`/?client=slug`) en vez de quedarse en el
  simulador, obligando a volver a entrar a mano (esta vez ya con `?client=`).
- **Causa**: `/reportes/simulador` no estaba en `CLIENT_FILTER_ROUTES`
  (`lib/client-filter.ts`). Por eso `redirectTargetForClientChange()` no lo
  reconocía como ruta que acepta el filtro ni matcheaba ningún prefijo, y caía
  al `return "/"` final.
- **Fix**: se agregó `/reportes/simulador` a `CLIENT_FILTER_ROUTES`. Ahora al
  elegir cliente desde el simulador se queda en `/reportes/simulador?client=slug`
  y renderiza la vista del cliente. No requiere acciones en prod.

### Cambios de la sesión 20/may/2026 — Publishers per-cliente (eliminar catálogo global)

- **`publishers` pasa a ser per-cliente**, igual que `markets` y
  `metrics_catalog`. Antes era un catálogo global + tabla puente
  `client_publishers`; eso causaba que un publisher recién creado "existiera"
  pero no apareciera para el cliente al armar un plan (había que habilitarlo
  en el puente). Ahora cada cliente tiene su propia lista (tabla `publishers`
  con `client_id`, `agency_pays`, `enabled`, `sort_order`, unique
  `(client_id, slug)`).
- **`client_publishers` se eliminó.** El `agency_pays` vive ahora directo en
  `publishers` (per-cliente); el override por bloque del plan sigue en
  `media_plan_publishers.agency_pays_override`.
- **CRUD per-cliente** en `/configuracion/clientes/[slug]` (sección Publishers):
  crear / renombrar / habilitar / definir agency_pays / borrar — mismo patrón
  que Mercados y Métricas. Se **eliminó** la página global
  `/configuracion/publishers`.
- Código tocado: `db/schema.ts`, `app/actions/publishers.ts` (CRUD per-cliente),
  `app/actions/plans.ts` (`listPublishersForClient`), queries
  (`project-detail.ts`, `billing.ts`, `simulator.ts`),
  `app/actions/plan-billing.ts`, la página de billing del plan, `db/rls.sql`,
  `scripts/seed.ts`, `lib/client-filter.ts`. El editor del plan **no** cambió:
  se mantuvo el shape de retorno de `listPublishersForClient`.

**Acciones requeridas en prod** (correr ANTES o junto con el deploy del código —
el código nuevo espera el schema per-cliente):
1. Correr `db/publishers-per-client.sql` en el SQL Editor de Supabase. Es
   **transaccional** (todo o nada) y migra los datos: crea las copias
   per-cliente, re-apunta `media_plan_publishers` / `plan_billing_publishers` /
   `campaign_actual_snapshots`, y borra `client_publishers` + los publishers
   globales viejos. **No** usar `npm run db:push` para esto (no haría el
   backfill de datos). Verificar con el bloque del final del archivo: conteos
   deben quedar 8 / 2 / 50 y `publishers_huerfanos = 0`.
2. Diagnóstico previo (20/may): toda la data de publishers era de Copa (9
   mapeados, 0 huérfanos), conteos 8 / 2 / 50 — la migración no pierde nada.

### Cambios de la sesión 20/may/2026 — RLS en Supabase (cerrar la REST API pública)

- **Row-Level Security activado en todas las tablas del schema `public`.**
  Supabase expone automáticamente cada tabla de `public` vía su REST API
  (PostgREST), accesible con la anon key — que es **pública por diseño**
  (`NEXT_PUBLIC_SUPABASE_ANON_KEY` viaja en el bundle del browser, ver
  `lib/supabase/client.ts`). Sin RLS, cualquiera con la URL del proyecto +
  la anon key podía leer/editar/borrar toda la data vía esa API. Esto disparó
  la alerta "Table publicly accessible" de Supabase. Importante: el OAuth NO
  cubre esto — protege el acceso a la app (puerta 1), no la REST API (puerta 2).
- **El fix no rompe la app.** La app conecta como el rol `postgres` (dueño de
  las tablas) vía Drizzle/`DATABASE_URL`, y el dueño bypassa RLS por defecto.
  **No** se usó `FORCE ROW LEVEL SECURITY` justamente para preservar ese
  bypass. Como no hay policies permisivas, los roles `anon`/`authenticated`
  quedan denegados en la REST API (lecturas → `[]`, escrituras → error 42501).
- **`db/rls.sql`** (nuevo): registro del SQL aplicado. Idempotente, con bloque
  de verificación (debe devolver 0 filas) y una variante dinámica para activar
  RLS en todas las tablas de una (útil para tablas futuras).

**Acciones requeridas en prod**: correr el contenido de `db/rls.sql` en el SQL
Editor de Supabase (**ya aplicado el 20/may/2026**). Verificar con la query del
final del archivo. **Toda tabla nueva** que se agregue al schema necesita su
propio `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` (o re-correr el bloque
dinámico).

### Cambios de la sesión 18/may/2026 (pm-3) — OAuth Google + Sangria.agency-only + audit author

- **OAuth con Google Workspace** vía Supabase Auth. Toda la app está
  ahora detrás de un proxy (`proxy.ts` — Next.js 16 renombró
  `middleware.ts → proxy.ts`) que valida sesión en cada request. Sin
  sesión → redirect a `/login` con `?next=` preservado para volver
  después del login. `/login`, `/auth/callback`, `/auth/signout` son
  públicas; el resto requiere login.
- **Bloqueo por dominio `@sangria.agency`** en dos lugares:
  - El botón de Google pasa `hd=sangria.agency` + `prompt=select_account`
    para que Google preseleccione la cuenta de agencia (no es bloqueo
    duro — es UX).
  - El callback (`app/auth/callback/route.ts`) verifica `user.email`
    después del exchange; si no termina en `@sangria.agency` hace
    `signOut()` y redirige a `/login?error=domain`.
  - El proxy también revalida en cada request (defensa en profundidad
    por si la sesión vino de otra cuenta).
- **Topbar con user pill**: avatar de Google (o iniciales si no hay
  picture) + menú con el email y "Cerrar sesión" (POST a
  `/auth/signout`). Reemplaza el círculo decorativo de antes.
- **Audit log con autor**: nueva columna `audit_log.user_email`
  denormalizada (también `user_id` que ya estaba). Todas las 48
  inserts de `db.insert(auditLog).values({...})` distribuidas por las
  11 server actions se migraron a `await recordAudit({...})`
  (`lib/audit.ts`). El helper hace `getCurrentUser()` y enriquece la
  row con id + email del usuario logueado; si no hay sesión (script
  de seed, llamada interna) queda en null → se renderiza "Sistema".
  `actorLabel(userEmail, userId)` en `lib/audit-format.ts` formatea
  el email como nombre ("mariano.manto@…" → "Mariano Manto"). Las
  rows previas al wire-up siguen mostrándose como "Sistema".

**Acciones requeridas en prod**:
1. `npm run db:push` — agrega la columna `audit_log.user_email`.
2. Setup en Supabase dashboard:
   - **Auth → Providers → Google**: enabled, con Client ID + Secret
     del OAuth 2.0 Client de Google Cloud Console.
   - **Auth → URL Configuration**:
     - Site URL = `https://<dominio-prod>` (o `http://localhost:3000` en dev).
     - Redirect URLs: agregar
       `https://<dominio-prod>/auth/callback` y
       `http://localhost:3000/auth/callback`.
3. Setup en Google Cloud Console:
   - En el OAuth Client, agregar como Authorized redirect URI:
     `https://<PROJECT-REF>.supabase.co/auth/v1/callback`.
   - (Recomendado) restringir el OAuth consent screen a usuarios
     internos del Workspace de sangria.agency.

Sin migración de datos: las rows viejas del audit_log quedan con
`user_email = null` y se renderizan como "Sistema". Las nuevas
quedan con el email del autor.

### Cambios de la sesión 18/may/2026 (pm-2) — Duplicar plan + auditoría legible + papelera

- **Duplicar plan al crear**: el form de `+ Nuevo plan`
  (`/proyectos/[code]/planes/nuevo`) ahora arranca con dos tabs:
  "Plan vacío" (comportamiento original) y "Duplicar plan existente".
  El dropdown de duplicar lista TODOS los planes del cliente del
  proyecto destino — cualquier proyecto, cualquier status — formateado
  como: `<plan> · <proyecto> (mercados) (publishers) · $total [status]`,
  para que el planner sepa qué tiene cada plan antes de elegir. Al
  seleccionar uno se renderiza un resumen abajo con período, total y
  un botón "usar 'X (copia)'" como sugerencia de nombre. La server
  action `duplicatePlan({ sourcePlanId, targetProjectId, newName })`
  clona el plan + publishers + placements + fees en estado `draft` con
  v0 y sin snapshots. Bloquea cruzar clientes (publishers / markets /
  metrics son per-cliente). Audit_log queda con
  `duplicatedFromPlanId` para trazabilidad.
- **Audit log legible**: cada evento se renderiza ahora como oración
  ("Sistema editó el plan 'Awareness' · hace 5 minutos") en vez del
  rectángulo opaco `media_plan · 7a3b1c…`. El verbo y el sustantivo
  se traducen al español a partir de `entityType + action` (helpers
  en `lib/audit-format.ts`); el nombre del item se extrae del
  before/afterJson según el tipo (`placement_name` para placements,
  `name` para plan/cliente/etc.). El timestamp pasa a relativo
  ("hoy 14:32" / "ayer 09:15" / "hace 3 minutos" / "12/may 14:32"),
  con tooltip que muestra absoluto. El actor sigue siendo "Sistema"
  como placeholder hasta que tengamos auth real (el campo
  `audit_log.user_id` está pero hoy siempre es null).
- **Papelera** (`/auditoria/papelera`): nueva vista que lista todos
  los items eliminados (proyectos, planes, publishers, placements,
  fees, catálogos) leídos del `audit_log` con `action='delete'`,
  ordenados desc. Tabla con tipo, nombre (extraído del beforeJson),
  quién lo borró, cuándo (relativo + tooltip absoluto) y un detalle
  por tipo (presupuesto del proyecto, monto del placement, etc.).
  Filtros por tipo de entidad. **No tiene botón de restaurar por
  ahora** — es consulta histórica. Para restaurar hace falta cambiar
  los deletes para que guarden snapshots con cascada en el
  beforeJson (cuando borrás un proyecto se cascadea a planes y los
  audit_log de los planes no existen). Se llega desde
  `/auditoria` con el botón "Papelera (N)".

**Acciones requeridas en prod**: ninguna. Solo cambios de código.

### Cambios de la sesión 18/may/2026 (pm) — Campaign Tracker: histórico de planes + fix label pace

- **Planes concluidos accesibles en el hub**: el `/campaign-tracker`
  agregó un filtro de estado (Vigentes / Concluidos / Todos). Antes
  desaparecían en cuanto el período del plan terminaba; ahora quedan
  en "Concluidos" con toda su data (placements, actuals, snapshots)
  para consulta histórica de "real vs planeado". Default sigue siendo
  Vigentes (el caso accionable). Para concluidos: badge "concluido"
  al lado del nombre, sin warning de stale (la carga ya no aplica),
  y los KPIs se rellabelean ("Cumplimiento promedio", "Cerraron
  off-pace", etc.). El detalle del plan (`/campaign-tracker/[planId]`)
  detecta también si el período terminó y muestra "concluido" en
  vez de "vigente" en el badge del header — el editor sigue
  funcionando porque sirve también para cargar datos atrasados.
- **Query change**: `getCampaignTrackerHub(clientId, filter)` ahora
  recibe el filtro y devuelve además `statusCounts` para los chips
  + `status` por plan ('vigente' | 'concluido'). Los "futuros"
  (start > hoy) siguen excluidos.
- **Fix UI**: el label "pace XX%" del gráfico de progreso del
  detalle se cortaba al medio cuando el pace caía cerca de los
  bordes (e.g., 95% rebasaba el chart por la derecha). Ahora la
  posición se elige según el valor (`insideTopRight` cuando >85,
  `insideTopLeft` cuando <15, `top` en el medio) y subimos el
  `margin.top` del chart a 28 para dar aire vertical. Ver
  `app/(app)/campaign-tracker/[planId]/tracker-chart.tsx`.

**Acciones requeridas en prod**: ninguna. Solo cambios de código.

### Cambios de la sesión 18/may/2026 — Duplicar publishers y placements

- **Duplicar placement** en el editor del plan: nuevo botón ⧉ (Copy) al lado
  del trash en cada fila. Clona todos los campos (nombre, mercado, monto,
  cost method, fechas, audiencia, notas, `metrics_json`) y queda
  inmediatamente debajo del original con `sortOrder = src + 1` (los demás
  se corren). Server action: `duplicatePlacement(placementId)` en
  `app/actions/plans.ts`.
- **Duplicar publisher**: mismo botón en el header del bloque. Clona el
  row de `mediaPlanPublishers` (mismo `publisherId`, `totalPlannedUsd`,
  `agencyPaysOverride`) **y todos sus placements**. El bloque queda
  apenas debajo del original. Server action: `duplicatePlanPublisher(mppId)`.
- **Schema**: se sacó el `unique("uq_mpp_plan_publisher")` de
  `media_plan_publishers` para permitir que un mismo publisher tenga N
  bloques en un plan (ej: "Meta Brand" + "Meta Performance"). El comentario
  en `db/schema.ts` documenta la nueva semántica.
- **Billing aggregation**: el `plan_billing_publishers` sigue siendo único
  por `(billing, publisher)`, así que la vista de billing y los caps de
  cap-de-gasto agregan los N bloques por publisher antes de armar las
  líneas. Fixes en:
  - `db/queries/billing.ts:getBillingDetail` — agrega `planPubs` por
    `publisherId` (suma `totalPlannedUsd`, OR de `agencyPays`).
  - `app/(app)/proyectos/[code]/planes/[planId]/billing/page.tsx` — mismo
    rollup para la vista de carga mensual.
  - `app/actions/plan-billing.ts:createBilling` — dedup de `planPubs`
    por `publisherId` para no violar `uq_pbp_billing_publisher` al
    pre-cargar rows en cero.
  - `app/actions/plan-billing.ts:setPublisherConsumption` — el cap usa
    `sum(totalPlannedUsd)` agregando todos los bloques.
  - `db/queries/dashboard.ts:listPlansForDashboard` — el publisher
    breakdown agrega bloques antes de comparar con el `billed` (que ya es
    único por publisher).
- **Editor / Excel / PDF**: cada bloque sigue siendo un row visible en
  el editor del plan, en el Excel y en el PDF — la rollup solo se aplica
  en la vista de billing y rollups de dashboard. El dropdown de "+ Agregar
  publisher…" ahora muestra siempre el catálogo completo (ya no filtra
  por "ya agregados", consistente con permitir bloques duplicados).

**Acciones requeridas en prod**: correr `npm run db:push` para borrar el
unique `uq_mpp_plan_publisher`. Sin migración de datos: planes existentes
quedan iguales (cada uno con 1 bloque por publisher).

### Cambios de la sesión 15/may/2026 — Aesthetic / cosmetic pass

- **Dark mode real**. El toggle del topbar (antes decorativo) ahora
  togglea entre claro y oscuro. La implementación es CSS-vars puras:
  los tokens (`--color-paper`, `--color-ink`, `--color-accent`, etc.)
  se redefinen bajo `.dark` en `app/globals.css`, así toda utility
  Tailwind que use esos tokens (`bg-paper`, `text-ink`, `border-line`)
  swappea sola sin tocar componentes. La preferencia se persiste en
  `localStorage.sangria-theme` y se sincroniza con el OS al primer
  load. Anti-FOUC con script inline en `<head>` (ver `app/layout.tsx`).
- **Sidebar siempre oscuro**: tokens nuevos `--color-rail` / `--color-rail-2`
  que NO swappean. Antes usaba `bg-ink` (rompía en dark mode).
- **Refinamiento del acento sangría**: nuevo tono medio
  `--color-accent-2` (`#a8345f`) para gradientes (barra de avance,
  avatar topbar) y hover states. La barra de consumo ahora usa
  `bg-gradient-to-r from-accent to-accent-2` en vez del ink plano.
- **Jerarquía tipográfica**: PageShell y dashboard tienen header con
  `gap-2.5` entre eyebrow/h1/subtitle, `h1` a `text-[32px]
  leading-[1.1]`, eyebrow con tracking `0.18em`. Más editorial, menos
  comprimido.
- **Microinteractions**: chevrons de tablas rotan en vez de swap,
  hover de filas con transición de 150ms, scale en botones del
  sidebar, sidebar con gradiente `rail-2 → rail`.
- **Focus ring global** con color de acento (`:focus-visible`) en
  vez del azul nativo.
- **Skeletons**: nuevo `components/skeleton.tsx` con animación
  shimmer (definida en globals.css). `SkeletonRow` y `SkeletonKpiCard`
  reutilizables para `loading.tsx` futuros.
- **EmptyState** mejorado en PageShell: ahora soporta `icon` y
  `action`, con círculo neutro alrededor del ícono.
- **Recharts dark-aware**: el `FacturacionChart` lee CSS vars vía
  `getComputedStyle` y observa cambios de clase en `<html>` para
  re-renderizar al togglear tema (Recharts no acepta CSS vars en
  fills directamente).
- **Reemplazos de hardcoded colors**: ~40 archivos con
  `text-stone-300/400` y `bg-stone-400` migrados a `text-line`,
  `text-muted`, `bg-muted` para que dark mode sea coherente. Todos
  los `bg-white` recibieron `dark:bg-paper-2` para que las cards y
  popovers tengan superficie elevada en ambos temas.
- **Topbar**: `bg-paper/80 backdrop-blur` da efecto frosted (antes
  `bg-white` plano). Avatar pasa de fondo plano a gradient burgundy
  con ring de acento.
- **Scrollbars** discretas (10px, color `line`) y `::selection` con
  acento — pequeños toques que dan cohesión.

**Acciones requeridas en prod**: ninguna. Solo cambios de código,
sin schema ni migraciones.

### Cambios de la sesión 14/may/2026 — Proyectos: editar / eliminar / sin identificador

- **Alta sin identificador**: el form de `/proyectos/nuevo` ya no pide un
  `m<id>`. El `code` (que sigue existiendo como URL slug + base de la
  convención de nombres de planes) se deriva del nombre vía `slugify`,
  con sufijo `-N` si colisiona. Se sacó también la columna `code` de la
  vista (detalle del proyecto + tabla expandible).
- **Editar proyecto**: nuevo panel `app/(app)/proyectos/[code]/edit-panel.tsx`
  (botón "Editar proyecto" en el detalle) con nombre, budget origin,
  total gross budget, fecha de inicio y notas. Action `updateProject`
  en `app/actions/projects.ts` — valida que el budget origin pertenezca
  al cliente del proyecto. El `code` NO se reescribe al renombrar (las
  URLs quedan estables).
- **Eliminar proyecto**: botón con `confirm()` en el mismo panel. Action
  `deleteProject` — la cascada se lleva planes, publishers, placements,
  fees, billings, snapshots y reportes.
- `getNewProjectFormData` se simplificó (ya no calcula `currentYear`).

**Acciones requeridas en prod**: ninguna. Solo cambios de código.

### Cambios de la sesión 14/may/2026 — Excel del plan: Fees + grand total

- **Sección Fees**: se eliminó la columna "Auto" (Sí/No, indicaba si el
  monto era auto-computado). Quedan Tipo, Nombre, Rate %, Monto y Notas.
- **Fila GRAND TOTAL**: tiene fondo INK (gris/negro); la fuente no tenía
  color seteado y quedaba ilegible. Se fuerza a blanco.
- Cambios cosméticos del `export.xlsx`, sin datos ni schema.

**Acciones requeridas en prod**: ninguna. Solo cambios de código.

### Cambios de la sesión 14/may/2026 — Excel del plan: nombre de publisher

- En el `export.xlsx` del plan, la fila de subtotal de cada publisher
  mostraba `<nombre> (agencia paga)`. Ahora muestra solo el nombre del
  publisher. Cambio cosmético, sin datos ni schema.

**Acciones requeridas en prod**: ninguna. Solo cambios de código.

### Cambios de la sesión 14/may/2026 — Cost method dCPA

- **Nuevo cost method `dCPA`** en el enum `cost_method` (`db/schema.ts`).
  Se actualizaron los 4 lugares con la lista hardcodeada:
  `db/schema.ts`, `lib/cost-methods.ts` (`COST_METHOD_PRIMARY_METRIC`,
  tipo `CostMethod`, array `COST_METHODS`), `app/actions/plans.ts` y
  `scripts/seed.ts`.
- `dCPA` comparte métrica principal (`conversions`) y rate (`cpa`) con
  `CPA`, que ya están en `DIRECT_METRIC_RATES` y en el seed de
  `metrics_catalog` — no hizo falta tocar eso.

**Acciones requeridas en prod**: `npm run db:push` para agregar el valor
`dCPA` al enum `cost_method`. Aditivo, sin backfill.

### Cambios de la sesión 14/may/2026 — Budget origins per-cliente CRUD

- **Nueva sección "Budget origins"** en `/configuracion/clientes/[slug]`
  (`sections.tsx`), junto a Métricas y Mercados. Permite crear, editar
  inline (nombre / color hex) y eliminar budget origins de cada cliente
  desde la UI — antes solo se cargaban vía seed.
- **Nuevas server actions** en `app/actions/budget-origins.ts`:
  `createBudgetOrigin` / `updateBudgetOrigin` / `deleteBudgetOrigin`,
  con el mismo patrón que markets/metrics (audit log + `revalidatePath`
  de `/proyectos`, `/planes` y la página del cliente).
- `deleteBudgetOrigin` chequea proyectos asociados **antes** de borrar
  (`projects.budget_origin_id` tiene `onDelete: "restrict"`) y devuelve
  un error claro si el origin está en uso, en vez de reventar la FK.
- **Se eliminó la columna `monthly_target_usd`** de `budget_origins`
  (schema + seed + action + UI). No se usaba en ninguna vista ni query;
  era solo un campo del form. **Requiere `npm run db:push`** en prod
  para dropear la columna.

**Acciones requeridas en prod**: `npm run db:push` para dropear
`budget_origins.monthly_target_usd`. No hay backfill.

### Cambios de la sesión 14/may/2026 — Excel del plan: formato cosmético

- **Colores de marca**: el `export.xlsx` usaba una paleta violeta
  (`#6D28D9`) que no era la marca. Ahora usa los design tokens —
  sangría (`#7A1F3D`), `accent-soft`, `ink` para el grand total,
  `line` para bordes, `muted` para textos secundarios.
- **Banner de título** a todo el ancho ("PLAN DE MEDIOS — <plan>") +
  fila "Generado" en el encabezado.
- **Indentación real** de placements bajo su publisher
  (`alignment.indent` en vez de espacios), y **outline levels** para
  que cada grupo de publisher sea colapsable en Excel (control +/-
  sobre la fila de subtotal, `outlineProperties.summaryBelow = false`).
- Freeze panes recalculado según el alto real del encabezado.
- Sin cambios de comportamiento ni de datos — solo formato.

**Acciones requeridas en prod**: ninguna. Solo cambios de código.

### Cambios de la sesión 14/may/2026 — Campaign Tracker

> Feature en branch `claude/add-campaign-tracker-zLUnE` — testing antes de
> ir a prod.

- **Nueva sección Campaign Tracker** para que la trafficker cargue el
  consumo real + métricas reales de las campañas vigentes en un solo
  lugar, sin tener que entrar a la consola de cada publisher y anotar
  aparte.
- **Schema**: nueva tabla `campaign_placement_actuals` (`db/schema.ts`).
  Un row por `(placement_id, metric_key)` con `value_actual` +
  `updated_at`. **NO es time-series**: el valor se reemplaza en cada
  edición (autosave), no hay histórico diario. `metric_key` = `'amount'`
  para inversión o un slug de `metrics_catalog` para el resto. Solo se
  persisten métricas direct; las calculadas (CPM, CTR, CPV, CPA,
  frequency) se derivan on-the-fly.
- **Goals**: NO se persisten ni se duplican. Salen del plan vigente —
  `amount_usd` + `metrics_json` de cada `media_plan_placement` ya son
  los goals. "Plan vigente" = status `approved` Y la fecha de hoy cae
  dentro del período derivado (min/max de fechas de placements).
- **Hub** (`/campaign-tracker`): listado de planes vigentes agrupados
  por cliente, ordenado por más rezagado primero (pace − progreso).
  Cada plan muestra barra de consumo con tick de pace, badge de pace
  (on pace / atrasado / sobre-pace) y freshness dots. Las filas sin
  update ≥48h se resaltan en amarillo.
- **Vista de carga** (`/campaign-tracker/[planId]`): header con KPIs +
  tabla densa de placements agrupada por publisher. Cada métrica direct
  tiene goal read-only, input editable amarillo (autosave, debounce
  300ms) y goal-bar con tick de pace. Las métricas calculadas aparecen
  como filas con input deshabilitado y badge "calc.". Abajo, chart de
  barras horizontales (recharts) con consumo / restante / exceso + línea
  de pace + línea de meta al 100%, reactivo al editar sin reload.
- **Elementos visuales / próximamente** (dependen de features fuera de
  alcance — sin histórico diario, sin cierre de día): stepper de fecha,
  tabs Histórico / Resumen acumulado, botones "Comparar con ayer" y
  "Cerrar carga del día". Quedan en el JSX `disabled` con tooltip.
- **Sidebar**: nueva entry "Campaign Tracker" (icono `LineChart`) al
  final de `PRIMARY`, después de Billing Tracker.
- **Histórico de cargas (Cerrar carga del día)**: segunda tabla
  `campaign_actual_snapshots` (`db/schema.ts`), **append-only**. El botón
  "Cerrar carga del día" (`closeDailyLoad` en `app/actions/campaign-tracker.ts`)
  toma un snapshot del estado actual de la capa viva y lo persiste fechado
  con el día de hoy. Re-cerrar el mismo día actualiza el snapshot (unique
  `placement+métrica+fecha`), **no bloquea la edición**. Snapshotea todas
  las métricas direct de cada placement (aunque estén en 0) + el goal del
  plan congelado al momento. La tabla es **self-contained**: denormaliza
  `client_id / project_id / media_plan_id / publisher_id / market_id` para
  que la futura sección de Reportes cruce sin depender de la estructura
  viva del plan y el histórico quede intacto si después se edita/borra.
- **"Comparar con última carga"**: toggle en el editor que agrega dos
  columnas (Última carga + Δ) comparando el estado actual contra el último
  snapshot. Las calculadas se derivan también del snapshot anterior. Se
  deshabilita si el plan nunca se cerró.
- **Clasificación direct/calculated**: sale del `metrics_catalog` del cliente,
  resuelto por plan en `getCampaignTrackerPlan` / `setPlacementActual` /
  `closeDailyLoad`. Toda métrica `direct` habilitada del catálogo presente en
  el `metrics_json` del placement es cargable; las `calculated` se derivan con
  su fórmula (`buildMetricRows(..., calcDefs)`). Antes usaba la lista
  hardcodeada `DIRECT_METRIC_RATES` y se perdían las métricas custom del
  cliente (tickets, tickets_stopover, revenue…) — **resuelto**.
- **Deuda técnica**: la query de snapshots trae todo el histórico del plan;
  si crece mucho, conviene un subquery por `max(snapshot_date)`.

**Acciones requeridas en prod**: `npm run db:push` para crear las tablas
`campaign_placement_actuals` (capa viva) y `campaign_actual_snapshots`
(histórico). Ambas son **aditivas** — no tocan tablas existentes, no hay
backfill ni migración de datos. Sin esto, las páginas `/campaign-tracker*`
fallan al hacer la query.

### Cambios de la sesión 14/may/2026 — Archivar clientes + Billing Tracker

- **Clientes archivados desaparecen del filtro global.** El topbar
  `TopbarClientPicker` y la lista pública `/clientes` ahora filtran
  `clients.status != 'archived'`. Los archivados siguen siendo
  gestionables desde `/configuracion/clientes` para des-archivarlos. El
  detalle `/clientes/[slug]` sigue accesible por URL directa para evitar
  romper deep-links desde proyectos/planes/billings históricos.
- **Nueva página `/billing-tracker`** (`app/(app)/billing-tracker/page.tsx`).
  Vista jerárquica proyecto → planes → facturas emitidas. Una factura
  cuenta como "emitida" cuando ya tiene `invoice_number` cargado, es
  decir, estado `invoiced` o `paid`. Para cada factura muestra: número,
  mes, subtotal medios (`totalNetUsd`), subtotal fees (`totalFeeUsd`) y
  total. Sin desglose de medios/fees individuales.
  - Filtros (`components/billing-tracker-filters.tsx`): proyecto
    (dropdown) y rango de meses (slider dual). Persisten como
    `?project=`, `?from=`, `?to=`. Respeta `?client=` global.
  - Query: `getBillingTracker` + `getBillingTrackerFilterOptions` en
    `db/queries/billing-tracker.ts`. Excluye clientes archivados.
- **Sidebar**: se sacó la entry "Clientes" y se agregó "Billing Tracker"
  (icono `Receipt`) al final de `PRIMARY` en `components/sidebar.tsx`.
- **Slider de meses extraído** a `components/month-range-slider.tsx` como
  componente self-contained (no expone draft state al parent). Ahora lo
  comparten `billing-filters.tsx` y `billing-tracker-filters.tsx`. De
  paso se eliminaron las 2 violaciones del lint `set-state-in-effect`
  que tenía `billing-filters.tsx`.

**Acciones requeridas en prod**: ninguna. Solo cambios de código,
sin migraciones ni seeds.

### Cambios de la sesión 13/may/2026 (noche-3) — Markets + métricas per-cliente

- **Schema**: agregamos `client_id` (NOT NULL FK a `clients`) tanto a
  `markets` como a `metrics_catalog`. La unique constraint pasa de
  `(slug)` a `(client_id, slug)`. Cada cliente tiene su propia lista,
  incluyendo conversiones custom (ej. "Solicitudes de tarjeta" en
  Banco Pacífico).
- **Publishers**: se queda como estaba — catálogo global +
  `client_publishers` para subset/enable/agency_pays per cliente.
- **Queries**: `listMarketsForClient(clientId)`, `listMetricsForClient(clientId)`
  reemplazan a las versiones globales. El editor del plan y el export
  Excel ahora pasan `detail.client.id`.
- **Actions**: `createMarket`, `updateMarket`, `deleteMarket`,
  `createMetric`, `updateMetric`, `deleteMetric` ahora todas requieren
  `clientId` (y opcionalmente `clientSlug` para revalidatePath).
- **Nueva action** `upsertClientPublisher` para toggle enabled +
  agency_pays per (cliente, publisher) desde la UI.
- **Página nueva** `/configuracion/clientes/[slug]` con tres secciones:
  Publishers (checkbox + dropdown agency/client), Métricas (CRUD per
  cliente con kind direct/calculated + fórmula), Mercados (CRUD per
  cliente).
- **Páginas viejas** `/configuracion/markets` y `/configuracion/metricas`
  ahora son redirects al admin per-cliente (lista de clientes con
  links). Bookmarks viejos siguen funcionando.
- **Seed** reorganizado: clientes primero, después markets+metrics
  replicados para cada cliente. Banco Pacífico tiene además la
  conversión custom de demo.

**Acciones requeridas en prod**: schema + datos. Ver el bloque SQL en el
PR. Es invasivo porque hay que reescribir FKs de
`media_plan_placements.market_id` para apuntar a las nuevas filas
per-cliente.

### Cambios de la sesión 13/may/2026 (noche-2) — Billing lifecycle + PDF report

### Cambios de la sesión 13/may/2026 (noche-2) — Billing lifecycle + PDF report

Nuevo lifecycle de `plan_billings`:

```
draft (borrador) → ready (listo) → sent (reportado) → invoiced (facturado) → paid (pagado)
```

- `draft → ready` (analista termina de cargar consumos / fees y marca listo).
- `ready → sent`: el manager aprieta "Reportar" en el editor; descarga un
  PDF para finanzas con el formato de tabla solicitado (una fila por
  publisher facturable con consumo > 0 + una fila por fee imputado en el
  mes). Este paso ya **NO** asigna número de factura automático.
- `sent → invoiced`: el manager recibe el número de factura de finanzas y
  lo carga vía un input inline (`markBillingInvoiced`). En esta transición
  se setea `due_date = today + 30d` si no había uno.
- `invoiced → paid`: el cliente notificó el pago.

Reversiones permitidas: ready ↔ draft, sent ↔ ready, invoiced ↔ sent,
paid ↔ invoiced.

PDF: nuevo endpoint `app/api/billings/[id]/report.pdf/route.ts`.
Layout: header con metadata + tabla "# | Product/service | Description |
Qty | Rate | Amount" y fila de TOTAL al final. Una fila por
`Media Placement` (publishers facturables con consumo > 0) + una por
`Services` (fees con imputación > 0).

### Acciones requeridas en prod

1. Agregar `'invoiced'` al enum `billing_status` (SQL adjunto en el PR).
2. Migrar `sent` (legacy con invoice_number) → `invoiced`: las facturas
   que ya estaban "sent" bajo el viejo significado tienen `invoice_number`
   no null → bajo el nuevo significado son `invoiced`.
3. `db/queries/dashboard.ts` ahora cuenta `[invoiced, paid]` en lugar de
   `[sent, paid]` como "facturado". Tras la migración el resultado es
   idéntico, pero rows nuevas en `sent` (reportado) ya no se contabilizan
   como facturadas.

### Cambios de la sesión 13/may/2026 (noche) — Billing filters + row click

> **Para setup inicial en una máquina nueva** ver [README.md](README.md).
> Este documento asume que ya está clonado el repo y `npm install`-eado.

---

## Estado actual

App **deployada y funcionando** en Vercel (auto-deploy desde `main`).

### Commits recientes

```
0154ed0  Billing Tracker (Estimación): filtro multi-select de clientes (#174)
f9551f9  Campaign Tracker: cargar todas las métricas del plan desde el catálogo (#171)
78d11b5  Revisión estética/cosmética + bugs + recomendaciones (#169)
0ff1348  Portal (Proyectos): filtro de rango de fechas Desde/Hasta (#167)
42264e2  Hojas auxiliares: la columna NET TOTAL nunca se trunca (regla) (#165)
3ba6288  PDF del plan: incluir las hojas auxiliares (formato del plan + firma/fecha) (#163)
e981f37  MP Excel: mercado de cada placement en columna propia (Tab 1) (#161)
3541a91  Add year filter to the reporting calendar (#157)
1749bf0  Add year filter (default current year) to plans and projects tabs (#156)
d1681f4  Rediseño Sangria OS: shell + dashboard de 3 vistas + confiabilidad (cache) + mobile cards (#150)
ec0f750  Portal Proyectos: filtro de campañas + multi-pacing + export ejecutivo + fix "Ver pacing" (#149)
f8be898  Dashboard: aislar cada sección con error boundary + fallbacks por query (#148)
2f55809  docs: registrar PR #146 en Commits recientes (#147)
ecb4d28  Aux sheets: undo/redo (Ctrl+Z / Ctrl+Shift+Z) (#146)
b9e8513  docs: registrar PR #144 en Commits recientes (#145)
a980742  Aux sheets: range select, copy/paste, and merge cells (#144) — REQUIERE npm run db:push
102279a  docs: registrar PR #141 en Commits recientes (#142)
c44dfc3  Reporting Calendar: tablerito de comentarios por reporte (#141)
ec08651  docs: registrar PR #139 en Commits recientes (#140)
0974f17  Preview del plan: toggle para ver también el Budget por mercado (Tab 2) (#139)
77408f6  docs: registrar PR #137 en Commits recientes (#138)
07029a3  Plan: chip "Última edición" de la versión vigente + modal read-only de cambios (#137)
ca063f0  docs: registrar PRs #133-#135 en Commits recientes (#136)
8d1a43a  Tabs auxiliares del plan: grillas libres con fórmulas + tabs extra en el Excel (#135)
b611490  Portal Proyectos: filtro Abiertos/Cerrados (default abiertos) (#134)
681698e  docs: barrido README + HANDOFF (sesión 05/jun) (#133)
e94ea38  Proyectos (lista): columna Período + aviso "termina pronto" (#132)
3a26719  Proyectos: período inicio/fin + aviso "termina pronto" (#131)
722181c  Benchmarks: botones Excel/PDF dentro del recuadro de filtros (#130)
f8ee7fd  Benchmarks (portal): descargar Excel / PDF de lo filtrado (#129)
4583b1e  Revert: volver al Gantt SVG (deshacer Mermaid) (#128)
436314d  Reportes: Gantt con Mermaid.js (#127) — revertido por #128
6e52838  Análisis: filtros multi-select (varios mercados / publishers) (#126)
425616d  Mapa de análisis: reemplazar SVG d3-geo por Leaflet (#125)
66d1418  Análisis: layout en 3 columnas + mapa menos angosto (#124)
87d72e7  Portal: ocultar la barra de scroll (#123)
20fb0cb  Mapa: arreglar escala del recuadro + zoom con rueda del mouse (#122)
6c74272  Mapa de análisis: match de mercados por token + zoom a lo filtrado (#121)
7fd0c5c  Análisis por publisher × mercado con mapa de América (interna + portal) (#120)
f4800c4  Polish de charts: kit compartido, gradientes, área cumulativa, planeado vs real (#119)
d32f82c  Portal Resumen: inversión por publisher + facturado acumulado vs estimado (#118)
5cd986b  Portal: Gantt en Reportes, solo proyectos abiertos, ocultar scrollbar (#117)
891205c  Portal de cliente público (read-only): billing, estimación, proyectos, reportes, benchmarks (#116)
6894773  Fix: crear reporte manual sin depender del filtro global de cliente (#115)
ef72348  /billing: agregar filtro por estado (#114)
2d62b0e  Billing: editar o quitar el número de factura de un report (#113)
1b0d84a  Billing PDF: usar el nombre del plan en la descripción de cada línea (#112)
4f5e655  Fix: descartar borrador de MP reventaba con un market_id borrado (#111)
5eb4d8d  Billing: excluir del reporte PDF los publishers que paga el cliente (#110)
c1ba37c  docs: registrar PR #108 en Commits recientes (#109)
a5cea8b  Unificar el estado de billing en un BillingStatusBadge compartido (#108)
ac7b394  docs: registrar PR #106 en Commits recientes (#107)
89ae2d0  Fix: billing facturado se mostraba como draft en la lista de meses (#106)
de1624a  docs: registrar PR #104 en Commits recientes (#105)
42ec544  UX hardening: toasts, confirm, loading/error/404, a11y, sidebar mobile (#104)
0cfac0c  docs: registrar PR #102 en Commits recientes (#103)
9139255  chore(skills): versionar ui-ux-pro-max + context7 en .claude/skills (#102)
e1dd84d  docs: registrar PR #100 en Commits recientes (#101)
4cc96da  Restringir la aprobación de planes a una allowlist de emails (#100)
10fed4e  docs: registrar PR #98 en Commits recientes (#99)
e152dfc  Fix: un billing en draft no saca el mes del tablero de pendientes (#98)
52556e1  docs: registrar PR #96 en Commits recientes (#97)
5379c4e  Cosmético: primitivo Button + usuario real en el sidebar (#96)
6051b9a  docs: registrar PR #94 en Commits recientes (#95)
20e1a1c  Cosmético: unificar el badge de estado de plan + limpiar código muerto (#94)
cea8f9f  docs: mencionar "Descartar borrador" en el inventario end-to-end (#93)
2b95a10  docs: registrar PR #91 en Commits recientes (#92)
1b44492  Editor: descartar borrador y volver al plan aprobado (#91)
3a16318  Reporting Calendar: reportes manuales (#89) — REQUIERE npm run db:push
b16dd0c  docs: registrar PR #87 en Commits recientes (#88)
9a19bce  docs: barrido completo README + HANDOFF para reflejar la sesión 27/may (#87)
df41fbf  docs: registrar PR #85 en Commits recientes (#86)
7010d43  Generador de reportes: column picker (elegir columnas a mostrar/descargar) (#85)
41cc6bc  docs: registrar PR #83 en Commits recientes (#84)
e2cb0fa  Fix client picker en /reportes/generador + sacar BillingEstimateCard de proyectos (#83)
125dda4  docs: registrar PR #81 en Commits recientes (#82)
b2cb11c  Generador de reportes históricos (Excel) con preview en vivo (#81)
777027a  docs: registrar PR #79 en Commits recientes (#80)
1efe5fe  /planes: KPI strip, density toggle, sort, agrupado, columna consumido (#79)
7238510  docs: registrar PR #77 en Commits recientes (#78)
0aeee2c  Billing Tracker: tabs "Tracker" + "Estimates" (movido desde /planes) (#77)
e85df72  docs: registrar PR #75 en Commits recientes (#76)
94439ae  Fix: /planes y dashboard inflaban total media por cartesian publishers × placements (#75)
ff08c0d  docs: registrar PR #73 en Commits recientes (#74)
656e77e  Billing del plan: management fee se autoprorratea por consumo (#73)
3a8cbe4  docs: registrar PR #71 en Commits recientes (#72)
eb889eb  Editor: tarifa/delivery rate-anchored al cambiar el monto (#71)
a4f16d8  docs: registrar PR #69 en Commits recientes (#70)
06a217d  Reportes enviados: link opcional al PPT final (#69) — REQUIERE npm run db:push
2664254  docs: hashes reales en Commits recientes (#63–#67) (#68)
fd31de1  Editor: preview tipo Excel read-only (#67)
6f313cb  Exports Excel+PDF: fechas de plan/publisher/placement (#66)
04a0b93  Planilla: achicar tarifa/delivery de la métrica principal (#65)
af6207c  Inspector del placement: más ancho + textareas de audiencia/notas más altas (#64)
8852ed3  Editor de planes: inputs legibles + fórmulas tipo Excel + más ancho (#63)
46aedbe  docs: referencia rápida de buscador/orden + tablero colapsable
bb755a4  Tablero de pendientes: layout compacto + colapsable desde el encabezado
de347e9  Planes y Proyectos: orden A-Z por default + buscador en vivo (nombre/código)
ed940fa  Exports: filename `{plan}-V{versión}` + sacar tag de pago del publisher
ac9e440  PDF: línea de iniciales por página en planes multipágina
7967e30  PDF: fix overlaps de título/separadores + GRAND TOTAL bajo fees
be47564  Fix PDF 500: sanitizar control chars (newline/tab) para WinAnsi
95e729a  Fix PDF: separar nombre de placement de su sub-línea (overlap)
29bad1e  docs: registrar el merge de exports en Commits recientes (HANDOFF)
acf2fe6  Merge: exports del plan — logo + firma/disclaimer + todas las métricas por placement (PDF landscape)
(branch claude/vigilant-darwin-8vSa4)  Tablero de pendientes en el dashboard
15eda3c  Filtro budget origin en reporting calendar + fix planes borrados en /planes (#55)
2590560  Papelera de planes: borrado definitivo (hard delete) (#54)
9448e9f  Borrar planes → papelera (soft delete) + restaurar (#53) — REQUIERE npm run db:push
7ea45a9  N° de factura de billing: editable + único (#52)
af1bae6  Cifras en formato US (plan + billing) + listado de reportes enviados (#51)
42fa754  Fix: el simulador rebotaba al dashboard al elegir cliente (#50)
eda75b8  Publishers per-cliente: eliminar catálogo global + client_publishers (#49)
d9adeea  Enable RLS en todas las tablas de public — cierra la REST API pública de Supabase
3b1a674  Proyectos: editar/eliminar + sacar el identificador del alta y la vista (#35)
953ac29  Excel del plan: quitar columna Auto de Fees + grand total legible (#33)
d0ac3bc  Excel del plan: quitar "(agencia paga)" del nombre del publisher (#31)
afa3d1f  Cost methods: agregar dCPA a la lista (#29)
bc550df  Budget origins: quitar el campo target mensual (#27)
4d7ca1f  docs: reflejar CRUD de budget origins per-cliente (#26)
d9ae34c  Config de cliente: CRUD de budget origins per-cliente (#25)
b714024  docs: hashes reales en Commits recientes (#22, #23) (#24)
eae28ff  Excel del plan: formato cosmético alineado a la marca (#23)
7a32be3  docs: hashes reales en Commits recientes (#20, #21) (#22)
a0d80a9  Campaign Tracker: carga de consumo real vs goal + histórico de cargas (#21)
660ae33  Archivar clientes los saca del filtro + nueva /billing-tracker (#20)
c09dc6a  Markets y métricas per-cliente + admin /configuracion/clientes/[slug] (#19)
2bea4ae  Gantt: feriados argentinos se renderizan como días de fin de semana (#15)
f334113  Gantt: eje diario con marcadores semanales + bandas de fin de semana (#14)
6c81be4  Reporting Calendar: closed → reportado con Gantt de 60 días (#13)
508dc6a  Excel: métricas en subtotales/totales + tab budget por mercado (#12)
7131c46  Clientes CRUD + idioma operativo (en/es) por cliente (#11)
3cb0076  docs: estimación media/fees + accuracy + regla doc-upkeep en AGENTS.md (#8)
872b735  Estimaciones: separar media/fees + accuracy del mes anterior (#7)
c922947  docs: reflejar editor bidireccional de métricas secundarias (#6)
7ac41fd  Editor: cálculo bidireccional rate↔delivery en métricas secundarias (#5)
0bd3d75  docs: reflejar cambios de la sesión 11/may/2026 (#4)
8e44a64  Billing fixes + filtro global de cliente (#3)
c2a51e0  Filtro global de cliente vía ?client=slug
4c1e75a  Billing: derivar cap de imputación de management fees por ratePct
a4ff8fd  Billing: derivar Total Fee de management fees por ratePct
bc625f0  Proyectos: quitar columna Spark del listado principal (#2)
71494f9  Excel export: layout estilo plan de medios (#1)
```

### Cambios de la sesión 13/may/2026 (noche) — Billing filters + row click

1. **Filtros en `/billing`**: nueva barra arriba con Budget Origin (dropdown),
   Proyecto (dropdown) y Rango de meses (slider dual con dos handles). Los
   valores se persisten en URL como `?budgetOrigin=`, `?project=`, `?from=`,
   `?to=` y se combinan con el `?client=` global. Componente client:
   `components/billing-filters.tsx`. Las opciones del dropdown se computan
   server-side desde billings existentes (scoped por cliente si aplica) vía
   nueva query `getBillingFilterOptions`.

2. **Filas clickeables**: cada fila de la tabla linkea a
   `/proyectos/[code]/planes/[planId]/billing?month=YYYY-MM`. La página
   destino ya tenía el editor completo (status transitions draft → ready →
   sent → paid, consumo por publisher, imputación de fees). Visual de chevron
   al final de cada fila refuerza la affordance.

3. **CSS del dual-range slider**: nuevos estilos en `app/globals.css` para la
   clase `.month-slider-thumb`. Dos `<input type="range">` superpuestos con
   `pointer-events: none` en el track y `pointer-events: auto` en el thumb,
   para que ambos handles sean arrastrables sobre el mismo track.

### Cambios de la sesión 13/may/2026 (tarde-2) — Gantt: feriados AR

Los feriados nacionales argentinos se rendean en el Gantt igual que los
fines de semana (banda slate-100). Nuevo módulo `lib/holidays-ar.ts` con
inamovibles + trasladables (ley 27.399) + Carnaval/Viernes Santo (Easter
gregoriano anónimo). No incluye feriados puente del PEN ni provinciales.

### Cambios de la sesión 13/may/2026 (tarde-1) — Gantt: eje diario

Debajo del eje de meses ahora hay un tick por día y un label en cada lunes
("18 may" / "May 18"). Bandas verticales slate-100 cubren sábados y
domingos en cada track + en el header del eje. Leyenda con entrada
"Fin de semana o feriado AR".

### Cambios de la sesión 13/may/2026 (tarde) — Reporting Calendar

1. **Nuevo lifecycle stage `reportado`.** Enum `project_status` ahora incluye
   `'reportado'` después de `'closed'`. Es el estado terminal: el reporte
   final fue entregado al cliente y el proyecto ya no tiene entregables
   nuestros. Solo se entra acá marcando el reporte como delivered desde el
   calendario; no es seteable manualmente vía `setProjectStatus`. El
   `StatusBadge` muestra el badge con color accent.

2. **Nueva tabla `project_reports`** (`db/schema.ts`). Una fila por
   proyecto, creada cuando el proyecto pasa a `'closed'`. Campos:
   `closed_at` (timestamp), `delivery_date` (date), `delivery_date_assigned_at`
   (timestamp, se reescribe en cada edición del compromiso), `delivered_at`
   (timestamp, no null = entregado y desaparece del calendario), `notes`.
   Unique en `project_id`. **Requiere `npm run db:push` + un backfill** (ver
   abajo).

3. **Página `/reportes/calendario`** (`app/(app)/reportes/calendario/page.tsx`).
   - Tabla arriba con proyectos closed sin `delivery_date` asignada. Botón
     "Asignar fecha" abre un modal con date picker.
   - Gantt abajo (`components/reporting-gantt.tsx`) — ventana fija de
     **-30 / hoy / +30 días**. Una fila por reporte en curso. Por fila:
     círculo gris (closed_at), cuadrado violeta (delivery_date_assigned_at),
     línea punteada de compromiso, rombo accent (delivery_date). Si hoy >
     delivery_date, el rombo se pinta rojo y hay una línea horizontal roja
     hasta la vertical azul punteada de "hoy". Símbolos que caen fuera de
     la ventana se renderizan como flechita ◄ / ► en el borde.
   - Modal "Marcar entregado" — al confirmar: `delivered_at = now()`, el
     proyecto pasa a `'reportado'`, se loguea en audit log
     (`entity_type='project_report', action='delivered'`) y el reporte
     desaparece del calendario.
   - Cualquier reasignación de fecha **reescribe** `delivery_date_assigned_at`
     (representa el compromiso vigente, no el original).

4. **Server actions** (`app/actions/reports.ts`):
   - `setProjectStatus({projectId, status})` — bloquea pasaje manual a
     `'reportado'` y desde `'reportado'`; cuando entra a `'closed'` crea la
     fila de project_reports vía `ensureProjectReport` (idempotente).
   - `setReportDeliveryDate({reportId, deliveryDate})` — escribe la fecha y
     `delivery_date_assigned_at = now()`. Bloqueado si ya está delivered.
   - `markReportDelivered({reportId})` — exige `delivery_date` no null,
     setea `delivered_at`, transiciona el proyecto a `'reportado'`, loguea.

5. **Status changer en `/proyectos/[code]`**
   (`components/project-status-changer.tsx`). Botones rápidos para mover
   entre planning/active/paused/closed. No expone `'reportado'` ni permite
   volver atrás desde ahí.

6. **Backfill obligatorio en prod.** Script
   `scripts/backfill-reports.mjs` (alias `npm run db:backfill-reports`)
   inserta una fila por cada proyecto closed sin report, usando el último
   `status_change → closed` del audit log como `closed_at` (o `created_at`
   como fallback). Idempotente vía ON CONFLICT.

7. **Sidebar**: nueva entry "Calendario de reportes" (icono `CalendarClock`)
   arriba de "Reportes". El active state de `/reportes` ahora es exacto para
   no marcarse cuando estás en el calendario. `/reportes/calendario` también
   está en `CLIENT_FILTER_ROUTES` para respetar `?client=`.

8. **getOpenProjectsForPlanCreation** (`db/queries/project-detail.ts`) ahora
   excluye también `'reportado'` (no solo `'closed'`).

### Cambios de la sesión 13/may/2026 (mañana)

1. **Excel export — tab 1 con métricas completas + tab 2 budget por
   mercado.** El export `app/api/plans/[planId]/export.xlsx/route.ts` ahora:
   - **Tab 1 (Media plan)**: se elimina la columna ambigua "Primary metric".
     En su lugar, cada métrica que aparece en `metrics_json` de algún
     placement obtiene su propia columna (primero las `direct`, después las
     `calculated`, ambas ordenadas por `metrics_catalog.sortOrder`). Las filas
     de **subtotal por publisher** y de **TOTAL MEDIA** ahora suman las
     direct y **recomputan** las calculated aplicando la fórmula del
     catálogo (`metrics_catalog.formula`) sobre `(publisherSubtotalUsd,
     directSubtotals)` y `(detail.totals.media, directTotals)`
     respectivamente. Así CPM/CPC/CTR/CPA del publisher reflejan los
     subtotales del publisher y los del plan reflejan los totales del plan,
     no un promedio mecánico de los placements.
   - **Tab 2 (Budget por mercado)**: nueva hoja `Budget por mercado` / `Budget
     by market`. Filas = mercados (orden alfabético en el locale del cliente),
     columnas = meses derivados del rango global, valores = USD prorrateados
     por días que cada placement cubre en cada mes (overlap inclusive en
     ambos extremos). Footer con total mensual + grand total y columna Total
     por mercado. Placements sin fechas caen en una columna `Sin fecha` /
     `Undated`; placements sin market en una fila `(sin mercado)` /
     `(no market)`. No lleva métricas.
   - El evaluador de fórmulas (`evalFormula`) soporta los mismos patrones que
     el editor: `amount / X`, `X / Y`, multiplier `× N`. Si la fórmula no
     encaja o falta input, la celda queda vacía (no aparece `#DIV/0!`).

### Cambios de la sesión 12/may/2026

1. **Clientes CRUD + idioma operativo (en/es).** Nuevo schema enum
   `client_language` y columna `clients.language` (default `'en'`).
   Página de admin en `/configuracion/clientes` para alta/edición de
   clientes con nombre, prefijo, idioma y estado. Server actions en
   `app/actions/clients.ts` (`createClient`, `updateClient`). El idioma
   se elige en alta y en cualquier momento desde el admin.

2. **i18n: fechas + exports respetan el idioma del cliente.** Nuevo
   módulo `lib/i18n.ts` con `Language`, `formatDate`, `formatMonth` y un
   diccionario `t(key, lang)`. La pieza clave: cuando hay un cliente
   seleccionado en el filtro global, las fechas y los exports se
   renderizan en su idioma; sin filtro ("Todos"), default `'en'`.
   Páginas actualizadas: Dashboard, `/proyectos`, `/planes`, `/billing`,
   `/clientes/[slug]`, `/proyectos/[code]`, `/proyectos/[code]/planes/[planId]`.
   Componentes: `billing-estimate-card`, `facturacion-chart`,
   `projects-table-expandable`, `dashboard-view`. Exports PDF + Excel
   del plan toman el `clients.language` del plan exportado y traducen
   labels/headers/dates. Las **métricas** (clicks, views, impressions,
   cpm, cpc) **quedan en inglés** por convención de la industria — esa
   fue la regla explícita del pedido.

3. **DB cambios**: necesario correr `npm run db:push` para aplicar el
   enum `client_language` + columna `clients.language NOT NULL DEFAULT 'en'`.
   El seed (`scripts/seed.ts`) asigna idiomas: Copa Airlines (es),
   Cervecería Andina (es), Banco Pacífico (en), Tienda Roma (es).

### Cambios de la sesión 11/may/2026 (PRs #3, #5)

1. **Bug fix — Management Fee mostraba $0 en billing (PR #3).** Para fees
   tipo `management` con `ratePct`, el campo `amountUsd` se persiste como
   `0.00` y el monto se deriva en runtime con
   `amount = TM × ratePct / (100 − ratePct)`. La página de billing leía el
   `amountUsd` crudo y mostraba $0. Replicada la fórmula en:
   - `app/(app)/proyectos/[code]/planes/[planId]/billing/page.tsx` (display)
   - `app/actions/plan-billing.ts` `setFeeImputation` (validación del cap)

2. **Filtro global de cliente vía `?client=slug` (PR #3).** El picker
   arriba a la derecha ahora preserva el cliente seleccionado al navegar
   entre vistas globales (Dashboard, Proyectos, Planes, Billing). Antes
   sólo funcionaba como atajo a `/clientes/[slug]` y la selección se
   perdía al cambiar de página. Ver "Arquitectura: convenciones clave" en
   README.

3. **Editor: bidireccional rate↔delivery en métricas secundarias (PR #5).**
   El bloque "Indicadores estimados" ahora tiene el mismo editor TARIFA +
   DELIVERY que la métrica principal: editás uno y la app calcula el otro
   desde el amount. Cubre las 10 métricas direct con rate canónico
   (impressions/cpm, clicks/cpc, views/cpv, conversions/cpa, reach/cpr,
   engagements/cpe, followers/cpf, leads/cpl, installs/cpi, visits/cpvis).
   `frequency` queda como input único (es un ratio). La métrica principal
   se excluye del dropdown Y del draft inicial para no duplicarse.
   - **Requiere `npm run db:seed` para producción** — agrega 6 calculated
     metrics al catálogo (`cpr`, `cpe`, `cpf`, `cpl`, `cpi`, `cpvis`).
     Si no se siembra, las tarifas se persisten igual pero la sección
     "Métricas calculadas" no las lista separadamente. Alternativa:
     insertar las 6 rows manualmente en Supabase si se quiere conservar
     la data actual sin re-seedear.

4. **Estimaciones de facturación con detalle media/fees + accuracy
   (PR #7).** La card "Estimación de facturación" ahora muestra:
   - Bruto desglosado en **Media** (placements) y **Fees** (management/
     setup/reporting/custom), tanto en el header del mes como en la tabla
     por proyecto.
   - Una card adicional del **mes anterior** con "Real vs Estimado"
     recomputado, con variación coloreada (verde <5%, warn <15%, danger
     ≥15%). Sirve como sanity check: si la magnitud es alta, o la
     estimación está off o el plan se modificó después de facturar.
   - La card también aparece ahora en **`/planes`** (antes solo en
     `/proyectos` y `/proyectos/[code]`).
   - `getBillingEstimate` ganó campos `grossMediaUsd`, `grossFeesUsd`,
     `alreadyBilledMediaUsd`, `alreadyBilledFeesUsd` (los totales
     `grossUsd` / `alreadyBilledUsd` se mantienen como sumas, back-compat).

5. **Parte B pendiente.** Markets y metrics siguen siendo catálogos
   globales. Se pidió poder editarlos per-cliente (ver "Próximos pasos"
   abajo).

### Lo que funciona end-to-end

- Dashboard `/` con KPIs, chart de facturación real vs proyectado, tabla de
  proyectos expandible que muestra los planes de cada uno con su breakdown
  de facturado/pendiente al expandir.
- `/proyectos` con filtro por Budget Origin (dropdown) y card de estimación
  de facturación mes en curso + mes siguiente.
- `/proyectos/[code]` con detalle del proyecto y cards de planes, más
  estimación scoped al proyecto.
- `/proyectos/[code]/planes/[planId]` editor del plan con:
  - Edición inline de publishers, placements, fees.
  - Lifecycle draft → ready_to_send → approved → archived (con snapshot al
    aprobar).
  - Descartar un borrador de versión y volver al plan aprobado vigente
    (botón "Descartar borrador", solo en `draft` con `currentVersion > 0`;
    restaura desde el snapshot via `revertPlanToApprovedSnapshot`).
  - Edición bidireccional rate↔delivery según cost method principal.
  - Management fee como % editable.
  - **Botones de descarga Excel y PDF** del plan.
- `/proyectos/[code]/planes/[planId]/billing` con cap duro al consumo
  (no se puede facturar más que el planeado).
- `/clientes` y `/clientes/[slug]` con timeline gantt de proyectos.
- `/planes` cross-clientes con filtro de status + Budget Origin.
- `/billing` con todas las facturas.
- `/auditoria` con log diff por entity type / action.
- `/configuracion/markets`, `/metricas`, `/publishers` admin de catálogos.
- **Topbar**: dropdown de cliente que setea `?client=<slug>` en la URL y se
  preserva al navegar entre vistas globales (Dashboard, Proyectos, Planes,
  Billing). El sidebar reescribe sus Links automáticamente. En vistas
  detalle (`/proyectos/[code]`, etc.) el picker redirige a la lista
  equivalente al cambiar de cliente.
- Catálogo de publishers **per cliente** con `client_publishers`: cada
  cliente ve solo su subset y su default de "agencia paga".

### Qué hay en la DB

Lo que insertó el último `npm run db:seed`:
- **4 clientes**: Copa Airlines, Cervecería Andina, Banco Pacífico (active),
  Tienda Roma (paused).
- **11 proyectos** cubriendo los 4 estados (planning/active/paused/closed).
- **14+ planes peer** con mix completo de status.
- **9 plan_billings** (paid + sent + draft).

---

## Setup en la máquina del lunes

1. Clonar el repo y `npm install` (ver [README.md](README.md)).
2. Crear `.env.local` con el connection string de Supabase. El password
   está en tu password manager (lo reseteaste el viernes — Supabase no
   muestra passwords antiguas).
3. **Importante**: usar el **Transaction Pooler** (puerto **6543**), no el
   Session Pooler ni la Direct Connection. Formato:
   ```
   DATABASE_URL=postgresql://postgres.bgbqraoowtoyzgzubple:TU_PASSWORD@aws-0-sa-east-1.pooler.supabase.com:6543/postgres
   ```
4. `npm run dev` y abrir `http://localhost:3000`.

Si pasa algo raro con la DB, `npm run db:check` para diagnosticar.

---

## Próximos pasos sugeridos (orden recomendado)

### 1. Parte B — Markets y Metrics per-cliente

**Contexto**: en la sesión del 11/may se hizo el filtro global de cliente
(`?client=slug`). En esa charla se pidió que `markets` y `metrics_catalog`
fueran per-cliente para que cada cliente pueda tener su propia lista. Hoy
son catálogos globales — la edición per-cliente requiere migración de
schema y NO se hizo en este PR para no romper data.

**Estado del schema hoy**:
- `markets` — global, sin FK a cliente.
- `metrics_catalog` — global, sin FK a cliente.
- `publishers` — global, pero con tabla join `client_publishers` que ya
  permite per-cliente (sólo falta UI).
- `budget_origins` — ya es per-cliente (`client_id` FK).

**Decisiones a tomar antes de codear**:

1. **¿Mapping tables o columnas directas?**
   - **Opción A** (mappings — sigue el patrón de `client_publishers`):
     nuevas tablas `client_markets (client_id, market_id, enabled,
     sort_order)` y `client_metrics (client_id, metric_id, enabled)`. El
     catálogo global queda como lista maestra editable por admins; cada
     cliente activa el subset que usa.
   - **Opción B** (column directa): agregar `client_id` a `markets` y
     `metrics_catalog`. Cada cliente tiene sus propios markets/metrics
     completamente independientes; no hay catálogo global. Más simple
     conceptualmente pero significa duplicar la lista para cada cliente
     nuevo.

2. **Migración de data existente**: hoy hay markets/metrics que se usan en
   `media_plan_placements.market_id` y `media_plan_placements.metrics_json`.
   - Si vamos Opción A: la FK existente en `placements` queda como está; el
     mapping `client_markets` se rellena para todos los clientes con el set
     global actual (mantener compat).
   - Si vamos Opción B: hay que duplicar cada row global a cada cliente
     existente Y reescribir las FKs en `placements` para apuntar al
     market_id correcto del cliente. Más invasivo.

3. **UI**: la página `/configuracion/markets` y `/configuracion/metricas`
   hoy editan el catálogo global. Cuando hay `?client=` activo, deberían
   mostrar el subset/lista de ese cliente. Sin cliente seleccionado: ver el
   catálogo maestro (Opción A) o mostrar mensaje "elegí un cliente"
   (Opción B).

4. **Publishers UI**: aprovechar para hacer la UI de `client_publishers`
   también (hoy se cargan vía seed). Misma página que markets/metrics: con
   cliente seleccionado, editar los publishers habilitados + sus
   `agency_pays`.

**Mi recomendación**: Opción A (mappings). Es coherente con `client_publishers`
que ya existe, la migración es backwards-compatible (data global queda
intacta), y el catálogo maestro sigue siendo un lugar útil para admins.

**Cuando se retome**: arrancar con la decisión Opción A vs B antes de
tocar schema. El filtro global de cliente ya está listo, así que el wiring
de la página queda mecánico una vez decidido el modelo de datos.

### 2. Auth + permisos (lo que pediste para el lunes)

El requerimiento: la app está abierta hoy para mostrar al manager. El
próximo paso es agregar autenticación con roles.

**Camino sugerido**:
- Supabase Auth (ya tenés Supabase configurado, viene gratis).
- Middleware en `middleware.ts` que redirija a `/login` si no hay sesión.
- Roles en una tabla `users` (mapeada por `auth.users.id`):
  - `admin` (todo)
  - `account_manager` (CRUD proyectos + billing)
  - `media_planner` (CRUD planes)
  - `finance` (billing y reportes, read-only en planes)
  - `viewer` (solo lectura)
- Server Actions chequean rol antes de cada mutación.
- Login page en `app/login/page.tsx` (fuera del grupo `(app)`).

**Decisiones a tomar**:
- ¿SSO con Google Workspace de Sangria, o email+password?
- ¿Roles per-cliente o globales? (ej. ¿un AM puede ser AM solo de Copa?)
- ¿Cómo manejamos el flujo de aprobación de un plan — quién firma?

### 3. Admin UI para per-client publishers — HECHO (sesión 20/may/2026)

Resuelto: `publishers` es per-cliente y se administra desde la sección
Publishers de `/configuracion/clientes/[slug]` (crear / renombrar / habilitar /
agency_pays / borrar). Se eliminó el catálogo global y la tabla
`client_publishers`. Ver el bloque de sesión arriba + `db/publishers-per-client.sql`.

### 4. Admin UI para clientes y budget origins

Los **budget origins** ya tienen CRUD per-cliente en
`/configuracion/clientes/[slug]` (sesión 14/may). Lo que falta es el alta
de **clientes** desde la UI — hoy crear un cliente sigue siendo vía seed.
Sería en `/configuracion/clientes` (ya está en placeholders).

### 5. Polish del PDF/Excel

El PDF está en texto plano sin tablas; el Excel tiene 4 hojas básicas. Si
los media planners van a mandarlo al cliente, conviene hacerlos más
presentables:
- PDF con tablas reales (probablemente migrando a `@react-pdf/renderer` o
  similar).
- Excel con formato (bordes, colores, formulas para los CPM/CPC, fila de
  totales por publisher, etc.).
- Header con logo de Sangria y datos del cliente.

### 6. Reportes

`/reportes` tiene 6 specs descriptas. Implementar a medida que el equipo
genere data histórica y se pueda benchmarkear.

---

## Gotchas / cosas que vale la pena recordar

### Vercel + Supabase
- **Transaction Pooler (6543)**, no Session Pooler (5432) ni Direct.
- `DATABASE_URL` debe estar marcado para Production, Preview y Development
  en Vercel.
- Cambiar la variable **requiere Redeploy** (Vercel no la aplica en deploys
  ya construidos).
- Si querés cambiar el password, Supabase no lo muestra de nuevo: **resetealo**
  desde Supabase → Settings → Database → Database password.

### Statement timeout en Supabase free
Si una query tarda >8s, Supabase la cancela. Si pasa, ejecutar en SQL
Editor de Supabase:
```sql
ALTER ROLE authenticated SET statement_timeout = '60s';
ALTER ROLE anon SET statement_timeout = '60s';
ALTER ROLE service_role SET statement_timeout = '60s';
ALTER DATABASE postgres SET statement_timeout = '60s';
```

### Drizzle + postgres-js
- **No usar** `sql\`= ANY(${arr})\`` — interpola mal. **Usar** `inArray()`.
- Para `max(timestamp)`, castear a `::text` y parsear: postgres-js no
  convierte el binary timestamp bien.

### Schema changes
- `npm run db:push --force` para aplicar `db/schema.ts` directo a la DB
  (NO genera migración).
- Después de un `db:push` hay que correr `npm run db:seed` si la migración
  rompió constraints o cambios de columnas.
- Si querés ir a un workflow de migraciones reales (recomendado antes de
  prod-prod), pasar a `db:generate` + `db:migrate` y commitear las
  migraciones SQL.

### Helpers de client filter: split client vs server
- `lib/client-filter.ts` — sólo helpers PUROS (path/URL). Lo usan
  componentes `"use client"` (sidebar, topbar-client-picker). NO importar
  `db` ni nada server-only acá.
- `lib/client-filter.server.ts` — usa `db`. Sólo importar desde pages /
  server actions. Si por error se importa desde un client component, el
  bundler intentará bundlear `postgres` para el navegador y falla.
- Convención: el sufijo `.server.ts` es informal (no enforced). En el
  futuro, si se instala el paquete `server-only` se puede agregar el
  `import "server-only"` arriba del archivo para que falle en build si
  alguien lo importa mal.

### MetricsEditor: principal vs secundarias sobre el mismo `metrics_json`
- El `PrincipalPairEditor` y el `MetricsEditor` editan el MISMO
  `media_plan_placements.metrics_json` (jsonb). Cada uno es dueño de un
  subset de keys:
  - `PrincipalPairEditor` — la delivery slug que corresponde al cost
    method del placement + su rate (ej. `impressions` + `cpm` para dCPM).
  - `MetricsEditor` — todas las DEMÁS direct con sus rates.
- El draft del `MetricsEditor` EXCLUYE la métrica principal del placement.
  Su `commit` PRESERVA las keys de la principal leyendo de `metrics_json`
  antes de escribir el draft, así no las pisa.
- Si agregás un nuevo cost method al schema, actualizá:
  1. `COST_METHODS` + `CostMethod` type + `COST_METHOD_PRIMARY_METRIC` en
     `lib/cost-methods.ts`.
  2. Si la métrica principal es nueva, agregá la entrada en
     `DIRECT_METRIC_RATES` con su rate slug + multiplier.
  3. Si el rate es nuevo, agregalo al `metricsCatalog` seed con su
     fórmula `amount / <delivery>`.

### Management fee con `rate_pct`
- Schema (`db/schema.ts:357-359`): los management fees con `rate_pct`
  guardan `amount_usd = 0.00`. El monto se deriva siempre en runtime.
- Fórmula: `amount = TM × rate_pct / (100 − rate_pct)` donde `TM = total
  media del plan` (suma de `totalPlannedUsd` de todos los publishers).
- Hay 4 lugares que aplican esta fórmula. Si se modifica, actualizar los 4:
  1. `db/queries/project-detail.ts:394-408` (vista del plan)
  2. `db/queries/dashboard.ts` (`feeBreakdown` y `getBillingEstimate`)
  3. `app/(app)/proyectos/[code]/planes/[planId]/billing/page.tsx` (display)
  4. `app/actions/plan-billing.ts` `setFeeImputation` (validación del cap)

### Force-dynamic global
[app/(app)/layout.tsx](app/(app)/layout.tsx) tiene
`export const dynamic = "force-dynamic"`. Esto evita que cualquier page
under `(app)` sea estática. Si en algún momento queremos cachear partes,
hay que sacarlo y agregar `force-dynamic` solo en las pages que lo
necesiten.

### React 19 — set state during render
Si ves errores como "Cannot update component while rendering...", chequear
los componentes cliente que tengan condicionales con `setX(...)` afuera de
useEffect. Pasó en `proyectos/nuevo/form.tsx` y se arregló moviendo a
`useEffect`.

### Build de Vercel
- Si falla con `DATABASE_URL is not defined`: el lazy-init del Proxy ya
  evita esto, pero si rompe igual, chequear que los pages no estén
  marcados como statics y que no haya un import sincrónico que dispare la
  creación de la DB en build.
- Si falla con `ENETUNREACH` IPv6: verificar que `db/index.ts` tenga el
  `dns.setDefaultResultOrder("ipv4first")` arriba.

---

## Donde están las cosas — referencia rápida

| Quiero...                              | Mirar...                                                  |
|----------------------------------------|-----------------------------------------------------------|
| Cambiar el schema                      | `db/schema.ts`                                            |
| Agregar una query                      | `db/queries/<dominio>.ts`                                 |
| Agregar una server action              | `app/actions/<dominio>.ts`                                |
| Cambiar la navegación (desktop ≥lg)    | `components/top-nav.tsx` (tira horizontal en el header). Entradas compartidas en `lib/nav.ts` (`PRIMARY_NAV`/`FOOTER_NAV`/`isNavActive`). |
| Cambiar la navegación (drawer mobile <lg) | `components/sidebar.tsx` (mismo `lib/nav.ts`). En ≥lg el `<aside>` no se renderiza. |
| Cambiar el topbar                      | `components/topbar.tsx` (marca + `TopNav` desktop; `topbar-nav.tsx` = título de sección solo mobile). |
| Cambiar la tabla expandible (Proyectos) | `components/projects-table-expandable.tsx` — el prop `searchable` activa buscador (nombre/código) + orden A-Z; el dashboard la usa SIN `searchable` (sin buscador, orden de la query). |
| Cambiar el buscador / orden de Planes  | `components/plans-table-client.tsx` (orden A-Z por nombre + filtro por nombre del plan o código del proyecto). La page `app/(app)/planes/page.tsx` ordena la query por `mediaPlans.name` y le pasa las filas ya filtradas por status/origen. |
| Tocar el tablero de pendientes (compacto / colapsable) | `components/pending-board.tsx` — colapso del board entero desde su header (persistido en `localStorage` `sangria:pending-board-collapsed`, leído con `useSyncExternalStore`; server arranca abierto), `PREVIEW` filas inline por card antes del "+ N más", densidad compacta. La `AlertBar` de vencidos queda siempre visible. Datos: `getDashboardPendings` en `db/queries/pendings.ts`. |
| Cambiar el editor del plan             | `app/(app)/proyectos/[code]/planes/[planId]/editor.tsx`   |
| Cambiar el **PDF** del plan            | `lib/plan-pdf.ts` (`renderPlanPdf`, todo el layout landscape: header, tabla, fees, GRAND TOTAL, firma, iniciales, sanitize WinAnsi). La ruta `app/api/plans/[planId]/export.pdf/route.ts` es solo el handler (fetch + filename + Response). |
| Cambiar el **Excel** del plan          | `app/api/plans/[planId]/export.xlsx/route.ts` (workbook inline ExcelJS: Tab 1 Media plan + Tab 2 Budget por mercado + tabs 3+ auxiliares si el plan tiene). |
| Tocar los tabs auxiliares del plan (grillas libres con fórmulas / tabs extra del Excel) | UI: `app/(app)/proyectos/[code]/planes/[planId]/aux-sheet.tsx` (botón "Crear tab auxiliar" + una sección colapsable por tab en el editor). CRUD: `app/actions/aux-sheets.ts`. Límites + helpers + **evaluador de fórmulas** (refs A1, SUM/AVERAGE/MIN/MAX/COUNT, errores `#REF!`/`#CIRC!`/…): `lib/aux-sheet.ts` (`evalAuxFormula`). Schema: `media_plan_aux_sheets` (N por plan, `sort_order`). **Insertar/eliminar filas y columnas en cualquier posición**: menú click-derecho en el editor → `insertAuxRow/Col` + `deleteAuxRow/Col` en `lib/aux-sheet.ts` (mueven data + uniones y reescriben refs con `shiftAuxFormula`). Los tabs del export: `buildAuxSheet` en `export.xlsx/route.ts` (fórmulas → fórmulas reales de Excel; **formato** header/subtotal/total/banding + anchos auto + congelado, parecido al Tab 1). |
| Qué métricas se muestran / cómo se computan en los exports | `lib/plan-metrics.ts` — `resolveMetricColumns` (qué columnas: directs presentes + calculated que resuelven), `placementMetricValue` (valor por placement: guardado o computado), `evalFormula`. Lo usan **PDF y Excel**. Las calculated NO están en `metrics_json`. |
| Cambiar el logo de los exports         | Reemplazar `public/sangria-logo.png` (o `.jpg`). Lo carga `lib/brand-logo.ts`; el tracing está en `next.config.ts` (`outputFileTracingIncludes`). Posición/tamaño: PDF en `lib/plan-pdf.ts`, XLSX en `export.xlsx/route.ts`. |
| Cambiar el nombre de archivo del export | `filename` en cada ruta `export.{pdf,xlsx}/route.ts`: hoy `{plan.name}-V{currentVersion}`. |
| Cambiar el disclaimer legal / texto de firma | Keys i18n `export.signatureDisclaimer`, `export.signaturePrompt`, `export.dateLabel`, `export.initials` en `lib/i18n.ts`. |
| Cambiar el prorrateo del budget split por mercado | `prorateByMonth` + `buildBudgetSplit` en `lib/budget-split.ts` (días-overlap inclusive) — lo usan el Tab 2 del Excel (`export.xlsx/route.ts`) y el preview del editor (`BudgetSplitPreview` en `editor.tsx`). |
| Tocar el lifecycle de un billing | `app/actions/plan-billing.ts` — `transitionBillingStatus` (validaciones + revert), `markBillingInvoiced` (sent → invoiced + cargar/editar número de factura, con pre-check de unicidad) y `clearBillingInvoiceNumber` (quita el número y revierte invoiced → sent). Labels: `components/billing-status-badge.tsx`. UI de los botones: `BillingStatusActions` en `app/(app)/proyectos/[code]/planes/[planId]/billing/editor.tsx`. |
| Cambiar el formato del PDF que se manda a finanzas | `app/api/billings/[id]/report.pdf/route.ts`. Columnas hardcodeadas en `COL_*` constants; cada fila es `Media Placement` (publishers con `agencyPays && isBillable` y consumo > 0 — los que paga el cliente directo se excluyen) o `Services` (fees con imputación > 0). |
| Tocar la lógica del Reporting Calendar | `app/actions/reports.ts` (actions: setProjectStatus / setReportDeliveryDate / markReportDelivered), `db/queries/reports.ts` (queries), `app/(app)/reportes/calendario/page.tsx` (page). |
| Tocar los comentarios de reportes del calendario | UI: `components/report-comments.tsx` (`ReportCommentsButton` + `ReportCommentsModal`). Actions: `app/actions/report-comments.ts` (list/add/update/delete, con audit). Schema: `report_comments` (FKs nullable a project/manual report). Counts: `commentsCount` en `CalendarReport`/`SentReport` (`db/queries/reports.ts`). El seed de la descripción como primer comentario vive en `createManualReport`. |
| Cambiar los filtros de /billing | `components/billing-filters.tsx` (dropdowns budget origin/proyecto/estado + slider de meses). El filtro de estado usa `BILLING_STATUSES` + `billingStatusLabel` de `components/billing-status-badge.tsx`; se aplica en `getBillingsList` (`db/queries/billing.ts`, param `status`) y la page valida `?status=` contra el enum. Las opciones de origin/proyecto/rango vienen de `getBillingFilterOptions`. |
| Tocar el Billing Tracker | `app/(app)/billing-tracker/page.tsx` (UI), `components/billing-tracker-filters.tsx` (filtros), `db/queries/billing-tracker.ts` (`getBillingTracker`, `getBillingTrackerFilterOptions`). Solo lista billings con `invoice_number` no-null (status `invoiced` o `paid`). |
| Compartir el slider dual de meses | `components/month-range-slider.tsx`. Self-contained; el parent pasa `initialFromIdx`/`initialToIdx` + `key` para resetearlo cuando los committed values cambian. |
| Tocar el Campaign Tracker | `app/(app)/campaign-tracker/page.tsx` (hub), `app/(app)/campaign-tracker/[planId]/page.tsx` (vista de carga) + `tracker-editor.tsx` (tabla editable con autosave + cerrar día + comparar) + `tracker-chart.tsx` (chart recharts). Queries: `db/queries/campaign-tracker.ts` (`getCampaignTrackerHub`, `getCampaignTrackerPlan`). Actions: `setPlacementActual`, `closeDailyLoad` en `app/actions/campaign-tracker.ts`. |
| Tocar el histórico de cargas / "Cerrar día" | Tabla `campaign_actual_snapshots` (`db/schema.ts`), action `closeDailyLoad`. La query `getCampaignTrackerPlan` arma `lastCloseDate` + `previousActuals` por placement leyendo el snapshot más reciente. |
| Cambiar la lógica de métricas del tracker (calculadas, pace, labels) | `lib/campaign-metrics.ts` — `buildMetricRows` (compartido server+client + `pacing.xlsx`; **siempre** recibe `calcDefs` del `metrics_catalog` del cliente para derivar calculadas, incl. custom como ROAS/CPT — no hay fallback hardcodeado), `computePacePct` / `computePaceStatus`. Clasificación direct/calc por catálogo: `db/queries/campaign-tracker.ts` (`directSlugs`/`calcDefs`) + validación en `setPlacementActual`. El export `pacing.xlsx` une los `calcDefs` de los planes (`unionCalcDefs`) para que subtotales/totales deriven las mismas calculadas que el detalle. `CALC_METRICS` (built-in) hoy solo lo usa el simulador (`db/queries/simulator.ts`). Piezas visuales en `components/campaign-tracker-bits.tsx`. |
| Cambiar qué planes aparecen como "vigentes" | `getCampaignTrackerHub` en `db/queries/campaign-tracker.ts` — filtra `status='approved'` + período (min/max de placements) incluye hoy. |
| Ocultar/mostrar un cliente en el filtro global | `clients.status` — `archived` lo saca del topbar picker y de `/clientes`. Se sigue gestionando desde `/configuracion/clientes`. |
| Cambiar el destino del click en una fila de /billing | `app/(app)/billing/page.tsx` — variable `detailHref` por row. Apunta a `/proyectos/[code]/planes/[planId]/billing?month=YYYY-MM`. |
| Estilos del slider dual-range de meses | `app/globals.css` — clase `.month-slider-thumb` (Webkit + Firefox). |
| Ajustar la ventana del Gantt o los símbolos | `components/reporting-gantt.tsx`. Constants `WINDOW_BEFORE_DAYS`, `WINDOW_AFTER_DAYS`, colores `COLOR_*`. |
| Cambiar el flow closed → reportado | `app/actions/reports.ts` `markReportDelivered` (delivered_at + project.status='reportado' + audit log). |
| Agregar un status nuevo a proyectos | `db/schema.ts` enum `projectStatus`, `components/status-badge.tsx`, `components/project-status-changer.tsx` (SELECTABLE / LABELS / PROMPTS). |
| Cambiar el label/color del badge de estado de un PLAN | `components/plan-status-badge.tsx` (`PlanStatusBadge`) — fuente única usada por el editor, el detalle de proyecto y las tablas de Planes/Proyectos. Prop `size` `md`/`sm`. NO duplicar el mapa de estilos en cada vista. |
| Cambiar el label/color del badge de estado de un BILLING | `components/billing-status-badge.tsx` (`BillingStatusBadge`) — fuente única (lang-aware es/en, prop `size` `md`/`sm`) usada por la lista de meses del plan, el detalle del editor, `/billing` y `/billing-tracker`. NO duplicar el mapa. |
| Cambiar el look de un botón / agregar variante o tamaño | `components/button.tsx` — `Button` (para `<button>`) + `buttonVariants()` (className para `<Link>`/`<a>`). Variantes primary/secondary/ghost/danger, tamaños xs/sm/md/lg. NO volver a escribir `bg-ink text-white …` inline; usar el primitivo. |
| Mostrar / cambiar el usuario logueado en la chrome | `app/(app)/layout.tsx` lee `getCurrentUser()` una vez y lo pasa a `components/sidebar.tsx` (footer) y `components/topbar.tsx` (avatar + menú `TopbarUser`). |
| Cambiar quién puede aprobar planes | `lib/permissions.ts` (`PLAN_APPROVER_EMAILS` + `canApprovePlans`). Chequeo real en `transitionPlanStatus` (`app/actions/plans.ts`, branch `to === "approved"`); el botón se esconde vía prop `canApprove` que `…/planes/[planId]/page.tsx` pasa al `PlanEditor`. |
| Agregar/editar skills de Claude Code (web) | `.claude/skills/` (versionado; el resto de `.claude/` está gitignored). Hoy: `ui-ux-pro-max` (scripts BM25 + data CSV) y `context7` (docs via API). Para sumar otro, copiar su carpeta `SKILL.md` ahí y commitear. Se cargan en la PRÓXIMA sesión web, no en la que se agregan. |
| Mostrar feedback (éxito/error) o pedir confirmación | `components/toast.tsx` (`useToast().success/error/info`) y `components/confirm-dialog.tsx` (`await useConfirm()({title, body, danger})`). Montados en `components/app-providers.tsx`. NO usar `alert()`/`confirm()` nativos. |
| Tocar el skeleton/loading o el error/404 de las rutas | `app/(app)/loading.tsx` (+ `PageSkeleton` en `components/skeleton.tsx`), `app/(app)/error.tsx` (boundary + retry), `app/(app)/not-found.tsx`. |
| Tocar el nav mobile (drawer + hamburguesa) | `components/mobile-nav.tsx` (`MobileNavProvider`, `MobileNavToggle`, `useMobileNav`). El sidebar (`components/sidebar.tsx`) es drawer en `< lg` y sticky en `≥ lg`; el toggle vive en el topbar. |
| Editar / eliminar un proyecto | `app/(app)/proyectos/[code]/edit-panel.tsx` (UI) + `updateProject` / `deleteProject` en `app/actions/projects.ts`. El alta (`createProject` + `proyectos/nuevo/form.tsx`) deriva el `code` del nombre. |
| Cambiar el form de "+ Nuevo plan" (vacío vs duplicar) | `app/(app)/proyectos/[code]/planes/nuevo/form.tsx` (UI) + `app/(app)/proyectos/[code]/planes/nuevo/page.tsx` (carga las opciones de fuentes via `listSourcePlansForClient`). Action: `duplicatePlan` en `app/actions/plans.ts`. |
| Descartar un borrador y volver al plan aprobado | Botón "Descartar borrador" en `editor.tsx` (header, solo en `draft` con `currentVersion > 0`) + `revertPlanToApprovedSnapshot` en `app/actions/plans.ts`. Restaura publishers/placements/fees/nombre/notas desde el snapshot `version = currentVersion` (en transacción) y deja el plan en `approved`. Contraparte de "Editar (nueva versión)". |
| Cambiar el render del log de auditoría / papelera | `app/(app)/auditoria/page.tsx` (log), `app/(app)/auditoria/papelera/page.tsx` (papelera). Sustantivos / verbos / labels de timestamp en `lib/audit-format.ts` — agregar nuevos entityType acá. El render de cada evento (oración + diff) vive en `components/audit-entry.tsx` (compartido con el modal del plan). |
| Tocar el chip "Última edición" / modal de cambios del plan | UI: `app/(app)/proyectos/[code]/planes/[planId]/plan-history.tsx` (`PlanLastEdit` + modal read-only). Datos: `getPlanAuditEvents` en `db/queries/audit-log.ts`. La ventana de la versión vigente la computa `…/planes/[planId]/page.tsx` con `detail.snapshots`. |
| Tocar la auth (login con Google, dominio permitido, sign-out) | `lib/supabase/{server,client,middleware}.ts` (cliente Supabase), `lib/auth.ts` (`getCurrentUser`), `proxy.ts` (route protection — Next.js 16 reemplaza middleware.ts), `app/login/`, `app/auth/{callback,signout}/`. El dominio `@sangria.agency` está hardcodeado en `proxy.ts` y `callback/route.ts` — cambiarlo en ambos. |
| Tocar el portal de cliente (público, read-only) | `app/(portal)/[clientSlug]/` (page + secciones + filtros), `app/api/portal/{login,logout}/route.ts`, `lib/client-portal.ts` (password/reservados/helpers edge-safe), `lib/client-portal.server.ts` (cookie + `canAccessClientExport`), `db/queries/client-portal.ts` (lookup + filtros). El gate público (solo GET) está en `lib/supabase/middleware.ts`. **Toda ruta top-level nueva de la app → sumala a `RESERVED_TOP_LEVEL_SLUGS`.** |
| Cambiar el password / usuario del portal de cliente | `CLIENT_PORTAL_PASSWORD` en `lib/client-portal.ts` (compartido para todos). El usuario es el slug o el nombre del cliente. El admin (`/configuracion/clientes`) muestra link + usuario + password con copiar. |
| Cambiar el favicon | `app/icon.svg` (App Router lo toma como icono; hoy "S" blanca sobre negro). No hay `favicon.ico`. |
| Tocar el análisis por publisher × mercado (mapa) | `components/market-analysis.tsx` (filtros + mapa + ranking + tabla, URL-based), `components/americas-map.tsx` (mapa SVG d3-geo), `lib/market-geo.ts` (centroides de mercados — agregá acá un mercado nuevo), `db/queries/analysis.ts` (`getMarketActivations`, `getAnalysisFilterOptions`). Páginas: `/analisis` (interna) y el tab Análisis del portal. |
| Wirear un user a un audit_log nuevo | Usar `await recordAudit({...})` de `lib/audit.ts` en server actions. Auto-detecta el user via `getCurrentUser()`. No insertar directo con `db.insert(auditLog)` desde server actions — si lo hacés a mano queda como "Sistema". |
| Activar RLS / cerrar la REST API pública de Supabase | `db/rls.sql` — `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` en todas las tablas de `public`. Pegarlo en el SQL Editor. La app no se ve afectada (conecta como `postgres`, dueño → bypassa RLS; no se usa `FORCE`). **Toda tabla nueva** necesita su propio ENABLE. |
| Cargar más datos demo                  | `scripts/seed.ts` + `npm run db:seed`                     |
| Configurar conexión DB                 | `db/index.ts`                                             |
| Agregar nueva ruta                     | `app/(app)/<...>/page.tsx`                                |
| Catálogo de cost methods, etc.         | `db/schema.ts` (enums) + `editor.tsx` (mapping principal) |
| Tocar el picker / filtro global cliente| `components/topbar-client-picker.tsx`, `lib/client-filter*.ts` |
| Agregar una ruta al filtro de cliente  | `CLIENT_FILTER_ROUTES` en `lib/client-filter.ts`          |
| Cambiar el idioma de un cliente        | `/configuracion/clientes` o columna `clients.language`     |
| Editar publishers/métricas/mercados/budget origins de un cliente | `app/(app)/configuracion/clientes/[slug]/sections.tsx` (UI) + actions en `app/actions/{publishers,metrics,markets,budget-origins}.ts`. La page (`page.tsx`) trae las 4 listas por `clientId`. |
| Agregar/traducir strings nuevas        | `DICT` en `lib/i18n.ts` + usar `t(key, lang)` en JSX       |
| Cambiar formato de fechas en la app    | `formatDate` / `formatMonth` en `lib/i18n.ts`              |
| Cambiar cómo se calcula el management fee | `db/schema.ts:357-359` (fórmula), `db/queries/project-detail.ts`, `db/queries/dashboard.ts`, `app/(app)/proyectos/[code]/planes/[planId]/billing/page.tsx`, `app/actions/plan-billing.ts` (todos aplican la misma fórmula) |
| Agregar/cambiar pares rate↔delivery del editor | `DIRECT_METRIC_RATES` en `lib/cost-methods.ts` + nueva calculated metric en `scripts/seed.ts` con fórmula `amount / <delivery>` |
| Editor de métricas del placement       | `MetricsEditor` y `PrincipalPairEditor` en `app/(app)/proyectos/[code]/planes/[planId]/editor.tsx` |
| Cambiar la card de estimación de facturación | `components/billing-estimate-card.tsx` (UI) + `getBillingEstimate` en `db/queries/dashboard.ts` (datos). **Vive en** `/billing-tracker?tab=estimates` (tab Estimates). |
| Agregar otra dimensión al desglose de la estimación | Extender el `ProjectAgg` interno de `getBillingEstimate` con el nuevo agregado, propagar a `MonthlyBillingEstimate`, y agregar columna en `EstimateMonthCard` |
| Tocar el generador de reportes históricos | `app/(app)/reportes/generador/page.tsx` (UI/preview), `components/report-generator-form.tsx` (filtros + column picker), `db/queries/historical-report.ts` (`getHistoricalReport` + `getReportFilterOptions`), `app/api/reports/historical.xlsx/route.ts` (Excel). Page y Excel comparten `resolveReportColumns` de `lib/historical-report-columns.ts` para que preview = archivo. |
| Cambiar qué columnas se ofrecen en el generador | `lib/historical-report-columns.ts` — `IDENTITY_COL_IDS` y `MONEY_COL_IDS` definen las columnas fijas; las métricas vienen del catálogo del cliente vía `getReportFilterOptions`. URL param `?cols=...` (comma-separated). |
| Tocar las tabs del billing-tracker | `app/(app)/billing-tracker/page.tsx` — la página lee `?tab=tracker|estimates` (default `tracker`) y server-rendera lo correspondiente. El nav está inline (`TabsNav`), URL-based con `<Link>`. |
| Tocar el preview tipo Excel del editor del plan | `ExcelPreview` en `app/(app)/proyectos/[code]/planes/[planId]/editor.tsx`. Read-only, colapsable, con toggle "Plan de medios" / "Budget por mercado" (pills). Tab 1 usa los helpers de `lib/plan-metrics.ts`; Tab 2 (`BudgetSplitPreview`) usa `buildBudgetSplit` de `lib/budget-split.ts` — los mismos que el export. |
| Tocar el formato US / fórmulas estilo Excel de los inputs | `lib/format.ts` — `formatIntInput`, `formatAmountInput`, `parseNumberInput`, `evalNumberInput` (con un mini parser de descenso recursivo, NO usa `eval()`). Wireado en `NumberInput`, `RateInput`, `DeliveryInput`, `RatePctInput` del editor del plan y `NumInput` del billing. |
| Cambiar el link al PPT del reporte | Schema: `project_reports.report_ppt_url`. Acción: `setReportPptUrl` en `app/actions/reports.ts`. UI: `LinkForm` en `components/reporting-calendar-client.tsx` (modal). Aparece en cada fila de la lista de Reportes Enviados. |

---

## Si algo está roto el lunes

1. `npm run db:check` para verificar la conexión.
2. Si el dev no levanta: chequear `.env.local` vs el formato del README.
3. Si Vercel está down: revisar Logs en Vercel y ver el último deploy
   exitoso. `git revert <hash>` y push si hace falta.
4. Si la DB tiene data mala/inconsistente: `npm run db:push` (re-aplica
   schema) + `npm run db:seed` (rehace todo desde cero).

Suerte y dale para adelante.
