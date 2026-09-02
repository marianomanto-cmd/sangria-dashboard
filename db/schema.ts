import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import type { ScenarioJson } from "@/lib/simulator-types";

// ════════════════════════════════════════════════════════════════════════════
// Enums
// ════════════════════════════════════════════════════════════════════════════

export const clientStatus = pgEnum("client_status", [
  "active",
  "paused",
  "archived",
]);

// Idioma en el que se opera el cliente. Default 'en' para todos. Afecta
// dates, exports (PDF/Excel) y labels de la UI cuando el filtro global de
// cliente apunta a ese cliente. Las métricas (clicks, views, impressions)
// quedan siempre en inglés.
export const clientLanguage = pgEnum("client_language", ["en", "es"]);

export const projectStatus = pgEnum("project_status", [
  "planning",
  "active",
  "paused",
  "closed",
  // 'reportado' es el estado final: el proyecto cerró sus campañas y ya se
  // entregó el reporte final al cliente. Se entra acá automáticamente cuando
  // se marca el project_report como delivered desde /reportes/calendario.
  "reportado",
]);

// Lifecycle de un plan dentro de un proyecto:
//   draft         → editable por el MM
//   ready_to_send → MM lo congeló, AM puede bajar el PDF y mandarlo a firma
//   approved      → cliente firmó, plan vigente, ediciones futuras crean nueva
//                   versión. Falta el QA de esta versión → NO puede ir a live
//   qa_done       → el planner controló línea por línea que la campaña esté
//                   armada tal cual el plan (ver media_plan_qa_runs)
//   live          → campaña al aire. Solo se llega desde qa_done
//   finished      → la campaña corrió y cerró. Sigue contando como FIRMADO
//                   (portal, análisis, benchmarks) pero NO como vigente: no
//                   genera pendientes ni aparece en el campaign tracker
//   archived      → reemplazado por una nueva versión approved o cancelado
//
// El QA es obligatorio y es POR VERSIÓN: aprobar la v(N+1) devuelve el plan a
// `approved`, así que hay que volver a controlarlo antes de marcarlo live.
// Los sets de estado ("firmado" ≠ "vigente" ≠ "comprometido") y el mapa de
// transiciones viven en lib/plan-status.ts — las queries importan de ahí en vez
// de hardcodear 'approved'.
export const planStatus = pgEnum("plan_status", [
  "draft",
  "ready_to_send",
  "approved",
  "qa_done",
  "live",
  "finished",
  "archived",
]);

export const billingStatus = pgEnum("billing_status", [
  "draft",     // borrador / abierto — el analista edita consumo y fees
  "ready",     // listo — analista marcó como listo para revisión del manager
  "sent",      // reportado — el manager descargó el PDF para finanzas
  "invoiced",  // facturado — manager cargó el número de factura de finanzas
  "paid",      // pagado — cliente notificó el pago
]);

export const feeType = pgEnum("fee_type", [
  "management",
  "setup",
  "reporting",
  "custom",
]);

export const costMethod = pgEnum("cost_method", [
  "dCPV",
  "dCPC",
  "dCPM",
  "dCPA",
  "CPM",
  "CPC",
  "CPV",
  "CPA",
  "Flat",
  "Other",
]);

// Tipo de métrica del catálogo:
//   direct     — el planner entra el valor directamente (views, clicks, impressions)
//   calculated — derivada de otras (cpc = amount/clicks, ctr = clicks/impressions)
export const metricKind = pgEnum("metric_kind", ["direct", "calculated"]);

// Qué se tilda en el QA de planificación: una línea del plan o un adset.
// Ver `media_plan_planning_qa_checks` más abajo.
export const planningQaItemKind = pgEnum("planning_qa_item_kind", [
  "placement",
  "adset",
]);

// ════════════════════════════════════════════════════════════════════════════
// Catálogo de mercados — per-cliente.
// Antes era global. Ahora cada cliente tiene su propia lista; podés tener
// "Centroamérica" definido distinto para Copa vs Banco. Unique en
// (client_id, slug).
// ════════════════════════════════════════════════════════════════════════════

export const markets = pgTable(
  "markets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),            // costa-rica, latam, centroamerica
    name: text("name").notNull(),            // Costa Rica, LATAM, Centroamérica
    enabled: boolean("enabled").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("markets_client_slug_uq").on(t.clientId, t.slug),
    index("idx_markets_client_enabled").on(t.clientId, t.enabled, t.sortOrder),
  ],
);

// ════════════════════════════════════════════════════════════════════════════
// Catálogo de métricas / KPIs — per-cliente.
// Antes era global. Ahora cada cliente puede definir conversiones custom
// (ej. "Solicitud de tarjeta" para un banco) además del estándar
// impressions/clicks/views/etc. Unique en (client_id, slug).
// Direct: views, clicks, impressions, conversions, etc.
// Calculated: ctr, cpc, cpm, cpv, etc. (derivadas de otras + amount).
// ════════════════════════════════════════════════════════════════════════════

