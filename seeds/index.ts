import { and, eq, sql } from 'drizzle-orm';
import { closeDb, getDb, type Db } from '../src/db/client.js';
import { hashPassword } from '../src/lib/password.js';
import {
  customers,
  inventoryBalances,
  locations,
  parts,
  priceHistory,
  prices,
  purchaseOrderLines,
  purchaseOrders,
  settings,
  stockMovements,
  suppliers,
  users,
} from '../src/db/schema/index.js';
import { landedCost, suggestedPrice } from './money.js';
import {
  CUSTOMERS,
  DEMO_PASSWORD,
  HISTORIC_FX_RATE,
  LOCATION_NAME,
  OPEN_PURCHASE_ORDER,
  PARTS,
  SETTINGS,
  SUPPLIERS,
  USERS,
} from './data.js';

/** Demo seed data.
 *
 *  Re-runnable: catalogue, users, prices and settings are upserted on their
 *  natural keys, so running this twice changes nothing. Stock is the exception —
 *  balances are reset to their opening figures and the opening movement is
 *  written only once, so re-seeding a database that has since recorded sales
 *  leaves the ledger and the balance disagreeing. Run it after `db:reset` for a
 *  clean history; that is the normal case.
 *
 *  It connects as the ordinary application role, not the migration role, which
 *  means a missing grant fails here rather than in production.
 */

const OPENING_STOCK_NOTE = 'Opening stock (seed)';

/** For tables with no unique constraint to conflict on. */
async function findOrCreate<T extends { id: string }>(
  find: () => Promise<T | undefined>,
  create: () => Promise<T>,
): Promise<T> {
  return (await find()) ?? (await create());
}

async function seedSettings(db: Db) {
  for (const [key, value] of Object.entries(SETTINGS)) {
    await db
      .insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
  }
  return Object.keys(SETTINGS).length;
}

async function seedLocation(db: Db) {
  return findOrCreate(
    async () =>
      (await db.select().from(locations).where(eq(locations.name, LOCATION_NAME)).limit(1))[0],
    async () => (await db.insert(locations).values({ name: LOCATION_NAME }).returning())[0]!,
  );
}

async function seedUsers(db: Db) {
  // Hashed with the app's own helper, so the cost matches what login expects.
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  for (const user of USERS) {
    await db
      .insert(users)
      .values({ ...user, passwordHash })
      .onConflictDoUpdate({
        target: users.email,
        set: { passwordHash, fullName: user.fullName, role: user.role, isActive: true },
      });
  }
  return USERS.length;
}

async function seedSuppliers(db: Db) {
  for (const supplier of SUPPLIERS) {
    await findOrCreate(
      async () =>
        (await db.select().from(suppliers).where(eq(suppliers.name, supplier.name)).limit(1))[0],
      async () => (await db.insert(suppliers).values({ ...supplier }).returning())[0]!,
    );
  }
  return SUPPLIERS.length;
}

async function seedCustomers(db: Db) {
  for (const customer of CUSTOMERS) {
    await findOrCreate(
      async () =>
        (await db.select().from(customers).where(eq(customers.name, customer.name)).limit(1))[0],
      async () => (await db.insert(customers).values({ ...customer }).returning())[0]!,
    );
  }
  return CUSTOMERS.length;
}

