CREATE TABLE "product_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "product_categories_name_unique" UNIQUE("name"),
	CONSTRAINT "product_categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "product_subtypes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "product_subtypes_category_name_key" UNIQUE("category_id","name"),
	CONSTRAINT "product_subtypes_category_slug_key" UNIQUE("category_id","slug"),
	CONSTRAINT "product_subtypes_id_category_key" UNIQUE("id","category_id")
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "subtype_id" uuid;--> statement-breakpoint
ALTER TABLE "product_subtypes" ADD CONSTRAINT "product_subtypes_category_id_product_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."product_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_product_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."product_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_subtype_belongs_to_category_fk" FOREIGN KEY ("subtype_id","category_id") REFERENCES "public"."product_subtypes"("id","category_id") ON DELETE no action ON UPDATE no action;