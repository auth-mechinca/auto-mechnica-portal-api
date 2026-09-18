ALTER TABLE "app"."purchase_orders" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."purchase_orders" ADD COLUMN "resolved_by" uuid;--> statement-breakpoint
ALTER TABLE "app"."purchase_orders" ADD COLUMN "resolution_reason" text;--> statement-breakpoint
ALTER TABLE "app"."purchase_orders" ADD CONSTRAINT "purchase_orders_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;