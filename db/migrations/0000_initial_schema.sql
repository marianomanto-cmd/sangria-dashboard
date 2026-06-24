CREATE TYPE "public"."billing_status" AS ENUM('draft', 'ready', 'sent', 'paid');--> statement-breakpoint
CREATE TYPE "public"."client_status" AS ENUM('active', 'paused', 'archived');--> statement-breakpoint
CREATE TYPE "public"."cost_method" AS ENUM('dCPV', 'dCPC', 'dCPM', 'CPM', 'CPC', 'CPV', 'CPA', 'Flat', 'Other');--> statement-breakpoint
CREATE TYPE "public"."fee_type" AS ENUM('management', 'setup', 'reporting', 'custom');--> statement-breakpoint
CREATE TYPE "public"."metric_kind" AS ENUM('direct', 'calculated');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('draft', 'ready_to_send', 'approved', 'archived');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('planning', 'active', 'paused', 'closed');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"before_json" jsonb,
	"after_json" jsonb,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_origins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"monthly_target_usd" numeric(14, 2),
	"color_hex" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_publishers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"publisher_id" uuid NOT NULL,
	"agency_pays" boolean DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_cp_client_publisher" UNIQUE("client_id","publisher_id")
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"prefix" text,
	"logo_url" text,
	"status" "client_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clients_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "markets_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "media_plan_fees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_plan_id" uuid NOT NULL,
	"fee_type" "fee_type" NOT NULL,
	"name" text NOT NULL,
	"rate_pct" numeric(5, 2),
	"amount_usd" numeric(14, 2) NOT NULL,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_plan_placements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_plan_publisher_id" uuid NOT NULL,
	"placement_name" text NOT NULL,
	"market_id" uuid,
	"audience" text,
	"amount_usd" numeric(14, 2) NOT NULL,
	"cost_method" "cost_method",
	"start_date" date,
	"end_date" date,
	"metrics_json" jsonb DEFAULT '{}'::jsonb,
	"notes_md" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_plan_publishers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_plan_id" uuid NOT NULL,
	"publisher_id" uuid NOT NULL,
	"total_planned_usd" numeric(14, 2) DEFAULT '0' NOT NULL,
	"agency_pays_override" boolean,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_mpp_plan_publisher" UNIQUE("media_plan_id","publisher_id")
);
--> statement-breakpoint
CREATE TABLE "media_plan_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_plan_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"snapshot_json" jsonb NOT NULL,
	"pdf_url" text,
	"signed_pdf_url" text,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by_user_id" uuid,
	"notes" text,
	CONSTRAINT "uq_mps_plan_version" UNIQUE("media_plan_id","version_number")
);
--> statement-breakpoint
CREATE TABLE "media_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "plan_status" DEFAULT 'draft' NOT NULL,
	"current_version" integer DEFAULT 0 NOT NULL,
	"notes_md" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_media_plan_project_name" UNIQUE("project_id","name")
);
--> statement-breakpoint
CREATE TABLE "metrics_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" "metric_kind" NOT NULL,
	"unit" text,
	"formula" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metrics_catalog_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "plan_billing_fees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_billing_id" uuid NOT NULL,
	"media_plan_fee_id" uuid NOT NULL,
	"amount_imputed_usd" numeric(14, 2) NOT NULL,
	"notes" text,
	CONSTRAINT "uq_pbf_billing_fee" UNIQUE("plan_billing_id","media_plan_fee_id")
);
--> statement-breakpoint
CREATE TABLE "plan_billing_publishers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_billing_id" uuid NOT NULL,
	"publisher_id" uuid NOT NULL,
	"amount_real_usd" numeric(14, 2) DEFAULT '0' NOT NULL,
	"is_billable" boolean DEFAULT true NOT NULL,
	"notes" text,
	CONSTRAINT "uq_pbp_billing_publisher" UNIQUE("plan_billing_id","publisher_id")
);
--> statement-breakpoint
CREATE TABLE "plan_billings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_plan_id" uuid NOT NULL,
	"month" varchar(7) NOT NULL,
	"status" "billing_status" DEFAULT 'draft' NOT NULL,
	"invoice_number" text,
	"total_net_usd" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total_fee_usd" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total_usd" numeric(14, 2) DEFAULT '0' NOT NULL,
	"pdf_url" text,
	"sent_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"due_date" date,
	"notes_md" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_billings_invoice_number_unique" UNIQUE("invoice_number"),
	CONSTRAINT "uq_pb_plan_month" UNIQUE("media_plan_id","month")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"budget_origin_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"status" "project_status" DEFAULT 'planning' NOT NULL,
	"start_date" date,
	"total_gross_budget_usd" numeric(14, 2),
	"drive_folder_url" text,
	"notes_md" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "publishers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"agency_pays_default" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publishers_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "budget_origins" ADD CONSTRAINT "budget_origins_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_publishers" ADD CONSTRAINT "client_publishers_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_publishers" ADD CONSTRAINT "client_publishers_publisher_id_publishers_id_fk" FOREIGN KEY ("publisher_id") REFERENCES "public"."publishers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_plan_fees" ADD CONSTRAINT "media_plan_fees_media_plan_id_media_plans_id_fk" FOREIGN KEY ("media_plan_id") REFERENCES "public"."media_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_plan_placements" ADD CONSTRAINT "media_plan_placements_media_plan_publisher_id_media_plan_publishers_id_fk" FOREIGN KEY ("media_plan_publisher_id") REFERENCES "public"."media_plan_publishers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_plan_placements" ADD CONSTRAINT "media_plan_placements_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_plan_publishers" ADD CONSTRAINT "media_plan_publishers_media_plan_id_media_plans_id_fk" FOREIGN KEY ("media_plan_id") REFERENCES "public"."media_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_plan_publishers" ADD CONSTRAINT "media_plan_publishers_publisher_id_publishers_id_fk" FOREIGN KEY ("publisher_id") REFERENCES "public"."publishers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_plan_snapshots" ADD CONSTRAINT "media_plan_snapshots_media_plan_id_media_plans_id_fk" FOREIGN KEY ("media_plan_id") REFERENCES "public"."media_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_plans" ADD CONSTRAINT "media_plans_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_billing_fees" ADD CONSTRAINT "plan_billing_fees_plan_billing_id_plan_billings_id_fk" FOREIGN KEY ("plan_billing_id") REFERENCES "public"."plan_billings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_billing_fees" ADD CONSTRAINT "plan_billing_fees_media_plan_fee_id_media_plan_fees_id_fk" FOREIGN KEY ("media_plan_fee_id") REFERENCES "public"."media_plan_fees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_billing_publishers" ADD CONSTRAINT "plan_billing_publishers_plan_billing_id_plan_billings_id_fk" FOREIGN KEY ("plan_billing_id") REFERENCES "public"."plan_billings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_billing_publishers" ADD CONSTRAINT "plan_billing_publishers_publisher_id_publishers_id_fk" FOREIGN KEY ("publisher_id") REFERENCES "public"."publishers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_billings" ADD CONSTRAINT "plan_billings_media_plan_id_media_plans_id_fk" FOREIGN KEY ("media_plan_id") REFERENCES "public"."media_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_budget_origin_id_budget_origins_id_fk" FOREIGN KEY ("budget_origin_id") REFERENCES "public"."budget_origins"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_entity" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_audit_created_at" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_cp_client" ON "client_publishers" USING btree ("client_id","enabled","sort_order");--> statement-breakpoint
CREATE INDEX "idx_markets_enabled" ON "markets" USING btree ("enabled","sort_order");--> statement-breakpoint
CREATE INDEX "idx_placements_mpp" ON "media_plan_placements" USING btree ("media_plan_publisher_id");--> statement-breakpoint
CREATE INDEX "idx_mps_plan_approved_at" ON "media_plan_snapshots" USING btree ("media_plan_id","approved_at");--> statement-breakpoint
CREATE INDEX "idx_metrics_enabled" ON "metrics_catalog" USING btree ("enabled","sort_order");--> statement-breakpoint
CREATE INDEX "idx_publishers_enabled" ON "publishers" USING btree ("enabled","sort_order");