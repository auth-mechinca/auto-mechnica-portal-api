-- Data migration, not a schema one. Drizzle generates structure; moving the
-- values that were already in the text columns is this file's job.
--
-- Written as insert-from-select so it works against whatever a given database
-- happens to hold, rather than assuming the demo seed.

-- One row per distinct name, case-insensitively: "Bosch" and "bosch" would
-- otherwise both insert and then collide with the unique index.
INSERT INTO "app"."categories" ("name")
SELECT DISTINCT ON (lower(trim(category))) trim(category)
  FROM "app"."parts"
 WHERE category IS NOT NULL AND trim(category) <> ''
 ORDER BY lower(trim(category)), trim(category);
--> statement-breakpoint

INSERT INTO "app"."brands" ("name")
SELECT DISTINCT ON (lower(trim(brand))) trim(brand)
  FROM "app"."parts"
 WHERE brand IS NOT NULL AND trim(brand) <> ''
 ORDER BY lower(trim(brand)), trim(brand);
--> statement-breakpoint

UPDATE "app"."parts" p
   SET category_id = c.id
  FROM "app"."categories" c
 WHERE lower(trim(p.category)) = lower(c.name);
--> statement-breakpoint

UPDATE "app"."parts" p
   SET brand_id = b.id
  FROM "app"."brands" b
 WHERE lower(trim(p.brand)) = lower(b.name);
