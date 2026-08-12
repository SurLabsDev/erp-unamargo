CREATE TABLE "alert_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "alert_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"product_id" uuid NOT NULL,
	"stock_at_trigger" integer NOT NULL,
	"min_stock_at_trigger" integer NOT NULL,
	"recipients" text[] NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_events_status_check" CHECK ("alert_events"."status" in ('sent','failed','skipped'))
);
--> statement-breakpoint
CREATE TABLE "cash_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "cash_categories_name_unique" UNIQUE("name"),
	CONSTRAINT "cash_categories_kind_check" CHECK ("cash_categories"."kind" in ('income','expense'))
);
--> statement-breakpoint
CREATE TABLE "cash_movements" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cash_movements_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"date" date NOT NULL,
	"kind" text NOT NULL,
	"category_id" uuid NOT NULL,
	"concept" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	CONSTRAINT "cash_movements_kind_check" CHECK ("cash_movements"."kind" in ('income','expense')),
	CONSTRAINT "cash_movements_amount_check" CHECK ("cash_movements"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"current_stock" integer DEFAULT 0 NOT NULL,
	"min_stock" integer DEFAULT 0 NOT NULL,
	"low_stock_alerted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_sku_unique" UNIQUE("sku"),
	CONSTRAINT "products_current_stock_check" CHECK ("products"."current_stock" >= 0),
	CONSTRAINT "products_min_stock_check" CHECK ("products"."min_stock" >= 0)
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"company_name" text NOT NULL,
	"currency_code" text DEFAULT 'UYU' NOT NULL,
	"timezone" text DEFAULT 'America/Montevideo' NOT NULL,
	"alert_recipients" text[] DEFAULT '{}'::text[] NOT NULL,
	"initial_balance" numeric(14, 2) DEFAULT '0' NOT NULL,
	"initial_balance_date" date NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_single_row_check" CHECK ("settings"."id" = 1),
	CONSTRAINT "settings_alert_recipients_check" CHECK (cardinality("settings"."alert_recipients") <= 3)
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stock_movements_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"product_id" uuid NOT NULL,
	"type" text NOT NULL,
	"delta" integer NOT NULL,
	"resulting_stock" integer NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_type_check" CHECK ("stock_movements"."type" in ('in','out','adjustment','initial')),
	CONSTRAINT "stock_movements_delta_check" CHECK ("stock_movements"."delta" <> 0),
	CONSTRAINT "stock_movements_resulting_stock_check" CHECK ("stock_movements"."resulting_stock" >= 0),
	CONSTRAINT "stock_movements_type_delta_check" CHECK (("stock_movements"."type" in ('in','initial') and "stock_movements"."delta" > 0) or ("stock_movements"."type" = 'out' and "stock_movements"."delta" < 0) or ("stock_movements"."type" = 'adjustment'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_role_check" CHECK ("users"."role" in ('admin','operator'))
);
--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_category_id_cash_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."cash_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cash_movements_date_idx" ON "cash_movements" USING btree ("date") WHERE "cash_movements"."voided_at" is null;--> statement-breakpoint
CREATE INDEX "stock_movements_product_idx" ON "stock_movements" USING btree ("product_id","created_at" DESC NULLS LAST);