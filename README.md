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
DATABASE_URL=postgresql://postgres.hhubbahbmurrukftezea:TU_PASSWORD@aws-1-us-east-2.pooler.supabase.com:6543/postgres
```

**Importante:**
- Usar el **Transaction Pooler** (puerto **6543**), no el Session Pooler (5432) ni la Direct Connection.

  **Verificado el 02/sep/2026** en `pg_stat_activity`: la app aparece como
  `Supavisor`, no como `postgres.js` — o sea que entra por el pooler y éste
  multiplexa (una sola conexión a Postgres para toda la app).

- **`pg_stat_activity` NO ve las conexiones de la app.** Ve las de Supavisor a
  Postgres, que son poquísimas. Contar ahí para diagnosticar saturación es medir
  la capa equivocada: `max_connections` (60) es de Postgres y **no** es el techo
  de la app. El techo real es el de Supavisor — Settings → Database → Connection
  pooling: *Pool Size* y *Max client connections* — y no se consulta por SQL.
  Las conexiones en `ClientRead` que aparecen ahí suelen ser servicios internos
  de Supabase (`postgrest`, `storage`, el exporter) en su estado normal: **no
  son fugas de la app**, y terminarlas no arregla nada.

- **Los números del pooler (Settings → Database → Connection pooling)**, medidos
  el 02/sep/2026 con compute **Nano**:
  - **Max client connections: 200** (fijo en Nano). Cuántas Lambdas pueden estar
    conectadas a Supavisor. Con `max: 3` en `db/index.ts` harían falta ~67
    instancias calientes a la vez: **no es el techo**.
  - **Connection pool size: 25** (editable; era 15 y se subió el 02/sep/2026).
    Cuántas conexiones mantiene Supavisor **contra Postgres**. En modo
    transacción, cada query en vuelo ocupa uno de esos slots mientras corre:
    **éste es el techo real de la app**.

  De ahí sale por qué `max` importa. Cada query **en vuelo** ocupa un slot
  mientras corre, y el 03/sep se midió que las queries de la app duran ~20 ms
  (pico histórico 907 ms), así que los slots se liberan enseguida: con `max: 3`
  hacen falta 9 instancias calientes **simultáneas** para agotar los 25.
  El experimento de bajarlo a 1 (02/sep) resultó contraproducente: no ahorraba
  slots reales y en cambio serializaba las 4-16 queries de cada página sobre un
  solo socket, donde las que no entraban morían en la cola local de postgres.js
  sin llegar nunca al server. Ver "Pool de conexiones".

  **Si hiciera falta más**: se puede volver a subir *Connection pool size*.
  Sigue habiendo lugar — se midieron 9 conexiones en uso contra
  `max_connections = 60`, y los servicios internos de Supabase (postgrest,
  storage, cron, exporter) usan ~8, así que con 25 el total queda en ~33 de 60.
  Es un cambio de dashboard, sin redeploy y sin tocar código.

- **Región**: la DB vive en `aws-1-us-east-2` (Ohio) y las funciones de Vercel
  corren en `iad1` (Virginia): ~15ms de ida y vuelta. No es un problema en sí,
  pero **cada round-trip a la DB cuesta**, y por eso importa el fan-out de
  queries por página (ver `db/queries/cached.ts`).
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
    error.tsx               # error boundary recuperable — REINTENTA solo una vez a los 2s antes de mostrar el error (la causa dominante es un timeout transitorio del pooler)
    not-found.tsx           # 404 con EmptyState
    page.tsx                # Dashboard (3 vistas: ?view=cuentas|operaciones|ejecutivo; default cuentas)
    clientes/               # /clientes y /clientes/[slug]
    proyectos/              # /proyectos, /proyectos/[code]/*, /proyectos/nuevo
      [code]/planes/[planId]/
        editor.tsx          # editor del plan (publishers + placements + fees)
        aux-sheet.tsx       # tabs auxiliares del plan: grillas libres tipo Excel con fórmulas, insertar/eliminar filas y columnas en cualquier posición (menú click-derecho) (tabs extra del export)
        bulk-dates-modal.tsx # cambio masivo de fechas: mueve inicio y/o fin de TODOS los placements del plan de una vez (solo sobre el borrador)
        plan-history.tsx    # chip "Última edición" + modal read-only con los cambios de la versión vigente (audit_log)
        qa-modal.tsx        # modal de QA del plan: preview tipo Excel con casilla "Controlado" por línea; con todas tildadas habilita "QA realizado" (approved → qa_done)
        planning-qa-modal.tsx # modal del QA DE PLANIFICACIÓN (media planner): cada línea del plan con una casilla; con todas tildadas cierra el QA y hace el pase draft → ready_to_send
        version-history.tsx # historial de versiones desplegable: qué cambió en cada versión vs la anterior (diff de snapshots) + fecha + QA + descargas ?v=N
        billing/            # editor de facturación mensual + gráfico "Avance de facturación" (facturado medios/fee acumulado vs total del plan) arriba de todo
    planes/                 # /planes — vista cross-proyectos
    billing/                # /billing — lista de facturas con filtros (origin/project/range) + buscador en vivo por N°/plan + click-to-edit
    billing-tracker/        # /billing-tracker — tabs "Tracker" (proyecto→plan→facturas emitidas) + "Estimates" (estimación de facturación)
    creative/               # /creative — facturación de trabajo creativo (tabla creative_billings, SIN media plan detrás): panel para CARGAR una factura + KPIs + chart mensual cobrado/pendiente + tabla con botón de cobro
    campaign-tracker/       # /campaign-tracker — hub con filtro vigentes/concluidos/todos + vista de carga de consumo real vs goal
      [planId]/             # vista de carga: tabla editable (autosave) + chart de progreso
    auditoria/              # /auditoria — log legible + papelera (/auditoria/papelera)
    configuracion/
      markets/, metricas/     # accesos a catálogos per-cliente
      clientes/               # alta/edición de clientes + config per-cliente (publishers, métricas, tipos de ad, mercados, budget origins)
      papelera-planes/        # papelera de planes borrados (soft delete) + restaurar
      usuarios/               # Usuarios y roles: quién tiene acceso y con qué rol. Solo Admin. La identidad la da Supabase Auth; acá se asigna el rol (tabla app_users)
    reportes/
      page.tsx              # landing con cards a las 3 herramientas
      calendario/           # Reporting Calendar (closed → reportado, link PPT por reporte)
      simulador/            # Simulador de escenarios con benchmarks históricos
      generador/            # Generador de reportes históricos (Excel) con preview en vivo + column picker
    analisis/               # Análisis publisher × mercado con mapa de América (filtro global de cliente)
  (portal)/                 # Portal de cliente PÚBLICO (fuera del gate de Supabase). Read-only salvo "Marcar pagado" (Billing Tracker y Creative)
    error.tsx               # boundary del PORTAL — lo ve el CLIENTE. Bilingüe, con marca, DOS reintentos automáticos (el portal es read-only, reintentar no duplica nada). Hasta el 03/sep/2026 no existía y una falla transitoria le mostraba al cliente la pantalla cruda de Next: `app/(app)/error.tsx` NO cubre este segmento
    loading.tsx             # skeleton del portal (header + 8 tabs + tarjetas). Antes el cliente veía la página en blanco mientras el server renderizaba
    [clientSlug]/           # /<slug> — tabs Resumen/Billing/Creative/Estimación/Proyectos/Análisis/Reportes/Benchmarks
      page.tsx              # gate por cookie → login o tabs; lookup por slug (404 si no existe/reservado)
      portal-content.tsx    # secciones (server) reusando las queries internas scopeadas al cliente
      portal-mark-paid.tsx  # botón "Marcar pagado" (client): 1 click invoiced → paid vía /api/portal/{billing,creative}/mark-paid — el prop `kind` elige el endpoint (plan_billings o creative_billings). ÚNICA escritura del portal
      portal-login.tsx, portal-logout.tsx, portal-benchmarks-filters.tsx
      portal-filters.tsx      # filtros URL-based del portal: multi-select genérico (MultiSelect, búsqueda opcional) para Budget Origin (?bo) / Proyecto (?proj) / Mes (?month) / Campañas (?camp) — todos listas separadas por coma — + rango de fechas Desde/Hasta (Proyectos, ?pfrom/?pto) + orden de Proyectos (?psort=: fecha/monto/nombre en las dos direcciones, default nombre A→Z)
  api/
    plans/[planId]/
      export.xlsx/route.ts  # XLSX del plan (logo + firma + disclaimer + todas las métricas + mercado + fechas por publisher/placement). ?v=N → versión aprobada histórica
      export.pdf/route.ts   # PDF del plan (thin handler → lib/plan-pdf.ts). ?v=N → versión aprobada histórica. Acceso: sesión interna O cookie de portal del cliente dueño
      version-diff/route.ts # diff de UNA versión vs la anterior (2 snapshots). Lo pide version-history.tsx al desplegar, para no traer todos los snapshot_json en el render
    portal/
      login/route.ts        # POST login del portal (autovalidante, público); logout/route.ts
      billing/mark-paid/route.ts # POST invoiced → paid de una factura del portal. Público + canWriteAsClientPortal + ownership (plan vivo del cliente) + sólo esa transición
      creative/mark-paid/route.ts # gemelo del anterior para creative_billings (tab Creative del portal). Mismas tres barreras; ownership = la factura es de ESE cliente
      pacing.xlsx/route.ts  # XLSX CONSOLIDADO del pacing de varias campañas (Resumen/Detalle/Por mercado). Público + canAccessClientExport + ownership
      estimate.xlsx/route.ts # XLSX de la tab Estimación con los mismos meses/filtros que la ventana: hojas Resumen + Detalle + Proyección (thin handler → lib/portal-estimate-xlsx.ts). Público + canAccessClientExport
      analysis.xlsx/route.ts # XLSX de la sección Análisis (mapa) con los mismos filtros que la vista: detalle línea por línea (campaña/mercado/budget origin/inversión) + hoja Por mercado (thin handler → lib/portal-analysis-xlsx.ts). Público + canAccessClientExport
    benchmarks/
      export/route.ts       # Excel/PDF de benchmarks filtrados (público + canAccessClientExport)
    reports/
      historical.xlsx/route.ts  # XLSX del generador (misma query que el preview, mismo resolveReportColumns)
  actions/                  # Server Actions (CRUD)
    plans.ts, plan-billing.ts, projects.ts, markets.ts, metrics.ts, publishers.ts,
    budget-origins.ts, clients.ts, reports.ts, campaign-tracker.ts, aux-sheets.ts,
    plan-qa.ts              # QA del plan: tildar/destildar línea, cerrar QA (→ qa_done) y reabrirlo
    ad-types.ts             # catálogo de tipos de ad per-cliente: crear/renombrar/habilitar/borrar + seedDefaultAdTypes ("Cargar los estándar")
  globals.css

components/                 # UI compartida
  theme-toggle.tsx          # toggle claro/oscuro (clase .dark en <html>)
  skeleton.tsx              # placeholders shimmer para loading states; PageSkeleton para loading.tsx
  chart-kit.tsx             # recharts compartido: useChartColors() (dark-aware) + tooltipStyle() + <ChartGradient>
  portal-charts.tsx         # charts del Resumen del portal: SpendByPublisherChart (planeado vs real) + CumulativeBillingChart (área YTD)
  americas-map.tsx          # mapa de mercados con Leaflet (tiles CARTO, burbujas por mercado, zoom/pan)
  market-analysis.tsx       # vista de análisis publisher × mercado (filtros multi-select + mapa + ranking + tabla + botón export a Excel); /analisis y portal
  plans-table-client.tsx    # /planes: buscador, sort por columna, density toggle, vista list/by-project, columna media+consumido (PR #79)
  projects-table-expandable.tsx  # tabla de proyectos con drill-down; prop `searchable` → buscador + A-Z (tab Proyectos)
  project-status-selector.tsx    # filtro por estado del proyecto (pills URL-based, server) en /proyectos — planning/active/paused/closed/reportado + Todos. Colores de dot espejan status-badge.tsx. Exporta PROJECT_STATUS_VALUES para validar el searchParam
  dashboard/                # Dashboard REDISEÑADO (3 vistas con toggle): dashboard-view.tsx (switch por ?view= + SectionBoundary) · view-cuentas/operaciones/ejecutivo.tsx · shared.tsx (groupPendings→href real, deriveClients, MiniBars, PendingRow). Reemplaza al viejo dashboard-view/pending-board/kpi-card (BORRADOS)
  topbar-nav.tsx            # título de sección (Archivo), SOLO mobile (<lg) — en desktop manda la TopNav del header
  top-nav.tsx               # navegación principal en el HEADER (≥lg): tira horizontal ícono+label desde lib/nav.ts; mide el ancho y mete lo que no entra en un menú "Más ▾" (nunca scrollea, ResizeObserver). Reemplaza al sidebar vertical para liberar el ancho al contenido
  billing-estimate-card.tsx # cards de estimación de facturación (mes previo real vs estimado + N meses futuros). Vive en /billing-tracker?tab=estimates y en el portal. Con `projectionsById` (portal) cada fila de proyecto se DESPLIEGA in situ → billing de cada plan + facturas emitidas (histórico: número + mes + valor) + cronograma de lo que falta facturar por mes restante (getClientBillingProjections)
  billing-filters.tsx       # /billing: dropdowns budget origin/proyecto/estado + slider de meses, URL-based
  creative-invoice-form.tsx # /creative: panel para CARGAR una factura de creative (client). Cliente/N°/mes/monto + código de campaña/proyecto/fecha/estado/notas. Queda abierto para cargar varias seguidas (conserva cliente + mes + estado)
  billing-table.tsx         # /billing: tabla (desktop) + cards (mobile) con buscador en vivo por N° de factura o nombre de plan (client-side, sobre las filas ya cargadas; case-insensitive, no recarga)
  plan-billing-progress.tsx # billing del plan: card "Avance de facturación" (client, recharts). KPIs + hero % + barra segmentada medios/fee + burn-up acumulado por mes con línea de referencia del total del plan. Datos: getPlanBillingProgress (db/queries/billing.ts). Medios=accent, fee=accent-2 (par CVD-válido)
  billing-tracker-filters.tsx    # filtros del tracker (project + month range), URL-based
  reporting-calendar-client.tsx  # /reportes/calendario: pending list + Gantt + sent reports (con link PPT por fila). Filtros client-side: año + budget origin arriba (pendientes/Gantt) y año + mes por fecha de envío en la sección de enviados (chips ChipGroup/FilterChip)
  reporting-gantt.tsx       # Gantt diario -30/+30 días para reporting calendar
  report-comments.tsx       # tablerito de comentarios por reporte del calendario (botón + modal con autor/fecha/hora)
  report-generator-form.tsx # /reportes/generador: filtros cascading + column picker URL-based
  button.tsx                # Button + buttonVariants() — primitivo único para CTAs (primary/secondary/ghost/danger, xs/sm/md/lg). NO volver a escribir bg-ink inline
  plan-status-badge.tsx     # PlanStatusBadge — badge de estado del plan (draft/ready_to_send/approved/qa_done/live/archived), prop size md/sm. Labels de lib/plan-status.ts. Fuente única; no duplicar
  billing-status-badge.tsx  # BillingStatusBadge — badge de estado del billing, lang-aware es/en, prop size md/sm. Fuente única; no duplicar
  toast.tsx                 # ToastProvider + useToast() — feedback no bloqueante success/error/info con live-region (role=alert/status)
  confirm-dialog.tsx        # ConfirmProvider + useConfirm() — confirmación promise-based con focus-trap, Escape, backdrop. No usar confirm() nativo
  app-providers.tsx         # monta ToastProvider + ConfirmProvider — en el layout, envuelve el contenido de la app
  audit-entry.tsx           # render de un evento del audit_log (oración + diff de campos) — lo usan /auditoria y el modal de cambios del plan
  audience-hover-card.tsx   # cuadrito flotante con la audiencia de un placement al hacer hover (2s de delay). Vista del plan: planilla + preview tipo Excel
  auto-grow-textarea.tsx    # textarea que se estira con su contenido (min/max configurables) — campos de texto libre del inspector del plan
  mobile-nav.tsx            # MobileNavProvider + MobileNavToggle + useMobileNav() — sidebar drawer en mobile (< lg)
  sidebar.tsx               # navegación como DRAWER mobile (< lg); en ≥lg no se renderiza (la nav vive en top-nav.tsx)
db/
  schema.ts                 # tablas + enums
  index.ts                  # cliente Drizzle (lazy con Proxy + Transaction Pooler)
  rls.sql                   # ENABLE ROW LEVEL SECURITY en todas las tablas (cierra la REST API pública de Supabase)
  plan-publisher-balance-check.sql # diagnóstico: publishers cuyo total no cuadra con la suma de placements, en planes ya congelados (previos a la regla de cuadre)
  plan-qa-status.sql        # migración del QA de planes: enum qa_done/live + tablas media_plan_qa_runs/_checks + RLS + backfill approved → live con QA hecho
  plan-health-check.sql     # chequeo de salud READ-ONLY de todos los planes: 14 controles (una fila cada uno, aunque den 0) — tipos de ad cruzados entre clientes, status drifteados, gates de tráfico que bloquean el avance, live sin cerrar, planes que caen en el año actual por falta de fechas, tarifas huérfanas en metrics_json
  queries/cached.ts         # envoltorios unstable_cache de las lecturas caras, compartidos entre rutas (/ y /proyectos)
  fk-indexes.sql            # índices en foreign keys (Postgres no los crea solos). Aplicado en prod el 02/sep/2026; idempotente
  migrations-check.sql      # CONTROL read-only: qué migraciones de db/ ya están aplicadas (una fila por objeto, aplicada true/false). Correrlo antes de decidir si falta algo
  estructura-actual.sql     # CONTROL read-only en 8 bloques: la estructura completa de la base HOY (tablas+columnas, constraints+índices+RLS+tamaño, enums/vistas/triggers/funciones, FK SIN índice, conteo real de filas) + medición en vivo (pg_stat_activity, pg_stat_statements, EXPLAIN de la query del dashboard). Se corre UN BLOQUE POR VEZ; los 5-8 con la app caída
  rls-creative-billings.sql # habilita RLS en creative_billings (la única tabla que quedó abierta; su migración no lo hacía). Idempotente
  reports-fk-index.sql      # índice en project_reports.project_id — la FK que fk-indexes.sql se había salteado, y la que joinean las dos queries del calendario. Aplicado en prod el 02/sep/2026; idempotente
  app-users.sql             # tabla app_users + enum de roles + seed de admins (Configuración → Usuarios y roles). Aplicado en prod el 02/sep/2026; idempotente
  drop-plan-traffic.sql     # BAJA de la sección Tráfico: dropea media_plan_traffic_ads/_adsets/_briefs y ad_types. ⚠️ borra datos; no toca planes, publishers, placements, fees ni billings
  plan-planning-qa.sql      # migración del QA DE PLANIFICACIÓN: enum planning_qa_item_kind + tablas media_plan_planning_qa_runs/_checks + RLS. Puramente aditiva: no toca el QA que ya existía ni traba ningún plan
  felix-plan-markets-tiers.sql # mercado por línea del plan de Félix: crea los mercados-tier `estados-unidos-t1`/`-t2` (hoy `Estados Unidos - Varios (T1)`/`(T2)`, ver db/markets-nomenclatura.sql) y asigna las 18 líneas leyendo el T1/T2 del nombre del placement. No se puede taggear por estado: cada línea corre sobre todos los estados de su tier y market_id es una sola FK
  felix-markets-usa.sql     # catálogo de mercados de Félix: los 13 estados de EE.UU. (hoy `Estados Unidos - <Estado>`, ver db/markets-nomenclatura.sql) (California, New York, New Jersey, Texas, Florida, Arizona, Illinois, Colorado, North Carolina, Georgia, Washington, Pennsylvania, New Mexico). Idempotente; incluye la verificación y la lectura del plan por placement
  copa-varios-desarmar.sql  # PASO A de la normalización de mercados: desarma el mercado "Varios" de Copa (17 líneas, USD 820.275,98) reasignando LÍNEA POR LÍNEA — 5 a su país (creándolos), 10 multi-país a LATAM, 2 always-on a un mercado nuevo "Global". Repunta cierres y snapshots de versión; sólo borra "Varios" si quedó vacío. Idempotente
  markets-control.sql       # control READ-ONLY del catálogo de mercados: una fila por mercado con sus líneas/monto/planes/cierres + columna `control` que marca slug que no coincide con el nombre, nombre repetido, nombre fuera de la taxonomía o espacios. Esperado: todas en `ok`
  markets-catalogo-2026-09-03.csv # la foto del catálogo de mercados en prod (salida del bloque 0). Es el INPUT del generador: el plan de renombres sale de cruzarla con la taxonomía
  markets-nomenclatura.sql  # ⚙️ GENERADO (`npm run gen:markets-sql`) — PASO B: normaliza el catálogo de TODOS los clientes y fusiona los duplicados, repuntando placements, cierres y los marketId embebidos en snapshot_json / rows_json. Es un PLAN EXPLÍCITO (una fila por mercado con su destino ya resuelto), no un diccionario que resuelve la base. 3 bloques: dry-run · aplicar · verificación. Idempotente
  billing-pendientes-a-pagado-copa.sql # corrección de datos: los meses de Copa que el panel "Billing pendiente" mostraba "sin facturar" pero ya estaban facturados y cobrados. **Upsert, no update**: un mes cae en ese panel o porque no existe la fila en plan_billings o porque está en 'draft', y el diagnóstico en prod dio que los 8 eran altas — un update a secas habría devuelto `UPDATE 0` sin tocar nada ni avisar. Idempotente (2da corrida = 0 filas), probado contra el Postgres 16 local. ⚠️ un mes sin sublíneas cargadas queda pagado en US$ 0 (los totales los deriva recalcBillingTotals de plan_billing_publishers + plan_billing_fees)
  fees-management-rate-check.sql # control READ-ONLY: management fees con tarifa distinta de la de base (13%) — el botón precargaba 15% hasta 2f5f189; muestra la diferencia contra lo que daría a 13%
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
    plan-qa.ts              # getPlanQaState (QA de una versión: run + líneas controladas) + getPlanVersionHistory (versiones con su diff y su QA)
scripts/
  seed.ts                   # datos de demo (4 clientes)
  db-check.mjs, db-reset.mjs
  gen-markets-sql.ts        # genera db/markets-nomenclatura.sql desde lib/market-nomenclature.ts (`npm run gen:markets-sql`)
  check-market-nomenclature.ts # control de la taxonomía (`npm run check:markets`): idempotencia, round-trip del form, colisiones de slug y geocoding
  db-connection-test.ts     # TEST del ciclo de vida de conexión de db/index.ts (`npm run test:db`). Contra un Postgres LOCAL, nunca prod (congela el server con SIGSTOP). Fija las tres fases del timeout, que el 57014 lo tire Postgres y no nuestro reloj, y que sólo un socket muerto cierre la conexión
lib/
  format.ts                 # formatUsd, formatPct, formatUsdCompact + inputs US: formatIntInput / formatAmountInput / parseNumberInput / evalNumberInput (fórmulas tipo Excel)
  i18n.ts                   # Language type + formatDate/formatMonth + dictionary `t`
  brand-logo.ts             # carga el logo de marca (public/sangria-logo.png|jpg) + dimensiones, para los exports
  plan-metrics.ts           # evalFormula + placementMetricValue + resolveMetricColumns + placementsPeriod + sumDirectMetrics (compartido PDF/Excel/preview)
  aux-sheet.ts              # tabs auxiliares del plan: límites + sanitize/normalize + evaluador de fórmulas (refs A1 + SUM/AVERAGE/…) + insert/delete fila/columna con reescritura de refs (estilo Excel) + helpers de layout para los exports (auxContentBounds/classifyAuxRow/detectAuxHeaderRow) — compartido editor/actions/export PDF+Excel
  nav.ts                    # entradas de navegación compartidas (PRIMARY_NAV/FOOTER_NAV + isNavActive) entre top-nav.tsx (desktop) y sidebar.tsx (drawer mobile)
  budget-split.ts           # prorrateo por días + agregación mercado × mes — compartido por el Tab 2 del Excel y el preview del editor
  plan-pdf.ts               # renderPlanPdf(detail, allMetrics): PDF apaisado con tabla de métricas + una página por hoja auxiliar (formato del plan + firma/fecha)
  portal-estimate-xlsx.ts   # buildEstimateWorkbook(estimates, projections): Excel de la tab Estimación del portal — espeja la pantalla en 3 hojas (Resumen mensual + Detalle por proyecto + Proyección por plan, look de marca). Lo usa api/portal/estimate.xlsx
  portal-analysis-xlsx.ts   # buildAnalysisWorkbook(rows, markets): Excel de la sección Análisis (Detalle de activaciones + Por mercado, look de marca). Lo usa api/portal/analysis.xlsx
  historical-report-columns.ts  # IDs canónicos + labels + parse/serialize del column picker del generador de reportes
  client-filter.ts          # helpers puros del filtro global ?client=slug
  client-filter.server.ts   # resolver server-only slug → {id, slug, name, language}
  cost-methods.ts           # mapping cost method → métrica principal + buildMetricRatePairs (par tarifa↔delivery derivado del catálogo del cliente, con fallback canónico)
  campaign-metrics.ts       # Campaign Tracker: métricas calculadas + pace + buildMetricRows
  audit.ts                  # recordAudit() — wrapper para insertar en audit_log con autor
  audit-format.ts           # entityNoun / actionVerb / entityLabel / actorLabel / formatRelativeDateTime
  auth.ts                   # getCurrentUser() (server-side)
  permissions.ts            # canApprovePlans(email) + PLAN_APPROVER_EMAILS — allowlist de aprobación de planes (case-insensitive)
  plan-readiness.ts         # findPlanReadinessIssues — qué falta para marcar un plan Listo/Aprobado (campos + métrica principal + CUADRE publisher↔placements). Fuente única: server action (barrera) + editor (diálogo y aviso de descuadre)
  plan-status.ts            # lifecycle del plan: PLAN_STATUSES, los tres sets (PLAN_ACTIVE_ = vigente/pendientes, PLAN_SIGNED_ = firmado/histórico, PLAN_COMMITTED_ = compromete plata), mapa de transiciones y labels. Fuente única: queries + actions + badges
  ad-types.ts               # DEFAULT_AD_TYPES — semilla del catálogo de tipos de ad de un cliente (vive en lib/ porque un "use server" sólo exporta funciones async)
  plan-version-diff.ts      # buildPlanVersionDiff — qué cambió entre dos versiones aprobadas, comparando sus snapshots (plan/publishers/líneas/fees)
  plan-export-version.ts    # parseVersionParam(?v=N) de los exports del plan: null = plan vigente, N = versión aprobada histórica, "invalid" = 400
  client-portal.ts          # portal público: password compartido, slugs reservados, helpers PUROS (edge-safe, los usa el proxy)
  client-portal.server.ts   # cookie de sesión del portal (set/clear/has) + canAccessClientExport
  market-nomenclature.ts    # FUENTE DE VERDAD de la nomenclatura de mercados: diccionarios (países / plazas / regiones) + canonicalMarketName / buildMarketName / parseMarketName. Lo usan el form del catálogo, el seed y el generador del SQL
  market-geo.ts             # geocoding de mercados → centroide (match exacto + por token, gana el más específico: plaza > región > país); para el mapa de Análisis
  project-period.ts         # período del proyecto (min/max de placements) + aviso "termina pronto" (≤7 días)
  external-url.ts           # normalizeExternalUrl — normaliza links pegados a mano (agrega https:// si falta) y rechaza esquemas que no sean http/https. Lo usan las actions de proyecto (carpeta de Drive) y los forms
  supabase/
    fetch-with-timeout.ts   # fetch con AbortSignal.timeout(8s) para Auth — inyectado en server.ts y middleware.ts
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

### Caché de lecturas e invalidación (regla de oro)

El recurso escaso de esta app no es CPU ni datos: son las **conexiones del
pooler** (ver "Pool de conexiones"). Cada round-trip a la DB en un render
compite por ellas, y cuando no hay una libre la query se encola y termina
venciendo a los 8s — que es como se ven casi todos los "Algo salió mal".

Por eso las lecturas caras se cachean, y la caché se invalida a mano:

1. **La lectura cacheada va en `db/queries/cached.ts`**, nunca inline en la
   página. Así la comparten las rutas que piden lo mismo (`/` y `/proyectos`
   usan la misma `getDashboardProjects`, que sola son 12 round-trips).
2. **Cada envoltorio lleva un tag de área** de `lib/cache-tags.ts` (`dashboard`,
   `reports`, `plans`, `billing`, `tracker`, `analysis`, `catalog`).
3. **Toda server action que muta llama `invalidate(TAG, ...)`**
   (`lib/cache-invalidate.ts`) al lado de su `revalidatePath`. Esto **no es
   opcional**: el TTL es de 600s, así que una action que no invalida deja la
   vista hasta 10 minutos desfasada.

4. **El portal del cliente se cachea con criterio propio** (`cachedPortalClient`,
   `cachedPortalFilterOptions`, `cachedPortalSpendByPublisher`, más
   `cachedKpis`/`cachedMonthly` que ya existían). Es el caso donde la caché vale
   MÁS que adentro, por dos razones que no aplican a la app interna: (a) el
   portal es **read-only**, así que no hay read-your-own-writes que proteger; y
   (b) el portal **comparte el pooler con la app interna y no al revés** — el
   03/sep/2026 `/felix` se cayó con tres queries muertas por contención mientras
   el equipo tenía 49 renders del editor de un plan en vuelo, y el portal de ese
   cliente es la página más BARATA de la app (1 proyecto, 1 plan, 0 billings).
   No se cayó por su costo: se cayó por el de al lado. Cacheado, la visita del
   cliente hace **cero queries**. Todas las entradas van keyadas por `clientId`
   (o por slug), así que **no hay forma de que un cliente vea data de otro**.

El TTL largo es deliberado: **el TTL no es el mecanismo de frescura, es la red
de seguridad**. Con TTL corto, cada expiración manda a un usuario por el camino
frío (el fan-out completo contra la DB) y, si el pooler está apretado en ese
momento, ese usuario ve la vista rota. Con invalidación explícita el camino frío
es raro y la data igual se actualiza al instante cuando alguien edita.

`invalidate` usa **`updateTag`**, no `revalidateTag`: en Next 16
`revalidateTag(tag, "max")` es stale-while-revalidate y mostraría el valor viejo
justo después de editarlo. `updateTag` expira la entrada de una
(read-your-own-writes), pero **sólo se puede llamar desde una server action** —
por eso `invalidate` cae a `revalidateTag` cuando la llaman desde un route
handler (pasa con `transitionBillingStatus`, que reusa
`app/api/portal/billing/mark-paid`).

Al agregar una vista pesada: cachear su lectura acá **y** sumar su tag a las
actions que la mutan. Las dos cosas, o no sirve.

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
  es más ancho (`lg:grid-cols-[1fr_440px]`, `xl:[1fr_520px]`) para dar aire a las
  métricas secundarias, y las textareas de **audiencia** y **notas** usan
  `AutoGrowTextarea` (`components/auto-grow-textarea.tsx`): arrancan altas
  (11rem / 7rem) y **se estiran solas con el contenido** hasta 30rem / 24rem —
  el texto guardado se lee entero sin scrollear adentro de la caja. Como el
  inspector es `sticky`, tiene `max-h-[calc(100vh-2rem)] overflow-y-auto`
  propio: por más que crezca, siempre se llega al final.
  `RateInput`/`DeliveryInput` aceptan un prop
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
  **período de placements lo intersecta** (una campaña 2024→2025 cae en ambos).
  En el calendario el reporte se ubica por su **fecha de entrega** (o el cierre
  del proyecto si todavía no la tiene). Opción **"Todos"** en los tres.
- **Filas sin período**: el período se DERIVA de los placements, así que un plan
  sin placements (o con placements sin fechas) no tiene. El orden de respaldo
  es: **meses de facturación** (`plan_billings.month`) → si tampoco hay, **año
  actual**. Sin ese respaldo, la **carga masiva de planes históricos** —cáscaras
  sin publishers, que existen sólo para colgarles billing— caía entera en el año
  en curso: un "Boosting Octubre 2024" aparecía bajo el filtro 2026 e **inflaba
  los KPIs de la página**, que se calculan sobre el set ya filtrado (`Vigentes`
  contaba esas cáscaras como campañas al aire). **`created_at` no sirve** como
  señal: la carga masiva creó todos esos planes el mismo día del año en curso.
  El año actual como último recurso preserva la intención original — un plan que
  se está armando ahora, todavía sin fechas, no desaparece de la vista default.
- En el calendario ese filtro cubre **pendientes + en curso (el Gantt)**: son
  los que se ubican por fecha objetivo. El listado de **Reportes enviados**
  tiene el suyo propio (Año + Mes, ver abajo) porque filtra por **fecha de
  envío** — cada listado usa la fecha que le corresponde y no se pisan.
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
- Cada plan tiene su propio lifecycle:
  `draft` → `ready_to_send` → `approved` → `qa_done` → `live` → `finished`,
  con `archived` como salida lateral.
  Los sets de estado, el mapa de transiciones y los labels viven en
  **`lib/plan-status.ts`** — fuente única que importan queries, actions y UI.
- **`approved` ya NO significa "al aire"**: significa *firmado por el cliente,
  falta el QA*. La campaña sale al aire recién en `live`, y **sólo se llega a
  `live` desde `qa_done`** (ver "QA del plan" abajo).
- **`finished` = la campaña corrió y cerró.** Es el estado terminal "sano"
  (`archived` es "se canceló o la reemplazó otra versión" — cosa distinta).
  Se llega desde `live` con "Marcar terminada" y se vuelve con "Reabrir
  campaña". Antes no existía: un plan quedaba `live` para siempre y el tablero
  de pendientes le seguía pidiendo billing y tracking a campañas cerradas.
- **FIRMADO ≠ VIGENTE**, y la diferencia la hace `finished`. Hasta que apareció,
  las dos ideas estaban colapsadas en un solo set porque coincidían:
  - `PLAN_ACTIVE_STATUSES` (`approved` + `qa_done` + `live`) = **vigente**,
    "todavía es trabajo en curso" → tablero de **pendientes** (`pendings.ts`) y
    **campaign tracker**. Sobre una campaña terminada, "¿qué falta hacer?" es
    "nada", así que `finished` queda afuera.
  - `PLAN_SIGNED_STATUSES` (+ `finished`) = **firmado alguna vez** → define el
    **histórico**: portal del cliente y análisis publisher × mercado. El cliente
    tiene que poder ver sus campañas cerradas.
  - `PLAN_COMMITTED_STATUSES` (+ `ready_to_send`) = **compromete plata** →
    estimación, pacing y comparables del simulador. Una campaña terminada gastó
    de verdad, así que cuenta.
  - Se cumple `vigente ⊂ firmado ⊂ comprometido`.
- **Nunca hardcodear `status = 'approved'` en una query nueva.** Usar los sets.
  Al elegir cuál, la pregunta es qué está respondiendo la query: *"¿qué falta
  hacer?"* → `PLAN_ACTIVE_STATUSES`; *"¿qué pasó?"* → `PLAN_SIGNED_STATUSES`;
  *"¿cuánta plata hay comprometida?"* → `PLAN_COMMITTED_STATUSES`.
- Los planes pueden solapar fechas y estar todos vigentes al mismo tiempo.
- **Regla dura — el plan tiene que estar COMPLETO para pasar a Listo/Aprobado**:
  `transitionPlanStatus` bloquea el pase a `ready_to_send` **y** a `approved` si
  el plan tiene algo sin cargar. La regla vive en **`lib/plan-readiness.ts`**
  (`findPlanReadinessIssues`), fuente única que comparten la server action (la
  barrera real) y el editor (el diálogo). Exige:
  - **publisher**: `total_planned_usd` > 0 y al menos un placement;
  - **cuadre del publisher**: la suma de los montos de sus placements tiene que
    dar el `total_planned_usd` del bloque, con **tolerancia de $1**
    (`BALANCE_TOLERANCE_USD`, que el editor importa para pintar el aviso con el
    mismo criterio con el que la regla bloquea);
  - **placement**: no puede estar vacío, y necesita `placement_name`,
    `amount_usd` > 0, `cost_method`, `start_date` y `end_date`;
  - **métrica principal**: la que mapea el cost method en
    `COST_METHOD_PRIMARY_METRIC` (dCPM/CPM→`impressions`, CPC→`clicks`,
    CPV→`views`, CPA→`conversions`) tiene que estar en `metrics_json` y ser > 0.
    `Flat`/`Other` no la piden (no tienen métrica canónica).

  Motivo: un plan Listo/Aprobado alimenta facturación, estimación y exports —
  p. ej. un placement sin fechas queda fuera del prorrateo de
  `getBillingEstimate` (`if (!startDate || !endDate) continue`), así que su media
  —y el management fee sobre esa media— desaparecen del estimado. **No** se
  bloquea por mercado vacío: la app tolera "Sin mercado" por diseño.

  El **cuadre del publisher** merece su propio párrafo porque el daño es
  silencioso: el **total del plan** (y con él la base del management fee, los
  KPIs, la estimación y la cobertura vs budget del proyecto) sale de
  `sum(media_plan_publishers.total_planned_usd)`, mientras que el **prorrateo
  mensual**, el pacing, el campaign tracker y las líneas del Excel salen de los
  **placements**. Si no coinciden, la diferencia es plata que figura en el total
  pero no se prorratea a ningún mes — o, al revés, meses que facturan más que el
  total del plan. En `draft` el descuadre se tolera (estás armando el plan) y el
  bloque muestra el aviso ámbar con el botón **"Balancear"**; para pasar a
  Listo/Aprobado hay que cuadrarlo.

  **Por qué la tolerancia es $1 y no un centavo**: repartir un budget entre N
  líneas deja restos de redondeo inevitables — un bloque de $4.250 en 3 líneas
  de $1.416,67 suma $4.250,01, y no hay forma de cuadrarlo sin ensuciar una
  línea con un centavo arbitrario. El barrido de prod (ago/2026) encontró 10
  bloques descuadrados y **los 10 eran ruido de redondeo**, entre $0,01 y $0,34;
  el error que la regla ataja era de $1.455. Un dólar separa limpiamente las dos
  poblaciones. Hay además una razón de producto: con tolerancia de un centavo el
  aviso ámbar se prendía en planes perfectos, y una alarma que salta por monedas
  es una alarma que se aprende a ignorar.

  Para los planes que se congelaron **antes** de esta regla hay un diagnóstico
  en [`db/plan-publisher-balance-check.sql`](db/plan-publisher-balance-check.sql)
  (lista los bloques descuadrados + un resumen de cuánta plata implica). **No**
  trae query de reparación a propósito: cuál de los dos números manda es una
  decisión por plan, y mover el total cambia la base del management fee.

  Al intentarlo, el editor abre un **diálogo** con la lista de lo que falta
  (`• Publisher · Placement: falta …`) en vez de disparar la acción; además marca
  en la planilla las fechas faltantes con un aviso (`⚠ falta`).

### Aprobar, editar (nueva versión) y descartar el borrador
- Aprobar (`ready_to_send` → `approved`) guarda un **snapshot inmutable** en
  `media_plan_snapshots` (`version_number = current_version`, que se incrementa)
  con el estado completo del plan: publishers + placements + fees + nombre +
  notas. Ver `transitionPlanStatus` / `capturePlanSnapshot` en
  `app/actions/plans.ts`.
- "Editar (nueva versión)" vuelve el plan `approved` → `draft` para trabajar la
  v(N+1) sin tocar el snapshot aprobado (`current_version` no cambia hasta la
  próxima aprobación).
- **Descargar una versión vieja**: en el editor, la sección "Historial de
  versiones" tiene links **Excel** y **PDF** por versión. Van a las rutas de
  export con **`?v=N`**, que reconstruyen el plan desde el snapshot vía
  `getPlanDetailAtVersion` (`db/queries/project-detail.ts`) — misma forma que
  `getPlanDetail`, así los builders de Excel/PDF se reusan sin cambios. Sin `?v`
  se exporta el plan vigente (comportamiento de siempre); un `?v` inválido da
  **400**. El archivo lleva sufijo `-historico`.
  **Ojo**: los snapshots **no capturan tabs auxiliares**, así que un export
  histórico sale sin ellos (para las versiones futuras habría que sumarlos a
  `capturePlanSnapshot`; retroactivamente no se puede recuperar).
- Si el planner se arrepiente, **"Descartar borrador"** (botón visible en el
  editor solo en un `draft` con `current_version > 0`) tira todos los cambios y
  restaura el plan al snapshot de la versión aprobada vigente, dejándolo en
  `qa_done` (si el QA de esa versión ya estaba cerrado) o en `approved` (si no).
  Lo hace `revertPlanToApprovedSnapshot` en
  `app/actions/plans.ts`: restore **en transacción** (borra el contenido del
  draft y reinserta el del snapshot, mapeando old→new ids), restaura nombre +
  notas y vuelve al estado firmado que corresponda. Pre-chequea colisión de nombre con el partial
  unique index si el draft había renombrado el plan. Es irreversible.
- **Los fees NO se borran en el revert** (regla dura: lo facturado ya está
  facturado). Publishers y placements sí se borran y reinsertan, porque el
  billing no cuelga de ellos (`plan_billing_publishers` apunta al catálogo de
  publishers). Los fees en cambio son el padre de `plan_billing_fees`, o sea de
  lo ya imputado y facturado: por eso el revert los **reconcilia** en vez de
  recrearlos — actualiza el fee que ya existe (mismo id → la imputación sigue
  colgando de él), inserta el que falta **conservando el id del snapshot**, y
  borra el que el draft agregó **solo si no tiene nada imputado** (si ya se
  imputó, se conserva y queda registrado en el audit como `keptBilledFees`).
- **Snapshot vs. FKs que pueden desaparecer**: el snapshot es JSONB congelado,
  así que puede referenciar un `market_id` que ya no existe (los markets se
  borran/editan desde config; la FK live es `onDelete: set null`). Al restaurar,
  `revertPlanToApprovedSnapshot` sanitiza cada `market_id` contra los markets
  vivos — si ya no existe lo deja en `null` (igual que la FK al borrarse) — para
  no reventar la transacción con un FK violation. El `publisher_id` es seguro
  (`onDelete: restrict`: un publisher en uso no se puede borrar). Si algo falla
  igual, la action captura el error y devuelve `{ok:false}` (toast) en vez de
  propagar y romper la vista.

### Los DOS QA del plan: planificación y armado
La app tiene **dos instancias de QA**, en los dos extremos del ciclo. Se hacen
en momentos distintos, las hace gente distinta y controlan cosas distintas —
conviene no confundirlas:

| | QA de **planificación** | QA de **armado** |
| --- | --- | --- |
| Pase que habilita | `draft → ready_to_send` | `approved → qa_done` |
| Quién | Media planner | AM / PM |
| Qué controla | Lo que acaba de cargar, antes de que el plan sea un compromiso | Que la campaña esté montada en las plataformas tal cual el plan |
| Qué se tilda | Cada **línea** del plan, antes de firmar | Cada **línea** del plan, ya montada |
| Tablas | `media_plan_planning_qa_runs` / `_checks` | `media_plan_qa_runs` / `_checks` |
| Módulos | `lib/plan-planning-qa.ts`, `app/actions/plan-planning-qa.ts` | `lib/plan-status.ts`, `app/actions/plan-qa.ts` |

### QA de planificación: el repaso del planner antes de la firma
- **Cómo se hace**: el botón **"Marcar listo para enviar"** ya no congela el
  plan de una. Primero corren los chequeos que ya existían (readiness y el gate
  — no tiene sentido hacer repasar 40 líneas para después avisar que a un
  publisher le falta el monto — y con eso en verde abre el modal
  (`planning-qa-modal.tsx`): cada **placement** con su mercado, monto, método,
  fechas y audiencia, y una casilla por línea. Con todo tildado, el botón del modal
  **cierra el QA y hace el pase** en una sola acción (`completePlanningQa`).
- **Es por versión**, igual que el otro, pero la versión que controla es la que
  el draft **va a ser**: `current_version + 1`. Así el QA de planificación de la
  v3 y el de armado de la v3 hablan de lo mismo, y editar un plan aprobado
  —que abre la v(N+1)— pide un QA nuevo en vez de heredar el anterior.
- **Volver a draft lo reabre**. Lo que se controló fue el plan como estaba antes
  de volver a editarlo; dar por bueno ese control sobre contenido que puede
  haber cambiado es justo el error que el QA existe para evitar. Los **tildes no
  se borran** (son el registro de qué se miró y quién): el planner reabre el
  modal, revisa y confirma.
- **Tablas aparte, no un `stage` en las del otro QA**: se separaron cuando este
  QA además tildaba adsets, y quedaron así — la migración fue puramente aditiva
  y el QA de armado nunca se tocó. La columna `item_kind` sobrevive con un solo
  valor (`placement`): sacarle un valor a un enum de Postgres no vale lo que
  cuesta, y deja la puerta abierta si vuelve a haber algo más que tildar.
- **Barreras reales (server-side)**, en `app/actions/plan-planning-qa.ts` y
  `transitionPlanStatus`:
  - sólo se tilda sobre un plan `draft`, y sólo ítems **de ese plan**;
  - `completePlanningQa` **re-cuenta contra la base** antes de cerrar, y sólo
    cuenta los tildes de líneas **vivas** (borrar un placement no puede dejar el
    QA completo con un tilde fantasma; lo mismo vale para los tildes viejos de
    adsets, que quedaron huérfanos al sacar el tráfico);
  - el pase lo hace `transitionPlanStatus`, que vuelve a chequear todo. Si
    rechaza, `completePlanningQa` **revierte el cierre** para no dejar un QA
    "hecho" sobre un plan que no se movió;
  - se exige **sólo** en `draft → ready_to_send`, no en `approved`: al aprobado
    sólo se llega desde ready_to_send, y gatearlo además dejaría trabados los
    planes que quedaron congelados antes de que este QA existiera.

### QA del plan: obligatorio para pasar a Live, y por versión
- Entre `approved` y `live` hay una **instancia de QA**: el planner verifica que
  la campaña esté **armada en las plataformas tal cual se planificó**. Es
  **obligatoria** — no hay transición `approved → live`.
- **Cómo se hace**: en el editor, un plan `approved` muestra la franja "Falta el
  QA de la vN" y el botón **"Realizar QA"**. Abre un modal
  (`app/(app)/proyectos/[code]/planes/[planId]/qa-modal.tsx`) que muestra el
  plan **con el mismo layout que el Excel** (grupos de publisher con subtotales,
  columnas Mercado / Inicio / Fin / Audiencia / Notas / Cost method / Inversión
  + una columna por métrica, bloque de fees y grand total) con una casilla
  **"Controlado"** al final de cada línea. Con **todas** tildadas se habilita
  **"QA realizado"** → el plan pasa a `qa_done`. De ahí, **cualquiera** puede
  marcarlo **Live**.
- **Es por versión**: aprobar la v(N+1) deja el plan en `approved` **sin** run de
  QA para esa versión, así que el control se rehace entero. Un plan nunca vuelve
  a live sin QA de la versión vigente.
- **Persistencia**: cada tilde se guarda sola en `media_plan_qa_checks` con
  **quién y cuándo**, colgando del run de `media_plan_qa_runs`
  (unique `(media_plan_id, version_number)`). Así el progreso sobrevive a cerrar
  el modal, y dos planners pueden repartirse un plan largo. La UI es optimista y
  **revierte** el tilde si el server rechaza. `placement_id` **no tiene FK** a
  propósito: una versión futura puede borrar la línea y el QA histórico tiene
  que seguir existiendo.
- **Barreras reales (server-side)**, en `app/actions/plan-qa.ts` y
  `transitionPlanStatus`:
  - sólo se tilda sobre un plan `approved`, y sólo líneas **de ese plan**;
  - `completePlanQa` **re-cuenta contra la base** antes de cerrar: si falta una
    línea, no cierra;
  - `qa_done` y `live` exigen que el run de la versión vigente esté cerrado —
    también se re-chequea al pasar a `live`, por si el status llegó de una
    corrección manual en la base.
- **No hay "marcar todas"**: tildar *es* el acto de controlar. Para planes
  largos hay "Ir a la primera pendiente" y un contador `N/M` con barra.
- **Escape hatches**: **"Reabrir QA"** (`qa_done` → `approved`, conserva los
  tildes como registro de lo controlado) y **"Sacar de Live"** (`live` →
  `qa_done`, el QA de esa versión sigue valiendo).
- **Descartar borrador** vuelve el plan a `qa_done` si el QA de esa versión ya
  estaba cerrado, o a `approved` si no. Nunca vuelve directo a `live`: que
  alguien confirme que la campaña está al aire es un click barato y evita dar
  por viva una campaña que se bajó mientras se editaba el borrador.

### Historial de versiones: qué cambió en cada una
- Abajo del editor, **"Historial de versiones"**
  (`version-history.tsx`) lista una fila por versión aprobada — número, fecha,
  chip de QA y un resumen (`+3 · 2 modificadas · −1`, con el delta de total) — y
  **cada una se despliega** para ver el detalle: totales antes→después, quién
  cerró el QA y cuándo, y el diff agrupado en **Plan · Publishers · Líneas ·
  Fees** con `campo: antes → después`. La última versión abre desplegada.
- El diff se computa en **`lib/plan-version-diff.ts`** comparando los
  **snapshots inmutables** de v(N−1) y vN, **no** el audit_log: el snapshot es
  exactamente lo que se aprobó, así que el diff es determinístico. El matching
  entre versiones es por **`id` de fila** (los uuid sobreviven a las ediciones:
  `updatePlacement` muta la misma row), así una línea nueva sale como "agregada"
  y una que desapareció como "eliminada".
- Los nombres de publisher / market / métrica se resuelven contra el catálogo
  **actual** (el snapshot congela ids), mismo criterio que
  `getPlanDetailAtVersion`.
- Las descargas por versión (`?v=N`, Excel / PDF) siguen viviendo en cada fila.

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
  tab **al final del workbook** (después del "Budget por mercado" y del
  "Historial de versiones", en orden), castea a número las
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
- Mercados: taxonomía cerrada, siempre país primero — `Argentina (País)` /
  `México - Ciudad de México` / `Argentina - Varios` / `Centroamérica`. No se
  tipea: se elige en el form. Ver "Mercados: nomenclatura única".
- Planes: `<Project.code>.<PlanName>` — ej. `costa-rica-2026.Awareness`.

### Períodos derivados, no almacenados
- El **plan** no guarda `period_start` / `period_end`: se derivan con
  `min/max` de las fechas de placements.
- El **proyecto** guarda `start_date` (estimado del AM) pero no `end_date`:
  se deriva del placement más lejano de todos sus planes.

### Cambio masivo de fechas de los placements
- Botón **"Cambiar fechas de todos"** en el strip de metadata del editor
  (pegado al período derivado, que es justo lo que mueve) → abre
  `bulk-dates-modal.tsx`. El planner elige **solo inicio, solo fin o ambos**
  (cada fecha tiene su checkbox; la destildada no se toca) y con "Cambiar"
  aplica a **todas las líneas del plan** de una vez. Antes eran dos fechas por
  placement, a mano, en el inspector.
- **Regla dura: sólo sobre un plan en `draft`.** La barrera está en
  `bulkUpdatePlacementDates` (`app/actions/plans.ts`), no sólo en la UI: en un
  plan firmado hay que apretar **"Editar (nueva versión)"** primero, y esa
  versión vuelve a pasar por **aprobación** (que congela la v(N+1)) y por el
  **QA de la versión nueva** antes de poder marcarse Live. Mover fechas cambia
  el compromiso con el cliente: tiene que dejar rastro de versión como
  cualquier otra edición. En un plan firmado el botón no se esconde — queda
  deshabilitado diciendo qué hay que hacer primero.
- **No se pueden vaciar fechas en masa** (dejar el campo vacío = "no tocar"):
  un placement sin fechas se cae del prorrateo mensual y su plata desaparece
  del estimado (`prorateByMonth` la manda a `NO_DATE_KEY`).
- **Nunca deja un rango invertido.** Aplicando un solo extremo, el otro queda
  como estaba en cada línea, así que se valida placement por placement que no
  quede `fin < inicio` — con el rango dado vuelta `prorateByMonth` también
  manda todo a `NO_DATE_KEY`. El modal lo avisa con los nombres de las líneas
  afectadas antes de mandar; la action lo rebota igual.
- **Auditoría**: una sola row a nivel `media_plan` (no una por placement) con
  el resumen "antes → después" y cuántas líneas cambiaron. Son N updates de un
  mismo acto del planner, y `recordAudit` hace un lookup de auth por llamada.

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
- Al escribir la **tarifa**, primero se redondea la tarifa a 6 decimales y
  DESPUÉS se deriva el delivery de esa tarifa ya guardada. Ese orden importa:
  garantiza que `delivery === monto × multiplier / tarifaGuardada` se cumpla
  exacto, así el warning de "tarifa y delivery no coinciden" no se
  autodispara y los dos caminos de edición (escribir la tarifa vs. cambiar el
  monto) producen el mismo número — lo que hace determinístico el diff de
  versiones.

### El delivery se guarda EXACTO y se muestra REDONDEADO (regla dura)
- `metrics_json` guarda el delivery **fraccionario**, acotado a 6 decimales
  (`exactDelivery` en `editor.tsx`, mismo criterio que las tarifas). Un CPA de
  $450 sobre un placement de $4.101,50 guarda `9.114444`, no `9`.
- **Ninguna superficie muestra decimales.** El delivery se redondea al
  imprimirse: `formatIntInput` (`lib/format.ts`, `maximumFractionDigits: 0`) en
  el editor, el QA modal y la vista previa; `numFmt "#,##0"` en el Excel del
  plan (Excel guarda el valor real en la celda y pinta el entero, así que las
  columnas suman bien); `maximumFractionDigits: 0` en el PDF; y el diff del
  historial de versiones formatea sin decimales cuando el slug es `direct`
  (`metricIsCount` de `NameLookups`, alimentado por `db/queries/plan-qa.ts`).
  El valor exacto se puede ver en el `title` del input.
- **Por qué**: redondear al guardar volvía por la ventana como una tarifa
  distinta de la cargada. Con delivery 9 en vez de 9,1144, la tarifa
  re-derivada pasaba de $450 a $455,72 — un 1,26% de error, que en volúmenes
  chicos (tickets, conversiones) es enorme y en impresiones es invisible. Y al
  sumar los goals de los placements el error se acumulaba: los 7 placements
  del plan daban 63 en vez de 63,80 (= $28.709,50 / 450), y por eso los goals
  no coincidían con el PPT que se le manda al cliente.
- **Corolarios en dos lugares que asumían enteros**:
  - `lib/campaign-metrics.ts` redondea el goal de las métricas **direct**: es
    el número contra el que carga la trafficker, así que cargar los "9" que ve
    la pantalla tiene que dar 100% y no 98,7%. La plata (`amount`) no se toca;
    los "costo por X" **calculated** siguen exactos (ahí está la gracia: el
    tracker vuelve a mostrar los $450 negociados).
  - `lib/plan-readiness.ts` exige que la métrica principal sea `>= 1` **ya
    redondeada**. Antes lo garantizaba el `Math.round` del editor; sin eso un
    delivery de 0,4 pasaba a Listo y se imprimía "0" en el PDF que firma el
    cliente.
- El simulador escribe con el mismo criterio al promover un escenario a plan
  (`placementMetricsFromRow` en `components/simulator/builder-helpers.ts`).
- **Los inputs numéricos no commitean si no escribiste.** `RateInput` y
  `DeliveryInput` pintan con menos precisión de la que guardan, así que
  reparsear al `blur` el texto que ellos mismos pintaron reescribía el dato
  con sólo tabular por la grilla (y `Enter` hace `blur()` para bajar de fila,
  así que recorrer una columna mutaba todo el bloque). Ahora cada uno lleva un
  flag que se prende en el primer `onInput` y se apaga al commitear. Efecto
  lateral buscado: escribir "9" sobre un `9.114444` guardado **sí** commitea 9
  — antes el umbral de 1 unidad lo bloqueaba y no se podía forzar el entero.

### Indicadores estimados (métricas secundarias)
- El bloque debajo de la métrica principal permite agregar métricas
  adicionales (reach, engagements, leads, tickets, etc.).
- **TODA métrica direct del catálogo** tiene el mismo editor bidireccional que
  la principal: ingresás tarifa o delivery y la app calcula el otro desde
  `amount × multiplier`. El par sale de `buildMetricRatePairs`
  ([`lib/cost-methods.ts`](lib/cost-methods.ts)), con este orden de precedencia:
  1. **Catálogo del cliente** — una métrica `calculated` con fórmula
     `amount / <delivery>` (con `× N` opcional) ES la tarifa de esa delivery:
     `cpt = amount / tickets` habilita la tarifa de `tickets` y la persiste bajo
     `cpt`. Métrica custom nueva = par nuevo, **sin tocar código**. La calculada
     además reserva su slug (dos deliveries no pueden pisarse la misma key).
  2. **Fallback canónico** (`DIRECT_METRIC_RATES`) para las delivery que el
     catálogo no cubre: `impressions ↔ cpm` (×1000), `clicks ↔ cpc`,
     `views ↔ cpv`, `conversions ↔ cpa`, `reach ↔ cpr`, `engagements ↔ cpe`,
     `followers ↔ cpf`, `leads ↔ cpl`, `installs ↔ cpi`, `visits ↔ cpvis`.
  3. **Sin métrica de costo en el catálogo** → `rate: null`. La columna Tarifa
     se habilita igual (editarla define el delivery), pero el valor se deriva al
     vuelo de `amount / delivery` en vez de persistirse: lo único que se pierde
     hasta crear la calculada es el rate-anchoring al cambiar el monto. El input
     lo dice en su tooltip.
- **Los ratios nunca generan par**, por dos vías: las *calculated* que no son
  `amount / X` (`ctr = clicks/impressions`) las rechaza `parseCostFormula`; y las
  *direct* que son ratios quedan excluidas del paso 3 — `frequency` por slug
  (su `unit` del seed, `"freq"`, no la delata) y cualquier custom del cliente por
  unidad (`%`, `x`, `$`). Esas siguen mostrando `—` en la columna Tarifa.
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

### Mercados: nomenclatura única (taxonomía cerrada)

El catálogo se había llenado de variantes del mismo lugar —"Panama", "Panamá",
"Panama City" y "Ciudad de Panamá" eran **cuatro** mercados distintos, cada uno
con sus líneas— porque el nombre se tipeaba libre. Hoy hay UNA taxonomía, la
misma para todos los clientes, y el nombre **no se escribe: se elige**.

| Qué es el mercado         | Forma              | Ejemplo                     |
| ------------------------- | ------------------ | --------------------------- |
| El país entero            | `<País> (País)`    | `Argentina (País)`          |
| Una plaza (ciudad/estado) | `<País> - <Plaza>` | `México - Ciudad de México` |
| Varias plazas de un país  | `<País> - Varios`  | `Argentina - Varios`        |
| Una región supranacional  | `<Región>`         | `Centroamérica` · `LATAM`   |

- **Siempre arranca por el país.** El separador es `" - "`. Si hay más de un
  grupo multi-plaza en el mismo país se etiqueta —`Estados Unidos - Varios (T1)`
  y `(T2)` son los dos tiers de Félix— porque dos "Varios" del mismo país
  colisionarían en el slug.
- **Las subdivisiones son plazas**: Félix planifica por estado de EE.UU., y un
  estado es una plaza dentro del país igual que una ciudad →
  `Estados Unidos - California`.
- **Las regiones quedan afuera de la forma "País - …"** a propósito:
  Centroamérica no tiene país que la anteceda. Sólo se unifica su ortografía.
- **`lib/market-nomenclature.ts` es la fuente de verdad**: los diccionarios (37
  países, ~180 plazas incluidos los 50 estados de EE.UU., 7 regiones) más
  `canonicalMarketName` / `buildMarketName` / `parseMarketName`.
  `npm run check:markets` chequea idempotencia, round-trip del form, colisiones
  de slug, alias repetidos entre diccionarios y geocoding.
- **Las siglas de dos letras quedaron afuera** de los alias: "ca" sería Canadá,
  California y Centroamérica a la vez. Van las de tres (IATA/ISO-3): `pty`,
  `cdmx`, `bog`, `mia`.
- **El alta y la edición pasan por `components/market-picker.tsx`** (nivel →
  país → plaza), no por un input de texto. `app/actions/markets.ts` arma el
  nombre con `buildMarketName`, deriva el slug del nombre canónico **también al
  renombrar** (antes lo dejaba congelado, y el mapa geocodifica por slug antes
  que por nombre) y rechaza el alta si el slug canónico ya existe, nombrando al
  mercado que lo ocupa.
- **La taxonomía tiene DOS niveles, no tres**: país y plaza. Una plaza dentro
  de otra no se anida — las cinco plazas del condado de San Diego que Copa
  pauta por separado son `Estados Unidos - La Jolla`, `- Coronado`,
  `- Encinitas`, `- Del Mar`, `- San Diego`, no `San Diego - La Jolla`.
- **Las decisiones que el diccionario no puede tomar** —dos formas válidas de
  la taxonomía que en el catálogo real se usaron para lo mismo— van en
  `market_override` (lista en `scripts/gen-markets-sql.ts`, con su porqué).
  Salen marcadas "decisión manual" en el dry-run y valen sólo para la
  migración.
- **Lo que no se puede mapear con certeza no se toca.** "Santiago" a secas es
  Chile o República Dominicana: queda como está y se lista aparte para que lo
  desambigüe una persona desde el form.
- La normalización de prod son **dos pasos**, los dos generados o probados
  contra el Postgres local: `db/copa-varios-desarmar.sql` (paso A, desarma el
  mercado "Varios" de Copa reasignando línea por línea) y
  `db/markets-nomenclatura.sql` (paso B, renombra y fusiona el catálogo). El paso
  B son cuatro bloques que van en Runs separados: **0** (la foto del antes),
  **1** (dry-run), **2** (aplicar, un solo statement todo-o-nada) y **3** (el
  control, que devuelve `ok`/`REVISAR` por control y los números a comparar
  contra el bloque 0). **El código se deploya ANTES del SQL**: con el geocoding
  viejo, los slugs nuevos de los tiers de Félix colapsan en una sola burbuja.
- **El paso B es generado** (`npm run gen:markets-sql`) cruzando
  `db/markets-catalogo-2026-09-03.csv` —la foto de prod— con la taxonomía, así
  que la base no puede divergir de la app. Y lo que emite es un **plan
  explícito**: una fila por mercado con su nombre destino ya resuelto, para que
  se lea entero antes de aplicarlo. Un mercado que esté en la base y no en el
  plan (cargado después de la foto) no se toca y sale reportado.
- `media_plan_placements.market_id` es FK con `ON DELETE SET NULL`.
- El catálogo se lee **sin caché** (`listMarketsForClient` en
  `app/actions/plans.ts` y la página de configuración van directo a la DB), así
  que un mercado cargado por SQL aparece en el dropdown del editor al refrescar
  — no hace falta deploy ni invalidar tags.

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
- **Lo facturado ya está facturado** (regla dura): un plan cambia todo el tiempo
  (nueva versión, descartar borrador, editar fees), pero lo que ya se imputó en
  un mes tiene que seguir existiendo y mostrándose. Por eso
  `plan_billing_fees.media_plan_fee_id` es **`no action`, NO `cascade`**: borrar
  un fee del plan no puede llevarse en silencio la imputación de los meses ya
  cargados. `removeFee` (`app/actions/plans.ts`) pre-chequea y devuelve un error
  con los meses y montos si el fee tiene imputaciones > 0 (hay que ponerlos en 0
  primero); si solo tiene filas en 0 —las que precrea `ensureBillingForMonth`—
  las limpia y borra el fee. `plan_billing_id` sí queda en `cascade`: borrar el
  **mes** sí borra sus líneas. Es `no action` y no `restrict` a propósito: el
  chequeo diferido al fin de la sentencia deja andar el hard delete de un plan
  (ahí `plan_billings` cascadea a `plan_billing_fees` antes de evaluar la FK).
  Migración: `db/billing-fees-no-cascade.sql`.
- **Estilo del PDF de finanzas** (excepción deliberada al look de marca): a
  diferencia del resto de los exports, este reporte va **sin el header bordó**
  — header gris claro, **una sola tipografía** (Helvetica) y un solo tamaño en
  todas las celdas del cuerpo, y la columna Description hace **wrap** (la fila
  crece) en vez de truncarse. Es un documento operativo que finanzas imprime y
  reenvía: manda la legibilidad, no la marca.

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
  activos y resta lo ya facturado en cada mes (facturas `invoiced`/`paid`).
- Devuelve **separado media de fees**: `grossMediaUsd` (placements) y
  `grossFeesUsd` (management/setup/reporting/custom). El **facturado** se lee de
  los TOTALES de la propia factura: `alreadyBilledMediaUsd` = `plan_billings.total_net_usd`
  (media facturable) y `alreadyBilledFeesUsd` = `plan_billings.total_fee_usd`
  (fees). Se usan los totales de la factura —y no la suma de sublíneas
  (`plan_billing_publishers` / `plan_billing_fees`)— porque son la **fuente de
  verdad de lo emitido**: evita descuadres cuando la itemización está incompleta
  (p. ej. facturas con el fee en `total_fee_usd` pero sin filas en
  `plan_billing_fees`, que hacían aparecer el fee ya cobrado como pendiente).
  Para data creada por la app da idéntico (ver `recalcBillingTotals`). Los
  totales `grossUsd` y `alreadyBilledUsd` se exportan como sumas.
- **Meses cerrados → "falta facturar" = $0**: "Falta facturar" es
  forward-looking; un mes anterior al actual ya no se factura, así que su
  `netUsd` (por proyecto y del mes) va a 0. Evita el "fantasma" de un plan que
  quedó 100% facturado pero de forma **despareja** entre meses (el prorrateo
  lineal esperaba X/mes, se facturó despar, y el piso `max(0, …)` por mes no
  dejaba que un mes compensara al otro). El saldo REAL pendiente de un plan vive
  en el mes actual/futuro y, sobre todo, en `getClientBillingProjections` (que
  reconcilia al nivel plan con `total_usd`). Los meses cerrados siguen mostrando
  su **Facturado real**.
- **Solo media FACTURABLE**: `grossMediaUsd` cuenta únicamente placements de
  publishers que la agencia factura (`coalesce(media_plan_publishers.agency_pays_override,
  publishers.agency_pays)`). La media que paga el cliente directo **no se
  factura como medio**, así que no figura como "falta facturar" (antes sí, y
  quedaba pendiente para siempre porque el facturado real la excluye). El
  **fee** en cambio se sigue calculando sobre **toda** la media gestionada
  (base `totalMedia` sin filtrar) — decisión de negocio #182. Misma regla en
  `getClientBillingProjections` (el desglose por plan del portal).
- Acepta filtros opcionales: `months[]`, `budgetOriginId`/`budgetOriginIds[]`,
  `projectId`/`projectIds[]`, `clientId`. Los `*Ids[]` (multi) tienen prioridad
  sobre los single homónimos (`inArray` en las subqueries de scope) — los usan
  los **filtros multi-select del portal**.
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
  la tab Estimación tiene un **filtro de Año** (default: año actual · `all` =
  todos) además del de Mes: el multi-select de **Mes** se scopea al año elegido
  (`estimationMonthOptions(opts.months, año)` = histórico ∪ ventana futura,
  filtrado por año), así **filtrar por Mes ya no mezcla meses de otros años**.
  La ventana efectiva de meses (vista y export) la calcula
  `estimateWindowMonths({ year, selectedMonths })` en `lib/estimate-window.ts`
  (fuente única compartida): meses elegidos scopeados al año, o el default (año
  actual/`all` → mes anterior + 2 próximos; un año puntual → sus 12 meses). La
  card de un mes **anterior al actual** (`isPast`, con `currentMonth`
  server-computed) lidera con el **FACTURADO REAL** en vez del neto
  (`components/billing-estimate-card.tsx`).
- **Export a Excel (portal)**: la tab Estimación tiene un botón **"Descargar
  estimación (Excel)"** que baja lo que se ve en la ventana (mismos meses +
  filtros bo/proj) vía `GET /api/portal/estimate.xlsx` (thin handler →
  `lib/portal-estimate-xlsx.ts`). **Espejo de la pantalla** (regla dura, ver
  `AGENTS.md`) en cuatro hojas con el look de marca del plan:
  - **Resumen** — fila por mes con header **agrupado en dos niveles**:
    **Estimación** (media · fees · bruto) · **Facturado real** (media · fees ·
    bruto) · neto + TOTAL, con estado Cerrado/En curso/Estimado.
  - **Detalle por proyecto** — por mes → proyecto, mismo desglose est. + real,
    con subtotal por mes.
  - **Proyección** — espeja el desplegable de cada proyecto: por proyecto →
    plan (Total / Facturado / Falta facturar) y, anidado y colapsable, las
    **facturas emitidas** (suman "Facturado") y la **proyección por mes
    restante** (suma "Falta facturar"). Usa `getClientBillingProjections`;
    forward-looking, ignora el filtro de Mes igual que la vista.
  - **Conciliación** — espeja los bullets de "facturado vs total del plan": una
    fila por proyecto con Total del plan · Facturado (coloreado verde/azul/rojo)
    · Diferencia · media que paga el cliente · publishers client-pays · Estado.
    Usa `getClientBillingReconciliation`.

### Conciliación "facturado vs total del plan" (portal)
- Debajo de las cards mensuales de la tab Estimación, una sección de **bullets**
  compara, por proyecto, el **facturado real** contra el **total del plan** =
  **presupuesto completo** (TODA la media —incl. la que paga el cliente directo—
  + fees). Semáforo del facturado: 🟢 **verde** = coincide · 🔵 **azul** (`text-info`)
  = le falta · 🔴 **rojo** = se pasó.
- El bullet **explica el gap**: en la mayoría de los casos el faltante es media
  que paga el cliente directo (YT/Google) —la agencia cobra el fee sobre esa
  inversión (#182) pero no factura el medio—, nombrando esos publishers y el
  monto. Si además queda facturación billable pendiente, lo aclara aparte.
- Datos: `getClientBillingReconciliation(clientId, bo?, proj?)` en
  `db/queries/dashboard.ts`. A diferencia de la estimación (solo media
  facturable) y la proyección (solo planes con saldo), mira el **presupuesto
  completo** de **todos** los planes approved/ready (suma TODOS los placements,
  aun sin fechas) y lo compara con el `total_usd` facturado (invoiced/paid). El
  fee de management va sobre toda la media (#182), así que en el gap los fees se
  cancelan y la diferencia ≈ media client-pays. UI en
  `components/billing-estimate-card.tsx` (`BillingReconciliationBullets`).

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

### Vista de auditoría (externa, solo lectura sobre TODA la app)
- **Qué es**: una segunda puerta al login para alguien de afuera que tiene que
  poder mirar la app interna completa sin poder cambiar nada. Usuario y
  contraseña fijos, no Google — el OAuth está restringido a `@sangria.agency` y
  una auditora externa no tiene esa cuenta.
- **Credenciales**: constantes en `lib/audit-session.ts` (`AUDIT_EMAIL`,
  `AUDIT_PASSWORD`), igual que `CLIENT_PORTAL_PASSWORD`. No hay alta de
  usuarios externos en la app: el acceso se revoca borrando esas constantes y
  redeployando.
- **Es la MISMA URL de la app**, no un subdominio ni una ruta aparte: entra al
  dashboard, el proxy la manda a `/login` y ahí abajo del botón de Google está
  el desplegable "Acceso de auditoría". El link que se comparte es
  **`/login?audit=1`**, que abre ese formulario ya desplegado.
- **Alcance**: la app interna **entera**, Configuración incluida. No hay lista
  de rutas vedadas — lo único que no puede es escribir.
- **Tres barreras encadenadas** (defensa en profundidad):
  1. **El proxy sólo la deja pasar en GET/HEAD/OPTIONS**
     (`lib/supabase/middleware.ts`, rama `isAudit`). Los Server Actions de Next
     se despachan por **POST** a la ruta actual sin importar el path, así que
     cerrar todo lo que no sea GET cierra de raíz **toda** escritura, incluidas
     las actions que todavía no se escribieron. Es el mismo razonamiento por el
     que el portal de cliente es GET-only. Ésta es la garantía estructural: no
     depende de acordarse de nada.
  2. **`assertCanWrite()`** (`lib/read-only.ts`) al principio de cada una de las
     **73** server actions que escriben. Devuelve `{ ok: false, error }` con la
     forma que ya usan las actions, así el error sale por el toast de siempre.
     `npm run check:read-only` falla si una action que escribe se queda sin el
     guard, si lo tiene después de la primera consulta a la base, o si se lo
     pusieron a una de sólo lectura.
  3. **La UI desactiva y explica**: cada control que escribe lleva
     `data-audit-hint="<nombreDeLaAction>"`, y en modo auditoría queda apagado
     y muestra al pasar el mouse **qué cambio haría y a qué áreas afecta**
     (`components/audit-mode.tsx` + registro en `lib/audit-hints.ts`).
- **El cookie va firmado** (HMAC-SHA256, vencimiento adentro de la firma). El
  del portal guarda un slug en texto plano porque el premio de falsearlo es un
  portal público; acá el premio es la app interna entera, así que se verifica
  firma y vencimiento en cada request. El secreto sale de `AUDIT_SESSION_SECRET`
  y, si no está, de `DATABASE_URL` (server-only y secreto). Sin ninguno de los
  dos, **falla cerrado**: no se emite ni se acepta ninguna sesión de auditoría y
  el formulario del login lo dice.
- **Exports**: sí puede bajar los Excel/PDF (`canAccessClientExport` en
  `lib/client-portal.server.ts`). Son GET y en este proyecto los exports son un
  espejo de la pantalla: si puede ver el plan, puede bajarlo. Lo que **no** pasa
  por ahí es `canWriteAsClientPortal`, que la deja afuera a propósito.
- **Chequeo**: `npm run check:audit` (`scripts/check-audit-session.ts`) valida
  firma, vencimiento, token alterado, secreto cambiado, falla cerrado y qué
  métodos deja pasar el proxy. No necesita DB ni levantar la app.
- **Cerrar sesión**: el mismo menú del topbar, pero posteando a
  `/api/audit/logout` en vez de `/auth/signout` (no hay sesión de Supabase que
  cerrar). Ese endpoint está exento del GET-only, si no daría 403.

### El rol Viewer: el gancho está, apagado a propósito
- El rol `viewer` dice "Solo lectura" pero es **decorativo**: `lib/permissions.ts`
  sólo mira el rol para aprobar planes y para administrar usuarios, así que un
  viewer puede invocar las otras ~80 server actions igual que un admin.
- `assertCanWrite()` ya sabe hacerlo cumplir: alcanza con agregar `"viewer"` a
  `READ_ONLY_ROLES` (`lib/roles.ts`). **Está vacía a propósito.**
- **Por qué no se activó**: el default de la columna es `viewer` (`db/schema.ts`)
  y `touchUser()` da de alta con el default a cualquiera que entre por primera
  vez. O sea que hoy casi todo el equipo figura como `viewer` sin que eso haya
  querido decir nunca "solo lectura" — activarlo dejaría a esa gente sin poder
  trabajar en el próximo deploy.
- **Para activarlo**: primero asignar roles de verdad en Configuración →
  Usuarios y roles, confirmar que no quede nadie en `viewer` por omisión, y
  recién ahí sumarlo a la lista. La sesión de auditoría no depende de esto.

### Portal de cliente (público, read-only salvo "Marcar pagado")
- **Qué es**: una vista para compartir con cada cliente en
  `/<slug>` (el mismo slug interno del cliente, ej. `/copa`).
  Read-only con **una sola excepción**: el botón "Marcar pagado", que está en
  las dos tablas de facturas del portal — Billing Tracker (`plan_billings`) y
  Creative (`creative_billings`) — ver más abajo. Tabs:
  **Resumen** (KPIs + chart de inversión mensual + **inversión por publisher
  planeado vs real** + **facturado acumulado vs estimado YTD**), **Billing
  Tracker**, **Creative** (facturación del trabajo creativo — ver más abajo),
  **Estimación**, **Proyectos**
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
    URL-based (GET). **La única escritura del portal** ("Marcar pagado") sale
    por el mismo canal: un route handler dedicado en `/api/portal/*` que se
    autovalida. **Si mañana hace falta otra escritura desde el portal, va por
    ahí — nunca abriendo POST en `/<slug>`.**
  - **Slugs reservados**: el proxy considera portal a cualquier primer segmento
    top-level que NO esté en `RESERVED_TOP_LEVEL_SLUGS` (`lib/client-portal.ts`).
    **Si agregás una sección nueva con ruta top-level, sumala a esa lista** o
    quedaría accesible sin login. El page del portal igual hace 404 si el slug no
    es un cliente vivo.
  - **Cookie**: `setPortalSession(slug)` guarda el slug desbloqueado (httpOnly).
    El export (`/api/plans/[id]/export.*`) valida `canAccessClientExport(slug)`:
    pasa si hay sesión interna O cookie de portal del cliente dueño del plan.
    `canWriteAsClientPortal(slug)` (mismo chequeo, nombre propio) es la barrera
    de las escrituras del portal — quien la use tiene que validar **además** que
    la entidad tocada sea de ese cliente.
- **"Marcar pagado" (Billing Tracker y Creative del portal)**: al lado del badge
  de estado, cada factura en estado **facturado** muestra un botón que con **un
  click** la pasa a **pagado** en la DB (`plan_billings.status` + `paid_at`, o
  `creative_billings.status` + `paid_at` en el tab Creative). Sin
  confirmación: es de un solo click a propósito, y se revierte desde la app
  interna ("Revertir a facturado" en el editor de billing del plan; "Revertir
  cobro" en `/creative`).
  - **UI**: `app/(portal)/[clientSlug]/portal-mark-paid.tsx` (client). Pega por
    `fetch` a `POST /api/portal/{billing,creative}/mark-paid` con
    `{clientSlug, billingId}` y hace `router.refresh()` (el portal es
    `force-dynamic`, así que el badge pasa a "pagado" solo). El prop `kind`
    (`billing` | `creative`) elige el endpoint; el resto es idéntico. Está en la
    tabla desktop **y** en las tarjetas mobile de los dos tabs.
  - **Backend**: `app/api/portal/billing/mark-paid/route.ts` y su gemelo
    `app/api/portal/creative/mark-paid/route.ts`. Tres barreras cada uno:
    (1) `canWriteAsClientPortal(slug)`; (2) ownership — la factura tiene que
    colgar de un plan **vivo** de un proyecto de **ese** cliente (creative: la
    factura tiene que ser de **ese** cliente, no archivado); si no, 404 — no
    filtra si el id existe; (3) **sólo** `invoiced → paid` (cualquier otro
    estado → 409; si ya está `paid`, responde ok — es idempotente para el doble
    click). El lifecycle sigue en la action (fuente única: validación,
    `paidAt`, auditoría y `revalidatePath` de las vistas internas):
    `transitionBillingStatus` para los planes, `setCreativeBillingPaid` para
    creative.
  - **Auditoría**: `recordAudit` acepta `actorEmail` como **fallback** cuando no
    hay sesión de Supabase (si hay user logueado, gana el user → no es
    spoofeable desde la app interna). El portal manda
    `portal-<slug>@sangria.portal`, así que en `/auditoria` el cambio aparece
    como "Portal Copa Airlines editó el billing del plan …" en vez de "Sistema".
  - **Riesgo asumido**: el gate del portal es de baja seguridad a propósito
    (password compartido `sangriaagency` + usuario = slug/nombre del cliente),
    así que cualquiera con el link y el password de ese cliente puede marcar sus
    facturas como pagadas. Se acotó al mínimo: una sola transición, sólo hacia
    adelante, scopeada al cliente, auditada y reversible desde la app interna.
  - **Sin cambios de schema**: reusa `plan_billings.status`/`paid_at` y
    `creative_billings.status`/`paid_at`. No requiere acción en prod.
  - **Ojo con la caché**: `BillingSection` y `CreativeSection` leen **directo**,
    sin `unstable_cache`, justamente porque tienen esta escritura. La
    invalidación desde un route handler no puede usar `updateTag` (sólo corre en
    Server Actions) y cae a `revalidateTag(tag, "max")`, que es
    stale-while-revalidate: cacheadas, el `router.refresh()` del click podría
    devolver la factura todavía "facturada", como si no se hubiera guardado.
- **Pacing del portal (Proyectos)**: cada campaña tiene un toggle "Ver pacing"
  (URL-based vía `?plan=<ids>` separados por coma → **varios expandidos a la
  vez**). El filtro **multi-select de campañas** (`?camp=<ids>`,
  `components`/`portal-filters.tsx`) busca por nombre y, cuando hay campañas
  elegidas, **la selección manda** (ignora estado/origin/rango de fechas para que
  no las esconda). El bug del "Ver pacing" que perdía `pstatus` (volvía a Abiertos
  y no mostraba el pacing de campañas cerradas) se arregló en `hrefWith`
  (preserva `pstatus` + `camp` + el rango de fechas `pfrom`/`pto`).
- **Orden de la lista (`?psort=`)**: el tab Proyectos se puede ordenar por
  **fecha**, **monto** y **nombre**, en las dos direcciones (el select "Ordenar"
  del filtro lista primero la de *mayor a menor*). Default `""` = **nombre A→Z**.
  Values: `nombre_desc` · `fecha_desc` · `fecha_asc` · `monto_desc` · `monto_asc`
  (los valida `resolveProjectSort` en `portal-content.tsx`; un valor basura cae
  al default). Es **URL-based y server-side**, no client-side como el orden de
  `/planes` y `/proyectos`: la sección es un server component y cada campaña
  puede expandir su pacing, que también se resuelve en el server.
  - **Monto** = suma de las campañas **visibles** del proyecto (las que quedaron
    después de los filtros), que es lo que el cliente ve en pantalla. **Fecha** =
    inicio del período del proyecto (`projectPeriod` sobre sus planes visibles),
    con fallback al fin; los proyectos **sin fechas van siempre al final**, en
    las dos direcciones. Desempate por código.
  - El orden se aplica **después** de filtrar y **antes** de armar
    `visiblePlanIds`, así el **Excel de pacing sale en el mismo orden que la
    pantalla** (regla dura de `AGENTS.md`: el export espeja la vista).
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

### Creative (`/creative`)
- **Qué es**: la facturación del trabajo **creativo**, separada de la de medios.
- **Por qué tabla propia (`creative_billings`)**: el creativo se factura por
  campaña pero **no tiene media plan** — ni publishers, ni placements, ni fees
  prorrateados. Meterlo en `plan_billings` (que cuelga de `media_plans` con
  `unique(media_plan_id, month)`) obligaría a inventar planes vacíos. Por eso
  vive aparte. Reusa el enum `billing_status`, pero en la práctica sólo se usan
  `invoiced` (emitida) y `paid` (cobrada).
- **Columnas**: `invoice_number` (único), `campaign_code` (el código tal cual
  viene del Excel, ej. `COPA.c1055.MejoresTarifasCreative`), `project_name`
  (nombre legible, nullable), `month`, `invoice_date`, `amount_usd`, `status`,
  `paid_at`.
- **La vista**: panel para **cargar una factura** (arriba de todo), 3 KPIs
  (total facturado / cobrado / pendiente), chart de barras apiladas por mes
  (cobrado vs pendiente, `components/creative-chart.tsx`) y la tabla con
  **botón de cobro inline** que hace `invoiced ↔ paid`
  (`components/creative-table.tsx` + `app/actions/creative-billing.ts`).
  Filtro de estado URL-based (`?status=invoiced|paid`) y respeta el filtro
  global de cliente (`?client=`).
- **Cargar una factura** (`components/creative-invoice-form.tsx` +
  `createCreativeBilling` en `app/actions/creative-billing.ts`): hasta acá las
  facturas entraban **sólo por SQL a mano** (`db/creative-billings.sql`). El
  panel pide cliente · N° de factura · mes · monto (obligatorios) y proyecto ·
  código de campaña · fecha · estado · notas (opcionales). El cliente arranca en
  el del filtro global si hay uno activo, y el select lista **todos** los
  clientes vivos (no sólo los que ya tienen creative), así el primero de un
  cliente nuevo se puede cargar. Después de guardar el panel **queda abierto** y
  conserva cliente + mes + estado: así llegan, por tanda mensual.
  - **Qué valida la action** (la UI sólo muestra el error): `invoice_number`
    único —pre-chequeo para el mensaje en castellano **y** captura del 23505,
    porque entre el select y el insert se puede colar otra carga—, `month` con
    formato `YYYY-MM` (la columna es `varchar(7)` sin constraint: un "2025-13"
    rompería el chart y el orden en silencio), monto > 0, fecha `YYYY-MM-DD` y
    cliente vivo. Alta como **cobrada** setea `paid_at`. Queda auditada
    (`entity_type = creative_billing`, `action = create`).
  - **Editar o borrar una factura sigue siendo SQL a mano.** Desde la UI sólo se
    carga y se cobra/revierte el cobro.
  - **Sin cambios de schema**: escribe en las columnas que ya existen. **No
    requiere acción en prod.**
- **En el portal del cliente**: tab **Creative** (`CreativeSection` en
  `app/(portal)/[clientSlug]/portal-content.tsx`), con los mismos 3 KPIs, el
  mismo chart y la tabla de facturas. Es **genérico para cualquier cliente** —
  el tab está siempre y muestra lo que ese cliente tenga cargado; sin facturas,
  muestra su vacío. El cliente ve **sólo facturas emitidas** (`emittedOnly` en
  `getCreativeBillings`: un `draft` es trabajo interno) y puede marcarlas
  pagadas con el mismo botón del Billing Tracker (`kind="creative"`).
- **Ojo**: `/creative` es ruta top-level, así que está sumada a
  `RESERVED_TOP_LEVEL_SLUGS` (`lib/client-portal.ts`). Sin eso el proxy la
  trataría como portal de cliente y quedaría accesible sin login.

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
- **Export a Excel** (`GET /api/portal/analysis.xlsx?client=<slug>&pub=&mkt=&bo=&from=&to=`):
  botón "Descargar Excel" en el header de la tabla de Activaciones (ambas
  vistas). Baja **la data filtrada que se está viendo** (mismos params URL que
  la vista) en dos hojas con el look de marca: **Detalle** (una fila por
  activación: campaña, mercado, budget origin, proyecto, publisher, período,
  inversión + TOTAL, con autofiltro y los filtros aplicados en el header) y
  **Por mercado** (el agregado del mapa + fila "Sin mercado" para que el total
  reconcilie). Thin handler → `lib/portal-analysis-xlsx.ts`; público en el
  proxy (`/api/portal/*`), barrera real `canAccessClientExport`. Para esto
  `getMarketActivations` expone también `budgetOriginName` (leftJoin a
  `budget_origins`).
- **Mapa** (`components/americas-map.tsx`): **Leaflet** (tiles reales de CARTO,
  zoom/pan nativos). Se importa **dinámico dentro de un effect** (vanilla
  Leaflet, sin react-leaflet) para no tocar `window` en SSR. Cada mercado es una
  burbuja `divIcon` (tamaño = inversión, número = activaciones, gradiente de
  marca) con tooltip y click→filtra. El mapa se auto-`fitBounds` a los mercados
  visibles (zoom a lo filtrado) y llena el ancho de su columna. Tiles
  `light_all`/`dark_all` según el tema. Estilos de la burbuja: `.mkt-bubble` en
  `globals.css`. (Antes era un SVG propio con d3-geo; se cambió a Leaflet por
  robustez de zoom/escala.)
- **Color por nivel del mercado**: las burbujas de **nivel país** (un país
  entero) se pintan **azul** (`.mkt-bubble--country`) para diferenciarlas de las
  de **ciudad/región** (bordó, default). El nivel lo infiere `resolveMarketGeo`
  por CÓMO matcheó: match **exacto** a una key país → `country` (tolerando el
  sufijo de la nomenclatura: `Argentina (País)` → `argentina-pais` → `argentina`
  — sin eso, el país entero salía pintado como ciudad); key de plaza →
  `city`; match por **token** dentro de un país (ej. "México - Cancún") →
  `city`; agrupaciones (LATAM/…) → `region`. Leyenda debajo del mapa
  (País · Ciudad/región).
- **Geocoding de mercados (todo en la UI, sin tocar la DB)**: los `markets` son
  nombres/slugs libres sin coordenadas. `lib/market-geo.ts` (`resolveMarketGeo`)
  resuelve por (1) match exacto normalizado y (2) match por **token** — una
  clave conocida que aparece como palabra dentro del nombre, así
  "Estados Unidos - Varios" → `estados-unidos`. Entre varios tokens que
  matchean **gana el más específico** (plaza > región > país, y a igualdad el
  más largo): sin eso `Estados Unidos - California` caía en el centroide de
  EE.UU. en vez del de California. Cubre países LATAM + agrupaciones
  (`centroamerica`/`latam`/…) + las **plazas** del diccionario de
  `lib/market-nomenclature.ts` — ciudades (Ciudad de México, Bogotá, Miami…) y
  los 50 **estados de EE.UU.**, todas con `kind: "city"` porque world-atlas no
  tiene siluetas sub-nacionales a las que fitear el zoom. Cada plaza tiene su
  propio centroide, así que dos plazas del mismo país ya no apilan sus burbujas
  en el mismo punto. Devuelve además `level` (país/ciudad/región, ver arriba). Los no reconocidos se listan aparte ("Sin ubicación en el mapa").
  **Para sumar/ajustar un mercado, editá `GEO` en `lib/market-geo.ts`**
  (centroide + `feature` = nombre del país en world-atlas).
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

Es colapsable; notas/fees se omiten (sí salen en el Excel/PDF) y la **audiencia
aparece al hacer hover** sobre el nombre del placement (ver abajo). La edición
sigue en la grilla + inspector; el preview es solo visualización. (Una
"planilla 100% editable" se evaluará aparte en otra branch.)

### Audiencia al hover (vista del plan)

En la vista del plan, dejar el mouse quieto sobre el nombre de un placement
—tanto en la **planilla** como en la **vista previa tipo Excel**— abre un
cuadrito con su **audiencia** (`components/audience-hover-card.tsx`). Antes ese
dato sólo se veía abriendo el inspector placement por placement.

- **Delay de 2s** a propósito: la planilla se recorre con el mouse todo el
  tiempo (seleccionar filas, editar montos) y un tooltip instantáneo sería
  ruido. Sólo aparece si el mouse se queda quieto ahí.
- `pointer-events: none` → nunca intercepta un click ni tapa un input; la fila
  se sigue seleccionando normal.
- `position: fixed` con coordenadas calculadas del ancla (misma técnica que el
  menú contextual de `aux-sheet.tsx` y el "Más ▾" del top-nav): dentro de las
  tablas, un `absolute` quedaría recortado por el `overflow`. Si no entra
  abajo, el cuadrito **flipea arriba**; se clampea contra el borde derecho.
- Un ícono chiquito de audiencia (`Users`, `lucide-react`) al final de la celda
  marca qué placements tienen audiencia cargada. Sin audiencia el cuadrito
  igual aparece, diciendo "Sin audiencia cargada" (que falte también es dato).
- Se cierra solo al salir, al scrollear, al clickear y al redimensionar la
  ventana — nunca queda flotando desanclado de su fila.

### Rutas

**Por qué el historial de versiones va al Excel y NO al PDF**: el PDF del plan
es el **documento que se manda al cliente a firmar** (tiene bloque de firma y
disclaimer legal). El historial de versiones y el QA son **proceso interno**:
meterlos ahí ensuciaría un entregable del cliente con información que no le
corresponde. El Excel, en cambio, es la copia de trabajo del equipo y sí espeja
la pantalla completa (regla dura de `AGENTS.md`). Si algún día el PDF deja de
ser el documento de firma, revisar esta decisión.

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
  del plan y, si el plan tiene **Notas** cargadas, una fila `Notas` con el mismo
  texto que muestra el editor — la fila se estira y envuelve si es multilínea;
  el export espeja la pantalla); tabla con columnas base (publisher/placement, market, start, end,
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
- **Tab 3 "Historial de versiones"**: espejo del desplegable del editor (regla
  dura de `AGENTS.md`: el Excel muestra también lo que está detrás de los
  expandibles de la pantalla desde donde se descarga). Una sección por versión
  aprobada — fecha, resumen del cambio, QA de esa versión (quién lo cerró,
  cuándo, cuántas líneas), totales antes→después — y una fila por cambio, con
  columnas `Versión · Fecha · Sección · Detalle · Antes · Después`. El diff sale
  de `lib/plan-version-diff.ts`. **Solo en el export del plan vigente**: un
  export con `?v=N` representa el plan tal como se aprobó en esa versión, y
  listar versiones posteriores adentro sería engañoso.
- **Tabs 4+ — Tabs auxiliares (uno por cada tab creado en el plan)**: las
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
- **`max: 3` por instancia** (03/sep/2026). Historial: 3 → 8 (22/may) → 3
  (02/sep, #248) → 1 (02/sep, #254) → **3**. Por qué había bajado a 1: el pool
  vive en scope de módulo, sobrevive entre invocaciones de la misma instancia, y
  Vercel no la mata al terminar el request sino que la **congela** — una
  instancia congelada no ejecuta timers, así que `idle_timeout` nunca dispara y
  sus conexiones quedan abiertas del lado de Supabase (`ClientRead`). Con
  `max: N`, cada instancia caliente retiene hasta N slots.
- **Por qué volvió a 3, y el supuesto que era falso.** El comentario de este
  archivo decía *"Vercel sirve un request por instancia a la vez, así que no se
  pierde concurrencia"*. Aunque eso valga ENTRE requests, no vale **dentro** de
  uno: una página dispara 4-16 queries y con `max: 1` todas comparten un solo
  socket. Las que no entran se encolan en la cola **local** de postgres.js, que
  no tiene timeout propio, y morían contra el reloj del cliente sin haber
  salido. Medido el 03/sep con `pg_stat_statements` reseteado y una carga de
  `/dashboard`: **21 ms** de trabajo real (20,48 + 0,98) y aun así la vista
  fallaba, porque **dos de las cuatro queries nunca llegaron a Postgres** — no
  figuraban en `pg_stat_statements`. Los 8 segundos se iban en la fila.
  Reproducido en `npm run test:db`: con `max: 1` morían 5 de 5 queries en
  contención; con 3, sobrevive 4 de 5.
- El **techo de concurrencia no está acá**: es el *Connection pool size* de
  Supavisor (**25** desde el 02/sep/2026, era 15). En modo transacción cada
  query **en vuelo** ocupa un slot, y como duran ~20 ms se liberan enseguida:
  con `max: 3` hacen falta 9 instancias calientes simultáneas para agotarlo.
  Ver "Los números del pooler" más arriba.
- `idle_timeout: 20`, `connect_timeout: 10`,
  `connection.statement_timeout: 10s` (`STATEMENT_TIMEOUT_MS`).
- **TRES FASES, no dos** (`db/index.ts`). postgres.js **pipelinea**: cuando no
  hay conexión libre no encola, le pasa la query a una conexión ocupada
  (`index.js`, `busy.length ? go(busy.shift(), query)`), que la escribe al
  socket igual y setea `q.state` (`connection.js`, `q.state = backend`). O sea
  que **`state != null` NO significa "el server está trabajando en esto"**. La
  señal que sí lo dice es `q.active`, que se pone en `true` sólo para la query
  que la conexión está atendiendo, y la promueve el `ReadyForQuery` cuando
  termina la anterior. De ahí las tres fases, cada una con su reloj, que arranca
  cuando la query **entra** en esa fase:

  | Fase | Estado | Reloj | Al vencer |
  |------|--------|-------|-----------|
  | `cola` | `!state` — en la cola local, nunca salió | 6s | `cancel()` **local**, no toca el server. Reintentable siempre, incluso escrituras. |
  | `pipeline` | `state && !active` — salió, espera a sus hermanas | 6s | **No se toca la conexión**: está sana y ocupada; cerrarla mataría a las hermanas. Se suelta la espera y postgres.js lee la respuesta cuando llegue. |
  | `ejecucion` | `state && active` — el server está en esta query | 12s | **Se cierra la conexión** (`discardPoisonedConnection`). Único caso que lo hace. |

- **El reloj de ejecución (12s) es a propósito MAYOR que el `statement_timeout`
  del server (10s).** Así el que corta una query lenta es SIEMPRE Postgres, que
  contesta un `57014` por la misma conexión y la deja limpia y reusable. Si
  ganara nuestro reloj habría que cerrar el socket — que es lo que fabricaba
  zombies. Invertir ese orden convierte el camino normal de falla en uno que no
  rompe nada. Fijado en `npm run test:db`, caso 2.
- **El reintento resuelve el cliente en CADA intento, no lo captura.** Era un
  bug: `resilientQuery` capturaba el cliente en un closure, así que si en el
  medio `discardPoisonedConnection` lo cerraba, postgres.js rechazaba al toque
  (`handler()` hace `if (ending) return query.reject(CONNECTION_ENDED)`, y
  `ending` **nunca se resetea**). El "segundo intento" fallaba en 0 ms sin tocar
  la red, o sea que `MAX_ATTEMPTS = 2` valía 1 — y ése era el
  `CONNECTION_ENDED ...pooler.supabase.com:6543` de los logs: **nos lo hacíamos
  solos, no lo tiraba el pooler.**
- **`discardPoisonedConnection` recibe el cliente**, no lo saca de `_rawClient`.
  Antes cerraba el cliente *actual*, que no tiene por qué ser el dueño de la
  query que venció: si otro timeout ya lo había reemplazado, cerraba una
  conexión **sana** y dejaba la envenenada abierta.
- **Presupuesto.** El peor caso tiene que quedar por debajo del `maxDuration` de
  la página (45s): si Vercel mata la función antes de que se lance el error, la
  instancia se congela con la conexión abierta y vuelve la espiral del 02/sep.
  Sólo la fase `cola` es reintentable siempre y vence a los 6s, así que el peor
  caso es `cola(6s) + backoff(0,3s) + [cola(6s) + pipeline(6s) + ejec(12s)]` =
  **30,3s**, más el auth (8s) — por debajo de 45s.
  conexiones colgadas. Ver HANDOFF 02/sep/2026 (3).

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
  Desde el 02/sep/2026 el código además manda `connection.statement_timeout`
  (12s) al abrir la conexión, así que el tope existe aunque el `ALTER ROLE`
  no se haya corrido.
- `enumerateMonths` blindado contra fechas malformadas (no más loop infinito).
- `max: 3` conexiones por instancia (era 1; ver "Pool de conexiones").

#### Si la app se cuelga: QUÉ MEDIR PRIMERO

No teorizar. En el SQL Editor, con la app colgada:

```sql
select
  (select count(*) from pg_stat_activity
    where datname = current_database() and state = 'active')             as activas,
  (select round(100.0 * sum(blks_hit) / nullif(sum(blks_hit + blks_read), 0), 1)
     from pg_stat_database where datname = current_database())           as cache_hit_pct,
  (select count(*) from pg_stat_activity
    where datname = current_database() and state = 'active'
      and wait_event = 'ClientRead'
      and now() - state_change > interval '2 minutes')                   as zombies;
```

Cómo leerlo:

- **`cache_hit_pct` ≈ 100 y `activas` bajo** → Postgres está sano y ocioso. El
  problema NO es la base, ni su CPU, ni el volumen de datos: es el pooler o la
  app. (Se descartaron las tres el 02/sep/2026.)
- **`zombies` > 0** → conexiones `active/ClientRead` de funciones que ya
  murieron. Cada una se come un slot y no vuelve sola. Hoy no deberían
  aparecer: el código cierra la conexión al vencer una query (ver "Pool de
  conexiones"). Si vuelven a aparecer, algo la está abandonando otra vez.
- **`cache_hit_pct` < 95** → ahí sí la instancia se queda corta de RAM.

#### Incidente del 02/sep/2026: la espiral completa (y qué NO era)

Con todo lo de arriba aplicado, la app se seguía colgando **horas**. La cadena
real tiene cinco eslabones, y hace falta cada uno para que sean horas y no
segundos. Detalle y cronología en HANDOFF → "Cambios de la sesión 02/sep/2026".

1. **La cola de postgres.js no tiene timeout.** Sin conexión libre, la query se
   encola y espera para siempre (`src/index.js`, `handler`). `statement_timeout`
   es server-side (no hay statement corriendo) y `connect_timeout` no aplica (la
   conexión ya está abierta). El render esperaba hasta que Vercel mataba la
   función.
2. **Una función que muere con la query en vuelo deja su conexión colgada en el
   pooler**: `active` / `Client:ClientRead`, esperando a un cliente que ya no
   existe, ocupando un slot **para siempre**. Ningún timeout de Postgres la
   reapea (`idle_in_transaction_session_timeout` no aplica porque el estado es
   `active`). Menos slots → más colas → más funciones muertas → más zombies.
3. **Saturación**: prefetch de las 13 secciones en cada carga (TopNav + Sidebar)
   y de cada fila de las tablas; `max: 8` por instancia contra ~15 slots;
   **ninguna FK indexada** (Postgres no las crea solas).
4. **La página del plan** traía el `snapshot_json` de todas las versiones y
   scaneaba `audit_log` en cada render.
5. **El primer fix empeoró el punto 2**: el reintento sumaba 45,8s contra un
   `maxDuration` de 45 → Vercel mataba la función antes de que se lanzara el
   error, con la conexión abierta. Fabricaba zombies.
6. **Y el timeout mismo era la fábrica de zombies** (encontrado el 02/sep/2026
   por la noche, midiendo prod): al vencer una query ya enviada la
   abandonábamos, dejando la conexión en vuelo → `active/ClientRead` eterno.
   Con Supavisor manteniendo UNA conexión contra Postgres, una sola alcanzaba
   para tapar todo. Hoy se cierra la conexión. Ver HANDOFF 02/sep (3).

**Descartado con evidencia**: locks (`pg_blocking_pids` = 0), zombies como
causa raíz (eran 0 cuando fallaba: son consecuencia del punto 5), volumen de
datos (son chicos).

**Lo que hay hoy en `db/index.ts`** (sobre el cliente postgres.js):

- **Timeout de cliente en TRES FASES** —- `cola` 6s, `pipeline` 6s,
  `ejecucion` 12s —- y **reintento** `MAX_ATTEMPTS = 2` (backoff 300ms). La
  fase la decide `query.state` + `query.active`; ver la tabla en "Pool de
  conexiones". Se reintenta siempre la fase `cola` (la query no salió, ni
  siquiera si escribe) y, en las otras dos, sólo las lecturas (`select`).
  El reintento **resuelve el cliente de nuevo**: capturarlo hacía que un
  descarte previo lo dejara inútil.
- **Invariante**: peor caso 30,3s, **por debajo del `maxDuration`** (45s), con
  8s más de auth. `EXEC_TIMEOUT_MS (12s) > STATEMENT_TIMEOUT_MS (10s)` a
  propósito, para que las queries lentas las corte Postgres con un 57014 y la
  conexión quede reusable.
  Si la suma se pasa, la función muere antes del error y vuelve el punto 2.
- **Sólo se cancela lo que nunca salió.** postgres.js pipelinea varias queries
  sobre una conexión, y el cancel de una pipelineada va con el backend key de
  la conexión: **puede matar a una query hermana** (reproducido en local). Las
  que ya salieron no se cancelan ni se reintentan: para ésas está el
  `connection.statement_timeout` de 12s del server.
- Las transacciones (`db.transaction`) quedan fuera a propósito.

**Fuera de `db/index.ts`**: `lib/supabase/fetch-with-timeout.ts` le pone
`AbortSignal.timeout(8s)` a `auth.getUser()` (proxy + layout) — era la única
llamada de red del render sin tope; `db/fk-indexes.sql` (12 índices, aplicado);
`maxDuration = 45` en `app/(app)/layout.tsx`; **`prefetch={false}` en TODOS los
`<Link>` de `app/` y `components/`** (84 links en 39 archivos, 03/sep/2026 — el
tratamiento del 02/sep sólo había llegado a las dos navs y a las tablas de
proyectos y planes, y quedaban afuera campaign-tracker, billing-tracker,
clientes, auditoría, configuración y reportes). El log de Vercel del 03/sep
muestra por qué: entre las 13:04:12 y las 13:04:16, **7 páginas de detalle de
`/campaign-tracker` renderizadas a la vez** por prefetch de las filas de la
tabla. Regla: en esta app un `<Link>` nuevo va SIEMPRE con `prefetch={false}`

Diagnóstico de zombies (SQL Editor). Contar:
```sql
select count(*) as zombies,
       round(max(extract(epoch from now() - xact_start))) as la_mas_vieja_seg
from pg_stat_activity
where datname = current_database()
  and wait_event = 'ClientRead'
  and xact_start < now() - interval '1 minute';
```
Matar (sólo backends esperando a un cliente hace más de 2 minutos):
```sql
select pid, pg_terminate_backend(pid) as terminada
from pg_stat_activity
where datname = current_database()
  and pid <> pg_backend_pid()
  and wait_event = 'ClientRead'
  and xact_start < now() - interval '2 minutes';
```
Si vuelven a acumularse con el código actual, el paso siguiente es un reaper
con `pg_cron` (función probada en local, ver HANDOFF → Pendientes).

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

- **Permisos por rol**: hay autenticación (Google OAuth, sangria.agency-only —
  ver "Auth" arriba), RLS cierra la REST API pública de Supabase, y desde el
  02/sep/2026 hay **modelo de roles**: `app_users` + Configuración → Usuarios y
  roles (Admin, Aprobador, Media Planner, Account Manager, Finance, Viewer).
  Se auto-puebla con quien entra (upsert throttleado en `getCurrentUser`).
  **Lo que el rol gobierna HOY**: aprobar un plan (ready_to_send → approved,
  Admin/Aprobador) y el acceso a la sección de usuarios (Admin). Para el resto
  de las áreas el rol queda registrado pero **todavía no restringe**: cualquier
  usuario logueado del dominio sigue teniendo acceso. `canApprovePlans` es
  **async** y lee el rol, con la allowlist de `lib/permissions.ts` como red de
  seguridad si la tabla no existe o la lectura falla. El chequeo real está en la
  server action `transitionPlanStatus`; el editor sólo esconde el botón.
  **El QA del plan (`approved` → `qa_done`) y el pase a `live` NO están
  restringidos**: los hace cualquier usuario logueado, como se pidió ("el
  planner hace el QA, y después cualquiera lo marca Live"). Igual queda
  registrado **quién** tildó cada línea y **quién** cerró el QA
  (`media_plan_qa_checks` / `media_plan_qa_runs`), así que si más adelante se
  quiere limitar el QA a un rol Planner, el dato para auditarlo ya existe.
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
- **Nomenclatura de mercados**: resuelto. Taxonomía única para todos los
  clientes (`<País> (País)` / `<País> - <Plaza>` / `<País> - Varios` /
  `<Región>`), el alta y la edición son un selector y no un input de texto, y
  `db/markets-nomenclatura.sql` normalizó y fusionó lo que ya había. Lo que
  **queda abierto**: los mercados que la migración no pudo mapear con certeza
  (nombres ambiguos como "Santiago" —Chile o RD— y los que no son un lugar,
  tipo "Q3 Boosting") siguen como estaban y hay que resolverlos a mano desde
  `/configuracion/clientes/[slug]#mercados`; el bloque 1 del SQL los lista con
  la etiqueta `SIN MAPEAR`.
- **Nombres de mercado tipeados dentro de texto libre**: ningún rename los
  alcanza. `media_plan_placements.placement_name` / `.audience` / `.notes_md` y
  `media_plan_aux_sheets.grid_json` pueden decir el nombre viejo de un mercado
  renombrado (hay precedente: las líneas de Félix llevan el tier en el nombre
  del placement). Se revisan a ojo — el bloque 3.e de
  `db/markets-nomenclatura.sql` deja la query.
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
  con fecha de envío + fecha objetivo, filtros de **Año** y **Mes** y un filtro
  de texto libre por proyecto o campaña (`getSentReports` en
  `db/queries/reports.ts`). Los de año/mes van por **fecha de envío**
  (`delivered_at`, la misma que muestra "Enviado el"), arrancan en el **año y
  el mes en curso** y tienen "Todos" los dos; el de Mes vive adentro del año
  elegido (con año "Todos" queda deshabilitado, así "Ago" no mezcla agosto de
  todos los años). Se combinan con el buscador y el contador del header muestra
  `visibles / total`. Cada fila tiene un
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
- **Drive integration**: sólo el **link a la carpeta del proyecto**
  (`projects.drive_folder_url`, ya existía en el schema pero no se usaba). Se
  carga al crear el proyecto (`/proyectos/nuevo`) o después desde "Editar
  proyecto", y el detalle del proyecto muestra un botón **"Carpeta de Drive"**
  que la abre en una pestaña nueva. Sin link no hay botón: se avisa dónde
  cargarlo en vez de dejar un botón muerto. La URL se normaliza y valida con
  `normalizeExternalUrl` (`lib/external-url.ts`) — agrega `https://` si falta y
  rechaza esquemas que no sean http/https (el campo se renderiza como `href`).
  Integración real con la API de Drive (listar/crear archivos): sigue fuera del
  scope.
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
