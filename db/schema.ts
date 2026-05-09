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
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// ════════════════════════════════════════════════════════════════════════════
// Enums
// ════════════════════════════════════════════════════════════════════════════

export const clientStatus = pgEnum("client_status", [
  "active",
  "paused",
  "archived",
]);

export const projectStatus = pgEnum("project_status", [
  "planning",
  "active",
  "paused",
  "closed",
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
  "draft",
  "ready",
  "sent",
  "paid",
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
  "CPM",
  "CPC",
  "CPV",
  "CPA",
  "Flat",
  "Other",
]);

// ════════════════════════════════════════════════════════════════════════════
// Catálogo de publishers (editable desde /configuracion/publishers).
// Reemplaza el enum hardcodeado que teníamos antes.
// ════════════════════════════════════════════════════════════════════════════

export const publishers = pgTable(
  "publishers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),       // youtube, meta, tiktok
    name: text("name").notNull(),                 // YouTube, Meta, TikTok
    enabled: boolean("enabled").notNull().default(true),
    // Default agency-pays. La agencia factura los publishers que ella paga;
    // los que el cliente paga directo no aparecen en facturas (tracking sí).
    agencyPaysDefault: boolean("agency_pays_default").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("idx_publishers_enabled").on(t.enabled, t.sortOrder)],
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
  monthlyTargetUsd: numeric("monthly_target_usd", { precision: 14, scale: 2 }),
  colorHex: text("color_hex"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ════════════════════════════════════════════════════════════════════════════
// Proyectos. AM crea el proyecto con metadata principal + total gross budget.
// Code sigue convención: <CLIENT_PREFIX>.m<id>.<ProjectName>
// Ej: "COPA.mCostaRica2026", "COPA.m1234.SubeLaMarea"
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
  startDate: date("start_date"),
  endDate: date("end_date"),
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
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    // 0 = nunca aprobado. Cada vez que se aprueba se crea un snapshot e
    // incrementa este contador.
    currentVersion: integer("current_version").notNull().default(0),
    notesMd: text("notes_md"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("uq_media_plan_project_name").on(t.projectId, t.name)],
);

// ════════════════════════════════════════════════════════════════════════════
// Publisher dentro de un plan. Tiene un total planeado que debe coincidir
// con la suma de sus placements.
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
    // Si está seteado, override del agencyPaysDefault del catálogo.
    agencyPaysOverride: boolean("agency_pays_override"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("uq_mpp_plan_publisher").on(t.mediaPlanId, t.publisherId)],
);

// ════════════════════════════════════════════════════════════════════════════
// Placements (líneas) dentro de un publisher dentro de un plan.
// Cada placement: nombre, mercado, monto, cost_method, indicadores flexibles
// (jsonb: cpc, ctr, est_imp, etc.) y notas free-text para audiencia/formato.
// ════════════════════════════════════════════════════════════════════════════

export const mediaPlanPlacements = pgTable(
  "media_plan_placements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mediaPlanPublisherId: uuid("media_plan_publisher_id")
      .notNull()
      .references(() => mediaPlanPublishers.id, { onDelete: "cascade" }),
    placementName: text("placement_name").notNull(),
    market: text("market"),
    amountUsd: numeric("amount_usd", { precision: 14, scale: 2 }).notNull(),
    costMethod: costMethod("cost_method"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    // Diccionario flexible: { cpc: 0.012, ctr: 0.5, est_imp: 1000000, ... }
    metricsJson: jsonb("metrics_json")
      .$type<Record<string, number>>()
      .default(sql`'{}'::jsonb`),
    notesMd: text("notes_md"), // audiencia / formatos / detalles libres
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
    userId: uuid("user_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_audit_entity").on(t.entityType, t.entityId),
    index("idx_audit_created_at").on(t.createdAt),
  ],
);
