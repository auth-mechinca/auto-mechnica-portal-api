CREATE TYPE "app"."price_change_source" AS ENUM('po_receipt', 'manual');--> statement-breakpoint
CREATE TABLE "app"."price_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"part_id" uuid NOT NULL,
	"landed_cost" numeric(14, 2),
	"suggested_price" numeric(14, 2),
	"final_price" numeric(14, 2),
	"margin_pct_used" numeric(6, 2),
	"source" "app"."price_change_source" NOT NULL,
	"reference_id" uuid,
	"changed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."price_history" ADD CONSTRAINT "price_history_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "app"."parts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."price_history" ADD CONSTRAINT "price_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "price_history_part_idx" ON "app"."price_history" USING btree ("part_id","created_at");