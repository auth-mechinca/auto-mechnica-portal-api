CREATE SCHEMA "app";
--> statement-breakpoint
CREATE TYPE "app"."adjustment_reason" AS ENUM('damage', 'loss', 'count_correction');--> statement-breakpoint
CREATE TYPE "app"."momo_network" AS ENUM('mtn', 'telecel', 'airteltigo');--> statement-breakpoint
CREATE TYPE "app"."movement_type" AS ENUM('po_receipt', 'sale', 'adjustment');--> statement-breakpoint
CREATE TYPE "app"."payment_method" AS ENUM('cash', 'cheque', 'momo');--> statement-breakpoint
CREATE TYPE "app"."payment_status" AS ENUM('pending', 'cleared', 'bounced');--> statement-breakpoint
CREATE TYPE "app"."po_status" AS ENUM('draft', 'sent', 'partially_received', 'received', 'cancelled');--> statement-breakpoint
CREATE TYPE "app"."user_role" AS ENUM('sales', 'purchasing', 'accountant', 'admin');--> statement-breakpoint
CREATE TABLE "app"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" text NOT NULL,
	"role" "app"."user_role" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"part_number" text,
	"oem_number" text,
	"brand" text,
	"category" text,
	"fitment" text[] DEFAULT '{}' NOT NULL,
	"reorder_point" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"part_id" uuid NOT NULL,
	"landed_cost" numeric(14, 2),
	"suggested_price" numeric(14, 2),
	"final_price" numeric(14, 2),
	"margin_pct_used" numeric(6, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."inventory_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"part_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"quantity" numeric(14, 3) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"part_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"type" "app"."movement_type" NOT NULL,
	"quantity_delta" numeric(14, 3) NOT NULL,
	"reason" "app"."adjustment_reason",
	"note" text,
	"reference_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."purchase_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"part_id" uuid NOT NULL,
	"quantity_ordered" numeric(14, 3) NOT NULL,
	"quantity_received" numeric(14, 3) DEFAULT '0' NOT NULL,
	"unit_cost_usd" numeric(14, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"status" "app"."po_status" DEFAULT 'draft' NOT NULL,
	"order_date" date NOT NULL,
	"fx_rate" numeric(12, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"contact_person" text,
	"phone" text,
	"email" text,
	"currency" text DEFAULT 'USD' NOT NULL,
	"payment_terms" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."sales_invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"part_id" uuid NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"unit_price" numeric(14, 2) NOT NULL,
	"line_total" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."sales_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"customer_id" uuid,
	"invoice_date" date NOT NULL,
	"total_amount" numeric(14, 2) NOT NULL,
	"sold_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."cheques" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"cheque_number" text NOT NULL,
	"bank_name" text,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."momo_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"network" "app"."momo_network" NOT NULL,
	"transaction_id" text NOT NULL,
	"phone_number" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"method" "app"."payment_method" NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"status" "app"."payment_status" NOT NULL,
	"payment_date" date NOT NULL,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."prices" ADD CONSTRAINT "prices_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "app"."parts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inventory_balances" ADD CONSTRAINT "inventory_balances_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "app"."parts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inventory_balances" ADD CONSTRAINT "inventory_balances_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "app"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."stock_movements" ADD CONSTRAINT "stock_movements_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "app"."parts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."stock_movements" ADD CONSTRAINT "stock_movements_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "app"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."stock_movements" ADD CONSTRAINT "stock_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "app"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "app"."parts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "app"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "app"."sales_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "app"."parts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."sales_invoices" ADD CONSTRAINT "sales_invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "app"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."sales_invoices" ADD CONSTRAINT "sales_invoices_sold_by_users_id_fk" FOREIGN KEY ("sold_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cheques" ADD CONSTRAINT "cheques_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "app"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cheques" ADD CONSTRAINT "cheques_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."momo_transactions" ADD CONSTRAINT "momo_transactions_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "app"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "app"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."payment_allocations" ADD CONSTRAINT "payment_allocations_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "app"."sales_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."payments" ADD CONSTRAINT "payments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "app"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."payments" ADD CONSTRAINT "payments_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_idx" ON "app"."users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "parts_sku_idx" ON "app"."parts" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "parts_part_number_idx" ON "app"."parts" USING btree ("part_number");--> statement-breakpoint
CREATE INDEX "parts_name_idx" ON "app"."parts" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "prices_part_idx" ON "app"."prices" USING btree ("part_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_balances_part_location_idx" ON "app"."inventory_balances" USING btree ("part_id","location_id");--> statement-breakpoint
CREATE INDEX "stock_movements_part_idx" ON "app"."stock_movements" USING btree ("part_id","location_id");--> statement-breakpoint
CREATE INDEX "stock_movements_reference_idx" ON "app"."stock_movements" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX "purchase_order_lines_po_idx" ON "app"."purchase_order_lines" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_supplier_idx" ON "app"."purchase_orders" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "sales_invoice_lines_invoice_idx" ON "app"."sales_invoice_lines" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "sales_invoices_customer_idx" ON "app"."sales_invoices" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "cheques_payment_idx" ON "app"."cheques" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "payment_allocations_payment_idx" ON "app"."payment_allocations" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "payment_allocations_invoice_idx" ON "app"."payment_allocations" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "payments_customer_idx" ON "app"."payments" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "app"."payments" USING btree ("status");