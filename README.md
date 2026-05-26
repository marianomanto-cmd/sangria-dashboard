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
- **Tailwind v4** con `@theme` block (paleta `stone` + accent `#7a1f3d`).
  Dark mode class-based (`.dark` en `<html>`): los tokens se redefinen
  bajo `.dark` en `globals.css` así toda utility swappea sola.
- **Drizzle ORM 0.45** sobre Postgres (Supabase)
- **postgres-js** como driver
- **lucide-react** para íconos
- **recharts** para el chart de facturación
- **ExcelJS** + **pdf-lib** para exports

---

## Estructura del proyecto

```
app/
  login/                    # /login — botón "Continuar con Google" (público)
  auth/
    callback/route.ts       # OAuth callback: exchange + valida @sangria.agency
    signout/route.ts        # POST → cierra sesión
  (app)/                    # layout principal (Sidebar + Topbar) — todo requiere login
    layout.tsx              # force-dynamic → ninguna page se prerenderea
    page.tsx                # Dashboard
    clientes/               # /clientes y /clientes/[slug]
    proyectos/              # /proyectos, /proyectos/[code]/*, /proyectos/nuevo
      [code]/planes/[planId]/
        editor.tsx          # editor del plan (publishers + placements + fees)
        billing/            # editor de facturación mensual
    planes/                 # /planes — vista cross-proyectos
    billing/                # /billing — lista de facturas con filtros (origin/project/range) + click-to-edit
    billing-tracker/        # /billing-tracker — vista jerárquica proyecto → planes → facturas emitidas con desglose media/fee
    campaign-tracker/       # /campaign-tracker — hub con filtro vigentes/concluidos/todos + vista de carga de consumo real vs goal
      [planId]/             # vista de carga: tabla editable (autosave) + chart de progreso
    auditoria/              # /auditoria — log legible + papelera (/auditoria/papelera)
    configuracion/
      markets/, metricas/     # accesos a catálogos per-cliente
      clientes/               # alta/edición de clientes + config per-cliente (publishers, métricas, mercados, budget origins)
      papelera-planes/        # papelera de planes borrados (soft delete) + restaurar
    reportes/
      page.tsx              # placeholders de los 6 reports analíticos
      calendario/           # Reporting Calendar (closed → reportado)
  api/
    plans/[planId]/
      export.xlsx/route.ts  # XLSX del plan (logo + firma + disclaimer + todas las métricas)
      export.pdf/route.ts   # PDF del plan (thin handler → lib/plan-pdf.ts)
  actions/                  # Server Actions (CRUD)
    plans.ts, plan-billing.ts, projects.ts, markets.ts, metrics.ts, publishers.ts,
    budget-origins.ts, clients.ts, reports.ts, campaign-tracker.ts
  globals.css

components/                 # UI compartida
  theme-toggle.tsx          # toggle claro/oscuro (clase .dark en <html>)
  skeleton.tsx              # placeholders shimmer para loading states
db/
  schema.ts                 # tablas + enums
  index.ts                  # cliente Drizzle (lazy con Proxy + Transaction Pooler)
  rls.sql                   # ENABLE ROW LEVEL SECURITY en todas las tablas (cierra la REST API pública de Supabase)
  queries/
    dashboard.ts            # KPIs, proyectos+planes, monthly chart, estimación
    project-detail.ts       # detalle de proyecto + plan
    client-detail.ts        # detalle de cliente con timeline
    clients.ts, billing.ts, billing-tracker.ts, audit-log.ts, budget-origins.ts,
    reports.ts, campaign-tracker.ts, plan-trash.ts (planes borrados),
    pendings.ts (tablero de pendientes del dashboard)
scripts/
  seed.ts                   # datos de demo (4 clientes)
  db-check.mjs, db-reset.mjs
lib/
  format.ts                 # formatUsd, formatPct, formatUsdCompact + inputs US: formatIntInput / formatAmountInput / parseNumberInput
  i18n.ts                   # Language type + formatDate/formatMonth + dictionary `t`
  brand-logo.ts             # carga el logo de marca (public/sangria-logo.png|jpg) + dimensiones, para los exports
  plan-metrics.ts           # evalFormula + placementMetricValue + resolveMetricColumns (compartido PDF/Excel)
  plan-pdf.ts               # renderPlanPdf(detail, allMetrics): PDF apaisado con tabla de métricas
  client-filter.ts          # helpers puros del filtro global ?client=slug
  client-filter.server.ts   # resolver server-only slug → {id, slug, name, language}
  cost-methods.ts           # mapping cost method → métrica principal
  campaign-metrics.ts       # Campaign Tracker: métricas calculadas + pace + buildMetricRows
  audit.ts                  # recordAudit() — wrapper para insertar en audit_log con autor
  audit-format.ts           # entityNoun / actionVerb / entityLabel / actorLabel / formatRelativeDateTime
  auth.ts                   # getCurrentUser() (server-side)
  supabase/
    server.ts               # cliente Supabase para Server Components / route handlers
    client.ts               # cliente Supabase para Client Components
    middleware.ts           # updateSession() — usado por proxy.ts (route protection)
proxy.ts                    # Next.js 16: ex-middleware.ts. Auth gate global.
public/
  sangria-logo.png          # logo de marca para los exports (PDF/XLSX). Ver "Exports del plan"
next.config.ts              # outputFileTracingIncludes del logo para las rutas de export
```

