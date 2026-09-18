import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Tx } from '../../db/client.js';
import { defaultLocationId } from '../../db/defaults.js';
import {
  brands,
  categories,
  inventoryBalances,
  parts,
  prices,
  purchaseOrderLines,
  purchaseOrders,
  stockMovements,
  suppliers,
  users,
} from '../../db/schema/index.js';
import { ApiError } from '../../lib/http.js';
import { compare, subtract } from '../../lib/money.js';

/** Inventory. Section 4 of the demo scope.
 *
 *  The rule the whole module is arranged around: **stock is never typed.** There
 *  is no endpoint here that sets a balance. It moves only through a purchase
 *  order receipt, a sale, or an adjustment recorded with a reason — and each of
 *  those writes a movement explaining itself, so the ledger always adds up to
 *  the balance.
 */

/* ------------------------------------------------------------------ input */

export const partIdParam = z.object({ id: z.string().uuid() });
export type PartIdParam = z.infer<typeof partIdParam>;

export const listPartsQuery = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  categoryId: z.string().uuid().optional(),
  brandId: z.string().uuid().optional(),
  belowReorder: z.coerce.boolean().optional(),
  status: z.enum(['active', 'inactive', 'all']).default('active'),
});
export type ListPartsQuery = z.infer<typeof listPartsQuery>;

const partFields = {
  sku: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(200),
  partNumber: z.string().trim().max(100).nullish(),
  oemNumber: z.string().trim().max(100).nullish(),
  /** References now, not free text. The UI picks from the category and brand
   *  endpoints, creating one on the fly if the officer types a new name. */
  brandId: z.string().uuid().nullish(),
  categoryId: z.string().uuid().nullish(),
  /** Free-text Year/Make/Model/Engine lines. Section 4 is explicit that this is
   *  not a cross-reference database for the demo. */
  fitment: z.array(z.string().trim().min(1).max(200)).default([]),
  reorderPoint: z.number().int().min(0).max(1_000_000).default(0),
  isActive: z.boolean().default(true),
};

export const createPartInput = z.object(partFields);
export type CreatePartInput = z.infer<typeof createPartInput>;

export const updatePartInput = z.object(partFields).partial();
export type UpdatePartInput = z.infer<typeof updatePartInput>;

export const adjustStockInput = z.object({
  direction: z.enum(['increase', 'decrease']),
  quantity: z.number().int().positive().max(1_000_000),
  /** Required, and the point of the screen: an adjustment without a reason is
   *  indistinguishable from someone editing stock to whatever they wanted. */
  reason: z.enum(['damage', 'loss', 'count_correction']),
  note: z.string().trim().max(500).optional(),
});
export type AdjustStockInput = z.infer<typeof adjustStockInput>;

/* ----------------------------------------------------------------- output */

export const partRow = z.object({
  id: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  partNumber: z.string().nullable(),
  oemNumber: z.string().nullable(),
  brand: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  category: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  fitment: z.array(z.string()),
  reorderPoint: z.number(),
  isActive: z.boolean(),
  onHand: z.string(),
  /** Null until Price Management has set one. Such a part cannot be sold. */
  sellPrice: z.string().nullable(),
  belowReorderPoint: z.boolean(),
});
export type PartRow = z.infer<typeof partRow>;

export const partsResponse = z.object({
  parts: z.array(partRow),
  belowReorderCount: z.number(),
});
export type PartsResponse = z.infer<typeof partsResponse>;

export const movementRow = z.object({
  at: z.string(),
  type: z.enum(['po_receipt', 'sale', 'adjustment']),
  quantityDelta: z.string(),
  /** Running balance immediately after this movement, so the ledger can be read
   *  down the page and checked against the figure at the top. */
  onHandAfter: z.string(),
  reason: z.enum(['damage', 'loss', 'count_correction']).nullable(),
  note: z.string().nullable(),
  /** The invoice or purchase order that caused it, where there is one. */
  reference: z.string().nullable(),
  by: z.string().nullable(),
});
export type MovementRow = z.infer<typeof movementRow>;

