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
import { createBrand, listBrands, updateBrand } from '../src/modules/brands/service.js';

/** Brands, in their own module at /api/brands. Separate from categories on
 *  purpose: a brand is who made the part, a category is what kind of part it is,
 *  and one will grow a field the other does not. */

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

describe('brands', () => {
  it('creates one, with nothing using it yet', async () => {
    const brand = await createBrand({ name: 'General Motors' });
    assert.equal(brand.name, 'General Motors');
    assert.equal(brand.partCount, 0);
  });

  it('refuses a duplicate regardless of case or stray spaces', async () => {
    await assert.rejects(() => createBrand({ name: 'general motors' }), /already exists/);
    await assert.rejects(() => createBrand({ name: '  GENERAL MOTORS  ' }), /already exists/);
  });

  it('counts the parts using it, and names it on the part', async () => {
    const [gm] = await listBrands({ status: 'all' });

    await createPart({
      sku: 'ALT-GM-140',
      name: 'Alternator',
      brandId: gm!.id,
      fitment: [],
      reorderPoint: 5,
      isActive: true,
    });

    assert.equal((await listBrands({ status: 'all' }))[0]!.partCount, 1);

    const [part] = (await listParts({ q: 'Alternator', status: 'all' })).parts;
    assert.equal(part!.brand!.name, 'General Motors');
    assert.equal(part!.category, null, 'a part can have a brand and no category');
  });

  it('renames, and every part using it follows', async () => {
    const [gm] = await listBrands({ status: 'all' });
    await updateBrand(gm!.id, { name: 'GM' });

    const [part] = (await listParts({ q: 'Alternator', status: 'all' })).parts;
    assert.equal(part!.brand!.name, 'GM');
  });

  it('deactivates rather than deletes, keeping the part branded', async () => {
    const [gm] = await listBrands({ status: 'all' });
    await updateBrand(gm!.id, { isActive: false });

    assert.equal((await listBrands({ status: 'active' })).length, 0);

    const [part] = (await listParts({ q: 'Alternator', status: 'all' })).parts;
    assert.equal(part!.brand!.id, gm!.id);
  });
});

describe('over HTTP', () => {
  it('is its own endpoint, not a mode on another one', async () => {
    const res = await request(server).get('/api/brands?status=all').set(auth());
    assert.equal(res.status, 200);
    assert.equal(res.body[0].name, 'GM');
  });

  it('creates on the fly for the part form', async () => {
    const res = await request(server).post('/api/brands').set(auth()).send({ name: 'Denso' });
    assert.equal(res.status, 201);
    assert.equal(res.body.partCount, 0);
  });

  it('filters for a type-ahead dropdown', async () => {
    const res = await request(server).get('/api/brands?q=den').set(auth());
    assert.equal(res.body[0].name, 'Denso');
  });

  it('keeps Sales out', async () => {
    const sales = signToken({ sub: base.sellerId, email: 'ama@demo', role: 'sales' });
    const res = await request(server).get('/api/brands').set('Authorization', `Bearer ${sales}`);
    assert.equal(res.status, 403);
  });
});
