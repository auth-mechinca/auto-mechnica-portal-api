import { eq } from 'drizzle-orm';
import type { Db } from '../../src/db/client.js';
import { hashPassword } from '../../src/lib/password.js';
import type { Role } from '../../src/lib/token.js';
import {
  brands,
  customers,
  inventoryBalances,
  locations,
  parts,
  prices,
  purchaseOrderLines,
  purchaseOrders,
  settings,
  suppliers,
  users,
} from '../../src/db/schema/index.js';

/** One location, one customer, the two shop settings, and one member of staff
 *  per role. Everything both suites need before they add parts of their own —
 *  kept separate because parts carry unique SKUs and two fixtures inventing the
 *  same one would collide.
 *
 *  Four users rather than one because `requireAuth` reads the role from the user
 *  row and ignores the claim in the token. A test can no longer sign itself a
 *  purchasing token for the sales account: it has to authenticate as somebody
 *  who actually holds that role, which is the same rule the shop runs under. */
export async function baseFixture(db: Db) {
  const [location] = await db.insert(locations).values({ name: 'Main Shop' }).returning();
  const passwordHash = await hashPassword('demo1234');

  const inserted = await db
    .insert(users)
    .values(
      (
        [
          ['sales', 'Ama Mensah'],
          ['purchasing', 'Kofi Asante'],
          ['accountant', 'Adjoa Boateng'],
          ['admin', 'Yaw Owusu'],
        ] as const
      ).map(([role, fullName]) => ({ email: `${role}@test`, fullName, role, passwordHash })),
    )
    .returning();

  const staff = Object.fromEntries(
    inserted.map((row) => [row.role, { id: row.id, email: row.email }]),
  ) as Record<Role, { id: string; email: string }>;

  const [customer] = await db
    .insert(customers)
    .values({ name: 'Adom Motors Ltd' })
    .returning();

  await db.insert(settings).values([
    { key: 'default_margin_pct', value: '35' },
    { key: 'default_payment_terms_days', value: '30' },
  ]);

  return {
    locationId: location!.id,
    /** The sales account. Still called this because it is who records a sale. */
    sellerId: staff.sales.id,
    customerId: customer!.id,
    staff,
  };
}

/** A shop with stock on the shelf, for the POS tests. */
export async function shopFixture(db: Db) {
  const base = await baseFixture(db);

  const [bosch] = await db.insert(brands).values({ name: 'Bosch' }).returning();

  const made = async (sku: string, name: string, price: string | null, stock: string) => {
    const [part] = await db.insert(parts).values({ sku, name, brandId: bosch!.id }).returning();
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
      .values({ partId: part!.id, locationId: base.locationId, quantity: stock });
    return part!;
  };

  return {
    ...base,
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

/** The purchase order from the ReceiveStock wireframe, figure for figure, so the
 *  tests can assert the exact numbers a reviewer can read off the design:
 *  40 x $11.80 and 24 x $23.50 and 18 x $17.20 at 12.4000 GHS/USD. */
export async function purchaseOrderFixture(db: Db) {
  const [supplier] = await db
    .insert(suppliers)
    .values({ name: 'Guangzhou Hongfa Auto Parts Co.' })
    .returning();

  const [order] = await db
    .insert(purchaseOrders)
    .values({
      reference: 'PO-2026-0031',
      supplierId: supplier!.id,
      status: 'sent',
      orderDate: '2026-09-02',
      fxRate: '12.400000',
    })
    .returning();

  const line = async (sku: string, name: string, ordered: string, unitCostUsd: string) => {
    const [part] = await db.insert(parts).values({ sku, name }).returning();
    const [row] = await db
      .insert(purchaseOrderLines)
      .values({
        purchaseOrderId: order!.id,
        partId: part!.id,
        quantityOrdered: ordered,
        unitCostUsd,
      })
      .returning();
    return { partId: part!.id, lineId: row!.id };
  };

  return {
    supplierId: supplier!.id,
    orderId: order!.id,
    brakePad: await line('BP-2042', 'Brake pad set, front', '40', '11.8000'),
    shock: await line('SA-3307', 'Shock absorber, rear', '24', '23.5000'),
    waterPump: await line('WP-2290', 'Water pump', '18', '17.2000'),
  };
}