export const metricsCatalog = pgTable(
  "metrics_catalog",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),              // impressions, ctr, cpc
    name: text("name").notNull(),              // Impressions, CTR, CPC
    kind: metricKind("kind").notNull(),
    unit: text("unit"),                        // imp, %, $, click, view (descriptivo)
    formula: text("formula"),                   // null en direct; "amount/views" en calculated
    enabled: boolean("enabled").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("metrics_catalog_client_slug_uq").on(t.clientId, t.slug),
    index("idx_metrics_client_enabled").on(t.clientId, t.enabled, t.sortOrder),
  ],
);

// ════════════════════════════════════════════════════════════════════════════
// Catálogo de publishers — per-cliente.
// Igual que markets y metrics_catalog: cada cliente tiene su propia lista de
// publishers, con su slug/nombre, su regla de "agencia paga / cliente paga"
// (agency_pays) y su flag enabled. NO hay catálogo global. Unique en
// (client_id, slug). Se administra en /configuracion/clientes/[slug].
// ════════════════════════════════════════════════════════════════════════════

export const publishers = pgTable(
  "publishers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),                 // youtube, meta, tiktok
    name: text("name").notNull(),                 // YouTube, Meta, TikTok
    enabled: boolean("enabled").notNull().default(true),
    // Default per-cliente de "agencia paga". La agencia factura los publishers
    // que ella paga; los que el cliente paga directo no aparecen en facturas
    // (el tracking sí). Se puede overridear por bloque del plan vía
    // media_plan_publishers.agency_pays_override.
    agencyPays: boolean("agency_pays").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("publishers_client_slug_uq").on(t.clientId, t.slug),
    index("idx_publishers_client_enabled").on(t.clientId, t.enabled, t.sortOrder),
  ],
);

// ════════════════════════════════════════════════════════════════════════════
// Clientes
// ════════════════════════════════════════════════════════════════════════════

