# Prompt de Desarrollo — Sangria Media OS

> Pegale esto a Claude Code (o al agente de desarrollo) **junto con los 5 archivos HTML de diseño** (`index.html`, `Dashboard.html`, `Vista de Cliente.html`, `Vista de Proyecto.html`, `Foundations v1 (manuscrita).html`) como referencia visual. Los HTML son **mockups de fidelidad alta**, no código fuente — usalos para extraer paleta, tipografía, espaciados, componentes y comportamiento, **no para copiar markup literal**.

---

## 0 · Contexto

**Sangria** es una agencia de medios. Hoy operan con Excels sueltos por cliente: cada cliente entrega un plan de medios mensual/trimestral en Excel, el equipo carga gastos reales mes a mes, y al cierre de cada mes generan un **billing** (facturación) por cliente / centro de costos.

Lo que estamos construyendo es **Sangria Media OS**: la herramienta interna que reemplaza esos Excels sueltos por un sistema único, con dashboard ejecutivo, vista por cliente, vista por proyecto, edición de gastos reales y generación automática de billing.

**Usuarios:** equipo interno de Sangria (planners, account managers, finance, dirección). NO es para clientes externos.

**Diseño:** estética **editorial / archivística**, NO SaaS genérico. Inspiración: Linear + Notion + un periódico viejo. Fondo crema (`#f6f4ef`), tinta casi negra (`#19171a`), tipografía sobria, mucho espacio en blanco, casi cero color. Acento único: rojo Sangria (`#7a1820`) usado con extrema parquedad. Iconografía mínima, monoespaciada para cifras.

---

## 1 · Stack recomendado

| Capa | Elección | Por qué |
|---|---|---|
| Framework | **Next.js 15 (App Router) + React 19** | SSR para tablas pesadas, server actions para autosave |
| Estilos | **Tailwind v4** + CSS variables del design system | Los mockups ya están en Tailwind |
| Componentes | **shadcn/ui** (Radix headless) — instalar a demanda | No imponer un look; matchear el design system |
| Base de datos | **PostgreSQL** + **Drizzle ORM** | Tablas relacionales claras; tipado estricto |
| Auth | **Clerk** o **Auth.js** con SSO Google | Equipo interno chico |
| Tablas | **TanStack Table v8** | Sorting, pinning, filtering, virtual scroll |
| Charts | **Apex Charts** (ya usado en mockups) o **Recharts** | Sparklines + área stacked + barras simples |
| Drag & drop | **dnd-kit** | Reordenar líneas dentro de un plan |
| Formularios | **React Hook Form + Zod** | Validación tipada |
| File upload | **UploadThing** o S3 directo | Para attachments del billing |

**No uses:** Material UI, Chakra, Ant Design. No matchean la estética.

---

## 2 · Modelo de datos (mínimo viable)

```ts
// Cliente real (centro de contratación con Sangria)
client {
  id, name, slug, logo_url, status: 'active'|'paused'|'archived',
  created_at
}

// Budget Origin: cada centro de costos / fuente de presupuesto del cliente.
// Un cliente tiene N. Ej: "Online", "CMI", "Trade", "Cargo".
// Es la unidad que se factura por separado.
budget_origin {
  id, client_id, name, monthly_target_usd, color_hex,
  created_at
}

// Proyecto: una campaña/iniciativa con fechas y un budget origin asociado.
project {
  id, client_id, budget_origin_id, name, code,
  status: 'planning'|'active'|'paused'|'closed',
  start_date, end_date, total_budget_usd,
  drive_folder_url, // si está acá → plan aprobado implícitamente
  notes_md, created_at
}

// Plan de Medios: un plan trimestral/mensual del proyecto.
// Un proyecto puede tener varios planes (revisiones del cliente).
media_plan {
  id, project_id, version, status: 'draft'|'approved'|'superseded',
  excel_source_url, // el Excel original que el cliente envió
  imported_at, approved_at, created_by
}

// Línea del plan: un placement individual.
// Tras importar el Excel del cliente, agrupamos visualmente por publisher
// pero en la tabla guardamos cada placement como fila propia.
media_plan_line {
  id, media_plan_id,
  publisher: 'YouTube'|'Meta'|'TikTok'|'DV360'|'OOH'|'Display'|...,
  placement_name,    // "In-Stream Skippable · LATAM Brand"
  audience_market,   // "25-44 viajeros · LATAM"
  start_date, end_date,
  budget_net_usd,
  fee_pct,           // honorarios sobre net
  notes,
  sort_order
}

// Gasto real cargado mes a mes (autosave en grilla).
actual_spend {
  id, media_plan_line_id, month: 'YYYY-MM',
  amount_usd, recorded_at, recorded_by, note
}

// Billing: factura mensual generada por (proyecto, mes).
billing {
  id, project_id, budget_origin_id, month: 'YYYY-MM',
  status: 'draft'|'sent'|'paid'|'overdue',
  invoice_number, total_net_usd, total_fee_usd, total_usd,
  pdf_url, sent_at, paid_at, due_date
}

billing_line {
  id, billing_id, media_plan_line_id,
  amount_net, fee_amount, total
}

// Auditoría
audit_log {
  id, entity_type, entity_id, action, before_json, after_json,
  user_id, created_at
}
```

