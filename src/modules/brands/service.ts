import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../../db/client.js';
import { brands, parts } from '../../db/schema/index.js';
import { ApiError } from '../../lib/http.js';

/** Part brands.
 *
 *  Free text on a part until it drifted — "Bosch" and "bosch" were two brands as
 *  far as a filter was concerned. A row now, which a part points at.
 *
 *  Kept apart from categories deliberately. They read almost identically today,
 *  and could share an implementation, but they are different things: a brand is
 *  who made the part and a category is what kind of part it is. One will grow a
 *  field the other does not.
 */

/* ------------------------------------------------------------------ input */

export const brandIdParam = z.object({ id: z.string().uuid() });
export type BrandIdParam = z.infer<typeof brandIdParam>;

export const listBrandsQuery = z.object({
  /** For a type-ahead dropdown on the part form. */
  q: z.string().trim().min(1).max(100).optional(),
  status: z.enum(['active', 'inactive', 'all']).default('active'),
});
export type ListBrandsQuery = z.infer<typeof listBrandsQuery>;

export const createBrandInput = z.object({
  name: z.string().trim().min(1).max(100),
});
export type CreateBrandInput = z.infer<typeof createBrandInput>;

export const updateBrandInput = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateBrandInput = z.infer<typeof updateBrandInput>;

/* ----------------------------------------------------------------- output */

export const brandRow = z.object({
  id: z.string().uuid(),
  name: z.string(),
  isActive: z.boolean(),
  /** How many parts use it, so a screen can say what deactivating would affect. */
  partCount: z.number(),
});
export type BrandRow = z.infer<typeof brandRow>;

/* --------------------------------------------------------------- behaviour */

const like = (value: string) => `%${value.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

export async function listBrands(query: ListBrandsQuery): Promise<BrandRow[]> {
  const db = getDb();
  const status = query.status ?? 'active';

  const conditions = [
    status === 'all' ? undefined : eq(brands.isActive, status === 'active'),
    query.q ? sql`${brands.name} ilike ${like(query.q)}` : undefined,
  ].filter((c) => c !== undefined);

  const rows = await db
    .select({ id: brands.id, name: brands.name, isActive: brands.isActive })
    .from(brands)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(brands.name);

  // Counted separately rather than as a correlated subquery: interpolating a
  // column into raw SQL renders it unqualified, which inside a subquery with its
  // own FROM resolves against the wrong table and returns zero with no error.
  const counts = await db
    .select({ id: parts.brandId, used: sql<number>`count(*)::int` })
    .from(parts)
    .groupBy(parts.brandId);

  const used = new Map(counts.map((c) => [c.id, c.used]));
  return rows.map((row) => ({ ...row, partCount: used.get(row.id) ?? 0 }));
}

export async function createBrand(input: CreateBrandInput): Promise<BrandRow> {
  const db = getDb();

  // Trimmed here rather than relying on the schema having done it. The unique
  // index is on lower(name), so a name arriving with a stray space would miss
  // the clash check and land as a second row that looks identical on screen.
  const name = input.name.trim();

  const [clash] = await db
    .select({ name: brands.name })
    .from(brands)
    .where(sql`lower(${brands.name}) = lower(${name})`)
    .limit(1);

  if (clash) throw ApiError.conflict(`Brand "${clash.name}" already exists`);

  const [created] = await db.insert(brands).values({ name }).returning();
  return { id: created!.id, name: created!.name, isActive: created!.isActive, partCount: 0 };
}

export async function updateBrand(
  id: string,
  input: UpdateBrandInput,
): Promise<BrandRow> {
  const db = getDb();

  const [existing] = await db.select().from(brands).where(eq(brands.id, id)).limit(1);
  if (!existing) throw ApiError.notFound('Brand not found');

  const name = input.name?.trim();

  if (name && name.toLowerCase() !== existing.name.toLowerCase()) {
    const [clash] = await db
      .select({ name: brands.name })
      .from(brands)
      .where(sql`lower(${brands.name}) = lower(${name})`)
      .limit(1);
    if (clash) throw ApiError.conflict(`Brand "${clash.name}" already exists`);
  }

  // Never deleted: a part points at this row, and removing it would leave that
  // part uncategorised. Deactivating takes it out of the dropdown instead.
  await db
    .update(brands)
    .set({ ...input, ...(name ? { name } : {}), updatedAt: new Date() })
    .where(eq(brands.id, id));

  const [row] = (await listBrands({ status: 'all' })).filter((r) => r.id === id);
  return row!;
}