export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),                 // "Copa Airlines"
  slug: text("slug").notNull().unique(),        // "copa"
  prefix: text("prefix"),                        // "COPA" — se usa en code de proyectos
  logoUrl: text("logo_url"),
  status: clientStatus("status").notNull().default("active"),
  language: clientLanguage("language").notNull().default("en"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ════════════════════════════════════════════════════════════════════════════
// Budget Origins (centros de costos / fuentes de presupuesto del cliente).
// Un proyecto pertenece a UN budget_origin (regla dura).
// ════════════════════════════════════════════════════════════════════════════

export const budgetOrigins = pgTable("budget_origins", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  name: text("name").notNull(),                 // "Online", "CMI", "Trade", "Cargo"
  colorHex: text("color_hex"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ════════════════════════════════════════════════════════════════════════════
// Proyectos. AM crea el proyecto con metadata principal + total gross budget.
// Code sigue convención: <CLIENT_PREFIX>.m<id>.<ProjectName>
// Ej: "COPA.mCostaRica2026", "COPA.m1234.SubeLaMarea"
//
// La fecha de finalización del proyecto se DERIVA del placement con la fecha
// fin más lejana de todos los planes del proyecto — no se almacena.
// El startDate sí se guarda como "estimado de inicio" del AM (puede usarse
// antes de que existan placements).
// ════════════════════════════════════════════════════════════════════════════

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "restrict" }),
  budgetOriginId: uuid("budget_origin_id")
    .notNull()
    .references(() => budgetOrigins.id, { onDelete: "restrict" }),
  code: text("code").notNull().unique(),       // "COPA.mCostaRica2026"
  name: text("name").notNull(),                 // "Costa Rica 2026" (display)
  status: projectStatus("status").notNull().default("planning"),
  startDate: date("start_date"),                // estimado del AM
  totalGrossBudgetUsd: numeric("total_gross_budget_usd", {
    precision: 14,
    scale: 2,
  }),
  driveFolderUrl: text("drive_folder_url"),
  notesMd: text("notes_md"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ════════════════════════════════════════════════════════════════════════════
// Planes — múltiples por proyecto, peers (no versiones de uno).
// Cada plan tiene su propio lifecycle (draft → ready_to_send → approved).
// Plan name sigue convención: <Project.code>.<PlanName>
// Ej: "COPA.mCostaRica2026.Awareness", "COPA.mCostaRica2026.Performance"
//
// Las fechas del plan se DERIVAN de las fechas de los placements:
//   period_start = min(placement.start_date)
//   period_end   = max(placement.end_date)
// No se almacenan.
// ════════════════════════════════════════════════════════════════════════════

export const mediaPlans = pgTable(
  "media_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),               // "Awareness", "Performance"
    status: planStatus("status").notNull().default("draft"),
    // 0 = nunca aprobado. Cada vez que se aprueba se crea un snapshot e
    // incrementa este contador.
    currentVersion: integer("current_version").notNull().default(0),
    notesMd: text("notes_md"),
    // Soft delete: borrar un plan lo manda a la papelera (deletedAt != null) y
    // se guarda ad eternum. Todas las queries de listado filtran
    // `deletedAt IS NULL`. La papelera vive en /configuracion/papelera-planes.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // Unicidad de nombre por proyecto sólo entre planes VIVOS (partial unique
  // index): permite re-crear un nombre cuyo plan fue borrado y tener varios
  // borrados con el mismo nombre en la papelera.
  (t) => [
    uniqueIndex("uq_media_plan_project_name")
      .on(t.projectId, t.name)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

// ════════════════════════════════════════════════════════════════════════════
// Publisher dentro de un plan. Tiene un total planeado que debe coincidir
// con la suma de sus placements.
//
// Un mismo publisher puede aparecer N veces en un plan (ej: "Meta Brand" +
// "Meta Performance"): cada bloque tiene su totalPlannedUsd y sus placements.
// El billing igual rolla a un solo número por publisher x mes — al
// agregar/sumar lo planeado por publisher hay que sumar todos los bloques
// (ver db/queries/billing.ts).
// ════════════════════════════════════════════════════════════════════════════

export const mediaPlanPublishers = pgTable(
  "media_plan_publishers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mediaPlanId: uuid("media_plan_id")
      .notNull()
      .references(() => mediaPlans.id, { onDelete: "cascade" }),
    publisherId: uuid("publisher_id")
      .notNull()
      .references(() => publishers.id, { onDelete: "restrict" }),
    totalPlannedUsd: numeric("total_planned_usd", {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default("0"),
    // Si está seteado, override del agency_pays per-cliente del publisher.
    agencyPaysOverride: boolean("agency_pays_override"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

// ════════════════════════════════════════════════════════════════════════════
// Placements (líneas) dentro de un publisher dentro de un plan.
// Cada placement: nombre, mercado (FK a markets), monto, cost_method,
// audiencia (free text), indicadores flexibles (jsonb con keys del catálogo
// de metrics_catalog) y notas free-text para formatos/extras.
// Las fechas (start_date / end_date) son la fuente de verdad — el período
// del plan y del proyecto se derivan de acá.
// ════════════════════════════════════════════════════════════════════════════

export const mediaPlanPlacements = pgTable(
  "media_plan_placements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mediaPlanPublisherId: uuid("media_plan_publisher_id")
      .notNull()
      .references(() => mediaPlanPublishers.id, { onDelete: "cascade" }),
    placementName: text("placement_name").notNull(),
    marketId: uuid("market_id").references(() => markets.id, {
      onDelete: "set null",
    }),
    audience: text("audience"),                  // detalles de audiencia (free text)
    amountUsd: numeric("amount_usd", { precision: 14, scale: 2 }).notNull(),
    costMethod: costMethod("cost_method"),       // método principal
    startDate: date("start_date"),
    endDate: date("end_date"),
    // Diccionario flexible: keys son slugs de metrics_catalog (cpc, ctr,
    // est_imp, etc.). Solo se almacenan métricas direct; las calculated
    // se derivan en runtime con la fórmula del catálogo.
    metricsJson: jsonb("metrics_json")
      .$type<Record<string, number>>()
      .default(sql`'{}'::jsonb`),
    notesMd: text("notes_md"),                    // formatos / detalles libres
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("idx_placements_mpp").on(t.mediaPlanPublisherId)],
);

// ════════════════════════════════════════════════════════════════════════════
// Fees del plan. La agencia los suma al billing y los imputa mes a mes
// como considere (ver plan_billing_fees).
// ════════════════════════════════════════════════════════════════════════════

export const mediaPlanFees = pgTable("media_plan_fees", {
  id: uuid("id").primaryKey().defaultRandom(),
  mediaPlanId: uuid("media_plan_id")
    .notNull()
    .references(() => mediaPlans.id, { onDelete: "cascade" }),
  feeType: feeType("fee_type").notNull(),
  name: text("name").notNull(),               // "Management Fee", custom name
  // Para management fees: el planner setea ratePct (% de comisión sobre
  // gross). El amount se DERIVA: amount = TM × ratePct/(100 - ratePct).
  // Equivalente a la fórmula del usuario: amount = TM/(1 - ratePct/100) - TM.
  // Para otros tipos de fee (setup, reporting, custom): ratePct queda null
  // y amount es manual.
  ratePct: numeric("rate_pct", { precision: 5, scale: 2 }),
  amountUsd: numeric("amount_usd", { precision: 14, scale: 2 }).notNull(),
  notes: text("notes"),
  sortOrder: integer("sort_order").notNull().default(0),
});

// ════════════════════════════════════════════════════════════════════════════
// Tabs auxiliares del plan — grillas libres tipo Excel que el planner edita a
// mano (N por plan, opcionales). Es material de trabajo: NO participa del
// lifecycle de aprobación ni de los snapshots (aprobar / descartar borrador
// no las toca). Cada tab sale en el export Excel después del "Budget por
// mercado", repitiendo arriba la metadata del plan (proyecto, período, budget
// origin) y debajo la grilla tal cual se cargó.
//
// grid_json es un array de filas; cada fila, un array de celdas (strings
// libres). Una celda que empieza con "=" es una fórmula estilo Excel (refs
// A1 + SUM/AVERAGE/etc.) que el export escribe como fórmula real. Límites y
// helpers compartidos en lib/aux-sheet.ts.
// ════════════════════════════════════════════════════════════════════════════

export const mediaPlanAuxSheets = pgTable(
  "media_plan_aux_sheets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mediaPlanId: uuid("media_plan_id")
      .notNull()
      .references(() => mediaPlans.id, { onDelete: "cascade" }),
    name: text("name").notNull().default("Auxiliar"), // nombre del tab en el Excel
    gridJson: jsonb("grid_json")
      .$type<string[][]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    // Celdas combinadas: rangos {r0,c0,r1,c1} en coords de la grilla. El valor
    // vive en la master (top-left); las tapadas quedan vacías. Ver lib/aux-sheet.ts.
    mergesJson: jsonb("merges_json")
      .$type<{ r0: number; c0: number; r1: number; c1: number }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("idx_mpas_plan").on(t.mediaPlanId, t.sortOrder)],
);

// ════════════════════════════════════════════════════════════════════════════
// Snapshots inmutables — cada vez que el plan se aprueba se guarda el
// estado completo en JSON + el PDF firmado.
// ════════════════════════════════════════════════════════════════════════════

export const mediaPlanSnapshots = pgTable(
  "media_plan_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mediaPlanId: uuid("media_plan_id")
      .notNull()
      .references(() => mediaPlans.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    // Snapshot completo: plan + publishers + placements + fees al momento.
    snapshotJson: jsonb("snapshot_json").notNull(),
    pdfUrl: text("pdf_url"),
    signedPdfUrl: text("signed_pdf_url"),
    approvedAt: timestamp("approved_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    approvedByUserId: uuid("approved_by_user_id"),
    notes: text("notes"),
  },
  (t) => [
    unique("uq_mps_plan_version").on(t.mediaPlanId, t.versionNumber),
    index("idx_mps_plan_approved_at").on(t.mediaPlanId, t.approvedAt),
  ],
);

// ════════════════════════════════════════════════════════════════════════════
// QA del plan — obligatorio para pasar a `live`, y POR VERSIÓN.
//
// Cuando el cliente firma (status `approved`), el planner tiene que verificar
// que la campaña esté ARMADA en las plataformas tal cual se planificó. Abre el
// modal de QA (preview tipo Excel del plan), tilda "controlado" en cada línea
// y recién con todas tildadas puede cerrar el QA → status `qa_done`. De ahí,
// cualquiera puede marcarlo `live`.
//
// Se guarda un RUN por (plan, versión):
//   • Aprobar la v(N+1) crea un run nuevo y vacío → el QA se rehace entero.
//   • Los checks son por placement, con quién y cuándo — así el progreso
//     sobrevive a cerrar el modal y dos planners pueden repartirse el plan.
//   • `placement_id` NO tiene FK: una versión posterior puede borrar la línea,
//     y el registro de QA de la versión vieja se conserva igual.
// ════════════════════════════════════════════════════════════════════════════

export const mediaPlanQaRuns = pgTable(
  "media_plan_qa_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mediaPlanId: uuid("media_plan_id")
      .notNull()
      .references(() => mediaPlans.id, { onDelete: "cascade" }),
    // Versión aprobada que se está controlando (= media_plans.current_version
    // al momento de abrir el QA).
    versionNumber: integer("version_number").notNull(),
    // null = QA en curso. Seteado = QA cerrado (todas las líneas controladas).
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedByUserId: uuid("completed_by_user_id"),
    completedByEmail: text("completed_by_email"),
    // Observaciones libres del planner al cerrar el QA (opcional).
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("uq_mpqr_plan_version").on(t.mediaPlanId, t.versionNumber),
    index("idx_mpqr_plan").on(t.mediaPlanId, t.versionNumber),
  ],
);

export const mediaPlanQaChecks = pgTable(
  "media_plan_qa_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    qaRunId: uuid("qa_run_id")
      .notNull()
      .references(() => mediaPlanQaRuns.id, { onDelete: "cascade" }),
    // Sin FK a media_plan_placements a propósito: la línea puede desaparecer en
    // una versión futura y el QA histórico tiene que seguir existiendo.
    placementId: uuid("placement_id").notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    checkedByUserId: uuid("checked_by_user_id"),
    checkedByEmail: text("checked_by_email"),
  },
  (t) => [
    unique("uq_mpqc_run_placement").on(t.qaRunId, t.placementId),
    index("idx_mpqc_run").on(t.qaRunId),
  ],
);

// ════════════════════════════════════════════════════════════════════════════
// QA de PLANIFICACIÓN — el control del MEDIA PLANNER antes de mandar a firma.
//
// Es el hermano del QA de arriba, en el otro extremo del ciclo. Se hacen en
// momentos distintos, los hace gente distinta y controlan cosas distintas:
//
//   PLANIFICACIÓN (esto)   draft → ready_to_send.  Lo hace el MEDIA PLANNER.
//     Antes de congelar el plan y mandarlo a firma, repasa línea por línea lo
//     que acaba de cargar: cada PLACEMENT y cada ADSET. Es la última lectura
//     antes de que el plan se vuelva un compromiso con el cliente.
//
//   ARMADO (media_plan_qa_runs)   approved → qa_done.  Lo hace el AM/PM.
//     Con el plan ya firmado, controla que la campaña esté montada en las
//     plataformas tal cual el plan.
//
// Por qué TABLAS APARTE y no un `stage` en las de arriba: este QA tilda dos
// tipos de entidad (placements y adsets), el otro sólo placements. Meterlos en
// la misma tabla obligaba a un check polimórfico y a re-hacer los unique de una
// tabla viva. Separadas, la migración es puramente aditiva y el QA que ya
// funciona no se toca.
//
// La versión que se controla es la que el draft VA A SER: `current_version + 1`.
// Así el QA de planificación de la v3 y el QA de armado de la v3 hablan de lo
// mismo, y editar un plan aprobado (que abre la v(N+1)) pide un QA nuevo.
// ════════════════════════════════════════════════════════════════════════════

export const mediaPlanPlanningQaRuns = pgTable(
  "media_plan_planning_qa_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mediaPlanId: uuid("media_plan_id")
      .notNull()
      .references(() => mediaPlans.id, { onDelete: "cascade" }),
    // Versión que este draft va a ser al aprobarse (= current_version + 1).
    versionNumber: integer("version_number").notNull(),
    // null = QA en curso. Seteado = cerrado (todo tildado) → habilitó el pase
    // a ready_to_send. Volver a draft lo limpia: lo que se controló ya no es
    // necesariamente lo que se va a congelar.
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedByUserId: uuid("completed_by_user_id"),
    completedByEmail: text("completed_by_email"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("uq_mppqr_plan_version").on(t.mediaPlanId, t.versionNumber),
    index("idx_mppqr_plan").on(t.mediaPlanId, t.versionNumber),
  ],
);

export const mediaPlanPlanningQaChecks = pgTable(
  "media_plan_planning_qa_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    qaRunId: uuid("qa_run_id")
      .notNull()
      .references(() => mediaPlanPlanningQaRuns.id, { onDelete: "cascade" }),
    // Qué se tildó. Sin FK a propósito (igual que en media_plan_qa_checks): la
    // línea o el adset pueden desaparecer en una versión futura y el registro
    // histórico de lo que se controló tiene que sobrevivir.
    //
    //   itemKind = 'placement' → itemId es un media_plan_placements.id
    //   itemKind = 'adset'     → itemId es un media_plan_traffic_adsets.id
    itemKind: planningQaItemKind("item_kind").notNull(),
    itemId: uuid("item_id").notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    checkedByUserId: uuid("checked_by_user_id"),
    checkedByEmail: text("checked_by_email"),
  },
  (t) => [
    unique("uq_mppqc_run_item").on(t.qaRunId, t.itemKind, t.itemId),
    index("idx_mppqc_run").on(t.qaRunId),
  ],
);

// ════════════════════════════════════════════════════════════════════════════
// Billings del plan, mes a mes. AM carga el consumo por publisher + imputa
// los fees del plan en cada mes (prorrateo manual).
// ════════════════════════════════════════════════════════════════════════════

export const planBillings = pgTable(
  "plan_billings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mediaPlanId: uuid("media_plan_id")
      .notNull()
      .references(() => mediaPlans.id, { onDelete: "cascade" }),
    month: varchar("month", { length: 7 }).notNull(), // YYYY-MM
    status: billingStatus("status").notNull().default("draft"),
    invoiceNumber: text("invoice_number").unique(),
    totalNetUsd: numeric("total_net_usd", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    totalFeeUsd: numeric("total_fee_usd", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    totalUsd: numeric("total_usd", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    pdfUrl: text("pdf_url"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    dueDate: date("due_date"),
    notesMd: text("notes_md"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("uq_pb_plan_month").on(t.mediaPlanId, t.month)],
);

// Consumo por publisher dentro de un billing mensual.
// `isBillable=false` para los publishers que la agencia no factura
// (cliente paga directo). Igual se trackea para reporting.
export const planBillingPublishers = pgTable(
  "plan_billing_publishers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planBillingId: uuid("plan_billing_id")
      .notNull()
      .references(() => planBillings.id, { onDelete: "cascade" }),
    publisherId: uuid("publisher_id")
      .notNull()
      .references(() => publishers.id, { onDelete: "restrict" }),
    amountRealUsd: numeric("amount_real_usd", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    isBillable: boolean("is_billable").notNull().default(true),
    notes: text("notes"),
  },
  (t) => [unique("uq_pbp_billing_publisher").on(t.planBillingId, t.publisherId)],
);

// Imputación de fees del plan en un mes específico. La suma a lo largo
// del tiempo de un fee no debería exceder al fee total del plan
// (validación en app, no DB).
//
// ⚠️ REGLA DURA: LO FACTURADO YA ESTÁ FACTURADO.
// Un plan cambia todo el tiempo (nueva versión, descartar borrador, editar
// fees), pero lo que ya se imputó y se facturó tiene que seguir existiendo y
// mostrándose. Por eso `media_plan_fee_id` es `no action` y NO `cascade`:
// borrar un fee del plan NO puede llevarse en silencio la imputación de los
// meses ya cargados. Si el fee tiene imputaciones > 0, el borrado falla y la
// app lo explica (`removeFee` en app/actions/plans.ts).
// `no action` (y no `restrict`) a propósito: el chequeo queda diferido al fin
// de la sentencia, así el hard delete de un plan sigue funcionando — ahí
// plan_billings cascadea a plan_billing_fees antes de que se evalúe la FK.
// `plan_billing_id` sí queda en cascade: borrar el MES sí debe borrar sus
// líneas.
export const planBillingFees = pgTable(
  "plan_billing_fees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planBillingId: uuid("plan_billing_id")
      .notNull()
      .references(() => planBillings.id, { onDelete: "cascade" }),
    mediaPlanFeeId: uuid("media_plan_fee_id")
      .notNull()
      .references(() => mediaPlanFees.id, { onDelete: "no action" }),
    amountImputedUsd: numeric("amount_imputed_usd", {
      precision: 14,
      scale: 2,
    }).notNull(),
    notes: text("notes"),
  },
  (t) => [unique("uq_pbf_billing_fee").on(t.planBillingId, t.mediaPlanFeeId)],
);

// ════════════════════════════════════════════════════════════════════════════
// Project reports — un row por proyecto cuando pasa a "closed".
// Lifecycle:
//   1. Project status pasa a 'closed' → action crea project_report con
//      closed_at = now() y todo lo demás null (idempotente vía unique).
//   2. Manager asigna fecha → delivery_date + delivery_date_assigned_at
//      = now(). En cada re-edición, delivery_date_assigned_at se reescribe
//      al día de la última asignación (el "compromiso vigente").
//   3. Manager marca delivered → delivered_at = now() + audit log + el
//      proyecto pasa a status 'reportado' y desaparece del calendario.
// ════════════════════════════════════════════════════════════════════════════

export const projectReports = pgTable(
  "project_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .unique()
      .references(() => projects.id, { onDelete: "cascade" }),
    closedAt: timestamp("closed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deliveryDate: date("delivery_date"),
    deliveryDateAssignedAt: timestamp("delivery_date_assigned_at", {
      withTimezone: true,
    }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    // Link al PPT del reporte final (Drive u otro). Opcional: lo carga el
    // analista para encontrarlo rápido a futuro. Solo se guarda la URL.
    reportPptUrl: text("report_ppt_url"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Para el listado del calendario: filtramos delivered_at IS NULL.
    index("idx_project_reports_pending").on(t.deliveredAt, t.deliveryDate),
    // FK: las dos queries del calendario joinean contra projects. Postgres no
    // indexa las FK solo (ver db/reports-fk-index.sql).
    index("idx_project_reports_project").on(t.projectId),
  ],
);

// ════════════════════════════════════════════════════════════════════════════
// Reportes manuales — items "free-form" del reporting calendar que no
// dependen del lifecycle de un proyecto. Sirven para entregas ad-hoc tipo
// recaps trimestrales, presentaciones de oportunidad, etc. La analista los
// crea desde un modal en /reportes/calendario con name + description +
// delivery_date; aparecen en el Gantt y en la lista de enviados igual que
// los project_reports.
// ════════════════════════════════════════════════════════════════════════════

export const manualReports = pgTable(
  "manual_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    deliveryDate: date("delivery_date").notNull(),
    deliveryDateAssignedAt: timestamp("delivery_date_assigned_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    // Mismo concepto que project_reports.report_ppt_url — link al PPT final.
    reportPptUrl: text("report_ppt_url"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_manual_reports_pending").on(t.deliveredAt, t.deliveryDate),
    index("idx_manual_reports_client").on(t.clientId),
  ],
);

// ════════════════════════════════════════════════════════════════════════════
// Comentarios de reportes — tablerito de comments por reporte del Reporting
// Calendar (project_reports y manual_reports por igual). Polimórfico vía dos
// FKs nullable: exactamente UNA seteada (lo valida la server action, no la
// DB). El autor va denormalizado como en audit_log. Al crear un reporte
// manual, su descripción se siembra como primer comentario (con el creador
// como autor); los manuales pre-existentes se backfillean una vez vía SQL
// (ver "acción en prod" en HANDOFF).
// ════════════════════════════════════════════════════════════════════════════

export const reportComments = pgTable(
  "report_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectReportId: uuid("project_report_id").references(
      () => projectReports.id,
      { onDelete: "cascade" },
    ),
    manualReportId: uuid("manual_report_id").references(
      () => manualReports.id,
      { onDelete: "cascade" },
    ),
    body: text("body").notNull(),
    // Autor denormalizado (mismo approach que audit_log). Null = "Sistema"
    // (p.ej. el seed lazy de la descripción de manuales pre-existentes).
    authorUserId: uuid("author_user_id"),
    authorEmail: text("author_email"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_report_comments_project").on(t.projectReportId, t.createdAt),
    index("idx_report_comments_manual").on(t.manualReportId, t.createdAt),
  ],
);

// ════════════════════════════════════════════════════════════════════════════
// Campaign Tracker — valores reales acumulados que carga la trafficker por
// placement y métrica. NO es time-series: hay un solo row por (placement,
// metric_key) y el valor se reemplaza en cada edición (autosave). El
// updated_at es la fuente de la "frescura" del plan en el hub.
//
// Los GOALS no viven acá — se derivan del plan vigente (amount_usd +
// metrics_json de cada placement). Solo se persisten métricas direct
// (amount, impressions, views, clicks, conversions, reach…); las
// calculadas (CPM, CTR, CPV, CPA, frequency) se derivan on-the-fly.
//
// metric_key = 'amount' para inversión, o un slug de metrics_catalog para
// el resto. Unique en (placement_id, metric_key).
// ════════════════════════════════════════════════════════════════════════════

export const campaignPlacementActuals = pgTable(
  "campaign_placement_actuals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    placementId: uuid("placement_id")
      .notNull()
      .references(() => mediaPlanPlacements.id, { onDelete: "cascade" }),
    metricKey: text("metric_key").notNull(), // 'amount' | slug de metrics_catalog
    valueActual: numeric("value_actual", { precision: 16, scale: 4 })
      .notNull()
      .default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedByUserId: uuid("updated_by_user_id"),
  },
  (t) => [
    unique("uq_cpa_placement_metric").on(t.placementId, t.metricKey),
    index("idx_cpa_placement").on(t.placementId),
  ],
);

// ════════════════════════════════════════════════════════════════════════════
// Campaign Tracker — histórico de cargas cerradas ("Cerrar carga del día").
//
// Append-only. Cada vez que la trafficker cierra la carga de un plan se
// escribe (o se reescribe, si re-cierra el mismo día) un row por
// (placement, métrica) con el valor acumulado a esa fecha + el goal del plan
// al momento. Es self-contained: denormaliza client/project/plan/publisher/
// market para que la futura sección de Reportes pueda cruzar sin depender de
// la estructura viva del plan, y para que el histórico quede intacto si
// después se edita o borra un placement.
//
// Solo métricas direct (igual que campaign_placement_actuals); las calculadas
// (CTR, CPV, CPM…) se derivan on-the-fly en Reportes.
//
// Unique en (placement_id, metric_key, snapshot_date) → re-cerrar el mismo
// día actualiza el snapshot en vez de duplicarlo.
// ════════════════════════════════════════════════════════════════════════════

export const campaignActualSnapshots = pgTable(
  "campaign_actual_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    mediaPlanId: uuid("media_plan_id")
      .notNull()
      .references(() => mediaPlans.id, { onDelete: "cascade" }),
    publisherId: uuid("publisher_id")
      .notNull()
      .references(() => publishers.id, { onDelete: "restrict" }),
    marketId: uuid("market_id").references(() => markets.id, {
      onDelete: "set null",
    }),
    placementId: uuid("placement_id")
      .notNull()
      .references(() => mediaPlanPlacements.id, { onDelete: "cascade" }),
    metricKey: text("metric_key").notNull(), // 'amount' | slug de metrics_catalog
    valueAccumulated: numeric("value_accumulated", {
      precision: 16,
      scale: 4,
    }).notNull(),
    // Goal del plan para esa métrica al momento del cierre. Se congela para
    // que el histórico no se mueva si después se edita el plan.
    goalValue: numeric("goal_value", { precision: 16, scale: 4 }),
    snapshotDate: date("snapshot_date").notNull(), // día de cierre (YYYY-MM-DD)
    closedAt: timestamp("closed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedByUserId: uuid("closed_by_user_id"),
  },
  (t) => [
    unique("uq_cas_placement_metric_date").on(
      t.placementId,
      t.metricKey,
      t.snapshotDate,
    ),
    index("idx_cas_plan_date").on(t.mediaPlanId, t.snapshotDate),
    index("idx_cas_client_date").on(t.clientId, t.snapshotDate),
    index("idx_cas_placement").on(t.placementId),
  ],
);

// ════════════════════════════════════════════════════════════════════════════
// Simulator — escenarios "qué pasaría si" que arma un planner antes de
// cotizar un plan real. No reemplazan a media_plans; viven en paralelo y
// se alimentan del benchmark histórico (campaign_actual_snapshots) + del
// catálogo de publishers/markets del cliente. Si un escenario se vuelve un
// plan, se promociona por código (no hay FK).
//
// rowsJson guarda el array de filas del builder con sus overrides y modo
// (p25/p50/p75/manual). Es flexible a propósito — agregar campos no
// requiere migration.
// ════════════════════════════════════════════════════════════════════════════

export const simulatorScenarios = pgTable(
  "simulator_scenarios",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    rowsJson: jsonb("rows_json")
      .$type<ScenarioJson>()
      .notNull()
      .default(sql`'{"rows":[]}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("idx_sim_scenarios_client").on(t.clientId, t.updatedAt)],
);

// ════════════════════════════════════════════════════════════════════════════
// Audit log — sin cambios respecto al schema anterior.
// ════════════════════════════════════════════════════════════════════════════

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    action: text("action").notNull(),
    beforeJson: jsonb("before_json"),
    afterJson: jsonb("after_json"),
    // Supabase auth user id (auth.users.id). Nullable: rows previas al
    // wire-up de auth quedan en null y se renderizan como "Sistema".
    userId: uuid("user_id"),
    // Denormalizado para no joinear a auth.users en cada render. Se setea
    // al insertar desde `recordAudit()` en `lib/audit.ts`.
    userEmail: text("user_email"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_audit_entity").on(t.entityType, t.entityId),
    index("idx_audit_created_at").on(t.createdAt),
  ],
);

// ════════════════════════════════════════════════════════════════════════════
// Facturación de CREATIVE — tabla propia, NO cuelga de un media plan.
//
// El trabajo creativo se factura por campaña pero no tiene plan de medios
// (ni publishers, ni placements, ni fees prorrateados), así que meterlo en
// `plan_billings` obligaría a inventar planes vacíos. Vive aparte y se
// consulta desde /creative.
//
// `campaignCode` guarda el código tal cual viene del Excel de facturación
// (ej. "COPA.c1055.MejoresTarifasCreative"); `projectName` es el nombre
// legible cuando se conoce. Ambos nullable: hay facturas sueltas sin campaña.
//
// Reusa el enum `billing_status` para que el badge y el botón de pago sean
// los mismos que en el resto de la app, pero en la práctica sólo se usan
// 'invoiced' (emitida) y 'paid' (cobrada).
// ════════════════════════════════════════════════════════════════════════════

export const creativeBillings = pgTable(
  "creative_billings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    invoiceNumber: text("invoice_number").notNull().unique(),
    campaignCode: text("campaign_code"),
    projectName: text("project_name"),
    month: varchar("month", { length: 7 }).notNull(), // YYYY-MM
    invoiceDate: date("invoice_date"),
    amountUsd: numeric("amount_usd", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    status: billingStatus("status").notNull().default("invoiced"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    notesMd: text("notes_md"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_creative_billings_month").on(t.month),
    index("idx_creative_billings_client").on(t.clientId),
  ],
);

// ════════════════════════════════════════════════════════════════════════════
// Usuarios y roles.
//
// La identidad la sigue manejando Supabase Auth (`auth.users`): acá NO se
// guardan contraseñas ni se crean cuentas. Esta tabla es la capa de la app
// sobre esa identidad — a quién conocemos, con qué rol y si está activo.
//
// Cómo se puebla: `syncCurrentUser()` hace upsert por email en cada request
// autenticado, así que cualquiera que entre queda listado sin trabajo manual.
// Un admin también puede pre-cargar a alguien por email antes de su primer
// login (queda `last_seen_at` en null hasta que entre).
//
// El email es la clave natural (único, case-insensitive por normalización en
// el código). `auth_user_id` se completa en el primer login.
// ════════════════════════════════════════════════════════════════════════════

export const appUserRole = pgEnum("app_user_role", [
  "admin",          // configura la app y los roles; aprueba planes
  "approver",       // aprueba planes, no toca configuración
  "media_planner",
  "account_manager",
  "finance",
  "viewer",         // solo lectura
]);

export const appUsers = pgTable(
  "app_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    name: text("name"),
    role: appUserRole("role").notNull().default("viewer"),
    active: boolean("active").notNull().default(true),
    authUserId: uuid("auth_user_id"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("idx_app_users_role").on(t.role)],
);
