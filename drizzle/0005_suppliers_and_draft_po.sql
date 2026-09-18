CREATE SEQUENCE "app"."purchase_order_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
ALTER TABLE "app"."purchase_orders" ALTER COLUMN "fx_rate" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_reference_idx" ON "app"."purchase_orders" USING btree ("reference");