### Reglas duras
- **Un plan de medios pertenece a UN solo budget origin** (vía `project.budget_origin_id`). No se mezclan orígenes en un plan.
- **Un proyecto puede tener múltiples planes** (versiones), pero solo uno con `status='approved'` activo.
- **El billing se factura por budget origin** porque cada origen es contablemente independiente.
- **Las fechas del publisher** (en la vista agrupada) son el rango envolvente de sus placements: `min(start_date)` a `max(end_date)`.
- **Edición de gastos reales**: autosave con debounce 300ms. Cada cambio escribe `actual_spend` y dispara `audit_log`.

---

## 3 · Pantallas a construir (en este orden)

### 1. Dashboard ejecutivo
- **2 layouts disponibles vía toggle** (preferencia de usuario, persistida):
  - **Layout A · KPIs Hero** — para presentar a management
  - **Layout C · Tabla protagonista** — para uso operativo diario
- 4 KPIs: Facturado YTD, Pipeline activo, Clientes activos, Margen agencia
- Chart de facturación: real (mensual) vs proyectado (próximos meses)
- Tabla de proyectos con sparkline de consumo de budget inline

### 2. Vista de Cliente — dos vistas con toggle
- **Tab "Resumen"**: header con cliente + budget origins como tabs; 4 KPIs del origen seleccionado; tabla de proyectos del origen
- **Tab "Línea de tiempo"**: gantt-like de proyectos, con su consumo de budget en la barra
- El switch de **Budget Origin** está arriba siempre y filtra todo lo que sigue.

### 3. Vista de Proyecto — 4 tabs
1. **Plan de Medios** — agrupado por publisher (desplegable). Cada publisher resume fecha envolvente + suma de inversión. Al expandir muestra cada placement con audiencia/mercado, fechas, inversión. **Sin métricas de performance** (eso lo ve el cliente en sus propias plataformas).
2. **Gastos Reales** — grilla editable inline mes a mes. Una fila por publisher con el total mensual, expandible al detalle de placements. Autosave. Marca de "exceso vs plan" cuando el real supera la prorrata mensual.
3. **Billing** — historial de facturas mensuales del proyecto, con su estado.
4. **Diff** — comparación entre versión vigente del plan y la anterior (líneas agregadas, modificadas, eliminadas).

### 4. Generador de Billing
- Selector de proyecto + mes
- El sistema toma los gastos reales del mes + fee del plan vigente y propone la factura
- Editor de líneas antes de "Emitir"
- Genera PDF + asigna número de factura correlativo

### 5. Importador de Excel
- Drop de Excel del cliente
- Parser tolerante (los Excels son inconsistentes entre clientes)
- Wizard de mapeo de columnas si no matchea automáticamente
- Crea `media_plan` + `media_plan_line[]` en draft

### 6. Auditoría / log de cambios
- Vista global filtrable por entidad, usuario, rango de fechas

---

## 4 · Sistema de diseño (tokens y componentes)

Extraé estos tokens del archivo `index.html` (pantalla de Foundations) y de los demás mockups:

```css
/* Color */
--paper:    #f6f4ef;   /* fondo crema */
--paper-2:  #efebe1;   /* fondo soft */
--ink:      #19171a;   /* texto principal */
--ink-2:    #4d484f;   /* texto secundario */
--rule:     #d9d3c5;   /* borde / hairline */
--accent:   #7a1820;   /* rojo sangria — uso parco */
--success:  #2f6f4f;
--warn:     #b58220;
--danger:   #9b2c2c;
--info:     #2a5a83;

/* Type — Tailwind v4 syntax */
--font-display: 'Fraunces', 'Georgia', serif;   /* H1, números hero */
--font-body:    'Inter', system-ui, sans-serif;
--font-mono:    'JetBrains Mono', ui-monospace, monospace;

/* Radius */
--radius-sm: 4px;
--radius:    8px;
--radius-lg: 14px;

/* Shadow */
--shadow-soft: 0 1px 2px rgba(25,23,26,.04), 0 8px 24px rgba(25,23,26,.04);
```

**Componentes a derivar (con shadcn como base):**
- `Button` (primary / ghost / sm), `Badge` (success/warn/danger/info/accent)
- `Card`, `Tabs`, `Table` (con TanStack), `Input`, `InputCell` (inline editable, autosave)
- `KpiCard`, `Sparkline`, `EmptyState`, `LayoutToggle`
- `PublisherRow` (la fila desplegable del plan de medios)
- `BudgetOriginTabs`

---

## 5 · Plan de fases

