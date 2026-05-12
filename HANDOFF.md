# Handoff — martes 12/may/2026

Estado del repo al cierre y plan para retomar en otra sesión.

> **Para setup inicial en una máquina nueva** ver [README.md](README.md).
> Este documento asume que ya está clonado el repo y `npm install`-eado.

---

## Estado actual

App **deployada y funcionando** en Vercel (auto-deploy desde `main`), ahora
contra el proyecto Supabase de la **agencia** (la DB ya no está en la cuenta
personal original — ver "Cambios de la sesión 12/may/2026").

### Commits recientes

```
(pendiente)  db: SQL inicial + seed dummy para nuevo proyecto Supabase (#9)
3cb0076  docs: estimación media/fees + accuracy + regla doc-upkeep en AGENTS.md (#8)
4023ea4  docs: PR #7 (estimación media/fees + accuracy) + regla doc-upkeep
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

### Cambios de la sesión 12/may/2026 (PR #9)

1. **Migración a Supabase de la agencia (PR #9).** La DB se movió del
   Supabase personal original al proyecto de la agencia. La app sigue siendo
   la misma — sólo cambió a qué proyecto Supabase apunta. Concretamente:
   - **5 env vars en Vercel** (Production + Preview + Development):
     `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
     `SUPABASE_SERVICE_ROLE_KEY`. La `service_role` queda marcada Sensitive.
     (`DATABASE_URL_POOLED` que estaba en el `.env.example` viejo nunca se
     leía y se eliminó.)
   - **Acceso al SQL editor**: la agencia agregó al developer como miembro
     de la organización Supabase con rol "Developer", lo que da acceso al
     SQL editor y Table editor sin tocar billing/keys.
   - **Schema corrido vía SQL editor**, no `db:push`. Se commitearon dos
     archivos en `db/migrations/` para que sean pegables directamente:
     - `0000_initial_schema.sql` — 16 tablas + 7 enums + FKs + índices,
       generado con `drizzle-kit generate` desde `db/schema.ts`.
     - `0001_seed_data.sql` — 280 INSERTs envueltos en `BEGIN/COMMIT`,
       dumpeados de un Postgres temporal alimentado con `scripts/seed.ts`.
       Contenido idéntico al seed actual (4 clientes, 11 proyectos, etc.).
   - **Fix crítico de connection string**: `DATABASE_URL` en Vercel tiene
     que ser SIEMPRE la del **Transaction Pooler** (`postgres.<ref>` user,
     host `aws-0-<region>.pooler.supabase.com`, puerto 6543). La direct
     connection (`db.<ref>.supabase.co:5432`) en proyectos Supabase nuevos
     resuelve sólo a IPv6 y falla en Vercel con `getaddrinfo ENOTFOUND`.
     El `.env.example` se actualizó para reflejar esto y eliminar la
     ambigüedad de la doble var.

   **Acción de runtime requerida en cualquier proyecto Supabase fresco**
   (si en algún momento se vuelve a montar la DB en otro lado): correr en
   orden `0000_initial_schema.sql` → `0001_seed_data.sql` en el SQL editor.
   Si la DB es para producción real, eventualmente conviene pasar a un
   workflow de `drizzle-kit migrate` con migraciones numeradas — los dos
   archivos commiteados son la base 0.

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

