# Handoff — jueves 14/may/2026

Estado del repo al cierre y plan para retomar en otra sesión.

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
(pendiente) Archivar clientes desaparece del filtro + nueva /billing-tracker
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
| Cambiar la tabla expandible            | `components/projects-table-expandable.tsx`                |
| Cambiar el editor del plan             | `app/(app)/proyectos/[code]/planes/[planId]/editor.tsx`   |
| Cambiar el PDF/Excel del plan          | `app/api/plans/[planId]/export.{pdf,xlsx}/route.ts`       |
| Agregar/cambiar columnas de métricas en el Excel | `app/api/plans/[planId]/export.xlsx/route.ts` — la sección "Tab 1" arma `metricSlugs` desde `metrics_json`; los subtotales por publisher usan `sumDirects` + `evalFormula`. |
| Cambiar el prorrateo del budget split por mercado | `prorateByMonth` en `app/api/plans/[planId]/export.xlsx/route.ts` (días-overlap inclusive). |
| Tocar el lifecycle de un billing | `app/actions/plan-billing.ts` — `transitionBillingStatus` (validaciones + revert) y `markBillingInvoiced` (sent → invoiced con número de factura). Labels: `STATUS_STYLE_BY_LANG` en `app/(app)/billing/page.tsx` y `BillingStatusPillInline` en el editor. |
| Cambiar el formato del PDF que se manda a finanzas | `app/api/billings/[id]/report.pdf/route.ts`. Columnas hardcodeadas en `COL_*` constants; cada fila es `Media Placement` (publishers facturables con consumo > 0) o `Services` (fees con imputación > 0). |
| Tocar la lógica del Reporting Calendar | `app/actions/reports.ts` (actions: setProjectStatus / setReportDeliveryDate / markReportDelivered), `db/queries/reports.ts` (queries), `app/(app)/reportes/calendario/page.tsx` (page). |
| Cambiar los filtros de /billing | `components/billing-filters.tsx` (dropdowns + slider). Las opciones vienen de `getBillingFilterOptions` en `db/queries/billing.ts`. |
| Tocar el Billing Tracker | `app/(app)/billing-tracker/page.tsx` (UI), `components/billing-tracker-filters.tsx` (filtros), `db/queries/billing-tracker.ts` (`getBillingTracker`, `getBillingTrackerFilterOptions`). Solo lista billings con `invoice_number` no-null (status `invoiced` o `paid`). |
| Compartir el slider dual de meses | `components/month-range-slider.tsx`. Self-contained; el parent pasa `initialFromIdx`/`initialToIdx` + `key` para resetearlo cuando los committed values cambian. |
| Ocultar/mostrar un cliente en el filtro global | `clients.status` — `archived` lo saca del topbar picker y de `/clientes`. Se sigue gestionando desde `/configuracion/clientes`. |
| Cambiar el destino del click en una fila de /billing | `app/(app)/billing/page.tsx` — variable `detailHref` por row. Apunta a `/proyectos/[code]/planes/[planId]/billing?month=YYYY-MM`. |
| Estilos del slider dual-range de meses | `app/globals.css` — clase `.month-slider-thumb` (Webkit + Firefox). |
| Ajustar la ventana del Gantt o los símbolos | `components/reporting-gantt.tsx`. Constants `WINDOW_BEFORE_DAYS`, `WINDOW_AFTER_DAYS`, colores `COLOR_*`. |
| Cambiar el flow closed → reportado | `app/actions/reports.ts` `markReportDelivered` (delivered_at + project.status='reportado' + audit log). |
| Agregar un status nuevo a proyectos | `db/schema.ts` enum `projectStatus`, `components/status-badge.tsx`, `components/project-status-changer.tsx` (SELECTABLE / LABELS / PROMPTS). |
| Cargar más datos demo                  | `scripts/seed.ts` + `npm run db:seed`                     |
| Configurar conexión DB                 | `db/index.ts`                                             |
| Agregar nueva ruta                     | `app/(app)/<...>/page.tsx`                                |
| Catálogo de cost methods, etc.         | `db/schema.ts` (enums) + `editor.tsx` (mapping principal) |
| Tocar el picker / filtro global cliente| `components/topbar-client-picker.tsx`, `lib/client-filter*.ts` |
| Agregar una ruta al filtro de cliente  | `CLIENT_FILTER_ROUTES` en `lib/client-filter.ts`          |
| Cambiar el idioma de un cliente        | `/configuracion/clientes` o columna `clients.language`     |
| Agregar/traducir strings nuevas        | `DICT` en `lib/i18n.ts` + usar `t(key, lang)` en JSX       |
| Cambiar formato de fechas en la app    | `formatDate` / `formatMonth` en `lib/i18n.ts`              |
| Cambiar cómo se calcula el management fee | `db/schema.ts:357-359` (fórmula), `db/queries/project-detail.ts`, `db/queries/dashboard.ts`, `app/(app)/proyectos/[code]/planes/[planId]/billing/page.tsx`, `app/actions/plan-billing.ts` (todos aplican la misma fórmula) |
| Agregar/cambiar pares rate↔delivery del editor | `DIRECT_METRIC_RATES` en `lib/cost-methods.ts` + nueva calculated metric en `scripts/seed.ts` con fórmula `amount / <delivery>` |
| Editor de métricas del placement       | `MetricsEditor` y `PrincipalPairEditor` en `app/(app)/proyectos/[code]/planes/[planId]/editor.tsx` |
| Cambiar la card de estimación de facturación | `components/billing-estimate-card.tsx` (UI) + `getBillingEstimate` en `db/queries/dashboard.ts` (datos) |
| Agregar otra dimensión al desglose de la estimación | Extender el `ProjectAgg` interno de `getBillingEstimate` con el nuevo agregado, propagar a `MonthlyBillingEstimate`, y agregar columna en `EstimateMonthCard` |

---

## Si algo está roto el lunes

1. `npm run db:check` para verificar la conexión.
2. Si el dev no levanta: chequear `.env.local` vs el formato del README.
3. Si Vercel está down: revisar Logs en Vercel y ver el último deploy
   exitoso. `git revert <hash>` y push si hace falta.
4. Si la DB tiene data mala/inconsistente: `npm run db:push` (re-aplica
   schema) + `npm run db:seed` (rehace todo desde cero).

Suerte y dale para adelante.
