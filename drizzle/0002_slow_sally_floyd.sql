ALTER TABLE "app"."sales_invoices" ADD COLUMN "due_date" date NOT NULL;--> statement-breakpoint
CREATE INDEX "sales_invoices_due_date_idx" ON "app"."sales_invoices" USING btree ("due_date");