La DB vive en el proyecto Supabase de la **agencia** (no en la cuenta
personal). Para credenciales nuevas pedirlas a la agencia (ver "Setup en la
máquina del lunes" más abajo).

Lo que se cargó en la DB (vía `db/migrations/0001_seed_data.sql`, equivalente
al output de `scripts/seed.ts`):
- **4 clientes**: Copa Airlines, Cervecería Andina, Banco Pacífico (active),
  Tienda Roma (paused).
- **11 proyectos** cubriendo los 4 estados (planning/active/paused/closed).
- **17 planes peer** con mix completo de status (draft / ready_to_send /
  approved / archived).
- **11 plan_billings** (paid + sent + draft) y 12 snapshots de aprobación.
- **Catálogos**: 11 publishers + 14 markets + 23 metrics.

---

## Setup en una máquina nueva

1. Clonar el repo y `npm install` (ver [README.md](README.md)).
2. Conseguir credenciales del proyecto Supabase de la agencia:
   - Pedir a la agencia que invite tu email a la organización Supabase con
     rol **Developer** (acceso al SQL editor + Table editor, sin tocar
     billing/keys).
   - O pedir las 5 env vars directamente por canal seguro (1Password /
     Bitwarden / similar). NUNCA pedir la `SUPABASE_SERVICE_ROLE_KEY` por
     Slack/mail en claro — es server-only y bypassa RLS.
3. Copiar `.env.example` a `.env.local` y completar las 5 variables. Las
   `NEXT_PUBLIC_*` son válidas para browser; la `SUPABASE_SERVICE_ROLE_KEY`
   es server-only.
4. **Importante**: `DATABASE_URL` tiene que ser SIEMPRE la del Transaction
   Pooler (puerto **6543**). La direct connection (`db.<ref>.supabase.co:5432`)
   no funciona desde Vercel/serverless en proyectos nuevos — falla con
   `getaddrinfo ENOTFOUND` por IPv6-only. Sacar el string del dashboard:
   Project Settings → Database → Connection string → pestaña **"Transaction
   pooler"**.
5. `npm run dev` y abrir `http://localhost:3000`.

Si pasa algo raro con la DB, `npm run db:check` para diagnosticar.

### Inicializar una DB Supabase desde cero

Si tenés que setear un proyecto Supabase fresco (porque la agencia creó
uno nuevo, o porque querés un staging propio):

1. Crear el proyecto en Supabase (cualquier región — la app usa pooler).
2. SQL editor → new query → pegar `db/migrations/0000_initial_schema.sql` →
   Run. Crea las 16 tablas + enums + FKs + índices.
3. SQL editor → new query → pegar `db/migrations/0001_seed_data.sql` → Run.
   Carga los datos dummy de demo (4 clientes, 11 proyectos, etc.).
4. Setear las 5 env vars (en `.env.local` para dev, en Vercel para deploy).
5. Redeploy en Vercel sin build cache si las vars se cambiaron en prod.

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

### 3. Admin UI para per-client publishers

Hoy `client_publishers` se carga vía seed. Falta una página
`/configuracion/clientes/[slug]` o tab dentro de `/clientes/[slug]` para que
el AM pueda:
- Habilitar/deshabilitar publishers para ese cliente.
- Cambiar el default de "agencia paga" / "cliente paga" por publisher.

Ya tenemos las server actions en `app/actions/publishers.ts` para el catálogo
global; faltan equivalentes para `client_publishers`.

Probablemente se hace junto con Parte B (paso 1) — todas las admin UIs
per-cliente conviene tenerlas en el mismo lugar visual.

### 4. Admin UI para clientes y budget origins

Mismo razonamiento. Crear un cliente o budget origin hoy es vía seed.
Sería `/configuracion/clientes` (ya está en placeholders).

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
- **Transaction Pooler (6543) SIEMPRE**, no Session Pooler (5432) ni Direct.
  En proyectos Supabase nuevos la direct connection (`db.<ref>.supabase.co`)
  resuelve sólo a IPv6 y falla en Vercel con `getaddrinfo ENOTFOUND`. El
  pooler (`aws-0-<region>.pooler.supabase.com`) resuelve IPv4 y es el único
  que anda. Formato del user en pooler: `postgres.<project-ref>` (con
  punto), no `postgres` solo.
- Las 5 env vars (`DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) tienen que
  estar marcadas para Production, Preview y Development en Vercel. La
  `service_role` marcala como **Sensitive** en el checkbox de Vercel para
  que se oculte del UI tras guardarla.
- Cambiar cualquier var **requiere Redeploy sin cache** (Deployments →
  último → ⋯ → Redeploy, desmarcar "Use existing Build Cache"). Vercel no
  aplica cambios de env vars en deploys ya construidos.
- Si querés cambiar el password de la DB, Supabase no lo muestra de nuevo:
  **resetealo** desde Supabase → Settings → Database → Database password.
- Acceso al proyecto Supabase de la agencia se gestiona invitando miembros
  a la org (Organization Settings → Team → Invite member) con rol Developer
  o superior.

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
  (NO genera migración). Útil para iterar local; **no usar en prod**.
- Después de un `db:push` hay que correr `npm run db:seed` si la migración
  rompió constraints o cambios de columnas.
- Para producción (la DB de la agencia): usar `npm run db:generate` para
  generar la migración SQL en `db/migrations/`, commitearla, y aplicarla
  vía SQL editor de Supabase (más seguro que `db:migrate` directo, deja
  registro en el historial de queries de Supabase, y no requiere
  `DATABASE_URL` apuntando a prod en local).
- La base inicial está en `db/migrations/0000_initial_schema.sql` +
  `0001_seed_data.sql`. Cambios futuros van como `0002_<nombre>.sql` etc.

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

### Build / runtime de Vercel
- Si falla con `DATABASE_URL is not defined`: el lazy-init del Proxy ya
  evita esto, pero si rompe igual, chequear que los pages no estén
  marcados como statics y que no haya un import sincrónico que dispare la
  creación de la DB en build.
- Si falla con `ENETUNREACH` IPv6: verificar que `db/index.ts` tenga el
  `dns.setDefaultResultOrder("ipv4first")` arriba.
- Si falla con `getaddrinfo ENOTFOUND db.<ref>.supabase.co`: el
  `DATABASE_URL` está usando la **direct connection** en lugar del
  Transaction Pooler. Cambiar al pooler (`aws-0-<region>.pooler.supabase.com:6543`,
  user `postgres.<ref>`) y redeploy sin cache.

---

## Donde están las cosas — referencia rápida

| Quiero...                              | Mirar...                                                  |
|----------------------------------------|-----------------------------------------------------------|
| Cambiar el schema                      | `db/schema.ts`                                            |
| Agregar una query                      | `db/queries/<dominio>.ts`                                 |
| Agregar una server action              | `app/actions/<dominio>.ts`                                |
| Cambiar la sidebar                     | `components/sidebar.tsx`                                  |
| Cambiar el topbar                      | `components/topbar.tsx`                                   |
| Cambiar la tabla expandible            | `components/projects-table-expandable.tsx`                |
| Cambiar el editor del plan             | `app/(app)/proyectos/[code]/planes/[planId]/editor.tsx`   |
| Cambiar el PDF/Excel del plan          | `app/api/plans/[planId]/export.{pdf,xlsx}/route.ts`       |
| Cargar más datos demo                  | `scripts/seed.ts` + `npm run db:seed`                     |
| Inicializar una DB Supabase fresca     | `db/migrations/0000_initial_schema.sql` + `0001_seed_data.sql` (pegar en SQL editor) |
| Configurar conexión DB                 | `db/index.ts`                                             |
| Cambiar formato del connection string  | `.env.example` (con warning de IPv6) + sección "Vercel + Supabase" en este HANDOFF |
| Agregar nueva ruta                     | `app/(app)/<...>/page.tsx`                                |
| Catálogo de cost methods, etc.         | `db/schema.ts` (enums) + `editor.tsx` (mapping principal) |
| Tocar el picker / filtro global cliente| `components/topbar-client-picker.tsx`, `lib/client-filter*.ts` |
| Agregar una ruta al filtro de cliente  | `CLIENT_FILTER_ROUTES` en `lib/client-filter.ts`          |
| Cambiar cómo se calcula el management fee | `db/schema.ts:357-359` (fórmula), `db/queries/project-detail.ts`, `db/queries/dashboard.ts`, `app/(app)/proyectos/[code]/planes/[planId]/billing/page.tsx`, `app/actions/plan-billing.ts` (todos aplican la misma fórmula) |
| Agregar/cambiar pares rate↔delivery del editor | `DIRECT_METRIC_RATES` en `lib/cost-methods.ts` + nueva calculated metric en `scripts/seed.ts` con fórmula `amount / <delivery>` |
| Editor de métricas del placement       | `MetricsEditor` y `PrincipalPairEditor` en `app/(app)/proyectos/[code]/planes/[planId]/editor.tsx` |
| Cambiar la card de estimación de facturación | `components/billing-estimate-card.tsx` (UI) + `getBillingEstimate` en `db/queries/dashboard.ts` (datos) |
| Agregar otra dimensión al desglose de la estimación | Extender el `ProjectAgg` interno de `getBillingEstimate` con el nuevo agregado, propagar a `MonthlyBillingEstimate`, y agregar columna en `EstimateMonthCard` |

---

## Si algo está roto en el próximo arranque

1. `npm run db:check` para verificar la conexión.
2. Si el dev no levanta: chequear `.env.local` vs el formato del
   `.env.example`. Recordar que `DATABASE_URL` es la del pooler (puerto
   6543, host `aws-0-...pooler.supabase.com`), no la direct.
3. Si prod tira `getaddrinfo ENOTFOUND db.<ref>.supabase.co`: el
   `DATABASE_URL` en Vercel apunta a la direct connection. Cambiarlo al
   pooler y redeploy sin cache.
4. Si Vercel está down: revisar Logs en Vercel y ver el último deploy
   exitoso. `git revert <hash>` y push si hace falta.
5. Si la DB tiene data mala/inconsistente y querés rehacerla desde cero
   sobre el mismo proyecto Supabase: en el SQL editor, drop schema +
   recrear (cuidado, destruye datos):
   ```sql
   DROP SCHEMA public CASCADE;
   CREATE SCHEMA public;
   GRANT ALL ON SCHEMA public TO postgres, anon, authenticated, service_role;
   ```
   Después pegar `0000_initial_schema.sql` + `0001_seed_data.sql` de nuevo.

Suerte y dale para adelante.
