import { eq } from 'drizzle-orm';
import type { Db } from '../../src/db/client.js';
import { hashPassword } from '../../src/lib/password.js';
import {
  customers,
  inventoryBalances,
  locations,
  parts,
  prices,
  settings,
  users,
} from '../../src/db/schema/index.js';

/** A minimal shop: one location, one salesperson, two priced parts in stock,
 *  one customer. Small on purpose — each test states the figures it depends on. */
export async function shopFixture(db: Db) {
  const [location] = await db.insert(locations).values({ name: 'Main Shop' }).returning();
  const passwordHash = await hashPassword('demo1234');

  const [seller] = await db
    .insert(users)
    .values({ email: 'sales@test', fullName: 'Ama Mensah', role: 'sales', passwordHash })
    .returning();

  const [customer] = await db
    .insert(customers)
    .values({ name: 'Adom Motors Ltd' })
    .returning();

  await db.insert(settings).values([
    { key: 'default_margin_pct', value: '35' },
    { key: 'default_payment_terms_days', value: '30' },
  ]);

  const made = async (sku: string, name: string, price: string | null, stock: string) => {
    const [part] = await db.insert(parts).values({ sku, name, brand: 'Bosch' }).returning();
    if (price !== null) {
      await db.insert(prices).values({
        partId: part!.id,
        landedCost: '100.00',
        suggestedPrice: '135.00',
        finalPrice: price,
        marginPctUsed: '35',
      });
    }
    await db
      .insert(inventoryBalances)
      .values({ partId: part!.id, locationId: location!.id, quantity: stock });
    return part!;
  };

  return {
    locationId: location!.id,
    sellerId: seller!.id,
    customerId: customer!.id,
    brakePad: await made('BP-2042', 'Brake pad set, front', '199.00', '64'),
    airFilter: await made('AF-0455', 'Air filter', '33.50', '41'),
    unpriced: await made('NEW-0001', 'Unpriced part', null, '10'),
    scarce: await made('WP-2290', 'Water pump', '289.00', '2'),
  };
}

export const stockOf = async (db: Db, partId: string): Promise<string> => {
  const [row] = await db
    .select({ quantity: inventoryBalances.quantity })
    .from(inventoryBalances)
    .where(eq(inventoryBalances.partId, partId))
    .limit(1);
  return row!.quantity;
};
