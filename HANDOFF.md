# Handoff — viernes 9/may/2026

Estado del repo al cierre del viernes y plan para retomar el lunes desde
otra máquina.

> **Para setup inicial en una máquina nueva** ver [README.md](README.md).
> Este documento asume que ya está clonado el repo y `npm install`-eado.

---

## Estado actual

App **deployada y funcionando** en Vercel (a verificar la última URL en el
dashboard de Vercel, branch `main` en auto-deploy).

### Commits recientes

```
9466453  db: max=5 + connect_timeout para evitar statement timeouts en serverless
fef471f  Topbar + Budget Origin: dropdowns funcionales
a596089  Build de Vercel: force-dynamic en (app) + IPv4-first en DNS
557bd16  Lazy-init de db: el build de Vercel no necesita DATABASE_URL
9a475a0  Per-client publishers, billing breakdown + estimación, exports XLSX/PDF, seed expandido
```

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
- **Topbar**: dropdown de cliente que navega a `/clientes/<slug>` y resalta
  el cliente actual.
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

### 1. Auth + permisos (lo que pediste para el lunes)

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

### 2. Admin UI para per-client publishers

Hoy `client_publishers` se carga vía seed. Falta una página
`/configuracion/clientes/[slug]` o tab dentro de `/clientes/[slug]` para que
el AM pueda:
- Habilitar/deshabilitar publishers para ese cliente.
- Cambiar el default de "agencia paga" / "cliente paga" por publisher.

Ya tenemos las server actions en `app/actions/publishers.ts` para el catálogo
global; faltan equivalentes para `client_publishers`.

### 3. Admin UI para clientes y budget origins

Mismo razonamiento. Crear un cliente o budget origin hoy es vía seed.
Sería `/configuracion/clientes` (ya está en placeholders).

### 4. Polish del PDF/Excel

El PDF está en texto plano sin tablas; el Excel tiene 4 hojas básicas. Si
los media planners van a mandarlo al cliente, conviene hacerlos más
presentables:
- PDF con tablas reales (probablemente migrando a `@react-pdf/renderer` o
  similar).
- Excel con formato (bordes, colores, formulas para los CPM/CPC, fila de
  totales por publisher, etc.).
- Header con logo de Sangria y datos del cliente.

### 5. Reportes

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
| Cargar más datos demo                  | `scripts/seed.ts` + `npm run db:seed`                     |
| Configurar conexión DB                 | `db/index.ts`                                             |
| Agregar nueva ruta                     | `app/(app)/<...>/page.tsx`                                |
| Catálogo de cost methods, etc.         | `db/schema.ts` (enums) + `editor.tsx` (mapping principal) |

---

## Si algo está roto el lunes

1. `npm run db:check` para verificar la conexión.
2. Si el dev no levanta: chequear `.env.local` vs el formato del README.
3. Si Vercel está down: revisar Logs en Vercel y ver el último deploy
   exitoso. `git revert <hash>` y push si hace falta.
4. Si la DB tiene data mala/inconsistente: `npm run db:push` (re-aplica
   schema) + `npm run db:seed` (rehace todo desde cero).

Suerte y dale para adelante.
