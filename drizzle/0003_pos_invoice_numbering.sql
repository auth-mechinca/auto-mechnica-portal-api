CREATE SEQUENCE "app"."invoice_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
ALTER TABLE "app"."payments" ALTER COLUMN "customer_id" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_invoices_reference_idx" ON "app"."sales_invoices" USING btree ("reference");