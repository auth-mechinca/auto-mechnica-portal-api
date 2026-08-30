import './helpers/env.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { createTestDb } from './helpers/db.js';
import type { Db } from '../src/db/client.js';
import { parts, prices, purchaseOrderLines, purchaseOrders, suppliers } from '../src/db/schema/index.js';

let db: Db;
let close: () => Promise<void>;

before(async () => {
  ({ db, close } = await createTestDb());
});
after(() => close());

describe('money columns', () => {
  it('stores GHS exactly and returns it as a string, never a float', async () => {
    const [part] = await db.insert(parts).values({ sku: 'BP-001', name: 'Brake Pad' }).returning();

    const [row] = await db
      .insert(prices)
      .values({
        partId: part!.id,
        landedCost: '1234.56',
        suggestedPrice: '1666.66',
        finalPrice: '1700.00',
        marginPctUsed: '35.00',
      })
      .returning();

    assert.equal(typeof row!.landedCost, 'string');
    assert.equal(row!.landedCost, '1234.56');
    assert.equal(row!.finalPrice, '1700.00');
  });

  it('keeps enough scale on an FX rate to avoid rounding the landed cost', async () => {
    const [supplier] = await db.insert(suppliers).values({ name: 'Guangzhou Parts Co' }).returning();
    const [po] = await db
      .insert(purchaseOrders)
      .values({
        reference: 'PO-0001',
        supplierId: supplier!.id,
        orderDate: '2026-08-29',
        fxRate: '12.480000',
      })
      .returning();

    assert.equal(po!.fxRate, '12.480000');
  });

  it('computes landed cost in GHS from USD cost x FX rate', async () => {
    // Section 6.4: the multiplication is what makes the figure Cedis. Done in
    // SQL rather than JS so it is exact numeric arithmetic, not floating point.
    const [supplier] = await db.insert(suppliers).values({ name: 'Dubai Autoparts' }).returning();
    const [part] = await db.insert(parts).values({ sku: 'FL-900', name: 'Oil Filter' }).returning();
    const [po] = await db
      .insert(purchaseOrders)
      .values({
        reference: 'PO-0002',
        supplierId: supplier!.id,
        orderDate: '2026-08-29',
        fxRate: '12.500000',
      })
      .returning();
    await db.insert(purchaseOrderLines).values({
      purchaseOrderId: po!.id,
      partId: part!.id,
      quantityOrdered: '10',
      unitCostUsd: '8.4000',
    });

    const { rows } = await db.execute<{ landed: string; suggested: string }>(sql`
      select round(l.unit_cost_usd * p.fx_rate, 2)::text as landed,
             round(l.unit_cost_usd * p.fx_rate * 1.35, 2)::text as suggested
      from app.purchase_order_lines l
      join app.purchase_orders p on p.id = l.purchase_order_id
      where p.reference = 'PO-0002'
    `);

    // 8.40 USD x 12.50 GHS/USD = 105.00 GHS, +35% margin = 141.75 GHS
    assert.equal(rows[0]!.landed, '105.00');
    assert.equal(rows[0]!.suggested, '141.75');
  });
});
