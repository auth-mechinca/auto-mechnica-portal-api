import './helpers/env.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { Server } from 'node:http';
import { createTestDb } from './helpers/db.js';
import { baseFixture } from './helpers/fixtures.js';
import { createApp } from '../src/app.js';
import { signToken } from '../src/lib/token.js';
import type { Db } from '../src/db/client.js';
import { createPart, listParts } from '../src/modules/ims/service.js';
import { createCategory, listCategories, updateCategory } from '../src/modules/categories/service.js';
import { createBrand } from '../src/modules/brands/service.js';

/** Categories, in their own module at /api/categories.
 *
 *  The problem this replaced: category was free text on a part, so "Electrical"
 *  and "Electrical and Charging" became two unrelated values and the filter list
 *  reported both. Nothing could tell a new category from a typo of an old one. */

let db: Db;
let close: () => Promise<void>;
let server: Server;
let base: Awaited<ReturnType<typeof baseFixture>>;
let token: string;

before(async () => {
  ({ db, close } = await createTestDb());
  base = await baseFixture(db);
  server = createApp().listen(0);
  token = signToken({ sub: base.sellerId, email: 'kofi@demo', role: 'purchasing' });
});

after(async () => {
  server.close();
  await close();
});

const auth = () => ({ Authorization: `Bearer ${token}` });

describe('categories and brands', () => {
  it('creates one and counts nothing against it yet', async () => {
    const category = await createCategory({ name: 'Electrical' });
    assert.equal(category.name, 'Electrical');
    assert.equal(category.partCount, 0);
    assert.equal(category.isActive, true);
  });

  it('refuses a duplicate regardless of case', async () => {
    await assert.rejects(() => createCategory({ name: 'Electrical' }), /already exists/);
    await assert.rejects(() => createCategory({ name: 'electrical' }), /already exists/);
    await assert.rejects(() => createCategory({ name: '  ELECTRICAL  ' }), /already exists/);
  });

  it('still allows a genuinely different name that happens to start the same', async () => {
    // This is the pair that started it. They are different categories, and the
    // system should let both exist — what it must not allow is two spellings of
    // one category.
    const other = await createCategory({ name: 'Electrical and Charging' });
    assert.equal(other.name, 'Electrical and Charging');
    assert.equal((await listCategories({ status: 'all' })).length, 2);
  });

  it('counts the parts using it', async () => {
    const [electrical] = (await listCategories({ status: 'all' })).filter(
      (c) => c.name === 'Electrical',
    );
    const gm = await createBrand({ name: 'General Motors' });

    await createPart({
      sku: 'ALT-GM-140',
      name: 'Alternator',
      categoryId: electrical!.id,
      brandId: gm.id,
      fitment: ['2008-2010 Kia Cerato 1.6L'],
      reorderPoint: 5,
      isActive: true,
    });

    const [after] = (await listCategories({ status: 'all' })).filter((c) => c.name === 'Electrical');
    assert.equal(after!.partCount, 1);
  });

  it('names the category and brand on the part, with ids the UI can filter by', async () => {
    const [part] = (await listParts({ q: 'Alternator', status: 'all' })).parts;

    assert.equal(part!.category!.name, 'Electrical');
    assert.equal(part!.brand!.name, 'General Motors');

    const filtered = await listParts({ categoryId: part!.category!.id, status: 'all' });
    assert.deepEqual(filtered.parts.map((p) => p.sku), ['ALT-GM-140']);
  });

  it('renames one, and every part using it follows', async () => {
    const [electrical] = (await listCategories({ status: 'all' })).filter(
      (c) => c.name === 'Electrical',
    );

    await updateCategory(electrical!.id, { name: 'Electrical & Charging' });

    const [part] = (await listParts({ q: 'Alternator', status: 'all' })).parts;
    assert.equal(
      part!.category!.name,
      'Electrical & Charging',
      'the part points at a row, so a rename reaches it without touching the part',
    );
  });

  it('deactivates rather than deletes, keeping the parts categorised', async () => {
    const [category] = (await listCategories({ status: 'all' })).filter(
      (c) => c.name === 'Electrical & Charging',
    );

    await updateCategory(category!.id, { isActive: false });

    assert.ok(!(await listCategories({ status: 'active' })).some((c) => c.id === category!.id));

    const [part] = (await listParts({ q: 'Alternator', status: 'all' })).parts;
    assert.equal(part!.category!.id, category!.id, 'the part is still categorised');
  });

  it('searches as the UI dropdown would', async () => {
    const matches = await listCategories({ q: 'charg', status: 'all' });
    assert.equal(matches.length, 2, 'both "and Charging" and "& Charging"');
  });
});

describe('over HTTP', () => {
  it('is its own endpoint, not a mode on another one', async () => {
    const res = await request(server).get('/api/categories?status=all').set(auth());
    assert.equal(res.status, 200);
    assert.ok(res.body.length > 0);
  });

  it('creates on the fly and reports a clash clearly', async () => {
    const created = await request(server)
      .post('/api/categories')
      .set(auth())
      .send({ name: 'Cooling' });
    assert.equal(created.status, 201);

    const clash = await request(server).post('/api/categories').set(auth()).send({ name: 'cooling' });
    assert.equal(clash.status, 409);
    assert.match(clash.body.error.message, /Category "Cooling" already exists/);
  });

  it('rejects a blank name', async () => {
    const res = await request(server).post('/api/categories').set(auth()).send({ name: '   ' });
    assert.equal(res.status, 400);
  });

  it('keeps Sales out', async () => {
    const sales = signToken({ sub: base.sellerId, email: 'ama@demo', role: 'sales' });
    const res = await request(server)
      .get('/api/categories')
      .set('Authorization', `Bearer ${sales}`);
    assert.equal(res.status, 403);
  });
});
