import {
  pgTable,
  uuid,
  text,
  varchar,
  date,
  timestamp,
  integer,
  numeric,
  jsonb,
  pgEnum,
  unique,
  index,
} from "drizzle-orm/pg-core";

// ────────────────────────────────────────────────────────────────────────────
// Enums
// ────────────────────────────────────────────────────────────────────────────

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

export const mediaPlanStatus = pgEnum("media_plan_status", [
  "draft",
  "approved",
  "superseded",
]);

export const billingStatus = pgEnum("billing_status", [
  "draft",
  "sent",
  "paid",
  "overdue",
]);

export const publisherEnum = pgEnum("publisher", [
  "YouTube",
  "Meta",
  "TikTok",
  "DV360",
  "OOH",
  "Display",
  "Search",
  "Spotify",
  "Programmatic",
  "Other",
]);

// ────────────────────────────────────────────────────────────────────────────
// Clientes — centro de contratación con Sangria.
// ────────────────────────────────────────────────────────────────────────────

export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logoUrl: text("logo_url"),
  status: clientStatus("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ────────────────────────────────────────────────────────────────────────────
// Budget Origins — centros de costo / fuentes de presupuesto del cliente.
// Un cliente tiene N (ej: "Online", "CMI", "Trade", "Cargo").
// Es la unidad que se factura por separado.
// ────────────────────────────────────────────────────────────────────────────

export const budgetOrigins = pgTable("budget_origins", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  monthlyTargetUsd: numeric("monthly_target_usd", { precision: 14, scale: 2 }),
  colorHex: text("color_hex"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ────────────────────────────────────────────────────────────────────────────
// Proyectos — campañas/iniciativas con fechas + budget origin asociado.
// Regla dura: un plan de medios pertenece a UN solo budget origin (vía
// project.budget_origin_id). No se mezclan orígenes en un plan.
// ────────────────────────────────────────────────────────────────────────────

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    budgetOriginId: uuid("budget_origin_id")
      .notNull()
      .references(() => budgetOrigins.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    code: text("code").notNull(),
    status: projectStatus("status").notNull().default("planning"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    totalBudgetUsd: numeric("total_budget_usd", { precision: 14, scale: 2 }),
    driveFolderUrl: text("drive_folder_url"),
    notesMd: text("notes_md"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("uq_project_client_code").on(t.clientId, t.code)],
);

// ────────────────────────────────────────────────────────────────────────────
// Planes de Medios — un plan trimestral/mensual del proyecto.
// Un proyecto puede tener varios planes (revisiones del cliente), pero solo
// uno con status='approved' a la vez. Eso lo enforzamos en app code, no acá.
// ────────────────────────────────────────────────────────────────────────────

export const mediaPlans = pgTable(
  "media_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    status: mediaPlanStatus("status").notNull().default("draft"),
    excelSourceUrl: text("excel_source_url"),
    importedAt: timestamp("imported_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    // createdBy referencia auth.users(id) gestionada por Supabase Auth.
    // No declaramos la FK acá para no acoplar el schema de Drizzle al
    // schema interno de Supabase (auth.users vive en otro namespace).
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("uq_media_plan_project_version").on(t.projectId, t.version)],
);

// ────────────────────────────────────────────────────────────────────────────
// Líneas del Plan — un placement individual.
// Tras importar el Excel del cliente agrupamos visualmente por publisher,
// pero en la tabla guardamos cada placement como fila propia.
// ────────────────────────────────────────────────────────────────────────────

export const mediaPlanLines = pgTable(
  "media_plan_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mediaPlanId: uuid("media_plan_id")
      .notNull()
      .references(() => mediaPlans.id, { onDelete: "cascade" }),
    publisher: publisherEnum("publisher").notNull(),
    placementName: text("placement_name").notNull(),
    audienceMarket: text("audience_market"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    budgetNetUsd: numeric("budget_net_usd", {
      precision: 14,
      scale: 2,
    }).notNull(),
    feePct: numeric("fee_pct", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    notes: text("notes"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("idx_mpl_media_plan").on(t.mediaPlanId)],
);

// ────────────────────────────────────────────────────────────────────────────
// Gastos reales — autosave en grilla mes a mes (debounce 300ms en UI).
// Cada cambio escribe acá y dispara audit_log. Una fila por (línea, mes).
// ────────────────────────────────────────────────────────────────────────────

export const actualSpend = pgTable(
  "actual_spend",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mediaPlanLineId: uuid("media_plan_line_id")
      .notNull()
      .references(() => mediaPlanLines.id, { onDelete: "cascade" }),
    month: varchar("month", { length: 7 }).notNull(), // formato YYYY-MM
    amountUsd: numeric("amount_usd", { precision: 14, scale: 2 }).notNull(),
    note: text("note"),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    recordedBy: uuid("recorded_by"),
  },
  (t) => [
    unique("uq_actual_spend_line_month").on(t.mediaPlanLineId, t.month),
    index("idx_actual_spend_month").on(t.month),
  ],
);

// ────────────────────────────────────────────────────────────────────────────
// Billing — factura mensual generada por (proyecto, mes).
// Se factura por budget origin porque cada origen es contablemente
// independiente. Una factura cubre un solo budget origin.
// ────────────────────────────────────────────────────────────────────────────

export const billings = pgTable(
  "billings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    budgetOriginId: uuid("budget_origin_id")
      .notNull()
      .references(() => budgetOrigins.id, { onDelete: "restrict" }),
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
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("uq_billing_project_month").on(t.projectId, t.month)],
);

export const billingLines = pgTable("billing_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  billingId: uuid("billing_id")
    .notNull()
    .references(() => billings.id, { onDelete: "cascade" }),
  mediaPlanLineId: uuid("media_plan_line_id")
    .notNull()
    .references(() => mediaPlanLines.id, { onDelete: "restrict" }),
  amountNet: numeric("amount_net", { precision: 14, scale: 2 }).notNull(),
  feeAmount: numeric("fee_amount", { precision: 14, scale: 2 }).notNull(),
  total: numeric("total", { precision: 14, scale: 2 }).notNull(),
});

// ────────────────────────────────────────────────────────────────────────────
// Audit log — toda edición se audita (regla dura del prompt §6).
// Cada actualización de actual_spend, media_plan_line, etc., escribe acá
// con before/after JSON.
// ────────────────────────────────────────────────────────────────────────────

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    action: text("action").notNull(), // 'create' | 'update' | 'delete'
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
