CREATE TABLE "site_strip_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"image_path" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"alt" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_strip_photos_image_path_unique" UNIQUE("image_path"),
	CONSTRAINT "site_strip_photos_size_check" CHECK ("site_strip_photos"."width" > 0 and "site_strip_photos"."height" > 0)
);
--> statement-breakpoint
ALTER TABLE "site_strip_photos" ADD CONSTRAINT "site_strip_photos_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;