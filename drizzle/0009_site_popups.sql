CREATE TABLE "site_popups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"image_path" text,
	"cta_label" text,
	"cta_url" text,
	"starts_on" date,
	"ends_on" date,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_popups_cta_check" CHECK (("site_popups"."cta_label" is null) = ("site_popups"."cta_url" is null)),
	CONSTRAINT "site_popups_dates_check" CHECK ("site_popups"."starts_on" is null or "site_popups"."ends_on" is null or "site_popups"."ends_on" >= "site_popups"."starts_on")
);
--> statement-breakpoint
ALTER TABLE "site_popups" ADD CONSTRAINT "site_popups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;