ALTER TABLE "stock_movements" ADD COLUMN "unit_price" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "campaign_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_campaign_id_discount_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."discount_campaigns"("id") ON DELETE no action ON UPDATE no action;