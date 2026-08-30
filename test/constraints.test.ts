import './helpers/env.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './helpers/db.js';
import type { Db } from '../src/db/client.js';
import {
  inventoryBalances,
  locations,
  parts,
  purchaseOrderLines,
  purchaseOrders,
  suppliers,
} from '../src/db/schema/index.js';

let db: Db;
let close: () => Promise<void>;

before(async () => {
  ({ db, close } = await createTestDb());
});
after(() => close());

describe('constraints', () => {
  it('rejects a duplicate SKU', async () => {
    await db.insert(parts).values({ sku: 'DUP-1', name: 'First' });
    await assert.rejects(() => db.insert(parts).values({ sku: 'DUP-1', name: 'Second' }));
  });

  it('rejects a purchase order line pointing at a part that does not exist', async () => {
    const [supplier] = await db.insert(suppliers).values({ name: 'Ghost Supplier' }).returning();
    const [po] = await db
      .insert(purchaseOrders)
      .values({
        reference: 'PO-0003',
        supplierId: supplier!.id,
        orderDate: '2026-08-29',
        fxRate: '12.000000',
      })
      .returning();

    await assert.rejects(() =>
      db.insert(purchaseOrderLines).values({
        purchaseOrderId: po!.id,
        partId: '99999999-9999-4999-8999-999999999999',
        quantityOrdered: '1',
        unitCostUsd: '1.0000',
      }),
    );
  });

  it('allows one balance per part per location, and no duplicates', async () => {
    const [location] = await db.insert(locations).values({ name: 'Main Shop' }).returning();
    const [part] = await db.insert(parts).values({ sku: 'LOC-1', name: 'Spark Plug' }).returning();

    await db
      .insert(inventoryBalances)
      .values({ partId: part!.id, locationId: location!.id, quantity: '5' });

    await assert.rejects(
      () =>
        db
          .insert(inventoryBalances)
          .values({ partId: part!.id, locationId: location!.id, quantity: '7' }),
      'a part must not have two balance rows at the same location',
    );
  });
});