---

## Arquitectura: convenciones clave

### Cifras numéricas: SIEMPRE formato US
- Punto = decimales, coma = separador de miles (ej: `15,000.00`, `1,500,000`).
  Nunca usar `Intl.NumberFormat("es-AR")` para cifras (la coma decimal de es-AR
  rompe el round-trip de los inputs editables).
- Todo input numérico editable muestra el valor con `formatIntInput` /
  `formatAmountInput` (`en-US`) y parsea lo tipeado con `parseNumberInput`
  (descarta la coma de miles, conserva el punto decimal) — todo en `lib/format.ts`.
- Para inputs nativos usar `<input type="number">` (su `.value` ya es US,
  independiente del locale del browser), como hace el simulador.

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

### El plan vive dentro del proyecto, peer con otros planes
- Un proyecto puede tener N planes en paralelo (no son versiones de uno).
- Cada plan tiene su propio lifecycle: `draft` → `ready_to_send` → `approved` → `archived`.
- Los planes pueden solapar fechas y estar todos `approved` al mismo tiempo.

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

### Cost method principal por placement
- `media_plan_placements.cost_method` (dCPV, dCPC, dCPM, etc.) marca la
  **métrica principal** del placement. Mapping en
  [`lib/cost-methods.ts`](lib/cost-methods.ts) (`COST_METHOD_PRIMARY_METRIC`):
  `dCPV→views`, `dCPM→impressions`, `dCPC→clicks`, etc.
- El editor permite ingresar **rate** o **delivery** indistintamente (el
  banner principal calcula el otro automáticamente).
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
  goals. Las métricas calculadas (CPM, CTR, CPV, CPA, frequency) se derivan
  on-the-fly para goal y real con las fórmulas de `lib/campaign-metrics.ts`.
- "Plan vigente" en el hub = `status='approved'` Y la fecha de hoy cae
  dentro del período derivado (min/max de fechas de placements).
- Solo se persisten métricas direct (`amount` + claves de
  `DIRECT_METRIC_RATES`), tanto en la capa viva como en los snapshots. El
  sistema es independiente de Billing / Gastos Reales aunque haya
  solapamiento conceptual con la inversión.

### Estimación de facturación
- `getBillingEstimate` en `db/queries/dashboard.ts` prorratea linealmente
  placements y fees de planes `approved` / `ready_to_send` sobre sus meses
  activos y resta lo ya facturado en cada mes (status `sent`/`paid`).
- Devuelve **separado media de fees**: `grossMediaUsd` (placements) y
  `grossFeesUsd` (management/setup/reporting/custom). Lo mismo para el
  facturado (`alreadyBilledMediaUsd` viene de `plan_billing_publishers`;
  `alreadyBilledFeesUsd` de `plan_billing_fees`). Los totales `grossUsd` y
  `alreadyBilledUsd` se siguen exportando como sumas.