### **Fase 0 — Setup (1 día)**
- Next.js 15 + Tailwind v4 + shadcn + Drizzle + Postgres local (docker)
- Auth con Google SSO
- Layout shell (sidebar + topbar) extraído de los mockups
- Design tokens en `globals.css`
- Tipografías cargadas (Fraunces + Inter + JetBrains Mono)
- **Entregable:** app loguea, muestra layout vacío con sidebar funcional

### **Fase 1 — Modelo + seed (2 días)**
- Schemas de Drizzle de las tablas de §2
- Migrations
- Seed con: 2 clientes, 4 budget origins, 8 proyectos, 1 plan de medios completo (~28 líneas), 3 meses de gastos reales
- API routes / server actions CRUD básicas
- **Entregable:** podés navegar la base con `drizzle-kit studio` y ver datos consistentes

### **Fase 2 — Dashboard ejecutivo (3 días)**
- Layout A y C funcionales con datos reales
- LayoutToggle persistido en `user_preference`
- KPIs calculados (no hardcodeados)
- Chart de facturación real vs proyectado
- Tabla de proyectos con sparkline
- **Entregable:** dashboard navegable, números reales del seed

### **Fase 3 — Vista de Cliente (2 días)**
- Tabs Resumen / Línea de tiempo
- Tabs de Budget Origin
- Gantt simple en tab Línea de tiempo
- **Entregable:** desde dashboard hacés click en cliente y ves su detalle

### **Fase 4 — Vista de Proyecto: tabs Plan + Diff (3 días)**
- Tab Plan de Medios con publishers desplegables
- Tab Diff entre versiones del plan
- **Aún sin** importador real — el plan se siembra a mano
- **Entregable:** ves el plan completo de un proyecto, expandible

### **Fase 5 — Vista de Proyecto: tab Gastos Reales (3 días)**
- Grilla editable inline con autosave (debounce 300ms)
- Banda de "exceso vs prorrata" calculada server-side
- Audit log poblándose con cada cambio
- **Entregable:** podés cargar gastos reales del mes y se persisten

### **Fase 6 — Importador de Excel (4 días)**
- Drop de Excel
- Parser con SheetJS
- Wizard de mapeo de columnas (con preview)
- Validación con Zod
- Crea plan en draft
- **Entregable:** subís un Excel real de un cliente y queda como plan importado

### **Fase 7 — Generador de Billing (3 días)**
- Selector proyecto + mes
- Cálculo automático desde gastos reales + fee
- Editor de líneas
- Generación de PDF (react-pdf o puppeteer)
- Numeración correlativa
- **Entregable:** generás una factura completa, descargás PDF

### **Fase 8 — Tab Billing en proyecto + auditoría global (2 días)**
- Histórico de billing por proyecto
- Vista global de audit log filtrable
- **Entregable:** trazabilidad completa

### **Fase 9 — Hardening (3 días)**
- Permisos por rol (admin / planner / finance / viewer)
- Tests E2E con Playwright en flujos críticos: importar plan, cargar gasto, generar billing
- Backups automáticos de la DB
- Monitoreo (Sentry)
- **Entregable:** listo para producción interna

**Total estimado: ~26 días de desarrollo (1 dev senior).**

---

## 6 · Reglas no negociables

1. **No replicar el HTML de los mockups literalmente** — usalos como referencia de layout y estilo. El código debe ser componentes React limpios, no markup pegado.
2. **Toda edición se audita.** Cada `actual_spend`, cada cambio en `media_plan_line`, va a `audit_log` con before/after.
3. **Tipografía y color del design system son sagrados.** Nada de Inter en headlines, nada de azul corporativo, nada de gradientes.
4. **Densidad sobre espacio en tablas operativas.** En Plan de Medios y Gastos Reales priorizar info-density. En Dashboard priorizar respiración visual.
5. **Mobile no es prioridad.** Esto es una herramienta interna de escritorio. Min-width 1280px. Pero que no rompa en 1024.
6. **i18n: español rioplatense** (no neutro, no es). "Facturado", "Gastado", "Pendiente". Sin tutear en UI ("Editá" no "Edita").
7. **Cifras siempre en monoespaciada y alineadas a la derecha.**
8. **Cero emoji en UI de producto.** Iconografía con Lucide.

---

## 7 · Cómo arrancar

1. Leé los 5 HTML de referencia en este orden: `index.html` (foundations) → `Dashboard.html` → `Vista de Cliente.html` → `Vista de Proyecto.html` → `Foundations v1 (manuscrita).html` (notas a mano del manager con la lógica de negocio).
2. Replicá los design tokens en `globals.css` antes de escribir un solo componente.
3. Empezá por Fase 0 y avanzá secuencial. No saltees fases.
4. Al terminar cada fase, mostrá una demo navegable y pedí review antes de seguir.

Cualquier ambigüedad en el modelo de datos o en una pantalla, **preguntá antes de inventar**. La parte de billing tiene implicaciones contables que no toleran improvisación.
