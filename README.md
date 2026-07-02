# Sangria Media OS

App interna de Sangria para gestionar planes de medios y facturación. MVP
para Copa Airlines y otros clientes.

**Producción**: deploy automático en Vercel desde `main`.
**Repo**: https://github.com/marianomanto-cmd/sangria-dashboard

---

## Setup en una máquina nueva

### 1. Requisitos
- Node.js ≥ 20 ([nodejs.org](https://nodejs.org))
- Git
- Editor (VS Code, Cursor, etc.)

### 2. Clonar e instalar

```powershell
git clone https://github.com/marianomanto-cmd/sangria-dashboard.git
cd sangria-dashboard
npm install
```

### 3. Variables de entorno

Crear `.env.local` en la raíz del proyecto con:

```
DATABASE_URL=postgresql://postgres.bgbqraoowtoyzgzubple:TU_PASSWORD@aws-0-sa-east-1.pooler.supabase.com:6543/postgres
```

**Importante:**
- Usar el **Transaction Pooler** (puerto **6543**), no el Session Pooler (5432) ni la Direct Connection.
- El password sale de Supabase → Settings → Database → Database password → Reset (Supabase no muestra el password antiguo).
- El connection string completo se copia desde Supabase → Settings → Database → Connection string → tab **Transaction pooler**.

### 4. Correr el dev server

```powershell
npm run dev
```

Abre `http://localhost:3000`.

### 5. Operaciones útiles de DB

```powershell
npm run db:push                # Aplica el schema (db/schema.ts) sin generar migraciones
npm run db:seed                # Limpia y repuebla la DB con datos de demo
npm run db:check               # Conecta y muestra info básica de las tablas
npm run db:studio              # Abre Drizzle Studio
npm run db:backfill-reports    # Crea project_reports para proyectos closed existentes (idempotente)
```

`db:push` usa `--force` (ver `package.json`). Útil para desarrollo; para
producción real conviene migrar a `db:generate` + `db:migrate`.

---

## Stack

- **Next.js 16.2.6** (App Router, Turbopack)
- **React 19.2** + TypeScript 5
- **Tailwind v4** con `@theme` block (rediseño Round 03: negro + crema cálido,
  accent vino `#7a1f3d`, `--color-surface` para cards). Dark mode class-based
  (`.dark` en `<html>`): los tokens se redefinen bajo `.dark` en `globals.css`
  así toda utility swappea sola.
- **Fuentes** (`next/font/google`): Geist (UI), JetBrains Mono (cifras) y
  **Archivo** (display / titulares, `--font-display`).
- **Drizzle ORM 0.45** sobre Postgres (Supabase)
- **postgres-js** como driver
- **lucide-react** para íconos
- **recharts** para el chart de facturación
- **xlsx** + **pdf-lib** para exports

---

## Estructura del proyecto

```
app/
  login/                    # /login — botón "Continuar con Google" (público)
  auth/
    callback/route.ts       # OAuth callback: exchange + valida @sangria.agency
    signout/route.ts        # POST → cierra sesión
  (app)/                    # layout principal (TopNav en el header ≥lg + Sidebar drawer <lg + Topbar) — todo requiere login
    layout.tsx              # async, llama getCurrentUser() una vez, monta AppProviders + MobileNavProvider
    loading.tsx             # skeleton de página durante la navegación del router (usa PageSkeleton)
    error.tsx               # error boundary recuperable (retry) — captura errores de server components
    not-found.tsx           # 404 con EmptyState
    page.tsx                # Dashboard (3 vistas: ?view=cuentas|operaciones|ejecutivo; default cuentas)
    clientes/               # /clientes y /clientes/[slug]
    proyectos/              # /proyectos, /proyectos/[code]/*, /proyectos/nuevo
      [code]/planes/[planId]/
        editor.tsx          # editor del plan (publishers + placements + fees)
        aux-sheet.tsx       # tabs auxiliares del plan: grillas libres tipo Excel con fórmulas, insertar/eliminar filas y columnas en cualquier posición (menú click-derecho) (tabs extra del export)
        plan-history.tsx    # chip "Última edición" + modal read-only con los cambios de la versión vigente (audit_log)
        billing/            # editor de facturación mensual
    planes/                 # /planes — vista cross-proyectos
    billing/                # /billing — lista de facturas con filtros (origin/project/range) + buscador en vivo por N°/plan + click-to-edit
    billing-tracker/        # /billing-tracker — tabs "Tracker" (proyecto→plan→facturas emitidas) + "Estimates" (estimación de facturación)
    campaign-tracker/       # /campaign-tracker — hub con filtro vigentes/concluidos/todos + vista de carga de consumo real vs goal
      [planId]/             # vista de carga: tabla editable (autosave) + chart de progreso
    auditoria/              # /auditoria — log legible + papelera (/auditoria/papelera)
    configuracion/
      markets/, metricas/     # accesos a catálogos per-cliente
      clientes/               # alta/edición de clientes + config per-cliente (publishers, métricas, mercados, budget origins)
      papelera-planes/        # papelera de planes borrados (soft delete) + restaurar
    reportes/
      page.tsx              # landing con cards a las 3 herramientas
      calendario/           # Reporting Calendar (closed → reportado, link PPT por reporte)
      simulador/            # Simulador de escenarios con benchmarks históricos
      generador/            # Generador de reportes históricos (Excel) con preview en vivo + column picker
    analisis/               # Análisis publisher × mercado con mapa de América (filtro global de cliente)
  (portal)/                 # Portal de cliente PÚBLICO, read-only (fuera del gate de Supabase)
    [clientSlug]/           # /<slug> — tabs Resumen/Billing/Estimación/Proyectos/Análisis/Reportes/Benchmarks
      page.tsx              # gate por cookie → login o tabs; lookup por slug (404 si no existe/reservado)
      portal-content.tsx    # secciones (server) reusando las queries internas scopeadas al cliente
      portal-login.tsx, portal-logout.tsx, portal-benchmarks-filters.tsx
      portal-filters.tsx      # filtros URL-based del portal: multi-select genérico (MultiSelect, búsqueda opcional) para Budget Origin (?bo) / Proyecto (?proj) / Mes (?month) / Campañas (?camp) — todos listas separadas por coma — + rango de fechas Desde/Hasta (Proyectos, ?pfrom/?pto)
  api/
    plans/[planId]/
      export.xlsx/route.ts  # XLSX del plan (logo + firma + disclaimer + todas las métricas + mercado + fechas por publisher/placement)
      export.pdf/route.ts   # PDF del plan (thin handler → lib/plan-pdf.ts). Acceso: sesión interna O cookie de portal del cliente dueño
    portal/
      login/route.ts        # POST login del portal (autovalidante, público); logout/route.ts
      pacing.xlsx/route.ts  # XLSX CONSOLIDADO del pacing de varias campañas (Resumen/Detalle/Por mercado). Público + canAccessClientExport + ownership
      estimate.xlsx/route.ts # XLSX de la tab Estimación con los mismos meses/filtros que la ventana (thin handler → lib/portal-estimate-xlsx.ts). Público + canAccessClientExport
    benchmarks/
      export/route.ts       # Excel/PDF de benchmarks filtrados (público + canAccessClientExport)
    reports/
      historical.xlsx/route.ts  # XLSX del generador (misma query que el preview, mismo resolveReportColumns)
  actions/                  # Server Actions (CRUD)
    plans.ts, plan-billing.ts, projects.ts, markets.ts, metrics.ts, publishers.ts,
    budget-origins.ts, clients.ts, reports.ts, campaign-tracker.ts, aux-sheets.ts
  globals.css

components/                 # UI compartida
  theme-toggle.tsx          # toggle claro/oscuro (clase .dark en <html>)
  skeleton.tsx              # placeholders shimmer para loading states; PageSkeleton para loading.tsx
  chart-kit.tsx             # recharts compartido: useChartColors() (dark-aware) + tooltipStyle() + <ChartGradient>
  portal-charts.tsx         # charts del Resumen del portal: SpendByPublisherChart (planeado vs real) + CumulativeBillingChart (área YTD)
  americas-map.tsx          # mapa de mercados con Leaflet (tiles CARTO, burbujas por mercado, zoom/pan)
  market-analysis.tsx       # vista de análisis publisher × mercado (filtros multi-select + mapa + ranking + tabla); /analisis y portal
  plans-table-client.tsx    # /planes: buscador, sort por columna, density toggle, vista list/by-project, columna media+consumido (PR #79)
  projects-table-expandable.tsx  # tabla de proyectos con drill-down; prop `searchable` → buscador + A-Z (tab Proyectos)
  dashboard/                # Dashboard REDISEÑADO (3 vistas con toggle): dashboard-view.tsx (switch por ?view= + SectionBoundary) · view-cuentas/operaciones/ejecutivo.tsx · shared.tsx (groupPendings→href real, deriveClients, MiniBars, PendingRow). Reemplaza al viejo dashboard-view/pending-board/kpi-card (BORRADOS)
  topbar-nav.tsx            # título de sección (Archivo), SOLO mobile (<lg) — en desktop manda la TopNav del header
  top-nav.tsx               # navegación principal en el HEADER (≥lg): tira horizontal ícono+label desde lib/nav.ts; mide el ancho y mete lo que no entra en un menú "Más ▾" (nunca scrollea, ResizeObserver). Reemplaza al sidebar vertical para liberar el ancho al contenido
  billing-estimate-card.tsx # cards de estimación de facturación (mes previo real vs estimado + N meses futuros). Vive en /billing-tracker?tab=estimates y en el portal. Con `projectionsById` (portal) cada fila de proyecto se DESPLIEGA in situ → billing de cada plan + facturas emitidas (histórico: número + mes + valor) + cronograma de lo que falta facturar por mes restante (getClientBillingProjections)
  billing-filters.tsx       # /billing: dropdowns budget origin/proyecto/estado + slider de meses, URL-based
  billing-table.tsx         # /billing: tabla (desktop) + cards (mobile) con buscador en vivo por N° de factura o nombre de plan (client-side, sobre las filas ya cargadas; case-insensitive, no recarga)
  billing-tracker-filters.tsx    # filtros del tracker (project + month range), URL-based
  reporting-calendar-client.tsx  # /reportes/calendario: pending list + Gantt + sent reports (con link PPT por fila)
  reporting-gantt.tsx       # Gantt diario -30/+30 días para reporting calendar
  report-comments.tsx       # tablerito de comentarios por reporte del calendario (botón + modal con autor/fecha/hora)
  report-generator-form.tsx # /reportes/generador: filtros cascading + column picker URL-based
  button.tsx                # Button + buttonVariants() — primitivo único para CTAs (primary/secondary/ghost/danger, xs/sm/md/lg). NO volver a escribir bg-ink inline
  plan-status-badge.tsx     # PlanStatusBadge — badge de estado del plan (draft/ready_to_send/approved/archived), prop size md/sm. Fuente única; no duplicar
  billing-status-badge.tsx  # BillingStatusBadge — badge de estado del billing, lang-aware es/en, prop size md/sm. Fuente única; no duplicar
  toast.tsx                 # ToastProvider + useToast() — feedback no bloqueante success/error/info con live-region (role=alert/status)
  confirm-dialog.tsx        # ConfirmProvider + useConfirm() — confirmación promise-based con focus-trap, Escape, backdrop. No usar confirm() nativo
  app-providers.tsx         # monta ToastProvider + ConfirmProvider — en el layout, envuelve el contenido de la app
  audit-entry.tsx           # render de un evento del audit_log (oración + diff de campos) — lo usan /auditoria y el modal de cambios del plan
  mobile-nav.tsx            # MobileNavProvider + MobileNavToggle + useMobileNav() — sidebar drawer en mobile (< lg)
  sidebar.tsx               # navegación como DRAWER mobile (< lg); en ≥lg no se renderiza (la nav vive en top-nav.tsx)
db/
  schema.ts                 # tablas + enums
  index.ts                  # cliente Drizzle (lazy con Proxy + Transaction Pooler)
  rls.sql                   # ENABLE ROW LEVEL SECURITY en todas las tablas (cierra la REST API pública de Supabase)
  queries/
    dashboard.ts            # KPIs, proyectos+planes, monthly chart, estimación
    project-detail.ts       # detalle de proyecto + plan
    client-detail.ts        # detalle de cliente con timeline
    historical-report.ts    # getHistoricalReport + getReportFilterOptions (generador de reportes)
    clients.ts, billing.ts, billing-tracker.ts, audit-log.ts, budget-origins.ts,
    reports.ts, campaign-tracker.ts, plan-trash.ts (planes borrados),
    pendings.ts (tablero de pendientes del dashboard)
    analysis.ts             # activaciones por mercado (mapa /analisis + portal): getMarketActivations + getAnalysisFilterOptions
    client-portal.ts        # portal: getPortalClient, getPortalFilterOptions, getClientSpendByPublisher
scripts/
  seed.ts                   # datos de demo (4 clientes)
  db-check.mjs, db-reset.mjs
lib/
  format.ts                 # formatUsd, formatPct, formatUsdCompact + inputs US: formatIntInput / formatAmountInput / parseNumberInput / evalNumberInput (fórmulas tipo Excel)
  i18n.ts                   # Language type + formatDate/formatMonth + dictionary `t`
  brand-logo.ts             # carga el logo de marca (public/sangria-logo.png|jpg) + dimensiones, para los exports
  plan-metrics.ts           # evalFormula + placementMetricValue + resolveMetricColumns + placementsPeriod + sumDirectMetrics (compartido PDF/Excel/preview)
  aux-sheet.ts              # tabs auxiliares del plan: límites + sanitize/normalize + evaluador de fórmulas (refs A1 + SUM/AVERAGE/…) + insert/delete fila/columna con reescritura de refs (estilo Excel) + helpers de layout para los exports (auxContentBounds/classifyAuxRow/detectAuxHeaderRow) — compartido editor/actions/export PDF+Excel
  nav.ts                    # entradas de navegación compartidas (PRIMARY_NAV/FOOTER_NAV + isNavActive) entre top-nav.tsx (desktop) y sidebar.tsx (drawer mobile)
  budget-split.ts           # prorrateo por días + agregación mercado × mes — compartido por el Tab 2 del Excel y el preview del editor
  plan-pdf.ts               # renderPlanPdf(detail, allMetrics): PDF apaisado con tabla de métricas + una página por hoja auxiliar (formato del plan + firma/fecha)
  portal-estimate-xlsx.ts   # buildEstimateWorkbook(estimates): Excel de la tab Estimación del portal (Resumen mensual + Detalle por proyecto, look de marca). Lo usa api/portal/estimate.xlsx
  historical-report-columns.ts  # IDs canónicos + labels + parse/serialize del column picker del generador de reportes
  client-filter.ts          # helpers puros del filtro global ?client=slug
  client-filter.server.ts   # resolver server-only slug → {id, slug, name, language}
  cost-methods.ts           # mapping cost method → métrica principal
  campaign-metrics.ts       # Campaign Tracker: métricas calculadas + pace + buildMetricRows
  audit.ts                  # recordAudit() — wrapper para insertar en audit_log con autor
  audit-format.ts           # entityNoun / actionVerb / entityLabel / actorLabel / formatRelativeDateTime
  auth.ts                   # getCurrentUser() (server-side)
  permissions.ts            # canApprovePlans(email) + PLAN_APPROVER_EMAILS — allowlist de aprobación de planes (case-insensitive)
  client-portal.ts          # portal público: password compartido, slugs reservados, helpers PUROS (edge-safe, los usa el proxy)
  client-portal.server.ts   # cookie de sesión del portal (set/clear/has) + canAccessClientExport
  market-geo.ts             # geocoding de mercados → centroide (match exacto + por token); para el mapa de Análisis
  project-period.ts         # período del proyecto (min/max de placements) + aviso "termina pronto" (≤7 días)
  supabase/
    server.ts               # cliente Supabase para Server Components / route handlers
    client.ts               # cliente Supabase para Client Components
    middleware.ts           # updateSession() — usado por proxy.ts (route protection)
proxy.ts                    # Next.js 16: ex-middleware.ts. Auth gate global.
public/
  sangria-logo.png          # logo de marca para los exports (PDF/XLSX). Ver "Exports del plan"
next.config.ts              # outputFileTracingIncludes del logo para las rutas de export
.claude/
  skills/                   # Skills versionados de Claude Code on the web (cargados en la próxima sesión; el resto de .claude/ está gitignored)
    ui-ux-pro-max/          # Design intelligence: BM25 search sobre estilos, paletas, tipografía, UX, charts. Scripts Python + CSVs
    context7/               # Docs de librerías al día vía la API pública de Context7 (curl, sin API key)
```

---

## Arquitectura: convenciones clave

### Cifras numéricas: SIEMPRE formato US
- Punto = decimales, coma = separador de miles (ej: `15,000.00`, `1,500,000`).
  Nunca usar `Intl.NumberFormat("es-AR")` para cifras (la coma decimal de es-AR
  rompe el round-trip de los inputs editables).
- Todo input numérico editable muestra el valor con `formatIntInput` /
  `formatAmountInput` (`en-US`) y parsea lo tipeado con `evalNumberInput`
  (descarta la coma de miles y el símbolo de moneda, conserva el punto decimal)
  — todo en `lib/format.ts`.
- Para inputs nativos usar `<input type="number">` (su `.value` ya es US,
  independiente del locale del browser), como hace el simulador.
- **Fórmulas estilo Excel**: `evalNumberInput` admite aritmética simple en
  cualquier campo numérico del plan/billing (`+2*2` → 4, `=1000*12` → 12000,
  `(1500+500)*3` → 6000), con `+ - * /`, paréntesis y signos unarios. El
  evaluador es un parser propio de descenso recursivo (NO usa `eval()`);
  devuelve `NaN` ante una fórmula inválida (incl. división por cero), y los
  inputs en ese caso **restauran el valor previo** sin commitear. Los inputs
  evalúan al perder foco y al apretar **Enter** (que además dispara la
  navegación tipo planilla de la grilla de placements).
- **Legibilidad**: los inputs numéricos del editor (`NumberInput`, `RateInput`,
  `DeliveryInput`) usan caja blanca con borde (`text-sm`, ancho holgado:
  `w-32`/`w-36`) para que entren cifras de millones sin recortarse. El monto del
  placement quedó consistente con tarifa/delivery. El **inspector** del placement
  es más ancho (`lg:grid-cols-[1fr_440px]`) para dar aire a las métricas
  secundarias, y las textareas de **audiencia** y **notas** son más altas
  (`rows={3}` + `resize-y`). `RateInput`/`DeliveryInput` aceptan un prop
  `className` (default `w-full` en inspector; en la **planilla** se angostan a
  `w-24`/`w-28` right-aligned para no comerse el ancho de la fila).

### Borrar un plan es soft delete (papelera)
- Borrar un plan desde la vista de proyecto setea `media_plans.deleted_at` (no
  lo elimina). Se conserva ad eternum y se restaura desde
  `/configuracion/papelera-planes`.
- **Regla**: toda query que liste planes (o billings/datos derivados de planes)
  debe filtrar `deleted_at IS NULL` — en el ON del join a `media_plans` o en el
  WHERE. Si agregás una query nueva sobre `media_plans`, acordate del filtro.
- La unicidad de nombre por proyecto es un **partial unique index**
  `(project_id, name) WHERE deleted_at IS NULL`: se puede reusar el nombre de un
  plan borrado.

### Listados de Planes y Proyectos: orden A-Z + buscador
- Las tabs `/planes` y `/proyectos` ordenan **A-Z por nombre** por default y
  anteponen un buscador en vivo que filtra por **nombre o código** (del plan o
  proyecto). Orden y filtro se computan en cliente sobre las filas ya cargadas
  (no recargan la página) y son case-insensitive + locale-aware.
- Planes: la tabla vive en `components/plans-table-client.tsx`. Proyectos: la
  tabla es `ProjectsTableExpandable` con el prop `searchable` (el dashboard la
  usa con `searchable=false` → sin buscador y con el orden de la query).
- **`/billing` comparte el mismo patrón**: `components/billing-table.tsx`
  antepone un buscador en vivo por **N° de factura o nombre de plan**
  (client-side sobre las filas ya cargadas, case-insensitive). Los filtros
  duros de `/billing` (budget origin / proyecto / estado / rango de meses)
  siguen siendo URL-based y el buscador acota lo que esos filtros ya dejaron.

### Filtro de año (Planes, Proyectos, Calendario)
- Las tabs `/planes`, `/proyectos` y `/reportes/calendario` filtran por **año**,
  con **default = año actual**. Un plan/proyecto pertenece a un año si su
  **período de placements lo intersecta** (una campaña 2024→2025 cae en ambos);
  las filas sin fechas cuentan como año actual. En el calendario el reporte se
  ubica por su **fecha de entrega** (o el cierre del proyecto si todavía no la
  tiene). Opción **"Todos"** en los tres.
- Helpers puros en `lib/year-filter.ts` (`periodMatchesYear`, `availableYears`,
  `resolveYearParam`). Planes/Proyectos usan `components/year-selector.tsx`
  (pills URL-based vía `?year=`; el año actual va sin param). El Calendario lo
  resuelve client-side (useState, mismo patrón que su filtro de budget origin).
  Todo el filtrado es en memoria sobre las filas ya cargadas.

### `/planes`: vista panel (KPIs + sort + density + agrupado + consumido)
- **Strip de KPIs** arriba del listado: total media + consumido (con barra
  accent) + planes vigentes (approved + ready) + drafts. Computado server-side
  desde el set ya filtrado por status / origen / cliente.
- **Sort por columna**: Plan, Proyecto, Cliente, Estado, Período y Media son
  clickeables y alternan asc↔desc. Default name asc.
- **Density toggle** (Normal / Compacta), persistido en `localStorage`
  (`sangria:planes:density`) vía `useSyncExternalStore` — mismo patrón que
  `theme-toggle`.
- **Vista "Por proyecto"** (toggle alternativo a Lista, también persistido en
  `sangria:planes:view`): planes anidados bajo cada proyecto, con mini-resumen
  por card (cantidad + total media + consumido).
- **Columna Media · Consumido**: cada plan muestra el total media, una barra
  de progreso (`spent / total media`) y el % consumido. El consumo real se
  calcula en query separada sobre `plan_billing_publishers.amount_real_usd`
  para no joinear placements+billings (cartesian).

### El plan vive dentro del proyecto, peer con otros planes
- Un proyecto puede tener N planes en paralelo (no son versiones de uno).
- Cada plan tiene su propio lifecycle: `draft` → `ready_to_send` → `approved` → `archived`.
- Los planes pueden solapar fechas y estar todos `approved` al mismo tiempo.

### Aprobar, editar (nueva versión) y descartar el borrador
- Aprobar (`ready_to_send` → `approved`) guarda un **snapshot inmutable** en
  `media_plan_snapshots` (`version_number = current_version`, que se incrementa)
  con el estado completo del plan: publishers + placements + fees + nombre +
  notas. Ver `transitionPlanStatus` / `capturePlanSnapshot` en
  `app/actions/plans.ts`.
- "Editar (nueva versión)" vuelve el plan `approved` → `draft` para trabajar la
  v(N+1) sin tocar el snapshot aprobado (`current_version` no cambia hasta la
  próxima aprobación).
- Si el planner se arrepiente, **"Descartar borrador"** (botón visible en el
  editor solo en un `draft` con `current_version > 0`) tira todos los cambios y
  restaura el plan al snapshot de la versión aprobada vigente, dejándolo de
  nuevo en `approved`. Lo hace `revertPlanToApprovedSnapshot` en
  `app/actions/plans.ts`: restore **en transacción** (borra el contenido del
  draft y reinserta el del snapshot, mapeando old→new ids), restaura nombre +
  notas y vuelve a `approved`. Pre-chequea colisión de nombre con el partial
  unique index si el draft había renombrado el plan. Es irreversible.
- **Snapshot vs. FKs que pueden desaparecer**: el snapshot es JSONB congelado,
  así que puede referenciar un `market_id` que ya no existe (los markets se
  borran/editan desde config; la FK live es `onDelete: set null`). Al restaurar,
  `revertPlanToApprovedSnapshot` sanitiza cada `market_id` contra los markets
  vivos — si ya no existe lo deja en `null` (igual que la FK al borrarse) — para
  no reventar la transacción con un FK violation. El `publisher_id` es seguro
  (`onDelete: restrict`: un publisher en uso no se puede borrar). Si algo falla
  igual, la action captura el error y devuelve `{ok:false}` (toast) en vez de
  propagar y romper la vista.

### Tabs auxiliares del plan (tabs extra del Excel, con fórmulas)
- Cada plan puede tener **N tabs auxiliares** opcionales
  (`media_plan_aux_sheets`, ordenados por `sort_order`): **grillas libres tipo
  Excel** que el planner edita a mano desde el editor del plan (botón **"Crear
  tab auxiliar"**, una sección colapsable por tab). Arriba muestran la metadata
  del plan (proyecto, período, budget origin, read-only); debajo, la grilla
  editable.
- **Interacción estilo Excel** (todo en `aux-sheet.tsx`, estado local):
  - **Selección de rango** con mouse (arrastrar o Shift+click) y teclado
    (flechas, Shift+flechas para extender, `Ctrl/Cmd+A` para todo). La celda
    activa se edita con doble click, Enter, F2 o tipeando (reemplaza). Dentro de
    la edición: Enter baja, Tab a la derecha, Escape cancela.
  - **Copiar / cortar / pegar / borrar** rangos: `Ctrl/Cmd+C` · `X` · `V` ·
    `Supr` (o los botones Copiar/Pegar/Borrar). El portapapeles es **TSV**, así
    que se puede **pegar desde Excel/Sheets** (y copiar hacia ellos); pegar
    agranda la grilla hasta los topes y un valor 1×1 rellena toda la selección.
  - **Combinar / separar celdas**: botones Combinar/Separar sobre la selección.
    Las uniones viven en `media_plan_aux_sheets.merges_json` (`{r0,c0,r1,c1}[]`
    en coords de la grilla). Al combinar **sobrevive solo el valor de la celda
    top-left** (master); las tapadas se guardan vacías, así el evaluador de
    fórmulas y el export las tratan como vacías sin lógica extra. El editor las
    rinde con `rowSpan/colSpan` y el export con `ws.mergeCells` (mismas coords).
    Helpers (`sanitizeMerges`, `findMerge`, `rectsIntersect`) en `lib/aux-sheet.ts`,
    saneadas server-side en `updateAuxSheet`.
  - **Insertar / eliminar filas y columnas en cualquier posición** (no solo al
    final): **click derecho** en el N° de fila o la letra de columna abre un
    menú estilo Excel (insertar arriba/abajo, izquierda/derecha, eliminar);
    click izquierdo selecciona la línea entera. Las ops puras viven en
    `lib/aux-sheet.ts` (`insertAuxRow/Col`, `deleteAuxRow/Col`): corren la data,
    mueven/encogen las **uniones** y —como Excel— **reescriben las referencias
    de las fórmulas** (`shiftAuxFormula`) para que sigan apuntando a lo mismo.
    Un **rango** (`SUM(A5:A10)`) se encoge/agranda como unidad; una ref **suelta**
    a una línea borrada queda `#REF!`. Pasan por el mismo historial + autosave.
  - **Deshacer / rehacer**: `Ctrl/Cmd+Z` y `Ctrl/Cmd+Shift+Z` (o `Ctrl+Y`, o los
    botones Deshacer/Rehacer). Historial **por tab** de hasta `HISTORY_MAX` (50)
    snapshots `{grid, merges}`: cada mutación apila el estado previo y una
    edición nueva limpia el redo. Deshacer/rehacer también **persiste** (mismo
    `updateAuxSheet`). Mientras se edita una celda, `Ctrl+Z` es el undo de texto
    nativo del input (la grilla solo lo toma fuera de edición).
- **Fórmulas**: una celda que empieza con `=` es una fórmula estilo Excel —
  aritmética (`+ - * /`, paréntesis), referencias A1 (`=B5*2`) y funciones
  `SUM / AVERAGE / MIN / MAX / COUNT` sobre rangos (`=SUM(A5:A10)`). La
  numeración visible del editor **coincide** con la del tab exportado (la
  grilla arranca en la fila `AUX_SHEET_GRID_ROW_OFFSET` = 5), así las refs
  significan lo mismo en ambos lados. El editor muestra el resultado (la
  fórmula cruda al enfocar, como Excel) y errores con códigos `#REF!`,
  `#VALUE!`, `#DIV/0!`, `#CIRC!` (ciclos), `#ERROR!`. Evaluador propio de
  descenso recursivo en `lib/aux-sheet.ts` (NO usa `eval()`).
- `grid_json` es un `string[][]` (filas × celdas) y `merges_json` un
  `{r0,c0,r1,c1}[]`. Solo se guardan strings; el **export Excel** agrega cada
  tab **después del "Budget por mercado"** (en orden), castea a número las
  celdas que parsean limpio (US format), escribe las fórmulas que resuelven como
  **fórmulas reales de Excel** (con resultado cacheado; las que no parsean van
  como texto crudo) y aplica las uniones con `ws.mergeCells`. El nombre del tab
  es el del planner (sanitizado a nombre válido). El **PDF imprimible también los
  incluye**: cada tab va en su propia página (después del plan principal), con el
  formato del plan (header accent, subtotales/totales, banding, uniones, fórmulas
  resueltas) + su propio bloque de **firma del cliente + fecha** y disclaimer, así
  cada anexo se firma por separado. La clasificación de filas (header / subtotal /
  total / grand) y el rectángulo con contenido salen de helpers compartidos en
  `lib/aux-sheet.ts` (`classifyAuxRow`, `detectAuxHeaderRow`, `auxContentBounds`)
  para que Excel y PDF formateen igual.
- **Defensivo deploy→migración**: `getPlanDetail` lee los tabs aunque la columna
  `merges_json` todavía no exista en prod (cae a una lectura sin esa columna,
  con `merges: []`), así no desaparecen los tabs hasta correr el SQL.
- Es material de trabajo: **no** participa del lifecycle de aprobación ni de
  los snapshots (aprobar / descartar borrador no los toca) y se borran duro
  (no pasan por la papelera). Crear/editar/borrar solo con el plan en `draft`
  (la UI lo esconde; las actions bloquean `archived` como el resto).
- Límites y helpers compartidos en `lib/aux-sheet.ts`; CRUD en
  `app/actions/aux-sheets.ts`; UI en
  `app/(app)/proyectos/[code]/planes/[planId]/aux-sheet.tsx`.

### Lifecycle del proyecto
- Estados: `planning` → `active` → `paused` → `closed` → **`reportado`**.
- `reportado` es el estado terminal: el proyecto cerró sus campañas Y se
  entregó el reporte final al cliente. Solo se entra acá marcando el reporte
  como delivered desde `/reportes/calendario` — no es seteable manualmente.
- Cuando un proyecto pasa a `closed`, automáticamente se crea una fila en
  `project_reports` (idempotente). Ver `app/actions/reports.ts`.

### Naming
- Proyectos: el `code` es interno (URL slug + base de la convención de
  planes). Se deriva del nombre del proyecto vía slug, con sufijo `-N` si
  colisiona — ej. nombre "Costa Rica 2026" → `code` `costa-rica-2026`. No
  se pide en el alta ni se muestra en la UI.
- Planes: `<Project.code>.<PlanName>` — ej. `costa-rica-2026.Awareness`.

### Períodos derivados, no almacenados
- El **plan** no guarda `period_start` / `period_end`: se derivan con
  `min/max` de las fechas de placements.
- El **proyecto** guarda `start_date` (estimado del AM) pero no `end_date`:
  se deriva del placement más lejano de todos sus planes.

### Management fee como % (rate-based)
- `media_plan_fees.fee_type = 'management'` con `rate_pct` numérico (ej. 15.00).
- Cuando hay `rate_pct`, el `amount_usd` se almacena como `0` y se computa al
  leer: `amount = TM × ratePct / (100 − ratePct)`.
- Equivalente a la fórmula de Mariano: `MF = (TM/(1−rate%)) − TM`.
- Otros tipos de fee (`setup`, `reporting`, `custom`) tienen monto manual,
  `rate_pct` queda `null`.
- **Auto-prorrateo en el billing mensual**: `setPublisherConsumption` recalcula
  `plan_billing_fees.amount_imputed_usd` para todos los management fees del
  plan después de actualizar el consumo de un publisher
  (`autoRecomputeMgmtFees` en `app/actions/plan-billing.ts`). Fórmula:
  `(gasto billable del mes / total media del plan) × total del fee`, clampeado
  por el remanente (`total − ya_imputado_en_otros_meses`). La analista puede
  sobreescribir a mano vía `setFeeImputation`, pero la próxima edición de un
  publisher pisa el override. La fila del fee en la UI muestra el badge `auto`
  en el editor de billing del plan.

### Cost method principal por placement
- `media_plan_placements.cost_method` (dCPV, dCPC, dCPM, etc.) marca la
  **métrica principal** del placement. Mapping en
  [`lib/cost-methods.ts`](lib/cost-methods.ts) (`COST_METHOD_PRIMARY_METRIC`):
  `dCPV→views`, `dCPM→impressions`, `dCPC→clicks`, etc.
- El editor permite ingresar **rate** o **delivery** indistintamente (el
  banner principal calcula el otro automáticamente). El recálculo dispara
  **siempre que se edita uno de los dos**, incluso si el otro ya tenía valor
  (`applyPrimaryPairChange` en `editor.tsx`).
- **Rate-anchored**: al cambiar el **monto** del placement, la tarifa queda
  fija y el delivery se recalcula proporcional (modelo de planificación: la
  tarifa es lo negociado, el delivery escala con el budget). Aplica al pair
  principal y a todos los secundarios con tarifa cargada
  (`recomputeMetricsForAmount` en `editor.tsx`). El draft del `MetricsEditor`
  se sincroniza con el render-phase setState pattern para que las filas
  secundarias muestren el delivery recalculado sin esperar a recargar.
- Las métricas se guardan en `media_plan_placements.metrics_json` (jsonb)
  con keys = slugs del catálogo `metrics_catalog`. Se persiste el delivery
  (impressions, clicks, etc.) y el rate (cpm, cpc, etc.) ingresado.

### Indicadores estimados (métricas secundarias)
- El bloque debajo de la métrica principal permite agregar métricas
  adicionales (reach, engagements, leads, etc.).
- Cada secundaria con rate canónico tiene el **mismo editor bidireccional**
  que la principal: ingresás tarifa o delivery, la app calcula el otro
  desde `amount × multiplier`. Mapping en `DIRECT_METRIC_RATES` de
  [`lib/cost-methods.ts`](lib/cost-methods.ts):
  - `impressions ↔ cpm` (×1000)
  - `clicks ↔ cpc`, `views ↔ cpv`, `conversions ↔ cpa`
  - `reach ↔ cpr`, `engagements ↔ cpe`, `followers ↔ cpf`
  - `leads ↔ cpl`, `installs ↔ cpi`, `visits ↔ cpvis`
- `frequency` no tiene par (es un ratio `impressions/reach`) → solo input
  de delivery.
- La métrica principal del cost method queda **excluida del dropdown Y del
  draft inicial** de secundarias para no duplicarse.

### Métricas: catálogo direct vs calculated
- `metric_kind = 'direct'` → ingresadas por el planner (impressions, clicks,
  views, conversions, reach, engagements, followers, leads, installs,
  visits, frequency).
- `metric_kind = 'calculated'` → derivadas por fórmula de otras. Hoy en
  catálogo: `ctr`, `cpc`, `cpm`, `cpv`, `cpa`, `vtr`, `cpr`, `cpe`, `cpf`,
  `cpl`, `cpi`, `cpvis`. La fórmula está en `metrics_catalog.formula`.
- **Las calculated NO se persisten** en `media_plan_placements.metrics_json`:
  el editor las computa al vuelo y los exports las recomputan por placement con
  `lib/plan-metrics.ts`. En `metrics_json` solo viven valores direct (y sus
  "rate companions" tipo `cpm`/`cpc` que el editor sí guarda). Ver
  "Exports del plan".

### Mercados como catálogo editable
- `markets` puede tener países (`costa-rica`, `panama`) o agrupaciones
  (`centroamerica`, `latam`). Editable desde `/configuracion/markets`.
- `media_plan_placements.market_id` es FK con `ON DELETE SET NULL`.

### Publishers per cliente
- `publishers` es **per-cliente** (igual que `markets` y `metrics_catalog`):
  cada cliente tiene su propia lista — `slug`, `name`, `agency_pays` (regla
  "agencia paga" / "cliente paga directo"), `enabled`, `sort_order`. Unique en
  `(client_id, slug)`. **No hay catálogo global ni tabla puente**: la tabla
  `client_publishers` se eliminó.
- Se administran desde `/configuracion/clientes/[slug]` (sección Publishers):
  crear, renombrar, habilitar/deshabilitar, definir agency_pays y borrar (los
  que estén en uso en planes no se pueden borrar — se deshabilitan). Mismo
  patrón que Mercados y Métricas.
- En el editor del plan se listan sólo los publishers habilitados del cliente
  del proyecto (`listPublishersForClient` en `app/actions/plans.ts`).
- Un mismo publisher puede aparecer **N veces** en un plan (cada bloque es
  un row independiente de `media_plan_publishers` con sus propios
  `totalPlannedUsd`, `agencyPaysOverride` y placements). Se usa para casos
  como "Meta Brand" + "Meta Performance" en el mismo plan. En el editor
  hay un botón "duplicar" (⧉) que clona el bloque entero con todos sus
  placements; el dropdown de "+ Agregar publisher…" no filtra los ya
  usados. **Importante**: `plan_billing_publishers` sigue keyed por
  `(billing, publisher)`, así que la vista de billing rolla los N bloques
  a una sola línea (suma de planeados, OR de `agency_pays`). Ver
  `db/queries/billing.ts:getBillingDetail` y
  `db/queries/dashboard.ts:listPlansForDashboard` para el patrón.
- Cascada para `agency_pays`: override del bloque del plan
  (`media_plan_publishers.agency_pays_override`) → `agency_pays` del publisher
  per-cliente.

### Billing per plan, per mes
- `plan_billings` es la factura del plan en un mes específico.
- `plan_billing_publishers` es el consumo real por publisher; los publishers
  con `is_billable=false` se trackean pero no van en la factura emitida.
- `plan_billing_fees` es la imputación manual de cada fee del plan en cada
  mes (la suma de imputaciones a lo largo del tiempo no debe pasar el total
  del fee — validado en server actions).
- **Publishers que paga el cliente directo (`agency_pays=false`)**: se cargan
  igual en el billing porque su consumo alimenta el cálculo del management fee
  (que el cliente sí paga), pero su inversión de medios **no se factura ni se
  reporta**. El PDF de finanzas (`app/api/billings/[id]/report.pdf/route.ts`)
  filtra las líneas de "Media Placement" por `agencyPays && isBillable`, así
  que los publishers client-pays nunca aparecen en el reporte. `agencyPays` es
  la verdad estructural (override del bloque ?? default del publisher);
  `isBillable` es el flag editable del mes que además permite marcar
  no-facturable un publisher de agencia en un mes puntual.

### Campaign Tracker: consumo real vs goal
- `campaign_placement_actuals (placement_id, metric_key, value_actual,
  updated_at)`: **capa viva** — el estado actual que edita la trafficker
  con autosave (debounce 300ms). Un row por `(placement, métrica)`, el
  valor se reemplaza en cada edición. Unique en `(placement_id, metric_key)`.
- `campaign_actual_snapshots`: **histórico append-only**. El botón "Cerrar
  carga del día" toma un snapshot del estado actual fechado con el día de
  hoy (`closeDailyLoad`). Re-cerrar el mismo día actualiza el snapshot
  (unique `placement_id + metric_key + snapshot_date`), no bloquea la
  edición. Es **self-contained**: denormaliza `client_id / project_id /
  media_plan_id / publisher_id / market_id` + congela el `goal_value` del
  momento, para que la futura sección de Reportes cruce sin depender de la
  estructura viva del plan y el histórico quede intacto ante ediciones.
- Los **goals NO se persisten** (en la capa viva): salen del plan vigente —
  `amount_usd` y `metrics_json` de cada `media_plan_placement` ya son los
  goals. Las métricas calculadas (CPM, CTR, ROAS, CPT, …) se derivan
  on-the-fly para goal y real con las fórmulas del `metrics_catalog` del
  cliente (vía `buildMetricRows` en `lib/campaign-metrics.ts`).
- "Plan vigente" en el hub = `status='approved'` Y la fecha de hoy cae
  dentro del período derivado (min/max de fechas de placements).
- Solo se persisten métricas direct (`amount` + las métricas `direct`
  habilitadas del `metrics_catalog` del cliente, p. ej. `tickets`,
  `tickets_stopover`, `revenue`), tanto en la capa viva como en los
  snapshots. La clasificación direct/calculated sale del catálogo per-cliente
  (NO de una lista hardcodeada), así el tracker muestra **todas** las métricas
  que el plan realmente usa. El sistema es independiente de Billing / Gastos
  Reales aunque haya solapamiento conceptual con la inversión.

### Estimación de facturación
- `getBillingEstimate` en `db/queries/dashboard.ts` prorratea linealmente
  placements y fees de planes `approved` / `ready_to_send` sobre sus meses
  activos y resta lo ya facturado en cada mes (status `sent`/`paid`).
- Devuelve **separado media de fees**: `grossMediaUsd` (placements) y
  `grossFeesUsd` (management/setup/reporting/custom). Lo mismo para el
  facturado (`alreadyBilledMediaUsd` viene de `plan_billing_publishers`;
  `alreadyBilledFeesUsd` de `plan_billing_fees`). Los totales `grossUsd` y
  `alreadyBilledUsd` se siguen exportando como sumas.
- Acepta filtros opcionales: `months[]`, `budgetOriginId`/`budgetOriginIds[]`,
  `projectId`/`projectIds[]`, `clientId`. Los `*Ids[]` (multi) tienen prioridad
  sobre los single homónimos (`inArray` en las 3 subqueries) — los usan los
  **filtros multi-select del portal**.
- **Dónde vive**: en `/billing-tracker?tab=estimates`. Las cards se renderean
  con `components/billing-estimate-card.tsx` — 2 meses adelante + 1 card del
  **mes anterior** con "Real vs Estimado recomputado" y variación coloreada.
  El estimado del mes anterior se recomputa contra los planes actuales — no
  es snapshot histórico; sirve como sanity check para detectar planes
  modificados después de facturar.
- Histórico: estas cards también se mostraban en `/planes`, `/proyectos` y
  `/proyectos/[code]`; se concentraron en `/billing-tracker` (tab Estimates)
  para no duplicar (PRs #77 + #83).
- **Facturado real de meses pasados (portal)**: `getBillingEstimate` devuelve
  una fila **por cada mes pedido** e incluye el **facturado real** (`invoiced`/
  `paid`) de ese mes **aunque no haya gross** — creando el bucket del proyecto
  on-demand desde las subqueries de facturado (que traen `code`/`name`/cliente)
  y **sin cortar** cuando no hay placements approved/ready. Por eso un mes ya
  cerrado (incl. planes archivados) muestra lo realmente facturado. En el portal
  el **filtro de Mes de Estimación** ofrece los meses históricos del cliente
  (`estimationMonthOptions(opts.months)` = histórico ∪ ventana futura), así se
  puede elegir un mes pasado y ver su facturado. La card de un mes **anterior al
  actual** (`isPast`, con `currentMonth` server-computed) lidera con el
  **FACTURADO REAL** en vez del neto (`components/billing-estimate-card.tsx`).
- **Export a Excel (portal)**: la tab Estimación tiene un botón **"Descargar
  estimación (Excel)"** que baja lo que se ve en la ventana (mismos meses +
  filtros bo/proj) vía `GET /api/portal/estimate.xlsx` (thin handler →
  `lib/portal-estimate-xlsx.ts`): hoja **Resumen** (fila por mes: media/fees est.
  · bruto · facturado real · neto + TOTAL, con estado Cerrado/En curso/Estimado)
  + hoja **Detalle por proyecto** (por mes, con subtotal). Look de marca del plan.

### Proyección de facturación por proyecto (portal del cliente)
- En el portal (`/<slug>` → tab **Estimación**), **cada fila de proyecto de las
  cards mensuales es DESPLEGABLE in situ** (no hay un listado aparte debajo): al
  tocar la fila se abre, dentro de la misma card, el **billing de cada uno de sus
  planes** (total a facturar / ya facturado / **falta facturar**) + la proyección
  de **lo que falta facturar prorrateada para cada mes que le queda al plan**,
  como un mini **cronograma**: una barra por mes restante con el monto al lado.
- **Affordance**: la fila entera actúa como botón (chevron que rota + hover +
  `cursor-pointer` + foco de teclado + `aria-expanded`); en mobile la tarjeta del
  proyecto se expande igual. Patrón de *disclosure / master-detail* (fila de
  detalle a todo el ancho en desktop; bloque debajo en mobile). El gráfico de
  barras lleva el valor **etiquetado al lado** (no depende solo del color).
- **Histórico de facturas emitidas**: además del resumen (total / facturado /
  falta), cada plan lista sus **facturas emitidas** (número de factura + mes +
  estado + valor de cada una), con el mismo criterio que el Billing Tracker
  (`invoiced`/`paid` con `invoice_number` no-null). El "Facturado" del plan es la
  **suma exacta** de esas facturas (reconcilia con la lista).
- Query: `getClientBillingProjections` en `db/queries/dashboard.ts`. A diferencia
  de `getBillingEstimate` (agrega al nivel proyecto, solo para meses puntuales),
  baja hasta el **plan** y arma todos los meses que le quedan. Reusa el **mismo
  prorrateo** (`enumerateMonths`): media = monto del placement / meses de su
  `[start, end]`; fees = total del fee / meses del período del plan; management
  fee = `TM × rate/(100 − rate)`. `gross = media + fees`; `billed` = **suma de las
  facturas emitidas** (`plan_billings.total_usd` de las `invoiced`/`paid` con
  número), las mismas que se listan en el detalle; `remaining =
  max(0, gross − billed)`. Lo que falta facturar se reparte por mes **ponderado
  por el bruto programado** de cada mes restante (suma exactamente `remaining`).
  Un plan ya finalizado con saldo imputa el remanente al mes actual.
- Solo incluye planes con `remaining > 0`. La proyección se le pasa a
  `BillingEstimateCard` como `projectionsById` (mapa `projectId → proyección`):
  cuando está presente, las filas de proyecto se vuelven desplegables; cuando no
  (vista interna `/billing-tracker?tab=estimates`), siguen siendo links al
  detalle, sin despliegue. UI en `components/billing-estimate-card.tsx` (client,
  read-only; el despliegue es estado local, sin POST/Server Actions). Respeta los
  filtros Budget Origin / Proyecto del portal. **Sin cambios de schema.**

### Pendientes del dashboard
- `getDashboardPendings(clientId)` en `db/queries/pendings.ts` arma las cuatro
  listas que consumen las 3 vistas del dashboard rediseñado
  (`components/dashboard/`), normalizadas por `groupPendings` (`shared.tsx`) →
  cada item con su **href real** al detalle + `clientSlug` (para `?client=`).
  Todo se deriva de columnas existentes (no hay flags nuevos):
  - **Billing reports a completar**: por cada plan `approved` (no borrado), los
    meses dentro del span de sus placements cuyo cierre ya pasó (`mes < mes
    actual`) cuyo billing todavía no se terminó. Un mes cuenta como **terminado**
    solo cuando tiene una fila en `plan_billings` en un estado más allá de
    `draft` (ready/sent/invoiced/paid). Un billing en `draft` (abierto pero no
    marcado "listo") **no** lo saca del tablero: el mes sigue pendiente hasta que
    se marca `ready`.
  - **Tracking del día pendiente**: planes `approved` vigentes hoy (hoy dentro
    del período) cuyo `max(snapshot_date)` de `campaign_actual_snapshots` es
    anterior a hoy (o que nunca se trackearon).
  - **Entregas de reportes**: de `getReportingCalendar().inProgress` (delivery
    date asignada, sin entregar) — `upcoming` = a ≤7 días; `overdue` = ya pasó.
  - **Facturas impagas**: cualquier `plan_billings` con `paid_at` null (incluye
    draft/ready/sent/invoiced); se marcan vencidas si `due_date < hoy`.
- **Dónde se ven**: en **Cuentas** y **Ejecutivo**, las más urgentes con un botón
  "Ver todos →" que cambia a la vista **Operaciones**; en **Operaciones**, el
  board completo de 4 columnas. Cada fila tiene un botón que navega al **detalle
  real** (billing del plan, campaign tracker, generador/calendario de reportes,
  /billing). (El board colapsable viejo `pending-board.tsx` se borró con el
  rediseño.)

### Audit log
- `audit_log` graba cada CREATE/UPDATE/DELETE con `before_json` +
  `after_json` + `user_id` + `user_email` (denormalizado para no
  joinear `auth.users` en cada render).
- Las server actions usan `await recordAudit({...})` de `lib/audit.ts`
  — el wrapper hace `getCurrentUser()` y enriquece la row con el
  autor. NO insertar directo con `db.insert(auditLog)` desde server
  actions: queda como "Sistema".
- Vista en `/auditoria` renderiza cada evento como oración legible
  ("Mariano Manto editó el plan 'Awareness' · hoy 14:32"). Sustantivos
  / verbos / fechas relativas viven en `lib/audit-format.ts` — agregar
  mapeos cuando aparezcan nuevos `entity_type`. Filtros por tipo y
  acción.
- **Papelera** en `/auditoria/papelera`: lista todos los items
  eliminados (proyectos, planes, publishers, placements, fees,
  catálogos) con su snapshot del momento. Hoy es solo consulta
  histórica — no hay restore (los `before_json` del proyecto borrado
  no traen los planes cascadeados). Acceso desde `/auditoria` con el
  botón "Papelera (N)".
- **"Última edición" en el editor del plan**: chip debajo del nombre con
  quién/cuándo editó por última vez la **versión vigente**; click → modal
  read-only con la lista de cambios (mismo render `components/audit-entry.tsx`
  que `/auditoria`: oración + diff de campos). Los eventos salen de
  `getPlanAuditEvents(planId, {since})` en `db/queries/audit-log.ts`: junta
  plan + publishers + placements + fees + tabs auxiliares (incluso hijos ya
  borrados, vía el `mediaPlanId`/`mediaPlanPublisherId` de los JSON del audit).
  La ventana la computa la page con los snapshots: en draft/ready, desde la
  última aprobación; en approved/archived, desde la aprobación anterior (los
  cambios que produjeron la versión vigente). Los updates de tabs auxiliares
  se compactan a "filas×cols · N celdas cambiadas" para no inflar el payload.

### Auth (Google OAuth, sangria.agency-only)
- Toda la app está detrás de un `proxy.ts` (Next.js 16 reemplaza
  `middleware.ts`) que valida la sesión via Supabase Auth en cada
  request. Sin sesión → redirect a `/login` con `?next=` preservado.
  Rutas públicas: `/login`, `/auth/callback`, `/auth/signout`.
- **Provider**: Google. El botón en `/login` invoca
  `supabase.auth.signInWithOAuth({ provider: "google", options: {
  queryParams: { hd: "sangria.agency", prompt: "select_account" } } })`
  para que Google preseleccione la cuenta de agencia.
- **Bloqueo por dominio** en dos lugares (defensa en profundidad):
  - `app/auth/callback/route.ts` valida `user.email.endsWith
    ("@sangria.agency")` después del exchange; si no, `signOut()` y
    redirige a `/login?error=domain`.
  - `lib/supabase/middleware.ts` también lo revalida en cada request
    por si la sesión vino con otra cuenta.
- **Topbar**: muestra avatar de Google (`user_metadata.avatar_url` /
  `picture`) o iniciales, con menú "Cerrar sesión" que hace POST a
  `/auth/signout`.
- **Setup de prod** (no automático): ver `.env.example` para los
  pasos en Supabase dashboard y Google Cloud Console.

### Portal de cliente (público, read-only)
- **Qué es**: una vista de solo lectura para compartir con cada cliente en
  `/<slug>` (el mismo slug interno del cliente, ej. `/copa-airlines`). Tabs:
  **Resumen** (KPIs + chart de inversión mensual + **inversión por publisher
  planeado vs real** + **facturado acumulado vs estimado YTD**), **Billing
  Tracker**, **Estimación**, **Proyectos**
  (filtros: estado **Abiertos/Cerrados/Todos** (default abiertos) + **multi-select de
  campañas con buscador** + budget origin + **rango de fechas Desde/Hasta**
  (`?pfrom=`/`?pto=`, YYYY-MM-DD: deja los planes cuyo período **intersecta** el
  rango); descarga PDF/Excel del plan +
  **pacing por placement** agrupado por publisher, expandible para **varias
  campañas a la vez**, con **export Excel consolidado** del pacing —reporte
  ejecutivo—), **Análisis**
  (mapa de América con activaciones por mercado + tabla filtrable), **Reportes**
  (**Gantt** de entregas en curso, read-only + tabla de enviados con link al PPT;
  con los **mismos filtros que Estimación** —Budget Origin / Proyecto / Mes— **más
  un filtro de Año que arranca en el año actual** por default) y
  **Benchmarks** (tabla CPM/CPC/CPV/CTR como el simulador). Todo scopeado al
  cliente; reusa las queries internas pasando `clientId`. El `ReportingGantt`
  acepta `readOnly` (sin botones de edición ni links internos) para el portal.
  Los filtros de Reportes se aplican **en memoria** sobre la fecha representativa
  de cada reporte (enviado → fecha de envío; en curso → fecha de entrega o cierre);
  los reportes manuales (sin proyecto/origen) quedan fuera cuando hay filtro de
  proyecto u origen activo. El filtro `year` es URL-based (`?year=`, vacío = año
  actual, `all` = todos) en `portal-filters.tsx`; las opciones de Mes se acotan al
  año elegido.
- **Acceso (baja seguridad, a propósito)**: usuario = nombre o slug del cliente;
  password compartido `sangriaagency` (constante en `lib/client-portal.ts`,
  `CLIENT_PORTAL_PASSWORD`). El admin de `/configuracion/clientes` muestra el
  link + usuario + contraseña (con botones de copiar) para pasárselos al cliente.
  No es auth real; es un gate para compartir un link.
- **Cómo convive con el gate de la app** (importante):
  - El portal vive **fuera** del `(app)` group y del login de Supabase. El proxy
    (`lib/supabase/middleware.ts`) trata como público **solo GET** a `/<slug>`
    (páginas read-only) + los endpoints dedicados `/api/portal/*` (login/logout,
    autovalidantes) + la descarga de export de planes (GET).
  - **Solo GET**: los Server Actions se despachan por POST a la ruta actual sin
    importar el path, y la app confía en el proxy como gate de sus mutaciones. Si
    abriéramos POST en `/<slug>`, cualquiera podría invocar acciones internas sin
    sesión. Por eso el portal **no usa Server Actions**: login/logout son route
    handlers públicos y todo lo interactivo (filtros, benchmarks, pacing) es
    URL-based (GET).
  - **Slugs reservados**: el proxy considera portal a cualquier primer segmento
    top-level que NO esté en `RESERVED_TOP_LEVEL_SLUGS` (`lib/client-portal.ts`).
    **Si agregás una sección nueva con ruta top-level, sumala a esa lista** o
    quedaría accesible sin login. El page del portal igual hace 404 si el slug no
    es un cliente vivo.
  - **Cookie**: `setPortalSession(slug)` guarda el slug desbloqueado (httpOnly).
    El export (`/api/plans/[id]/export.*`) valida `canAccessClientExport(slug)`:
    pasa si hay sesión interna O cookie de portal del cliente dueño del plan.
- **Pacing del portal (Proyectos)**: cada campaña tiene un toggle "Ver pacing"
  (URL-based vía `?plan=<ids>` separados por coma → **varios expandidos a la
  vez**). El filtro **multi-select de campañas** (`?camp=<ids>`,
  `components`/`portal-filters.tsx`) busca por nombre y, cuando hay campañas
  elegidas, **la selección manda** (ignora estado/origin/rango de fechas para que
  no las esconda). El bug del "Ver pacing" que perdía `pstatus` (volvía a Abiertos
  y no mostraba el pacing de campañas cerradas) se arregló en `hrefWith`
  (preserva `pstatus` + `camp` + el rango de fechas `pfrom`/`pto`).
- **Export consolidado de pacing**
  (`GET /api/portal/pacing.xlsx?client=<slug>&plans=<ids>`): baja en un solo
  Excel el pacing de **varias campañas a la vez** (las visibles/seleccionadas),
  para presentar a nivel ejecutivo. Tres hojas con el look del Excel del plan:
  **Resumen** (una fila por campaña: goal/real/avance/pace/estado + total),
  **Detalle** (campaña → publisher → placement, con métricas goal/real en
  columnas) y **Por mercado** (desglose agregado por mercado). Público en el
  proxy (`/api/portal/*`); valida `canAccessClientExport` + ownership de cada
  plan. Reusa `getCampaignTrackerPlan` por plan (tope `MAX_PLANS`).
- **Sin cambios de schema**: reusa `clients.slug`. No requiere acción en prod.

### Análisis por publisher × mercado (mapa de América)
- **Qué es**: una vista que mapea las "activaciones" (placements de planes
  **aprobados**) por mercado sobre un **mapa de América**, con burbujas por
  mercado (tamaño = inversión planeada, número = # de activaciones) + una tabla
  filtrable. Filtros: publisher · mercado · budget origin · período (desde/hasta).
  Click en una burbuja (o en el ranking) filtra a ese mercado.
- **Dónde**: sección interna `/analisis` (con el filtro global de cliente) y tab
  **Análisis** del portal de cliente. Ambas renderean el mismo
  `components/market-analysis.tsx` con datos de `getMarketActivations` +
  `getAnalysisFilterOptions` (`db/queries/analysis.ts`).
- **Mapa** (`components/americas-map.tsx`): **Leaflet** (tiles reales de CARTO,
  zoom/pan nativos). Se importa **dinámico dentro de un effect** (vanilla
  Leaflet, sin react-leaflet) para no tocar `window` en SSR. Cada mercado es una
  burbuja `divIcon` (tamaño = inversión, número = activaciones, gradiente de
  marca) con tooltip y click→filtra. El mapa se auto-`fitBounds` a los mercados
  visibles (zoom a lo filtrado) y llena el ancho de su columna. Tiles
  `light_all`/`dark_all` según el tema. Estilos de la burbuja: `.mkt-bubble` en
  `globals.css`. (Antes era un SVG propio con d3-geo; se cambió a Leaflet por
  robustez de zoom/escala.)
- **Geocoding de mercados (todo en la UI, sin tocar la DB)**: los `markets` son
  nombres/slugs libres sin coordenadas. `lib/market-geo.ts` (`resolveMarketGeo`)
  resuelve por (1) match exacto normalizado y (2) match por **token** — una
  clave conocida que aparece como palabra dentro del nombre, así
  "Estados Unidos - Varios" → `estados-unidos`. Cubre países LATAM + agrupaciones
  (`centroamerica`/`latam`/…). Los no reconocidos se listan aparte ("Sin
  ubicación en el mapa"). **Para sumar/ajustar un mercado, editá `GEO` en
  `lib/market-geo.ts`** (centroide + `feature` = nombre del país en world-atlas).
- Sin cambios de schema. Deps nuevas: `d3-geo`, `d3-scale`, `topojson-client`,
  `world-atlas`. **No requiere acción en prod.**

### Seguridad: RLS en todas las tablas de `public`
- Supabase expone **automáticamente** cada tabla del schema `public` vía su
  REST API (PostgREST), accesible con la anon key — que es **pública por
  diseño** (`NEXT_PUBLIC_SUPABASE_ANON_KEY` viaja en el bundle del browser,
  ver `lib/supabase/client.ts`). RLS es lo único que cierra esa puerta; el
  OAuth solo protege el acceso a la app, **no** la REST API.
- **Todas las tablas de `public` tienen RLS activado, sin policies permisivas**
  → los roles `anon`/`authenticated` quedan denegados en la REST API (lecturas
  devuelven `[]`, escrituras dan error `42501`).
- La app **no** se ve afectada: conecta como el rol `postgres` (dueño de las
  tablas) vía Drizzle/`DATABASE_URL`, y el dueño bypassa RLS por defecto. **No**
  se usa `FORCE ROW LEVEL SECURITY` a propósito, para preservar ese bypass.
- El SQL aplicado vive en [`db/rls.sql`](db/rls.sql) (idempotente, con query de
  verificación). **Toda tabla nueva** que se agregue al schema necesita su
  propio `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`.

### Idioma operativo del cliente (i18n)
- `clients.language` (`'en' | 'es'`, default `'en'`) define el idioma en
  el que la UI y los exports se renderizan **cuando ese cliente está
  seleccionado** en el filtro global (`?client=slug`). Sin filtro
  ("Todos") se usa el default global `'en'`.
- El idioma afecta: formato de fechas (`12 may 2026` vs `May 12, 2026`),
  meses (`Mayo 2026` vs `May 2026`), labels visibles (page titles,
  table headers, badges) y los **exports** (Excel + PDF del plan).
- **Excepción**: nombres de métricas (clicks, views, impressions, cpm,
  cpc, ctr…) quedan siempre en inglés, por convención de la industria.
- Helpers en [`lib/i18n.ts`](lib/i18n.ts):
  - `Language` type + `DEFAULT_LANGUAGE`
  - `formatDate(iso, lang)` / `formatDateLong` / `formatMonth(yyyymm, lang)`
    / `formatMonthShort` / `shortMonthName`
  - `t(key, lang)` con un diccionario de strings comunes (status,
    common labels, export labels)
- Server resolver: `resolveLanguageFromSearchParams` y
  `resolveClientFromSearchParams` (en `lib/client-filter.server.ts`)
  devuelven `language` ya tipado.
- Para vistas detalle (`/proyectos/[code]`, `/proyectos/.../planes/[planId]`)
  que no llevan `?client=`, el idioma se lee del cliente del proyecto
  (incluido en `getProjectWithPlans` y `getPlanDetail`).

### Filtro global de cliente vía `?client=slug`
- El picker arriba a la derecha (`components/topbar-client-picker.tsx`) setea
  `?client=<slug>` en la URL. El slug se preserva al navegar entre vistas
  globales — el sidebar reescribe sus Links automáticamente.
- Páginas que aplican el filtro a sus queries: Dashboard, `/proyectos`,
  `/planes`, `/billing`. El Budget Origin selector también se restringe a los
  origins del cliente activo.
- Vistas detalle (`/proyectos/[code]`, `/clientes/[slug]`,
  `/proyectos/.../planes/[planId]`) NO aceptan el filtro porque ya están
  scopeadas. Al cambiar de cliente desde una de esas, el picker redirige a
  la lista equivalente (ej. `/proyectos/COPA.x → /proyectos?client=otro`).
- Helpers:
  - `lib/client-filter.ts` — puros: `buildHrefWithClient`,
    `routeAcceptsClientFilter`, `redirectTargetForClientChange`. Los usan
    componentes client (sidebar, picker).
  - `lib/client-filter.server.ts` — `resolveClientFromSearchParams(sp)`
    devuelve `{id, slug, name} | null`. Las pages la llaman antes de pasar
    `clientId` a las queries.
- Para agregar una nueva ruta al filtro: incluirla en `CLIENT_FILTER_ROUTES`
  en `lib/client-filter.ts` + leer `searchParams.client` en la page +
  agregar `clientId` opcional a la query relevante.
- **Configuración**: por ahora publishers/markets/metrics siguen siendo
  catálogos globales aunque haya un cliente seleccionado (banner aclaratorio
  en `/configuracion`). La edición per-cliente es Parte B (ver HANDOFF.md).

---

## Exports del plan (PDF / Excel)

El plan se descarga en dos formatos desde el editor
(`app/(app)/proyectos/[code]/planes/[planId]/editor.tsx`, dos botones que
linkean a las rutas de abajo). Ambos comparten idioma, logo, métricas, firma y
disclaimer; difieren en el layout.

**Preview tipo Excel en el editor**: el componente `ExcelPreview` (en
`editor.tsx`) renderiza una tabla **read-only** con un **toggle de tab**
(pills "Plan de medios" / "Budget por mercado") que replica los dos tabs del
Excel:

- **Plan de medios** (Tab 1): cada placement con su **mercado** en columna
  propia + todas las métricas en columnas, subtotal por publisher (fechas +
  montos + métricas) y fila `TOTAL MEDIA`. Usa los **mismos helpers** que los exports
  (`resolveMetricColumns`, `placementMetricValue`, `evalFormula`,
  `sumDirectMetrics`, `placementsPeriod` en `lib/plan-metrics.ts`) para no
  divergir.
- **Budget por mercado** (Tab 2): mercado × mes con prorrateo por días
  (`BudgetSplitPreview` en `editor.tsx`). La agregación vive en
  `lib/budget-split.ts` (`buildBudgetSplit` + `prorateByMonth`) y la usan
  **tanto el preview como el Tab 2 del export** — cero divergencia.

Es colapsable; audiencia/notas/fees se omiten (sí salen en el Excel/PDF). La
edición sigue en la grilla + inspector; el preview es solo visualización. (Una
"planilla 100% editable" se evaluará aparte en otra branch.)

### Rutas

- `GET /api/plans/[planId]/export.pdf` — **thin handler**: hace `getPlanDetail`
  + `listMetricsForClient`, delega el render a `lib/plan-pdf.ts`
  (`renderPlanPdf(detail, allMetrics)`) y arma la `Response`. La separación
  permite testear el render sin DB.
- `GET /api/plans/[planId]/export.xlsx` — genera el workbook inline con ExcelJS.

### Nombre de archivo

`{plan.name}-V{currentVersion}.{pdf|xlsx}`, sanitizado a `[A-Za-z0-9._-]` (el
resto → `_`). **No** incluye el código ni el nombre del proyecto. Ej:
`Q3_Always-On-V3.pdf`.

### Idioma y formato numérico

Sigue `clients.language` del cliente del plan. Los **nombres** de métricas van
siempre en inglés (decisión de producto); los **números** se formatean con el
locale (`es-AR` / `en-US`). El disclaimer legal va en inglés en ambos idiomas.

### Logo de marca

- `lib/brand-logo.ts` → `getBrandLogo()` lee `public/sangria-logo.png` (o
  `.jpg`/`.jpeg`, gana el primero que exista) del filesystem, parsea las
  dimensiones intrínsecas (PNG `IHDR` / JPEG `SOFn`) y devuelve
  `{ bytes, type, width, height }` o `null`.
- **Defensivo**: si no hay archivo, el export se genera igual, sin logo (no
  rompe la descarga).
- `next.config.ts` → `outputFileTracingIncludes: { "/api/plans/**":
  ["./public/sangria-logo.*"] }` para que el asset viaje en el bundle de las
  funciones serverless en Vercel (las rutas lo leen en runtime).
- Posición: arriba a la derecha, preservando el aspect ratio. PDF: caja
  150×58pt. XLSX: anclado sobre el área blanca de la metadata (no sobre el
  banner de color, para que un JPG opaco no muestre un recuadro blanco).

### Métricas en los exports (clave)

Las métricas **calculated** (`ctr`, `cpm`, `vtr`, engagement rate, etc.) **no
se persisten** en `media_plan_placements.metrics_json` — el editor las computa
al vuelo desde las direct + el monto. Por eso los exports las **recomputan**.
Lógica compartida en `lib/plan-metrics.ts`:

- `evalFormula(formula, amount, directs)` — evalúa fórmulas simples del catálogo
  (`a/b`, `a/b×N`). `null` si falta algún input.
- `placementMetricValue(meta, pl)` — valor guardado si es finito (honra lo
  cargado a mano), o el computado por la fórmula desde los directs + `amountUsd`
  del placement.
- `resolveMetricColumns(allMetrics, placements)` — qué columnas mostrar:
  directs presentes en algún placement + calculated que **resuelven** (sus
  inputs existen) en ≥1 placement; ordenadas direct→calculated por `sortOrder`.

Subtotales por publisher y total del plan: directs = suma; calculated =
`evalFormula` sobre la suma de directs + el total invertido del grupo/plan.
Donde una calculated no resuelve para un placement, la celda queda en blanco.

### PDF (`lib/plan-pdf.ts`)

- **Landscape** letter (792×612pt, margin 40) para que entren las columnas de
  métricas.
- Estructura: header (label `MEDIA PLAN` + nombre del plan, truncado al ancho
  libre a la izquierda del logo + project code + metadata, **incluye `Período`
  general del plan**) → Totales → **tabla** → Fees → **GRAND TOTAL** → firma +
  disclaimer → footer → **una página por hoja auxiliar** (ver abajo).
- Tabla: columnas = Publisher/Placement (flexible) + Invest (USD) + una por
  métrica (ancho y fuente 7–8pt según cantidad). Filas: subtotal por publisher
  (fondo accent-soft, **sin** tag de quién paga, con **sub-línea gris de fechas**
  = más temprana/más tardía de sus placements), placements (nombre + sub-línea
  gris `mercado · audiencia · cost method · fechas`), fila `MEDIA TOTAL`
  (accent). El **header de la tabla se redibuja en cada salto de página**.
- **Sanitización WinAnsi**: la fuente Helvetica de pdf-lib no codifica fuera de
  Latin-1 ni caracteres de control. `sanitize()` mapea flechas/comillas
  tipográficas/`×`/`…` a ASCII, los **control chars y C1 (newline, tab) a
  espacio**, y el resto fuera de `0x20–0xFF` a `?`. Sin esto, una `audience` o
  `placementName` con un salto de línea reventaba el encoder → **HTTP 500**.
- **GRAND TOTAL**: barra oscura con `(Media + Fees)` y el total, debajo de Fees.
- **Firma**: `Signature: ___` / `Date: ___` + disclaimer legal
  (`export.signatureDisclaimer`).
- **Hojas auxiliares**: después del plan principal, cada tab auxiliar va en
  **su propia página** con el formato del plan: label `PLAN DE MEDIOS · Hoja
  auxiliar` + nombre del tab + metadata (proyecto / período / budget origin) →
  **tabla** de la grilla a todo el ancho (header accent, filas subtotal/total/
  grand resaltadas, banding, números a la derecha, **uniones** y **fórmulas
  resueltas**) → **firma del cliente + fecha** + disclaimer + footer. Cada anexo
  se firma por separado (el cliente puede aprobar las hojas auxiliares además del
  plan). Comparte con el Excel los helpers de `lib/aux-sheet.ts`
  (`auxContentBounds`, `classifyAuxRow`, `detectAuxHeaderRow`) para no divergir.
  - **Columnas-monto siempre legibles (regla)**: una columna cuyo encabezado sea
    un monto de inversión —hoy **`NET TOTAL`** (o `TOTAL NETO`),
    `isProtectedAuxLabel` en `lib/aux-sheet.ts`— **nunca se trunca con `…`**. Al
    repartir el ancho usable de la tabla, esas columnas "protegidas" toman su
    ancho **completo** (el que necesita su celda más ancha, medido con la fuente
    real de cada fila) y el resto del ancho se reparte entre las demás. Sin
    columnas protegidas, el comportamiento es el de antes (todo escala a llenar
    el ancho, pudiendo truncar). Para sumar otra columna-monto que deba quedar
    siempre completa, agregá su etiqueta a `isProtectedAuxLabel`.
- **Iniciales por página**: en docs **multipágina**, cada página que **no** lleva
  un bloque de firma completa lleva `Client initials: ___` abajo a la derecha
  (las páginas firmadas —última del plan + cada hoja auxiliar— se saltean). Se
  dibuja al final iterando `pdf.getPages()` contra el set de páginas firmadas.

### Excel (`export.xlsx/route.ts`, ExcelJS)

- **Tab 1 "Media plan"**: banner de título + metadata (incluye `Período` general
  del plan); tabla con columnas base (publisher/placement, market, start, end,
  audience, notes, cost method, investment) + una por métrica. El **mercado** de
  cada placement va en su propia columna (antes se anexaba al nombre con ` · `).
  Filas: subtotal por
  publisher (colapsable vía outline, con **start/end del publisher** =
  más temprana/más tardía de sus placements en las columnas de fecha), placements
  (indentados, con sus start/end), `TOTAL MEDIA`, sección `Fees`,
  `GRAND TOTAL` (INK). Bloque de firma + disclaimer al final. Logo anclado arriba
  a la derecha (base64).
- **Fechas en los tres niveles** (helper compartido `placementsPeriod` en
  `lib/plan-metrics.ts`): período del plan en la metadata, fechas del publisher
  en su subtotal y fechas de cada placement en sus columnas. Idem en el PDF.
- **Tab 2 "Budget por mercado"**: prorratea la inversión de cada placement por
  días entre los meses que cubre `[startDate, endDate]` y la agrega por
  mercado × mes (los sin fecha caen en una columna "Undated"/"Sin fecha"). Solo
  USD, sin métricas.
- **Tabs 3+ — Tabs auxiliares (uno por cada tab creado en el plan)**: las
  grillas libres que el planner editó en el editor, con la misma metadata del
  plan arriba (proyecto, período, budget origin). El nombre de cada tab es el
  que le puso el planner (sanitizado: sin `[]:*?/\`, máx. 31 chars, sufijo
  `(2)` si colisiona con otro tab). Las celdas numéricas (US format) van como
  número y las fórmulas (`=…`) como **fórmulas reales de Excel**. Ver "Tabs
  auxiliares del plan" en convenciones.
  - **Formato parecido al Tab 1** (`buildAuxSheet`): se da estilo solo al
    rectángulo con contenido (incluyendo lo que cubre una unión). La 1ra fila si
    es todo texto → **header** (fondo ACCENT, blanco, centrado); filas cuya
    **etiqueta** (1ra celda) arranca con `total/totales` → fondo ACCENT blanco,
    `subtotal/subtotales` → ACCENT_SOFT, `grand total/total general` → INK
    blanco; el resto, **banding** suave en filas alternas. Todo en **negrita** en
    subtotales/totales/header, bordes finos, alto de fila (interlineado) 20/22 y
    **ancho de columna auto-ajustado** al contenido (col de etiquetas ≥16, tope
    48 chars; las **columnas-monto** `NET TOTAL`/`TOTAL NETO`, `isProtectedAuxLabel`,
    suben el tope a 80 para que el monto nunca se corte — misma regla que el PDF).
    Los números se alinean a la derecha y se **congela** la metadata + el header.

### i18n y decisiones

- Keys: `export.mediaPlan`, `export.totals`, `export.publishersPlacements`,
  `export.signaturePrompt`, `export.dateLabel`, `export.signatureDisclaimer`,
  `export.initials`, `common.grandTotal`, etc. (`lib/i18n.ts`).
- **No se imprime quién paga el publisher** (`agencyPays`): el tag
  `[agency pays]`/`[client pays]` se sacó del PDF (el XLSX nunca lo tuvo). El
  campo sigue en el modelo, solo no se muestra en el MP.

---

## Generador de reportes históricos (`/reportes/generador`)

Herramienta separada del export por plan: arma un Excel **cross-plan** con los
datos históricos cargados (billing + campaign tracker), filtrando por scope.

### UX
- Filtros URL-based: `client` (global topbar), `origin`, `project`, `plan`,
  `placement`, `from`, `to` (YYYY-MM). Los dropdowns cascadean en el cliente
  (origin → projects → plans → placements; cambiar un padre limpia los hijos).
- **Preview en vivo**: la página server-rendera la misma tabla que va al Excel
  a medida que cambian los filtros. Cero divergencia preview-vs-archivo porque
  ambos llaman a `getHistoricalReport` con los mismos params.
- **Column picker**: panel collapsible "Columnas a mostrar" con checkboxes
  agrupados (Identidad / Monto / Métricas) — la selección se serializa a
  `?cols=client,plan,placement,planned,impressions,...`. Default sin `cols` =
  todas las columnas (back-compat con links viejos).

### Granularidad de la data
- **1 fila por placement** con data histórica en la ventana.
- **Tracker**: latest snapshot por `(placement, metric)` con `snapshot_date` ≤
  `to` y ≥ `from` (`campaign_actual_snapshots.value_accumulated` es running
  total al cierre del día).
- **Billing**: suma de `plan_billing_publishers.amount_real_usd` por
  `(plan, publisher)` dentro de la ventana, **prorrateada** a cada placement
  por `placement.amount_usd / Σ amount_usd de placements del publisher en el
  plan`. Es la única manera honesta de bajar billing (publisher×mes) a nivel
  placement.

### Archivos
- `db/queries/historical-report.ts`: `getHistoricalReport(filters)` (datos del
  reporte) + `getReportFilterOptions(clientId)` (cascadas + catálogo de
  métricas para los checkboxes del column picker).
- `app/api/reports/historical.xlsx/route.ts`: route handler que llama la
  misma query y arma el Excel con ExcelJS (mismo estilo que el export de
  plan: banner accent, logo, freeze, `numFmt` por `unit` del catálogo).
- `app/(app)/reportes/generador/page.tsx`: server component con form +
  preview.
- `components/report-generator-form.tsx`: client component URL-based (filtros
  cascading + column picker).
- `lib/historical-report-columns.ts`: IDs canónicos
  (`IDENTITY_COL_IDS` / `MONEY_COL_IDS`), labels i18n y
  `resolveReportColumns(selected, catalog, withData)` — usado por page y
  route handler para que la lista de columnas sea idéntica en ambos lugares.

---

## Patrones técnicos

### Feedback, confirmación, carga y errores de UI (no usar nativos)
- **Feedback** (éxito/error): `useToast()` de `components/toast.tsx`
  (`toast.success/error/info`). NO usar `alert()`.
- **Confirmación** de acciones destructivas/irreversibles: `useConfirm()` de
  `components/confirm-dialog.tsx` — `await confirm({ title, body, danger })`
  (modal accesible con focus-trap/Escape/backdrop). NO usar `confirm()`.
- Ambos providers se montan en `components/app-providers.tsx` (en el layout).
- **Carga**: `app/(app)/loading.tsx` usa `PageSkeleton`
  (`components/skeleton.tsx`) como fallback de navegación; la chrome persiste.
- **Errores**: `app/(app)/error.tsx` (boundary recuperable con retry) y
  `app/(app)/not-found.tsx` (404 con `EmptyState`).
- **Errores de formulario**: el contenedor del mensaje lleva `role="alert"`
  para que se anuncie.

### Responsive: nav en el header (desktop) + drawer (mobile)
- En `≥ lg` la **navegación principal vive en el header** (`components/top-nav.tsx`,
  tira horizontal ícono+label) para liberar todo el ancho de la ventana al
  contenido; el `<aside>` lateral ya no se renderiza. La marca y la `TopNav`
  van en el `Topbar`; el `topbar-nav.tsx` (título de sección) queda solo mobile.
  La `TopNav` **nunca scrollea**: mide el ancho disponible (`ResizeObserver`) y
  manda lo que no entra a un menú **"Más ▾"** al final. El wordmark de la marca
  solo aparece en `2xl` para dejarle lugar a los items.
- En `< lg` el sidebar (`components/sidebar.tsx`) es un drawer deslizable
  controlado por `components/mobile-nav.tsx` (`MobileNavProvider` +
  `MobileNavToggle` en el topbar). Las entradas de ambos salen de `lib/nav.ts`.
- Tablas anchas: envolver en un contenedor `overflow-x-auto` (+ `min-w-[...]`
  en la `<table>`) para que scrolleen en vez de aplastarse (ver
  `projects-table-expandable` y la lista de `plans-table-client`).

### Cartesian publishers × placements al agregar totales (footgun recurrente)
Si una query hace `LEFT JOIN media_plan_publishers` **y** `LEFT JOIN
media_plan_placements` (porque placements cuelga 1:N de publishers) en el
mismo SELECT y suma `publisher.total_planned_usd`, el sum se infla por el
factor "placements por publisher" del plan. min/max no se afectan porque son
idempotentes.

**Regla**: no sumar `total_planned_usd` en una query que joine placements.
Sumarlo en una query separada (sólo contra `media_plan_publishers`) y
mergear en JS. El período se calcula en su propia query (sí joineando
placements, pero sin sumas).

Ejemplos de queries que ya siguen el patrón: `db/queries/project-detail.ts`,
`app/(app)/planes/page.tsx`, `db/queries/dashboard.ts:getPlansSummaryForProjects`,
`app/actions/plans.ts:1147` (con su `sum(distinct ... * 0 + ...)` que era el
workaround histórico). Si volves a tocar alguna query que agrega billings
y/o placements: verificá no caer en esto. Hubo 13 planes mostrando totales
hasta 11× inflados antes del fix (PR #75).

### DB lazy con Proxy
[db/index.ts](db/index.ts) usa un `Proxy` para diferir la creación del
cliente postgres + Drizzle hasta el primer acceso. Permite que el build de
Next.js no requiera `DATABASE_URL` (se carga en runtime cuando hay un
request real).

### `force-dynamic` en `(app)/layout.tsx`
Toda la app es data-driven: ninguna page se prerenderea en build. También
evita que el build de Vercel intente conectar a la DB durante "Generating
static pages".

### IPv4-first en DNS
[db/index.ts](db/index.ts) llama `dns.setDefaultResultOrder("ipv4first")`.
Vercel a veces no tiene IPv6 funcional, y el pooler de Supabase resuelve a
ambos; preferir IPv4 evita `ENETUNREACH`.

### Server Actions
Todos los CRUD viven en `app/actions/*.ts` con `"use server"`. Cada uno
loggea al `audit_log` y revalida los paths relevantes.

Tipo de retorno consistente:
```ts
type Result<T = void> =
  | (T extends void ? { ok: true } : { ok: true } & T)
  | { ok: false; error: string };
```

### `inArray()` para queries IN
**No usar** `sql\`= ANY(${arr})\`` — postgres-js interpola arrays como
parámetros separados y rompe. **Usar** `inArray()` de `drizzle-orm`.

### Aggregaciones de timestamp
postgres-js no convierte bien `max(timestamp)` a `Date`. Usar:
```ts
sql<string>`max(${tbl.col})::text`
```
Y parsear con `new Date(str)` después.

### Dashboard: caché por cliente + resiliencia
[app/(app)/page.tsx](app/(app)/page.tsx) cachea sus 4 bloques de datos (KPIs,
proyectos, monthly, pendientes) con **`unstable_cache`** (revalida 60s, keyed
por `clientId`). Motivo: el dashboard es la página más pesada (~15-20 queries
agregadas por carga) y, sin caché, cada (re)carga / cambio de cliente armaba una
tormenta de conexiones concurrentes que saturaba el Transaction Pooler de
Supabase (`Postgres.js: Unknown Message`, `Failed query`, Vercel Runtime
Timeouts). Con caché, tras la 1ª carga las siguientes salen del Data Cache (0
queries, instantáneo). Además es **resiliente**: `resolveClientFromSearchParams`
va en `try/catch`, las 4 queries en `Promise.allSettled` con fallbacks vacíos, y
cada vista en su `SectionBoundary` → un fallo transitorio degrada esa sección en
vez de tirar el error boundary de ruta. `maxDuration = 60` da aire a la 1ª carga
en frío que puebla el cache.

### Pool de conexiones
- `prepare: false` para Transaction Pooler (puerto 6543).
- `max: 8` por warm-instance. Da lugar a las queries concurrentes sin que
  queueen ni se traben (el dashboard además ahora **cachea** esas queries, ver
  "Dashboard: caché por cliente"). (Se probó `max: 3` durante el incidente del
  pooler, pero la fuga de conexiones que motivaba bajarlo la causaba un loop
  infinito en `enumerateMonths`, ya arreglado.)
- `idle_timeout: 20`, `connect_timeout: 10`.

---

## Despliegue (Vercel)

- Branch principal: `main`. Cada push trigger un deploy.
- Variable obligatoria en Vercel → Settings → Environment Variables:
  - `DATABASE_URL` (mismo formato que `.env.local`, pegado en las 3 envs:
    Production, Preview, Development).
- Si cambiás la variable, Vercel **no aplica el cambio en deploys
  existentes**: hay que **Redeploy** (Deployments → último → ⋯ → Redeploy,
  desmarcando "Use existing Build Cache").

### Si Vercel falla con statement_timeout (57014) o 504 FUNCTION_INVOCATION_TIMEOUT

**Lección del incidente del 22/may/2026**: una query lenta (un fan-out
cartesiano en el tablero de pendientes) hacía que los renders del dashboard
tardaran y las funciones de Vercel se mataran por timeout (504). Cada función
muerta dejaba su conexión colgada en `active/ClientRead` ocupando un slot del
Transaction Pooler; al acumularse, el pool se agotó y **hasta queries
triviales (<1ms) empezaron a dar `57014 statement timeout` o a colgar (504)**.
La query directa en el SQL Editor seguía instantánea porque usa otro path de
conexión — síntoma claro de saturación del pooler, no de SQL lento.

Diagnóstico rápido (SQL Editor, mientras está caída):
```sql
-- conexiones colgadas: active + wait_event=ClientRead con xact_age de minutos
select pid, state, wait_event, now()-xact_start as age, left(query,60)
from pg_stat_activity where datname = current_database() and state <> 'idle';
```

Recuperación: **reiniciar el proyecto** en Supabase (Settings → Restart) limpia
las conexiones colgadas y corta el espiral.

**Causa raíz real**: además del fan-out, `getPendingBillings` entraba en un
**loop infinito** en `enumerateMonths` cuando un placement tenía una fecha
malformada (p.ej. `start_date` que parsea a mes `NaN`): la función colgaba
300s, Vercel la mataba y filtraba conexiones → pool agotado. Ya está blindado
(`enumerateMonths` valida año/mes finitos + tope duro de iteraciones).

Prevención (ya aplicada):
- **No subir** `statement_timeout` a 60s: un timeout largo hace que las
  conexiones filtradas linger MÁS. Conviene un timeout MODERADO que reape
  conexiones colgadas:
  ```sql
  ALTER ROLE postgres SET statement_timeout = '15s';
  ALTER ROLE postgres SET idle_in_transaction_session_timeout = '20s';
  ```
  (Scripts largos como `db:seed` pueden overridear con `SET statement_timeout = 0;`.)
- `enumerateMonths` blindado contra fechas malformadas (no más loop infinito).
- `max: 8` conexiones por instancia (ver "Pool de conexiones").

---

## Comandos

| Comando             | Qué hace                                            |
|---------------------|-----------------------------------------------------|
| `npm run dev`       | Dev server con Turbopack en :3000                   |
| `npm run build`     | Build de producción                                 |
| `npm run start`     | Sirve el build (después de `build`)                 |
| `npm run lint`      | ESLint                                              |
| `npm run db:push`   | Aplica `db/schema.ts` a la DB (con `--force`)       |
| `npm run db:seed`   | Limpia y repuebla con datos de demo (4 clientes)    |
| `npm run db:check`  | Conecta y muestra info básica                       |
| `npm run db:studio` | Drizzle Studio                                      |

---

## Datos de seed

`scripts/seed.ts` crea:
- **4 clientes**: Copa Airlines (active), Cervecería Andina (active), Banco
  Pacífico (active), Tienda Roma (paused).
- **8 budget origins** repartidos.
- **11 publishers + 14 markets + 17 metrics** en catálogos globales.
- **~24 mappings cliente↔publisher** con reglas de pago variadas (Spotify =
  cliente paga directo en Andina, OOH = agencia paga override en BPAC, etc.).
- **11 proyectos** cubriendo los 4 estados (planning, active, paused, closed).
- **14+ planes peer** mezclando draft/ready_to_send/approved/archived.
- **9 plan_billings** (paid + sent + draft) para alimentar la estimación y el
  módulo de billing.

Idempotente: limpia las tablas antes de insertar.

---

## Issues conocidos / a resolver

- **Permisos por rol**: ya hay autenticación (Google OAuth, sangria.agency-only
  — ver "Auth" arriba) y RLS cierra la REST API pública de Supabase. Falta el
  modelo de roles general (Account Manager, Media Planner, Finance, Viewer): hoy
  casi todo usuario logueado del dominio tiene acceso total dentro de la app.
  **Única excepción hoy**: aprobar un plan (ready_to_send → approved) está
  restringido a una allowlist de emails en `lib/permissions.ts`
  (`canApprovePlans`). El chequeo real está en la server action
  `transitionPlanStatus`; el editor esconde el botón "Aprobar (firmado)" para
  el resto. Cuando se arme el modelo de roles, migrar esta allowlist a roles.
- **Reportes**: la sección `/reportes` tiene tres herramientas funcionando:
  Reporting Calendar (`/reportes/calendario`), Simulador (`/reportes/simulador`)
  y Generador de reportes históricos (`/reportes/generador`, ver sección
  dedicada arriba). Ya no quedan placeholders.
- **Admin de clientes**: `/configuracion/clientes` ya existe (CRUD básico
  con idioma operativo). `/configuracion/usuarios` sigue siendo placeholder
  ("próximamente").
- **Publishers / markets / metrics per-cliente**: resuelto. Los tres son
  catálogos per-cliente (tabla con `client_id`, unique `(client_id, slug)`) y
  se administran desde `/configuracion/clientes/[slug]`. Ya no hay catálogo
  global de publishers ni tabla puente `client_publishers`.
- **Exports (PDF / Excel)**: resueltos y documentados en detalle en la sección
  "Exports del plan (PDF / Excel)" arriba. Resumen: logo de marca, todas las
  métricas (incl. calculated recomputadas) por placement, firma + disclaimer
  legal, GRAND TOTAL, PDF apaisado con tabla + iniciales por página + **una
  página por hoja auxiliar** (formato del plan + firma/fecha), nombre de archivo
  `{plan}-V{versión}`.
- **Reporting Calendar** (`/reportes/calendario`): listado de proyectos
  closed pendientes de reporte + Gantt de 60 días (-30/+30 desde hoy). Una
  fila por reporte en curso con símbolos para closed/assigned/delivery y
  línea de atraso si hoy > delivery_date. Marcar entregado transiciona el
  proyecto a `reportado`. **Requiere `npm run db:push` + `npm run db:backfill-reports`**
  en prod para sembrar la nueva tabla y dar de alta los closed existentes.
  Debajo del Gantt hay un listado de **Reportes enviados** (`delivered_at != null`)
  con fecha de envío + fecha objetivo y un filtro de texto libre por proyecto o
  campaña (`getSentReports` en `db/queries/reports.ts`). Cada fila tiene un
  **link opcional al PPT final** (`project_reports.report_ppt_url`, en Drive u
  otro): el analista lo carga/edita/quita desde un modal (acción
  `setReportPptUrl`) para encontrar el reporte rápido a futuro. **Requiere
  `npm run db:push`** en prod para crear la columna `report_ppt_url`.
  Además, **cada reporte** (pendientes, Gantt y enviados — project y manual
  por igual) tiene un botoncito **"Comentarios (N)"** que abre un tablerito
  read-only-friendly: lista de comentarios con **autor + fecha y hora**,
  edición/borrado inline y compose abajo. El **primer comentario de un
  reporte manual es su descripción** (sembrada al crearlo con el creador como
  autor; las pre-existentes se backfillean por SQL). Tabla `report_comments`
  (dos FKs nullable project/manual, cascade), actions en
  `app/actions/report-comments.ts`, UI en `components/report-comments.tsx`
  (el Gantt expone `onOpenComments`, oculto en el portal read-only).
  Requirió SQL en prod (tabla + RLS + backfill de descripciones) — **ya
  aplicado**; el SQL de referencia vive en el HANDOFF.
- **i18n parcial**: las áreas de mayor visibilidad (dashboard, listas
  globales, exports, dates) están traducidas a `en`/`es`. Quedan strings
  hardcodeados en formularios secundarios (`/proyectos/nuevo`, editor
  del plan en lo más profundo, `/auditoria`, billing editor del plan).
  Plan: ir traduciendo a medida que se toque cada archivo.
- **Drive integration**: en discusión, fuera del scope MVP.
- **Campaign Tracker** (`/campaign-tracker`): hub de planes con filtro de
  estado (Vigentes / Concluidos / Todos) + vista de carga de consumo real
  vs goal con autosave, chart de progreso, cierre de día (snapshot al
  histórico) y comparación contra la última carga. Los planes
  concluidos (hoy > `endDate`) quedan accesibles en el hub para consulta
  histórica — el detalle del plan funciona igual y el badge del header
  pasa de "vigente" a "concluido". **Requiere `npm run db:push`** en prod
  para crear las tablas `campaign_placement_actuals` (capa viva) y
  `campaign_actual_snapshots` (histórico) — ambas aditivas, sin backfill.
  Pendiente: la sección de Reportes que consume `campaign_actual_snapshots`
  todavía no existe. Elementos del mockup que siguen "próximamente":
  stepper de fecha y tabs Histórico / Resumen acumulado (dependen de una
  vista de histórico diario, fuera de alcance de esta entrega).
