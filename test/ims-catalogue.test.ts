import './helpers/env.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { createTestDb } from './helpers/db.js';
import { baseFixture } from './helpers/fixtures.js';
import type { Db } from '../src/db/client.js';
import { inventoryBalances, prices } from '../src/db/schema/index.js';
import { createPart, getPart, listParts, updatePart } from '../src/modules/ims/service.js';
import { createCategory, listCategories } from '../src/modules/categories/service.js';
import { createBrand, listBrands } from '../src/modules/brands/service.js';

let db: Db;
let close: () => Promise<void>;
let base: Awaited<ReturnType<typeof baseFixture>>;
let suspension: string;
let filters: string;
let kyb: string;
let mann: string;

before(async () => {
  ({ db, close } = await createTestDb());
  base = await baseFixture(db);

  suspension = (await createCategory({ name: 'Suspension' })).id;
  filters = (await createCategory({ name: 'Filters' })).id;
  kyb = (await createBrand({ name: 'KYB' })).id;
  mann = (await createBrand({ name: 'Mann' })).id;
});
after(() => close());

describe('the parts catalogue', () => {
  it('creates a part with a zero balance, not with stock', async () => {
    const part = await createPart({
      sku: 'SA-3307',
      name: 'Shock absorber, rear',
      partNumber: '348044',
      oemNumber: '48531-0K540',
      brandId: kyb,
      categoryId: suspension,
      fitment: ['Toyota Hilux 2016–2022', 'Toyota Fortuner 2016–2021'],
      reorderPoint: 6,
      isActive: true,
    });

    assert.equal(part.onHand, '0.000', 'stock arrives through a PO, never at creation');
    assert.equal(part.fitment.length, 2);
    assert.equal(part.sellPrice, null, 'and it has no price until one is set');
    assert.equal(part.belowReorderPoint, true, 'zero is below a reorder point of 6');
  });

  it('refuses a duplicate SKU', async () => {
    await assert.rejects(
      () => createPart({ sku: 'SA-3307', name: 'Something else', fitment: [], reorderPoint: 0, isActive: true }),
      /already in use/,
    );
  });

  it('edits details without any way to touch stock', async () => {
    const [existing] = (await listParts({ status: 'all' })).parts;

    // The update schema has no stock field at all — this is the assertion that
    // the only way to move a balance is a movement.
    const updated = await updatePart(existing!.id, {
      reorderPoint: 12,
      fitment: ['Toyota Hilux 2016–2022'],
    });

    assert.equal(updated.reorderPoint, 12);
    assert.equal(updated.fitment.length, 1);
    assert.equal(updated.onHand, existing!.onHand, 'editing a part cannot move stock');
  });

  it('searches by name, SKU, part number and OEM number', async () => {
    for (const term of ['shock', 'SA-3307', '348044', '48531']) {
      const found = await listParts({ q: term, status: 'all' });
      assert.equal(found.parts.length, 1, `expected a match for ${term}`);
    }
  });

  it('names the category and brand rather than repeating their text', async () => {
    const [part] = (await listParts({ q: 'shock', status: 'all' })).parts;
    assert.equal(part!.category!.name, 'Suspension');
    assert.equal(part!.brand!.name, 'KYB');
    assert.equal(part!.category!.id, suspension);
  });

  it('offers the filter lists from what actually exists', async () => {
    await createPart({
      sku: 'AF-0455',
      name: 'Air filter',
      brandId: mann,
      categoryId: filters,
      fitment: [],
      reorderPoint: 20,
      isActive: true,
    });

    // The lists come from their own endpoints now, and carry how many parts use
    // each — so a screen can say what deactivating one would affect.
    const cats = await listCategories({ status: 'all' });
    assert.deepEqual(cats.map((c) => c.name), ['Filters', 'Suspension']);
    assert.equal(cats.find((c) => c.name === 'Suspension')!.partCount, 1);

    const brandList = await listBrands({ status: 'all' });
    assert.deepEqual(brandList.map((b) => b.name), ['KYB', 'Mann']);
  });

  it('filters by category, brand and below-reorder', async () => {
    assert.equal((await listParts({ categoryId: filters, status: 'all' })).parts.length, 1);
    assert.equal((await listParts({ brandId: kyb, status: 'all' })).parts.length, 1);

    const low = await listParts({ belowReorder: true, status: 'all' });
    assert.equal(low.parts.length, 2, 'both are at zero against a reorder point');
    assert.equal(low.belowReorderCount, 2);
  });

  it('hides an inactive part from the default list but keeps it findable', async () => {
    const [part] = (await listParts({ q: 'Air filter', status: 'all' })).parts;
    await updatePart(part!.id, { isActive: false });

    assert.ok(!(await listParts({ status: 'active' })).parts.some((p) => p.id === part!.id));
    assert.ok((await listParts({ status: 'all' })).parts.some((p) => p.id === part!.id));
  });

  it('shows cost to purchasing, which POS search never returns', async () => {
    const [part] = (await listParts({ q: 'shock', status: 'all' })).parts;

    await db.insert(prices).values({
      partId: part!.id,
      landedCost: '291.40',
      suggestedPrice: '448.31',
      finalPrice: '399.00',
      marginPctUsed: '35',
    });

    const detail = await getPart(part!.id);
    assert.equal(detail.landedCost, '291.40');
    assert.equal(detail.sellPrice, '399.00');
  });

  it('404s an unknown part', async () => {
    await assert.rejects(
      () => getPart('99999999-9999-4999-8999-999999999999'),
      /Part not found/,
    );
  });

  it('keeps the balance row it was created with', async () => {
    const [part] = (await listParts({ q: 'shock', status: 'all' })).parts;
    const rows = await db
      .select()
      .from(inventoryBalances)
      .where(eq(inventoryBalances.partId, part!.id));

    assert.equal(rows.length, 1, 'one location, one balance');
    assert.equal(rows[0]!.locationId, base.locationId);
  });
});
