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
//   approved      → cliente firmó, plan vigente, ediciones futuras crean nueva versión
//   archived      → reemplazado por una nueva versión approved o cancelado
export const planStatus = pgEnum("plan_status", [
  "draft",
  "ready_to_send",
  "approved",
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
export const planBillingFees = pgTable(
  "plan_billing_fees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planBillingId: uuid("plan_billing_id")
      .notNull()
      .references(() => planBillings.id, { onDelete: "cascade" }),
    mediaPlanFeeId: uuid("media_plan_fee_id")
      .notNull()
      .references(() => mediaPlanFees.id, { onDelete: "cascade" }),
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
