# Handoff — viernes 15/may/2026

Estado del repo al cierre y plan para retomar en otra sesión.

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
  al lado del filtro de Budget Origin). Abre un modal con **nombre,
  descripción, fecha de entrega**. Requiere que haya un cliente seleccionado
  en el filtro global del topbar — sino el botón queda deshabilitado.
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
- **Deuda técnica**: la clasificación direct vs calculated de métricas usa
  `DIRECT_METRIC_RATES` (`lib/cost-methods.ts`) como fuente — si el
  `metrics_json` de un placement trae keys que no están ahí, se ignoran
  para la carga. La query de snapshots trae todo el histórico del plan;
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
4cc96da  Restringir la aprobación de planes a una allowlist de emails (#100)
e152dfc  Fix: un billing en draft no saca el mes del tablero de pendientes (#98)
5379c4e  Cosmético: primitivo Button + usuario real en el sidebar (#96)
20e1a1c  Cosmético: unificar el badge de estado de plan + limpiar código muerto (#94)
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
| Cambiar la sidebar                     | `components/sidebar.tsx`                                  |
| Cambiar el topbar                      | `components/topbar.tsx`                                   |
| Cambiar la tabla expandible (Proyectos) | `components/projects-table-expandable.tsx` — el prop `searchable` activa buscador (nombre/código) + orden A-Z; el dashboard la usa SIN `searchable` (sin buscador, orden de la query). |
| Cambiar el buscador / orden de Planes  | `components/plans-table-client.tsx` (orden A-Z por nombre + filtro por nombre del plan o código del proyecto). La page `app/(app)/planes/page.tsx` ordena la query por `mediaPlans.name` y le pasa las filas ya filtradas por status/origen. |
| Tocar el tablero de pendientes (compacto / colapsable) | `components/pending-board.tsx` — colapso del board entero desde su header (persistido en `localStorage` `sangria:pending-board-collapsed`, leído con `useSyncExternalStore`; server arranca abierto), `PREVIEW` filas inline por card antes del "+ N más", densidad compacta. La `AlertBar` de vencidos queda siempre visible. Datos: `getDashboardPendings` en `db/queries/pendings.ts`. |
| Cambiar el editor del plan             | `app/(app)/proyectos/[code]/planes/[planId]/editor.tsx`   |
| Cambiar el **PDF** del plan            | `lib/plan-pdf.ts` (`renderPlanPdf`, todo el layout landscape: header, tabla, fees, GRAND TOTAL, firma, iniciales, sanitize WinAnsi). La ruta `app/api/plans/[planId]/export.pdf/route.ts` es solo el handler (fetch + filename + Response). |
| Cambiar el **Excel** del plan          | `app/api/plans/[planId]/export.xlsx/route.ts` (workbook inline ExcelJS: Tab 1 Media plan + Tab 2 Budget por mercado). |
| Qué métricas se muestran / cómo se computan en los exports | `lib/plan-metrics.ts` — `resolveMetricColumns` (qué columnas: directs presentes + calculated que resuelven), `placementMetricValue` (valor por placement: guardado o computado), `evalFormula`. Lo usan **PDF y Excel**. Las calculated NO están en `metrics_json`. |
| Cambiar el logo de los exports         | Reemplazar `public/sangria-logo.png` (o `.jpg`). Lo carga `lib/brand-logo.ts`; el tracing está en `next.config.ts` (`outputFileTracingIncludes`). Posición/tamaño: PDF en `lib/plan-pdf.ts`, XLSX en `export.xlsx/route.ts`. |
| Cambiar el nombre de archivo del export | `filename` en cada ruta `export.{pdf,xlsx}/route.ts`: hoy `{plan.name}-V{currentVersion}`. |
| Cambiar el disclaimer legal / texto de firma | Keys i18n `export.signatureDisclaimer`, `export.signaturePrompt`, `export.dateLabel`, `export.initials` en `lib/i18n.ts`. |
| Cambiar el prorrateo del budget split por mercado | `prorateByMonth` en `app/api/plans/[planId]/export.xlsx/route.ts` (días-overlap inclusive). |
| Tocar el lifecycle de un billing | `app/actions/plan-billing.ts` — `transitionBillingStatus` (validaciones + revert) y `markBillingInvoiced` (sent → invoiced con número de factura). Labels: `STATUS_STYLE_BY_LANG` en `app/(app)/billing/page.tsx` y `BillingStatusPillInline` en el editor. |
| Cambiar el formato del PDF que se manda a finanzas | `app/api/billings/[id]/report.pdf/route.ts`. Columnas hardcodeadas en `COL_*` constants; cada fila es `Media Placement` (publishers facturables con consumo > 0) o `Services` (fees con imputación > 0). |
| Tocar la lógica del Reporting Calendar | `app/actions/reports.ts` (actions: setProjectStatus / setReportDeliveryDate / markReportDelivered), `db/queries/reports.ts` (queries), `app/(app)/reportes/calendario/page.tsx` (page). |
| Cambiar los filtros de /billing | `components/billing-filters.tsx` (dropdowns + slider). Las opciones vienen de `getBillingFilterOptions` en `db/queries/billing.ts`. |
| Tocar el Billing Tracker | `app/(app)/billing-tracker/page.tsx` (UI), `components/billing-tracker-filters.tsx` (filtros), `db/queries/billing-tracker.ts` (`getBillingTracker`, `getBillingTrackerFilterOptions`). Solo lista billings con `invoice_number` no-null (status `invoiced` o `paid`). |
| Compartir el slider dual de meses | `components/month-range-slider.tsx`. Self-contained; el parent pasa `initialFromIdx`/`initialToIdx` + `key` para resetearlo cuando los committed values cambian. |
| Tocar el Campaign Tracker | `app/(app)/campaign-tracker/page.tsx` (hub), `app/(app)/campaign-tracker/[planId]/page.tsx` (vista de carga) + `tracker-editor.tsx` (tabla editable con autosave + cerrar día + comparar) + `tracker-chart.tsx` (chart recharts). Queries: `db/queries/campaign-tracker.ts` (`getCampaignTrackerHub`, `getCampaignTrackerPlan`). Actions: `setPlacementActual`, `closeDailyLoad` en `app/actions/campaign-tracker.ts`. |
| Tocar el histórico de cargas / "Cerrar día" | Tabla `campaign_actual_snapshots` (`db/schema.ts`), action `closeDailyLoad`. La query `getCampaignTrackerPlan` arma `lastCloseDate` + `previousActuals` por placement leyendo el snapshot más reciente. |
| Cambiar la lógica de métricas del tracker (calculadas, pace, labels) | `lib/campaign-metrics.ts` — `CALC_METRICS` (CPM/CTR/…), `buildMetricRows` (compartido server+client), `computePacePct` / `computePaceStatus`. Piezas visuales (barras, badges, freshness dots) en `components/campaign-tracker-bits.tsx`. |
| Cambiar qué planes aparecen como "vigentes" | `getCampaignTrackerHub` en `db/queries/campaign-tracker.ts` — filtra `status='approved'` + período (min/max de placements) incluye hoy. |
| Ocultar/mostrar un cliente en el filtro global | `clients.status` — `archived` lo saca del topbar picker y de `/clientes`. Se sigue gestionando desde `/configuracion/clientes`. |
| Cambiar el destino del click en una fila de /billing | `app/(app)/billing/page.tsx` — variable `detailHref` por row. Apunta a `/proyectos/[code]/planes/[planId]/billing?month=YYYY-MM`. |
| Estilos del slider dual-range de meses | `app/globals.css` — clase `.month-slider-thumb` (Webkit + Firefox). |
| Ajustar la ventana del Gantt o los símbolos | `components/reporting-gantt.tsx`. Constants `WINDOW_BEFORE_DAYS`, `WINDOW_AFTER_DAYS`, colores `COLOR_*`. |
| Cambiar el flow closed → reportado | `app/actions/reports.ts` `markReportDelivered` (delivered_at + project.status='reportado' + audit log). |
| Agregar un status nuevo a proyectos | `db/schema.ts` enum `projectStatus`, `components/status-badge.tsx`, `components/project-status-changer.tsx` (SELECTABLE / LABELS / PROMPTS). |
| Cambiar el label/color del badge de estado de un PLAN | `components/plan-status-badge.tsx` (`PlanStatusBadge`) — fuente única usada por el editor, el detalle de proyecto y las tablas de Planes/Proyectos. Prop `size` `md`/`sm`. NO duplicar el mapa de estilos en cada vista. |
| Cambiar el look de un botón / agregar variante o tamaño | `components/button.tsx` — `Button` (para `<button>`) + `buttonVariants()` (className para `<Link>`/`<a>`). Variantes primary/secondary/ghost/danger, tamaños xs/sm/md/lg. NO volver a escribir `bg-ink text-white …` inline; usar el primitivo. |
| Mostrar / cambiar el usuario logueado en la chrome | `app/(app)/layout.tsx` lee `getCurrentUser()` una vez y lo pasa a `components/sidebar.tsx` (footer) y `components/topbar.tsx` (avatar + menú `TopbarUser`). |
| Cambiar quién puede aprobar planes | `lib/permissions.ts` (`PLAN_APPROVER_EMAILS` + `canApprovePlans`). Chequeo real en `transitionPlanStatus` (`app/actions/plans.ts`, branch `to === "approved"`); el botón se esconde vía prop `canApprove` que `…/planes/[planId]/page.tsx` pasa al `PlanEditor`. |
| Editar / eliminar un proyecto | `app/(app)/proyectos/[code]/edit-panel.tsx` (UI) + `updateProject` / `deleteProject` en `app/actions/projects.ts`. El alta (`createProject` + `proyectos/nuevo/form.tsx`) deriva el `code` del nombre. |
| Cambiar el form de "+ Nuevo plan" (vacío vs duplicar) | `app/(app)/proyectos/[code]/planes/nuevo/form.tsx` (UI) + `app/(app)/proyectos/[code]/planes/nuevo/page.tsx` (carga las opciones de fuentes via `listSourcePlansForClient`). Action: `duplicatePlan` en `app/actions/plans.ts`. |
| Descartar un borrador y volver al plan aprobado | Botón "Descartar borrador" en `editor.tsx` (header, solo en `draft` con `currentVersion > 0`) + `revertPlanToApprovedSnapshot` en `app/actions/plans.ts`. Restaura publishers/placements/fees/nombre/notas desde el snapshot `version = currentVersion` (en transacción) y deja el plan en `approved`. Contraparte de "Editar (nueva versión)". |
| Cambiar el render del log de auditoría / papelera | `app/(app)/auditoria/page.tsx` (log), `app/(app)/auditoria/papelera/page.tsx` (papelera). Sustantivos / verbos / labels de timestamp en `lib/audit-format.ts` — agregar nuevos entityType acá. |
| Tocar la auth (login con Google, dominio permitido, sign-out) | `lib/supabase/{server,client,middleware}.ts` (cliente Supabase), `lib/auth.ts` (`getCurrentUser`), `proxy.ts` (route protection — Next.js 16 reemplaza middleware.ts), `app/login/`, `app/auth/{callback,signout}/`. El dominio `@sangria.agency` está hardcodeado en `proxy.ts` y `callback/route.ts` — cambiarlo en ambos. |
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
| Tocar el preview tipo Excel del editor del plan | `ExcelPreview` en `app/(app)/proyectos/[code]/planes/[planId]/editor.tsx`. Read-only, colapsable; usa los mismos helpers que el export (`resolveMetricColumns`, `placementMetricValue`, `sumDirectMetrics` de `lib/plan-metrics.ts`). |
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
