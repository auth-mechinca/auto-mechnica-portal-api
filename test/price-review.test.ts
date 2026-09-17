import './helpers/env.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { createTestDb } from './helpers/db.js';
import { baseFixture, purchaseOrderFixture } from './helpers/fixtures.js';
import type { Db } from '../src/db/client.js';
import { receiveStock } from '../src/modules/backoffice/service.js';
import { priceHistory, prices } from '../src/db/schema/index.js';

/** What happens to a hand-set price when the same part is bought again at a new
 *  cost — the question left open in the build-progress notes.
 *
 *  The answer implemented here: the override stands, because it was a deliberate
 *  decision, and the part is surfaced for review. "Needs review" is derived
 *  rather than stored — price_history records the landed cost each price was set
 *  against, so a cost that has since moved is a comparison, not a flag somebody
 *  has to remember to set.
 */

let db: Db;
let close: () => Promise<void>;
let base: Awaited<ReturnType<typeof baseFixture>>;
let po: Awaited<ReturnType<typeof purchaseOrderFixture>>;

before(async () => {
  ({ db, close } = await createTestDb());
  base = await baseFixture(db);
  po = await purchaseOrderFixture(db);
});
after(() => close());

describe('an overridden price meeting a new cost', () => {
  it('keeps a hand-set price when the cost has not moved', async () => {
    // Somebody priced the shock absorber by hand at the cost it had then.
    await db.insert(prices).values({
      partId: po.shock.partId,
      landedCost: '291.40',
      suggestedPrice: '448.31',
      finalPrice: '430.00',
      marginPctUsed: '35',
    });
    await db.insert(priceHistory).values({
      partId: po.shock.partId,
      landedCost: '291.40',
      suggestedPrice: '448.31',
      finalPrice: '430.00',
      marginPctUsed: '35',
      source: 'manual',
      changedBy: base.sellerId,
    });

    const result = await receiveStock(
      po.orderId,
      { lines: [{ lineId: po.shock.lineId, quantityReceived: 12 }] },
      base.sellerId,
    );

    const shock = result.received[0]!;
    assert.equal(shock.landedCost, '291.40', 'same rate, same cost');
    assert.equal(shock.finalPrice, '430.00', 'the override stands');
    assert.equal(shock.needsReview, false, 'nothing has changed to review');
  });

  it('flags the part when the new cost differs from the one it was priced against', async () => {
    // The water pump was priced by hand against a cheaper delivery.
    await db.insert(prices).values({
      partId: po.waterPump.partId,
      landedCost: '205.00',
      suggestedPrice: '315.38',
      finalPrice: '325.00',
      marginPctUsed: '35',
    });
    await db.insert(priceHistory).values({
      partId: po.waterPump.partId,
      landedCost: '205.00',
      suggestedPrice: '315.38',
      finalPrice: '325.00',
      marginPctUsed: '35',
      source: 'manual',
      changedBy: base.sellerId,
    });

    const result = await receiveStock(
      po.orderId,
      { lines: [{ lineId: po.waterPump.lineId, quantityReceived: 18 }] },
      base.sellerId,
    );

    const pump = result.received[0]!;
    // 17.20 x 12.4000 = 213.28, against the 205.00 it was priced at.
    assert.equal(pump.landedCost, '213.28');
    assert.equal(pump.finalPrice, '325.00', 'the human decision is not thrown away');
    assert.equal(pump.needsReview, true, 'but the cost it was set against has moved');

    const [stored] = await db
      .select()
      .from(prices)
      .where(eq(prices.partId, po.waterPump.partId))
      .limit(1);

    assert.equal(stored!.finalPrice, '325.00');
    assert.equal(stored!.landedCost, '213.28', 'the cost is updated even though the price is not');
    assert.equal(stored!.suggestedPrice, '328.12', '213.28 / 0.65');
  });

  it('does not flag a part nobody had priced by hand', async () => {
    const result = await receiveStock(
      po.orderId,
      { lines: [{ lineId: po.brakePad.lineId, quantityReceived: 40 }] },
      base.sellerId,
    );

    const brake = result.received[0]!;
    assert.equal(brake.needsReview, false);
    assert.equal(brake.finalPrice, brake.suggestedPrice, 'it takes the suggestion');
  });
});
