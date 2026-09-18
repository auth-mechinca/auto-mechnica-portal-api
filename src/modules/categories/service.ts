import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../../db/client.js';
import { categories, parts } from '../../db/schema/index.js';
import { ApiError } from '../../lib/http.js';

/** Part categories.
 *
 *  These were free text on a part until they drifted: one part went in as
 *  "Electrical" and another as "Electrical and Charging", and nothing could tell
 *  a new category from a typo of an existing one. They are rows now, and a part
 *  points at one.
 */

/* ------------------------------------------------------------------ input */

export const categoryIdParam = z.object({ id: z.string().uuid() });
export type CategoryIdParam = z.infer<typeof categoryIdParam>;

export const listCategoriesQuery = z.object({
  /** For a type-ahead dropdown on the part form. */
  q: z.string().trim().min(1).max(100).optional(),
  status: z.enum(['active', 'inactive', 'all']).default('active'),
});
export type ListCategoriesQuery = z.infer<typeof listCategoriesQuery>;

export const createCategoryInput = z.object({
  name: z.string().trim().min(1).max(100),
});
export type CreateCategoryInput = z.infer<typeof createCategoryInput>;

export const updateCategoryInput = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateCategoryInput = z.infer<typeof updateCategoryInput>;

/* ----------------------------------------------------------------- output */

export const categoryRow = z.object({
  id: z.string().uuid(),
  name: z.string(),
  isActive: z.boolean(),
  /** How many parts use it, so a screen can say what deactivating would affect. */
  partCount: z.number(),
});
export type CategoryRow = z.infer<typeof categoryRow>;

/* --------------------------------------------------------------- behaviour */

const like = (value: string) => `%${value.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

export async function listCategories(query: ListCategoriesQuery): Promise<CategoryRow[]> {
  const db = getDb();
  const status = query.status ?? 'active';

  const conditions = [
    status === 'all' ? undefined : eq(categories.isActive, status === 'active'),
    query.q ? sql`${categories.name} ilike ${like(query.q)}` : undefined,
  ].filter((c) => c !== undefined);

  const rows = await db
    .select({ id: categories.id, name: categories.name, isActive: categories.isActive })
    .from(categories)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(categories.name);

  // Counted separately rather than as a correlated subquery: interpolating a
  // column into raw SQL renders it unqualified, which inside a subquery with its
  // own FROM resolves against the wrong table and returns zero with no error.
  const counts = await db
    .select({ id: parts.categoryId, used: sql<number>`count(*)::int` })
    .from(parts)
    .groupBy(parts.categoryId);

  const used = new Map(counts.map((c) => [c.id, c.used]));
  return rows.map((row) => ({ ...row, partCount: used.get(row.id) ?? 0 }));
}

export async function createCategory(input: CreateCategoryInput): Promise<CategoryRow> {
  const db = getDb();

  // Trimmed here rather than relying on the schema having done it. The unique
  // index is on lower(name), so a name arriving with a stray space would miss
  // the clash check and land as a second row that looks identical on screen.
  const name = input.name.trim();

  const [clash] = await db
    .select({ name: categories.name })
    .from(categories)
    .where(sql`lower(${categories.name}) = lower(${name})`)
    .limit(1);

  if (clash) throw ApiError.conflict(`Category "${clash.name}" already exists`);

  const [created] = await db.insert(categories).values({ name }).returning();
  return { id: created!.id, name: created!.name, isActive: created!.isActive, partCount: 0 };
}

export async function updateCategory(
  id: string,
  input: UpdateCategoryInput,
): Promise<CategoryRow> {
  const db = getDb();

  const [existing] = await db.select().from(categories).where(eq(categories.id, id)).limit(1);
  if (!existing) throw ApiError.notFound('Category not found');

  const name = input.name?.trim();

  if (name && name.toLowerCase() !== existing.name.toLowerCase()) {
    const [clash] = await db
      .select({ name: categories.name })
      .from(categories)
      .where(sql`lower(${categories.name}) = lower(${name})`)
      .limit(1);
    if (clash) throw ApiError.conflict(`Category "${clash.name}" already exists`);
  }

  // Never deleted: a part points at this row, and removing it would leave that
  // part uncategorised. Deactivating takes it out of the dropdown instead.
  await db
    .update(categories)
    .set({ ...input, ...(name ? { name } : {}), updatedAt: new Date() })
    .where(eq(categories.id, id));

  const [row] = (await listCategories({ status: 'all' })).filter((r) => r.id === id);
  return row!;
}
