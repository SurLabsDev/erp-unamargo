CREATE TABLE "product_traits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_traits_name_unique" UNIQUE("name"),
	CONSTRAINT "product_traits_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "trait_id" uuid;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "product_trait_label" text DEFAULT 'Característica' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_trait_id_product_traits_id_fk" FOREIGN KEY ("trait_id") REFERENCES "public"."product_traits"("id") ON DELETE no action ON UPDATE no action;