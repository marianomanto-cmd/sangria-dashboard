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
npm run db:push     # Aplica el schema (db/schema.ts) sin generar migraciones
npm run db:seed     # Limpia y repuebla la DB con datos de demo
npm run db:check    # Conecta y muestra info básica de las tablas
npm run db:studio   # Abre Drizzle Studio
```

`db:push` usa `--force` (ver `package.json`). Útil para desarrollo; para
producción real conviene migrar a `db:generate` + `db:migrate`.

---

## Stack

- **Next.js 16.2.6** (App Router, Turbopack)
- **React 19.2** + TypeScript 5
- **Tailwind v4** con `@theme` block (paleta `stone` + accent `#7a1f3d`)
- **Drizzle ORM 0.45** sobre Postgres (Supabase)
- **postgres-js** como driver
- **lucide-react** para íconos
- **recharts** para el chart de facturación
- **xlsx** + **pdf-lib** para exports

---

## Estructura del proyecto

```
app/
  (app)/                    # layout principal (Sidebar + Topbar)
    layout.tsx              # force-dynamic → ninguna page se prerenderea
    page.tsx                # Dashboard
    clientes/               # /clientes y /clientes/[slug]
    proyectos/              # /proyectos, /proyectos/[code]/*, /proyectos/nuevo
      [code]/planes/[planId]/
        editor.tsx          # editor del plan (publishers + placements + fees)
        billing/            # editor de facturación mensual
    planes/                 # /planes — vista cross-proyectos
    billing/                # /billing — lista de facturas
    auditoria/              # /auditoria — log con diff
    configuracion/
      markets/, metricas/, publishers/   # admin de catálogos
    reportes/               # placeholders por ahora
  api/
    plans/[planId]/
      export.xlsx/route.ts  # XLSX del plan
      export.pdf/route.ts   # PDF del plan
  actions/                  # Server Actions (CRUD)
    plans.ts, plan-billing.ts, projects.ts, markets.ts, metrics.ts, publishers.ts
  globals.css

components/                 # UI compartida
db/
  schema.ts                 # tablas + enums
  index.ts                  # cliente Drizzle (lazy con Proxy + Transaction Pooler)
  queries/
    dashboard.ts            # KPIs, proyectos+planes, monthly chart, estimación
    project-detail.ts       # detalle de proyecto + plan
    client-detail.ts        # detalle de cliente con timeline
    clients.ts, billing.ts, audit-log.ts, budget-origins.ts
scripts/
  seed.ts                   # datos de demo (4 clientes)
  db-check.mjs, db-reset.mjs
lib/
  format.ts                 # formatUsd, formatPct, formatUsdCompact
  client-filter.ts          # helpers puros del filtro global ?client=slug
  client-filter.server.ts   # resolver server-only slug → {id, slug, name}
  cost-methods.ts           # mapping cost method → métrica principal
```

---

## Arquitectura: convenciones clave

### El plan vive dentro del proyecto, peer con otros planes
- Un proyecto puede tener N planes en paralelo (no son versiones de uno).
- Cada plan tiene su propio lifecycle: `draft` → `ready_to_send` → `approved` → `archived`.
- Los planes pueden solapar fechas y estar todos `approved` al mismo tiempo.

### Naming
- Proyectos: `<CLIENT_PREFIX>.m<id>.<ProjectName>` — ej. `COPA.m2026A01.CostaRica2026`.
- Planes: `<Project.code>.<PlanName>` — ej. `COPA.m2026A01.CostaRica2026.Awareness`.

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
  [editor.tsx](app/(app)/proyectos/[code]/planes/[planId]/editor.tsx):
  `dCPV→views`, `dCPM→impressions`, `dCPC→clicks`, etc.
- El editor permite ingresar **rate** o **delivery** indistintamente (el
  banner calcula el otro automáticamente).
- Las métricas se guardan en `media_plan_placements.metrics_json` (jsonb)
  con keys = slugs del catálogo `metrics_catalog`.

### Métricas: catálogo direct vs calculated
- `metric_kind = 'direct'` → ingresadas por el planner (impressions, clicks,
  views, conversions, etc.).
- `metric_kind = 'calculated'` → derivadas por fórmula de otras (`ctr`,
  `cpc`, `cpm`, etc.). La fórmula está en `metrics_catalog.formula`.

### Mercados como catálogo editable
- `markets` puede tener países (`costa-rica`, `panama`) o agrupaciones
  (`centroamerica`, `latam`). Editable desde `/configuracion/markets`.
- `media_plan_placements.market_id` es FK con `ON DELETE SET NULL`.

### Publishers per cliente
- Catálogo global `publishers` (lista maestra, editable en
  `/configuracion/publishers`).
- Tabla join `client_publishers (client_id, publisher_id, agency_pays,
  enabled, sort_order)`: define el subset que cada cliente usa y su default
  de "agencia paga" / "cliente paga".
- En el editor del plan se listan solo los publishers habilitados para el
  cliente del proyecto.
- Cascada para `agency_pays`: override del plan → default del cliente →
  default global del catálogo.

### Billing per plan, per mes
- `plan_billings` es la factura del plan en un mes específico.
- `plan_billing_publishers` es el consumo real por publisher; los publishers
  con `is_billable=false` se trackean pero no van en la factura emitida.
- `plan_billing_fees` es la imputación manual de cada fee del plan en cada
  mes (la suma de imputaciones a lo largo del tiempo no debe pasar el total
  del fee — validado en server actions).

### Audit log
- `audit_log` graba cada CREATE/UPDATE/DELETE con `before_json` + `after_json`.
- Vista en `/auditoria` con diff campo a campo, filtros por entityType y
  action.

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

### Lock de conexiones
- `prepare: false` para Transaction Pooler.
- `max: 5` para que `Promise.all` no se queue en una conexión sola.
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

### Si Vercel falla con statement_timeout

Plan free de Supabase tiene 8s por query. Si alguna query se acerca, ejecutar
en Supabase → SQL Editor:

```sql
ALTER ROLE authenticated SET statement_timeout = '60s';
ALTER ROLE anon SET statement_timeout = '60s';
ALTER ROLE service_role SET statement_timeout = '60s';
ALTER DATABASE postgres SET statement_timeout = '60s';
```

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

- **Auth/permisos**: aún no hay autenticación. La idea es Supabase Auth con
  roles (Account Manager, Media Planner, Finance, Viewer).
- **Reportes**: `/reportes` son specs sin implementar.
- **Admin de clientes**: `/configuracion/clientes` y `/configuracion/usuarios`
  son placeholders ("próximamente").
- **Publishers per-cliente UI**: la edición del mapping `client_publishers`
  hoy es vía seed; no hay UI para que el AM lo administre.
- **Markets/metrics per-cliente (Parte B)**: hoy son catálogos globales. Se
  pidió poder editarlos per-cliente. Requiere migración de schema (nuevas
  tablas `client_markets` / `client_metrics` o agregar `client_id`) +
  decisión de qué hacer con la data existente. Ver detalle en HANDOFF.md.
- **Excel/PDF**: formato básico, no es producción-ready. Especialmente el
  PDF (lista de texto plano, sin tablas estilizadas).
- **Drive integration**: en discusión, fuera del scope MVP.