- Acepta filtros opcionales: `months[]`, `budgetOriginId`, `projectId`,
  `clientId`. Los usan `/proyectos`, `/proyectos/[code]` y `/planes`.
- La UI (`components/billing-estimate-card.tsx`) renderiza 2 meses adelante
  + 1 card del **mes anterior** con "Real vs Estimado recomputado" y
  variación coloreada. El estimado del mes anterior se recomputa contra
  los planes actuales — no es snapshot histórico; sirve como sanity check
  para detectar planes modificados después de facturar.

### Tablero de pendientes del dashboard
- `getDashboardPendings(clientId)` en `db/queries/pendings.ts` arma las cuatro
  listas que muestra `components/pending-board.tsx`, debajo de la tabla de
  proyectos. Todo se deriva de columnas existentes (no hay flags nuevos):
  - **Billing reports a completar**: por cada plan `approved` (no borrado), los
    meses dentro del span de sus placements cuyo cierre ya pasó (`mes < mes
    actual`) y que no tienen fila en `plan_billings`.
  - **Tracking del día pendiente**: planes `approved` vigentes hoy (hoy dentro
    del período) cuyo `max(snapshot_date)` de `campaign_actual_snapshots` es
    anterior a hoy (o que nunca se trackearon).
  - **Entregas de reportes**: de `getReportingCalendar().inProgress` (delivery
    date asignada, sin entregar) — `upcoming` = a ≤7 días; `overdue` = ya pasó.
  - **Facturas impagas**: cualquier `plan_billings` con `paid_at` null (incluye
    draft/ready/sent/invoiced); se marcan vencidas si `due_date < hoy`.
- Cada card es colapsable (arranca cerrada) y sus filas linkean al área
  correspondiente (billing del plan, campaign tracker, calendario de reportes).
  Si una categoría está vacía muestra "Al día" en verde.

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
- **Configuración per-cliente**: publishers, métricas, mercados y budget
  origins son catálogos **per-cliente** (cada uno con `client_id`, unique
  `(client_id, slug)`) y se editan desde `/configuracion/clientes/[slug]`. No
  dependen del filtro global `?client=` — éste sólo afecta las vistas de datos
  (Dashboard, `/proyectos`, `/planes`, `/billing`).

---

## Exports del plan (PDF / Excel)

El plan se descarga en dos formatos desde el editor
(`app/(app)/proyectos/[code]/planes/[planId]/editor.tsx`, dos botones que
linkean a las rutas de abajo). Ambos comparten idioma, logo, métricas, firma y
disclaimer; difieren en el layout.

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
  libre a la izquierda del logo + project code + metadata) → Totales → **tabla**
  → Fees → **GRAND TOTAL** → firma + disclaimer → footer.
