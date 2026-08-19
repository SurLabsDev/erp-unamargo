CREATE TABLE "discount_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"percentage" smallint NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discount_campaigns_percentage_check" CHECK ("discount_campaigns"."percentage" between 1 and 90),
	CONSTRAINT "discount_campaigns_dates_check" CHECK ("discount_campaigns"."ends_on" >= "discount_campaigns"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "discount_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"product_id" uuid,
	"subtype_id" uuid,
	"category_id" uuid,
	CONSTRAINT "discount_targets_exactly_one_check" CHECK (num_nonnulls("discount_targets"."product_id", "discount_targets"."subtype_id", "discount_targets"."category_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "discount_campaigns" ADD CONSTRAINT "discount_campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_targets" ADD CONSTRAINT "discount_targets_campaign_id_discount_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."discount_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_targets" ADD CONSTRAINT "discount_targets_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_targets" ADD CONSTRAINT "discount_targets_subtype_id_product_subtypes_id_fk" FOREIGN KEY ("subtype_id") REFERENCES "public"."product_subtypes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_targets" ADD CONSTRAINT "discount_targets_category_id_product_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."product_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discount_targets_campaign_idx" ON "discount_targets" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "discount_targets_campaign_product_key" ON "discount_targets" USING btree ("campaign_id","product_id") WHERE "discount_targets"."product_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "discount_targets_campaign_subtype_key" ON "discount_targets" USING btree ("campaign_id","subtype_id") WHERE "discount_targets"."subtype_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "discount_targets_campaign_category_key" ON "discount_targets" USING btree ("campaign_id","category_id") WHERE "discount_targets"."category_id" is not null;