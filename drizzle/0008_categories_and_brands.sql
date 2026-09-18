CREATE TABLE "app"."brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."parts" ADD COLUMN "brand_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."parts" ADD COLUMN "category_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "brands_name_lower_idx" ON "app"."brands" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "categories_name_lower_idx" ON "app"."categories" USING btree (lower("name"));--> statement-breakpoint
ALTER TABLE "app"."parts" ADD CONSTRAINT "parts_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "app"."brands"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."parts" ADD CONSTRAINT "parts_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "app"."categories"("id") ON DELETE restrict ON UPDATE no action;