- Tabla: columnas = Publisher/Placement (flexible) + Invest (USD) + una por
  métrica (ancho y fuente 7–8pt según cantidad). Filas: subtotal por publisher
  (fondo accent-soft, **sin** tag de quién paga), placements (nombre + sub-línea
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
- **Iniciales por página**: en planes **multipágina**, cada página menos la
  última lleva `Client initials: ___` abajo a la derecha (la última conserva la
  firma completa). Se dibuja al final iterando `pdf.getPages()`, cuando ya se
  conoce el total de páginas.

### Excel (`export.xlsx/route.ts`, ExcelJS)

- **Tab 1 "Media plan"**: banner de título + metadata; tabla con columnas base
  (publisher/placement, start, end, audience, notes, cost method, investment) +
  una por métrica. Filas: subtotal por publisher (colapsable vía outline),
  placements (indentados), `TOTAL MEDIA`, sección `Fees`, `GRAND TOTAL` (INK).
  Bloque de firma + disclaimer al final. Logo anclado arriba a la derecha
  (base64).
- **Tab 2 "Budget por mercado"**: prorratea la inversión de cada placement por
  días entre los meses que cubre `[startDate, endDate]` y la agrega por
  mercado × mes (los sin fecha caen en una columna "Undated"/"Sin fecha"). Solo
  USD, sin métricas.

### i18n y decisiones

- Keys: `export.mediaPlan`, `export.totals`, `export.publishersPlacements`,
  `export.signaturePrompt`, `export.dateLabel`, `export.signatureDisclaimer`,
  `export.initials`, `common.grandTotal`, etc. (`lib/i18n.ts`).
- **No se imprime quién paga el publisher** (`agencyPays`): el tag
  `[agency pays]`/`[client pays]` se sacó del PDF (el XLSX nunca lo tuvo). El
  campo sigue en el modelo, solo no se muestra en el MP.

---

## Patrones técnicos

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

### Dashboard: sin caché (queries directas)
[app/(app)/page.tsx](app/(app)/page.tsx) corre sus 4 bloques de datos (KPIs,
proyectos, monthly, pendientes) en `Promise.all`, **sin caché**. Se probó
`unstable_cache` durante el incidente del pooler pero se sacó: no era la causa
del cuelgue (era un loop infinito en `enumerateMonths`, ver más abajo) y con la
DB chica las queries son instantáneas. La resiliencia del pooler la dan hoy
`max: 8` conexiones (ver "Pool de conexiones") + el `statement_timeout` a nivel
rol. Si en el futuro crece el tráfico, se puede reintroducir caché por cliente.

### Pool de conexiones
- `prepare: false` para Transaction Pooler (puerto 6543).
- `max: 8` por warm-instance. Da lugar a las ~12 queries concurrentes del
  dashboard sin que queueen ni se traben. (Se probó `max: 3` durante el
  incidente del pooler, pero la fuga de conexiones que motivaba bajarlo la
  causaba un loop infinito en `enumerateMonths`, ya arreglado.)
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
- **8 budget origins** repartidos (3 Copa, 2 Andina, 2 BPAC, 1 Tienda Roma).
- **Catálogos per-cliente** replicados a cada cliente: 14 mercados + 23
  métricas (11 direct + 12 calculated) cada uno, más una conversión custom
  ("Solicitudes de tarjeta") sólo en Banco Pacífico. Publishers per-cliente con
  reglas de pago variadas (Spotify = cliente paga directo en Andina, OOH =
  agencia paga override en BPAC, etc.). No hay catálogo global ni tabla puente.
- **11 proyectos** cubriendo los 4 estados (planning, active, paused, closed).
- **14+ planes peer** mezclando draft/ready_to_send/approved/archived.
- **9 plan_billings** (paid + sent + draft) para alimentar la estimación y el
  módulo de billing.

Idempotente: limpia las tablas antes de insertar.

---

## Issues conocidos / a resolver

- **Permisos por rol**: ya hay autenticación (Google OAuth, sangria.agency-only
  — ver "Auth" arriba) y RLS cierra la REST API pública de Supabase. Falta el
  modelo de roles (Account Manager, Media Planner, Finance, Viewer): hoy todo
  usuario logueado del dominio tiene acceso total dentro de la app.
- **Reportes**: `/reportes` son specs sin implementar.
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
  legal, GRAND TOTAL, PDF apaisado con tabla + iniciales por página, nombre de
  archivo `{plan}-V{versión}`.
- **Reporting Calendar** (`/reportes/calendario`): listado de proyectos
  closed pendientes de reporte + Gantt de 60 días (-30/+30 desde hoy). Una
  fila por reporte en curso con símbolos para closed/assigned/delivery y
  línea de atraso si hoy > delivery_date. Marcar entregado transiciona el
  proyecto a `reportado`. **Requiere `npm run db:push` + `npm run db:backfill-reports`**
  en prod para sembrar la nueva tabla y dar de alta los closed existentes.
  Debajo del Gantt hay un listado de **Reportes enviados** (`delivered_at != null`)
  con fecha de envío + fecha objetivo y un filtro de texto libre por proyecto o
  campaña (`getSentReports` en `db/queries/reports.ts`).
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