export const partDetail = partRow.extend({
  /** Visible to purchasing and admin only — never returned by the POS search. */
  landedCost: z.string().nullable(),
  movements: z.array(movementRow),
});
export type PartDetail = z.infer<typeof partDetail>;

export const lowStockRow = z.object({
  id: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  brand: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  onHand: z.string(),
  reorderPoint: z.number(),
  shortBy: z.string(),
  lastReceived: z.string().nullable(),
  usualSupplier: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  /** Already on order, so the shortfall may already be covered. */
  onOrder: z.object({ quantity: z.string(), reference: z.string() }).nullable(),
});
export type LowStockRow = z.infer<typeof lowStockRow>;

export const adjustmentRow = z.object({
  at: z.string(),
  partId: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  reason: z.enum(['damage', 'loss', 'count_correction']),
  quantityDelta: z.string(),
  note: z.string().nullable(),
  by: z.string().nullable(),
});
export type AdjustmentRow = z.infer<typeof adjustmentRow>;

/* ---------------------------------------------------------------- reading */

type PartQueryRow = Omit<PartRow, 'belowReorderPoint' | 'brand' | 'category'> & {
  brandId: string | null;
  brandName: string | null;
  categoryId: string | null;
  categoryName: string | null;
};

const like = (value: string) => `%${value.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

export async function listParts(query: ListPartsQuery): Promise<PartsResponse> {
  const db = getDb();

  // Conditions are composed rather than written as `${value}::text is null`
  // checks inside one fixed statement. That trick reads neatly until a caller
  // reaches the service without going through the schema — an absent value then
  // renders as a bare cast and Postgres rejects the whole query.
  const status = query.status ?? 'active';
  const conditions = [
    status === 'all' ? undefined : sql`p.is_active = ${status === 'active'}`,
    query.q
      ? sql`(p.name ilike ${like(query.q)} or p.sku ilike ${like(query.q)}
             or p.part_number ilike ${like(query.q)} or p.oem_number ilike ${like(query.q)})`
      : undefined,
    query.categoryId ? sql`p.category_id = ${query.categoryId}` : undefined,
    query.brandId ? sql`p.brand_id = ${query.brandId}` : undefined,
  ].filter((c) => c !== undefined);

  const where =
    conditions.length > 0 ? sql`where ${sql.join(conditions, sql` and `)}` : sql``;

  const { rows } = await db.execute<PartQueryRow>(sql`
    select p.id,
           p.sku,
           p.name,
           p.part_number   as "partNumber",
           p.oem_number    as "oemNumber",
           p.brand_id      as "brandId",
           b2.name         as "brandName",
           p.category_id   as "categoryId",
           c2.name         as "categoryName",
           p.fitment,
           p.reorder_point as "reorderPoint",
           p.is_active     as "isActive",
           -- Cast rather than coalesce to a literal: a part with no balance row
           -- would otherwise read "0" where every other row reads "0.000".
           coalesce(b.quantity, 0)::numeric(14, 3)::text as "onHand",
           pr.final_price  as "sellPrice"
      from ${parts} p
      left join ${inventoryBalances} b on b.part_id = p.id
      left join ${prices} pr on pr.part_id = p.id
      left join ${brands} b2 on b2.id = p.brand_id
      left join ${categories} c2 on c2.id = p.category_id
    ${where}
     order by p.name
  `);

  const all = rows.map(({ brandId, brandName, categoryId, categoryName, ...row }) => ({
    ...row,
    brand: brandId ? { id: brandId, name: brandName! } : null,
    category: categoryId ? { id: categoryId, name: categoryName! } : null,
    reorderPoint: Number(row.reorderPoint),
    belowReorderPoint: compare(row.onHand, String(row.reorderPoint)) <= 0,
  }));

  // The filter dropdowns come from the category and brand endpoints now. They
  // used to be a `distinct` over whatever anyone had typed, which reported the
  // duplicates rather than preventing them.
  return {
    parts: query.belowReorder ? all.filter((p) => p.belowReorderPoint) : all,
    belowReorderCount: all.filter((p) => p.belowReorderPoint).length,
  };
}

export async function getPart(id: string): Promise<PartDetail> {
  const db = getDb();

  const [part] = (await listParts({ status: 'all' })).parts.filter((p) => p.id === id);
  if (!part) throw ApiError.notFound('Part not found');

  const [price] = await db
    .select({ landedCost: prices.landedCost })
    .from(prices)
    .where(eq(prices.partId, id))
    .limit(1);

  // The running balance is computed from the ledger rather than stored, which is
  // what lets the last row be checked against the balance at the top of the
  // screen. They disagree only if something wrote a balance without a movement.
  const { rows: movements } = await db.execute<{
    at: string;
    type: MovementRow['type'];
    quantityDelta: string;
    onHandAfter: string;
    reason: MovementRow['reason'];
    note: string | null;
    invoiceReference: string | null;
    poReference: string | null;
    by: string | null;
  }>(sql`
    select m.created_at    as at,
           m.type,
           m.quantity_delta::text as "quantityDelta",
           (sum(m.quantity_delta) over (order by m.created_at, m.id
                                        rows between unbounded preceding and current row))::text
                           as "onHandAfter",
           m.reason,
           m.note,
           si.reference    as "invoiceReference",
           po.reference    as "poReference",
           u.full_name     as by
      from ${stockMovements} m
      left join ${users} u on u.id = m.created_by
      left join app.sales_invoices si on si.id = m.reference_id
      left join ${purchaseOrderLines} pol on pol.id = m.reference_id
      left join ${purchaseOrders} po on po.id = pol.purchase_order_id
     where m.part_id = ${id}
     order by m.created_at desc, m.id desc
     limit 50
  `);

  return {
    ...part,
    landedCost: price?.landedCost ?? null,
    movements: movements.map((m) => ({
      at: new Date(m.at).toISOString(),
      type: m.type,
      quantityDelta: m.quantityDelta,
      onHandAfter: m.onHandAfter,
      reason: m.reason,
      note: m.note,
      reference: m.invoiceReference ?? m.poReference,
      by: m.by,
    })),
  };
}

export async function listLowStock(): Promise<LowStockRow[]> {
  const db = getDb();

  const { rows } = await db.execute<{
    id: string;
    sku: string;
    name: string;
    brandId: string | null;
    brandName: string | null;
    onHand: string;
    reorderPoint: number;
    lastReceived: string | null;
    supplierId: string | null;
    supplierName: string | null;
    onOrderQuantity: string | null;
    onOrderReference: string | null;
  }>(sql`
    select p.id,
           p.sku,
           p.name,
           p.brand_id  as "brandId",
           br.name     as "brandName",
           coalesce(b.quantity, 0)::numeric(14, 3)::text as "onHand",
           p.reorder_point as "reorderPoint",
           (select max(m.created_at) from ${stockMovements} m
             where m.part_id = p.id and m.type = 'po_receipt')  as "lastReceived",
           -- Whoever supplied it most recently, which is what a purchasing
           -- officer means by "usual" when reordering in a hurry.
           (select s.id from ${purchaseOrderLines} l
              join ${purchaseOrders} o on o.id = l.purchase_order_id
              join ${suppliers} s on s.id = o.supplier_id
             where l.part_id = p.id and o.status <> 'cancelled'
             order by o.order_date desc limit 1)                as "supplierId",
           (select s.name from ${purchaseOrderLines} l
              join ${purchaseOrders} o on o.id = l.purchase_order_id
              join ${suppliers} s on s.id = o.supplier_id
             where l.part_id = p.id and o.status <> 'cancelled'
             order by o.order_date desc limit 1)                as "supplierName",
           -- Anything still expected on an open order: the shortfall may already
           -- be covered, and reordering again would double up.
           (select sum(l.quantity_ordered - l.quantity_received)::text
              from ${purchaseOrderLines} l
              join ${purchaseOrders} o on o.id = l.purchase_order_id
             where l.part_id = p.id and o.status in ('sent', 'partially_received')
               and l.quantity_ordered > l.quantity_received)     as "onOrderQuantity",
           (select o.reference from ${purchaseOrderLines} l
              join ${purchaseOrders} o on o.id = l.purchase_order_id
             where l.part_id = p.id and o.status in ('sent', 'partially_received')
               and l.quantity_ordered > l.quantity_received
             order by o.order_date desc limit 1)                 as "onOrderReference"
      from ${parts} p
      left join ${inventoryBalances} b on b.part_id = p.id
      left join ${brands} br on br.id = p.brand_id
     where p.is_active
       and coalesce(b.quantity, 0) <= p.reorder_point
     order by (p.reorder_point - coalesce(b.quantity, 0)) desc, p.name
  `);

  return rows.map((row) => ({
    id: row.id,
    sku: row.sku,
    name: row.name,
    brand: row.brandId ? { id: row.brandId, name: row.brandName! } : null,
    onHand: row.onHand,
    reorderPoint: Number(row.reorderPoint),
    shortBy: subtract(String(row.reorderPoint), row.onHand),
    lastReceived: row.lastReceived ? new Date(row.lastReceived).toISOString() : null,
    usualSupplier: row.supplierId ? { id: row.supplierId, name: row.supplierName! } : null,
    onOrder:
      row.onOrderQuantity && row.onOrderReference
        ? { quantity: row.onOrderQuantity, reference: row.onOrderReference }
        : null,
  }));
}

export async function listAdjustments(): Promise<AdjustmentRow[]> {
  const rows = await getDb()
    .select({
      at: stockMovements.createdAt,
      partId: parts.id,
      sku: parts.sku,
      name: parts.name,
      reason: stockMovements.reason,
      quantityDelta: stockMovements.quantityDelta,
      note: stockMovements.note,
      by: users.fullName,
    })
    .from(stockMovements)
    .innerJoin(parts, eq(parts.id, stockMovements.partId))
    .leftJoin(users, eq(users.id, stockMovements.createdBy))
    .where(eq(stockMovements.type, 'adjustment'))
    .orderBy(desc(stockMovements.createdAt))
    .limit(50);

  return rows.map((row) => ({
    at: row.at.toISOString(),
    partId: row.partId,
    sku: row.sku,
    name: row.name,
    // Every adjustment has one: the column is nullable because receipts and
    // sales share the table, and neither of those has a reason to give.
    reason: row.reason ?? 'count_correction',
    quantityDelta: row.quantityDelta,
    note: row.note,
    by: row.by,
  }));
}

/* ---------------------------------------------------------------- writing */

export async function createPart(input: CreatePartInput): Promise<PartDetail> {
  const [existing] = await getDb()
    .select({ id: parts.id })
    .from(parts)
    .where(eq(parts.sku, input.sku))
    .limit(1);
  if (existing) throw ApiError.conflict(`SKU ${input.sku} is already in use`);

  const id = await getDb().transaction(async (tx) => {
    const [part] = await tx
      .insert(parts)
      .values({
        sku: input.sku,
        name: input.name,
        partNumber: input.partNumber ?? null,
        oemNumber: input.oemNumber ?? null,
        brandId: input.brandId ?? null,
        categoryId: input.categoryId ?? null,
        fitment: input.fitment,
        reorderPoint: input.reorderPoint,
        isActive: input.isActive,
      })
      .returning();

    // A balance row from the start, at zero, so the part appears in stock views
    // straight away rather than only once something arrives.
    await tx
      .insert(inventoryBalances)
      .values({ partId: part!.id, locationId: await defaultLocationId(tx), quantity: '0' })
      .onConflictDoNothing();

    return part!.id;
  });

  return getPart(id);
}

export async function updatePart(id: string, input: UpdatePartInput): Promise<PartDetail> {
  const db = getDb();

  const [existing] = await db.select().from(parts).where(eq(parts.id, id)).limit(1);
  if (!existing) throw ApiError.notFound('Part not found');

  if (input.sku && input.sku !== existing.sku) {
    const [clash] = await db
      .select({ id: parts.id })
      .from(parts)
      .where(eq(parts.sku, input.sku))
      .limit(1);
    if (clash) throw ApiError.conflict(`SKU ${input.sku} is already in use`);
  }

  // Deliberately no stock field. A balance cannot be edited here, or anywhere.
  await db
    .update(parts)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(parts.id, id));

  return getPart(id);
}

export async function adjustStock(
  partId: string,
  input: AdjustStockInput,
  adjustedBy: string,
): Promise<PartDetail> {
  await getDb().transaction(async (tx) => {
    const locationId = await defaultLocationId(tx);

    const [part] = await tx
      .select({ name: parts.name, isActive: parts.isActive })
      .from(parts)
      .where(eq(parts.id, partId))
      .limit(1);
    if (!part) throw ApiError.notFound('Part not found');
    if (!part.isActive) throw ApiError.conflict('That part is inactive');

    // Locked in its own statement — Postgres will not take a schema-qualified
    // name in FOR UPDATE OF, and a sale on the till may be touching this row.
    const [balance] = await tx
      .select({ quantity: inventoryBalances.quantity })
      .from(inventoryBalances)
      .where(
        and(eq(inventoryBalances.partId, partId), eq(inventoryBalances.locationId, locationId)),
      )
      .for('update')
      .limit(1);

    const onHand = balance?.quantity ?? '0';
    const delta = input.direction === 'increase' ? String(input.quantity) : `-${input.quantity}`;

    if (input.direction === 'decrease' && compare(onHand, String(input.quantity)) < 0) {
      throw ApiError.conflict(
        `Cannot remove ${input.quantity} from ${part.name}: only ${onHand} on hand`,
      );
    }

    await tx.insert(stockMovements).values({
      partId,
      locationId,
      type: 'adjustment',
      quantityDelta: delta,
      reason: input.reason,
      note: input.note ?? null,
      createdBy: adjustedBy,
    });

    await tx
      .insert(inventoryBalances)
      .values({ partId, locationId, quantity: delta })
      .onConflictDoUpdate({
        target: [inventoryBalances.partId, inventoryBalances.locationId],
        set: {
          quantity: sql`${inventoryBalances.quantity} + ${delta}`,
          updatedAt: new Date(),
        },
      });
  });

  return getPart(partId);
}

/* ---------------------------------------------------- categories and brands */

/** Both are the same shape and the same rules, kept parallel rather than behind
 *  a shared abstraction: two short readable blocks beat one generic one that
 *  has to fight the query builder's types.
 *
 *  Neither is ever deleted. A part points at one, and removing the row would
 *  leave that part uncategorised — so they are deactivated, as suppliers are.
 */

export const taxonomyIdParam = z.object({ id: z.string().uuid() });
export type TaxonomyIdParam = z.infer<typeof taxonomyIdParam>;

export const listTaxonomyQuery = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  status: z.enum(['active', 'inactive', 'all']).default('active'),
});
export type ListTaxonomyQuery = z.infer<typeof listTaxonomyQuery>;

export const createTaxonomyInput = z.object({
  name: z.string().trim().min(1).max(100),
});
export type CreateTaxonomyInput = z.infer<typeof createTaxonomyInput>;

export const updateTaxonomyInput = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateTaxonomyInput = z.infer<typeof updateTaxonomyInput>;

export const taxonomyRow = z.object({
  id: z.string().uuid(),
  name: z.string(),
  isActive: z.boolean(),
  /** How many parts use it, so a screen can say what deactivating would affect. */
  partCount: z.number(),
});
export type TaxonomyRow = z.infer<typeof taxonomyRow>;

type Taxonomy = typeof categories | typeof brands;

const partColumnFor = (table: Taxonomy) =>
  table === categories ? parts.categoryId : parts.brandId;

const labelFor = (table: Taxonomy) => (table === categories ? 'Category' : 'Brand');

async function listTaxonomy(table: Taxonomy, query: ListTaxonomyQuery): Promise<TaxonomyRow[]> {
  const db = getDb();
  const status = query.status ?? 'active';
  const partColumn = partColumnFor(table);

  const conditions = [
    status === 'all' ? undefined : eq(table.isActive, status === 'active'),
    query.q ? sql`${table.name} ilike ${like(query.q)}` : undefined,
  ].filter((c) => c !== undefined);

  const rows = await db
    .select({ id: table.id, name: table.name, isActive: table.isActive })
    .from(table)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(table.name);

  // Counted separately rather than as a correlated subquery: interpolating a
  // column into raw SQL renders it unqualified, which inside a subquery with its
  // own FROM silently resolves against the wrong table.
  const counts = await db
    .select({ id: partColumn, used: sql<number>`count(*)::int` })
    .from(parts)
    .groupBy(partColumn);

  const used = new Map(counts.map((c) => [c.id, c.used]));
  return rows.map((row) => ({ ...row, partCount: used.get(row.id) ?? 0 }));
}

async function createTaxonomy(
  table: Taxonomy,
  input: CreateTaxonomyInput,
): Promise<TaxonomyRow> {
  const db = getDb();

  // Trimmed here rather than relying on the schema having done it. The unique
  // index is on lower(name), so a name arriving with a stray space would miss
  // the clash check and land as a second row that looks identical on screen —
  // which is the exact failure this table exists to prevent.
  const name = input.name.trim();

  // Case-insensitive, matching the index: "Electrical" and "electrical" are the
  // same category, not two that look alike in a dropdown.
  const [clash] = await db
    .select({ id: table.id, name: table.name })
    .from(table)
    .where(sql`lower(${table.name}) = lower(${name})`)
    .limit(1);

  if (clash) {
    throw ApiError.conflict(`${labelFor(table)} "${clash.name}" already exists`);
  }

  const [created] = await db.insert(table).values({ name }).returning();
  return { id: created!.id, name: created!.name, isActive: created!.isActive, partCount: 0 };
}

async function updateTaxonomy(
  table: Taxonomy,
  id: string,
  input: UpdateTaxonomyInput,
): Promise<TaxonomyRow> {
  const db = getDb();

  const [existing] = await db.select().from(table).where(eq(table.id, id)).limit(1);
  if (!existing) throw ApiError.notFound(`${labelFor(table)} not found`);

  const name = input.name?.trim();

  if (name && name.toLowerCase() !== existing.name.toLowerCase()) {
    const [clash] = await db
      .select({ name: table.name })
      .from(table)
      .where(sql`lower(${table.name}) = lower(${name})`)
      .limit(1);
    if (clash) throw ApiError.conflict(`${labelFor(table)} "${clash.name}" already exists`);
  }

  await db
    .update(table)
    .set({ ...input, ...(name ? { name } : {}), updatedAt: new Date() })
    .where(eq(table.id, id));

  const [row] = await listTaxonomy(table, { status: 'all' }).then((rows) =>
    rows.filter((r) => r.id === id),
  );
  return row!;
}

export const listCategories = (query: ListTaxonomyQuery) => listTaxonomy(categories, query);
export const createCategory = (input: CreateTaxonomyInput) => createTaxonomy(categories, input);
export const updateCategory = (id: string, input: UpdateTaxonomyInput) =>
  updateTaxonomy(categories, id, input);

export const listBrands = (query: ListTaxonomyQuery) => listTaxonomy(brands, query);
export const createBrand = (input: CreateTaxonomyInput) => createTaxonomy(brands, input);
export const updateBrand = (id: string, input: UpdateTaxonomyInput) =>
  updateTaxonomy(brands, id, input);