async function seedPartsAndPrices(db: Db, locationId: string) {
  const margin = SETTINGS.default_margin_pct;

  for (const part of PARTS) {
    const [row] = await db
      .insert(parts)
      .values({
        sku: part.sku,
        name: part.name,
        partNumber: part.partNumber,
        oemNumber: part.oemNumber,
        brand: part.brand,
        category: part.category,
        fitment: [...part.fitment],
        reorderPoint: part.reorderPoint,
      })
      .onConflictDoUpdate({
        target: parts.sku,
        set: { name: part.name, brand: part.brand, reorderPoint: part.reorderPoint },
      })
      .returning();

    const partId = row!.id;

    // Computed, never typed in — the seed must agree with what receiveStock will
    // later calculate from the same figures.
    const landed = landedCost(part.unitCostUsd, HISTORIC_FX_RATE);
    const suggested = suggestedPrice(landed, margin);

    await db
      .insert(prices)
      .values({
        partId,
        landedCost: landed,
        suggestedPrice: suggested,
        finalPrice: part.finalPrice,
        marginPctUsed: margin,
      })
      .onConflictDoUpdate({
        target: prices.partId,
        set: {
          landedCost: landed,
          suggestedPrice: suggested,
          finalPrice: part.finalPrice,
          marginPctUsed: margin,
        },
      });

    // One history row, so a price has a cost basis from the start rather than
    // appearing to have been set against nothing.
    const existingHistory = await db
      .select({ id: priceHistory.id })
      .from(priceHistory)
      .where(eq(priceHistory.partId, partId))
      .limit(1);

    if (existingHistory.length === 0) {
      await db.insert(priceHistory).values({
        partId,
        landedCost: landed,
        suggestedPrice: suggested,
        finalPrice: part.finalPrice,
        marginPctUsed: margin,
        source: 'manual',
      });
    }

    await db
      .insert(inventoryBalances)
      .values({ partId, locationId, quantity: part.openingStock })
      .onConflictDoUpdate({
        target: [inventoryBalances.partId, inventoryBalances.locationId],
        set: { quantity: part.openingStock },
      });

    const existingOpening = await db
      .select({ id: stockMovements.id })
      .from(stockMovements)
      .where(and(eq(stockMovements.partId, partId), eq(stockMovements.note, OPENING_STOCK_NOTE)))
      .limit(1);

    if (existingOpening.length === 0) {
      await db.insert(stockMovements).values({
        partId,
        locationId,
        type: 'adjustment',
        quantityDelta: part.openingStock,
        reason: 'count_correction',
        note: OPENING_STOCK_NOTE,
      });
    }
  }

  return PARTS.length;
}

async function seedOpenPurchaseOrder(db: Db) {
  const po = OPEN_PURCHASE_ORDER;

  const existing = await db
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.reference, po.reference))
    .limit(1);
  if (existing.length > 0) return 0;

  const [supplier] = await db
    .select()
    .from(suppliers)
    .where(eq(suppliers.name, po.supplierName))
    .limit(1);
  if (!supplier) throw new Error(`Seed supplier missing: ${po.supplierName}`);

  const [order] = await db
    .insert(purchaseOrders)
    .values({
      reference: po.reference,
      supplierId: supplier.id,
      status: 'sent',
      orderDate: po.orderDate,
      fxRate: po.fxRate,
    })
    .returning();

  for (const line of po.lines) {
    const [part] = await db.select().from(parts).where(eq(parts.sku, line.sku)).limit(1);
    if (!part) throw new Error(`Seed part missing: ${line.sku}`);

    await db.insert(purchaseOrderLines).values({
      purchaseOrderId: order!.id,
      partId: part.id,
      quantityOrdered: line.quantityOrdered,
      unitCostUsd: line.unitCostUsd,
    });
  }

  return 1;
}

export async function seed(db: Db = getDb()): Promise<void> {
  const settingsCount = await seedSettings(db);
  const location = await seedLocation(db);
  const userCount = await seedUsers(db);
  const supplierCount = await seedSuppliers(db);
  const customerCount = await seedCustomers(db);
  const partCount = await seedPartsAndPrices(db, location.id);
  const poCount = await seedOpenPurchaseOrder(db);

  console.log(
    [
      `settings   ${settingsCount}`,
      `location   ${location.name}`,
      `users      ${userCount} (password: ${DEMO_PASSWORD})`,
      `suppliers  ${supplierCount}`,
      `customers  ${customerCount}`,
      `parts      ${partCount} with prices, stock and history`,
      `purchase   ${poCount ? `${OPEN_PURCHASE_ORDER.reference} left open for the receive demo` : 'already present'}`,
    ].join('\n'),
  );
}

// Only run when invoked directly, so tests can import `seed` without side effects.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  seed()
    .then(() => closeDb())
    .then(() => process.exit(0))
    .catch(async (error: unknown) => {
      console.error('Seed failed:', error);
      await closeDb();
      process.exit(1);
    });
}
