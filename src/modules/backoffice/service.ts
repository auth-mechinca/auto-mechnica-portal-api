import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Tx } from '../../db/client.js';
import { defaultLocationId, settingValue } from '../../db/defaults.js';
import {
  inventoryBalances,
  parts,
  priceHistory,
  prices,
  purchaseOrderLines,
  purchaseOrders,
  stockMovements,
  settings,
  suppliers,
  users,
} from '../../db/schema/index.js';
import { ApiError } from '../../lib/http.js';
import { add, compare, multiply, sum, suggestedPrice as suggestedPriceFor } from '../../lib/money.js';

/** Suppliers, purchase orders and pricing. Section 6 of the demo scope.
 *
 *  Receiving stock is the centrepiece: it is the step where a USD purchase cost
 *  becomes a Cedi price at the till.
 */

/* ------------------------------------------------------------------ input */

export const purchaseOrderIdParam = z.object({ id: z.string().uuid() });
export type PurchaseOrderIdParam = z.infer<typeof purchaseOrderIdParam>;

export const listPurchaseOrdersQuery = z.object({
  status: z.enum(['draft', 'sent', 'partially_received', 'received', 'cancelled']).optional(),
  supplierId: z.string().uuid().optional(),
});
export type ListPurchaseOrdersQuery = z.infer<typeof listPurchaseOrdersQuery>;

export const receiveStockInput = z.object({
  lines: z
    .array(
      z.object({
        lineId: z.string().uuid(),
        /** What actually arrived now, not the running total. Zero is expressed by
         *  leaving the line out. */
        quantityReceived: z.number().int().positive().max(1_000_000),
      }),
    )
    .min(1),
});
export type ReceiveStockInput = z.infer<typeof receiveStockInput>;

/* ----------------------------------------------------------------- output */

const poStatusSchema = z.enum([
  'draft',
  'sent',
  'partially_received',
  'received',
  'cancelled',
]);

export const purchaseOrderSummary = z.object({
  id: z.string().uuid(),
  reference: z.string(),
  supplier: z.object({ id: z.string().uuid(), name: z.string() }),
  orderDate: z.string(),
  status: poStatusSchema,
  lineCount: z.number(),
  /** GHS per USD, fixed for the life of the order. */
  fxRate: z.string(),
  totalUsd: z.string(),
  totalGhs: z.string(),
});
export type PurchaseOrderSummary = z.infer<typeof purchaseOrderSummary>;

export const purchaseOrderDetail = purchaseOrderSummary.extend({
  orderedUnits: z.number(),
  receivedUnits: z.number(),
  /** Landed value of what has arrived, and of what is still to come. */
  receivedGhs: z.string(),
  outstandingGhs: z.string(),
  lines: z.array(
    z.object({
      id: z.string().uuid(),
      partId: z.string().uuid(),
      sku: z.string(),
      name: z.string(),
      quantityOrdered: z.string(),
      quantityReceived: z.string(),
      quantityOutstanding: z.string(),
      unitCostUsd: z.string(),
      lineTotalUsd: z.string(),
      /** unit cost x the order's FX rate. GHS from here on. */
      landedCost: z.string(),
    }),
  ),
  receipts: z.array(
    z.object({
      receivedAt: z.string(),
      receivedBy: z.string().nullable(),
      lines: z.array(z.object({ sku: z.string(), quantity: z.string() })),
      valueGhs: z.string(),
    }),
  ),
});
export type PurchaseOrderDetail = z.infer<typeof purchaseOrderDetail>;

export const receiveStockResult = z.object({
  id: z.string().uuid(),
  reference: z.string(),
  statusBefore: poStatusSchema,
  statusAfter: poStatusSchema,
  received: z.array(
    z.object({
      lineId: z.string().uuid(),
      sku: z.string(),
      name: z.string(),
      quantityReceived: z.string(),
      landedCost: z.string(),
      suggestedPrice: z.string(),
      finalPrice: z.string(),
      /** True when a hand-set price now stands against a cost that has moved.
       *  The override is kept — it was a deliberate decision — but the part is
       *  surfaced for review rather than silently left to erode the margin. */
      needsReview: z.boolean(),
      valueGhs: z.string(),
    }),
  ),
  valueReceivedGhs: z.string(),
});
export type ReceiveStockResult = z.infer<typeof receiveStockResult>;

/* ---------------------------------------------------------------- helpers */

/** landed cost is per unit and fixed for the order: the FX rate does not move
 *  with a later delivery. Section 6.2. */
const landedCostOf = (unitCostUsd: string, fxRate: string) => multiply(unitCostUsd, fxRate);

/** Deliberately not redefined here — `suggestedPrice` in lib/money.ts is the one
 *  implementation of the pricing rule, shared with the seeds so the two cannot
 *  drift apart on what a margin means. */

/* -------------------------------------------------------------- reading */

export async function listPurchaseOrders(
  query: ListPurchaseOrdersQuery,
): Promise<PurchaseOrderSummary[]> {
  const db = getDb();

  const conditions = [
    query.status ? eq(purchaseOrders.status, query.status) : undefined,
    query.supplierId ? eq(purchaseOrders.supplierId, query.supplierId) : undefined,
  ].filter((c) => c !== undefined);

  const rows = await db
    .select({
      id: purchaseOrders.id,
      reference: purchaseOrders.reference,
      orderDate: purchaseOrders.orderDate,
      status: purchaseOrders.status,
      fxRate: purchaseOrders.fxRate,
      supplierId: suppliers.id,
      supplierName: suppliers.name,
      lineCount: sql<number>`count(${purchaseOrderLines.id})::int`,
      totalUsd: sql<string>`coalesce(sum(${purchaseOrderLines.quantityOrdered} * ${purchaseOrderLines.unitCostUsd}), 0)::text`,
    })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .leftJoin(purchaseOrderLines, eq(purchaseOrderLines.purchaseOrderId, purchaseOrders.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .groupBy(purchaseOrders.id, suppliers.id)
    .orderBy(desc(purchaseOrders.orderDate));

  return rows.map((row) => ({
    id: row.id,
    reference: row.reference,
    supplier: { id: row.supplierId, name: row.supplierName },
    orderDate: row.orderDate,
    status: row.status,
    lineCount: row.lineCount,
    fxRate: row.fxRate,
    totalUsd: multiply(row.totalUsd, '1'),
    totalGhs: multiply(row.totalUsd, row.fxRate),
  }));
}

export async function getPurchaseOrder(id: string): Promise<PurchaseOrderDetail> {
  const db = getDb();

  const [order] = await db
    .select({
      id: purchaseOrders.id,
      reference: purchaseOrders.reference,
      orderDate: purchaseOrders.orderDate,
      status: purchaseOrders.status,
      fxRate: purchaseOrders.fxRate,
      supplierId: suppliers.id,
      supplierName: suppliers.name,
    })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(eq(purchaseOrders.id, id))
    .limit(1);

  if (!order) throw ApiError.notFound('Purchase order not found');

  const lineRows = await db
    .select({
      id: purchaseOrderLines.id,
      partId: parts.id,
      sku: parts.sku,
      name: parts.name,
      quantityOrdered: purchaseOrderLines.quantityOrdered,
      quantityReceived: purchaseOrderLines.quantityReceived,
      unitCostUsd: purchaseOrderLines.unitCostUsd,
    })
    .from(purchaseOrderLines)
    .innerJoin(parts, eq(parts.id, purchaseOrderLines.partId))
    .where(eq(purchaseOrderLines.purchaseOrderId, id))
    .orderBy(asc(parts.name));

  const lines = lineRows.map((line) => {
    const landedCost = landedCostOf(line.unitCostUsd, order.fxRate);
    const outstanding = String(Number(line.quantityOrdered) - Number(line.quantityReceived));
    return {
      id: line.id,
      partId: line.partId,
      sku: line.sku,
      name: line.name,
      quantityOrdered: line.quantityOrdered,
      quantityReceived: line.quantityReceived,
      quantityOutstanding: outstanding,
      unitCostUsd: line.unitCostUsd,
      // Two decimals: the extra scale on unit_cost_usd keeps a per-unit cost
      // precise, but a line total is an amount the supplier actually invoices,
      // and they invoice in dollars and cents.
      lineTotalUsd: multiply(line.unitCostUsd, line.quantityOrdered),
      landedCost,
    };
  });

  // Every movement written inside one transaction shares the same created_at,
  // because Postgres `now()` is the transaction timestamp. That makes a receipt
  // event identifiable without a header table of its own.
  const movements =
    lines.length === 0
      ? []
      : await db
          .select({
            createdAt: stockMovements.createdAt,
            byName: users.fullName,
            sku: parts.sku,
            quantity: stockMovements.quantityDelta,
            unitCostUsd: purchaseOrderLines.unitCostUsd,
          })
          .from(stockMovements)
          .innerJoin(purchaseOrderLines, eq(purchaseOrderLines.id, stockMovements.referenceId))
          .innerJoin(parts, eq(parts.id, stockMovements.partId))
          .leftJoin(users, eq(users.id, stockMovements.createdBy))
          .where(
            and(
              eq(stockMovements.type, 'po_receipt'),
              inArray(
                purchaseOrderLines.id,
                lines.map((l) => l.id),
              ),
            ),
          )
          .orderBy(desc(stockMovements.createdAt));

  const receiptsByMoment = new Map<string, PurchaseOrderDetail['receipts'][number]>();
  for (const movement of movements) {
    const key = movement.createdAt.toISOString();
    const receipt = receiptsByMoment.get(key) ?? {
      receivedAt: key,
      receivedBy: movement.byName,
      lines: [],
      valueGhs: '0.00',
    };
    receipt.lines.push({ sku: movement.sku, quantity: movement.quantity });
    receipt.valueGhs = add(
      receipt.valueGhs,
      multiply(landedCostOf(movement.unitCostUsd, order.fxRate), movement.quantity),
    );
    receiptsByMoment.set(key, receipt);
  }

  const orderedUnits = lines.reduce((n, l) => n + Number(l.quantityOrdered), 0);
  const receivedUnits = lines.reduce((n, l) => n + Number(l.quantityReceived), 0);
  const totalUsd = sum(lines.map((l) => l.lineTotalUsd));

  return {
    id: order.id,
    reference: order.reference,
    supplier: { id: order.supplierId, name: order.supplierName },
    orderDate: order.orderDate,
    status: order.status,
    lineCount: lines.length,
    fxRate: order.fxRate,
    totalUsd,
    totalGhs: multiply(totalUsd, order.fxRate),
    orderedUnits,
    receivedUnits,
    receivedGhs: sum(lines.map((l) => multiply(l.landedCost, l.quantityReceived))),
    outstandingGhs: sum(lines.map((l) => multiply(l.landedCost, l.quantityOutstanding))),
    lines,
    receipts: [...receiptsByMoment.values()],
  };
}

/* ------------------------------------------------------------- receiving */

export async function receiveStock(
  purchaseOrderId: string,
  input: ReceiveStockInput,
  receivedBy: string,
): Promise<ReceiveStockResult> {
  return getDb().transaction(async (tx) => {
    const locationId = await defaultLocationId(tx);

    const [order] = await tx
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, purchaseOrderId))
      .for('update')
      .limit(1);

    if (!order) throw ApiError.notFound('Purchase order not found');

    // A draft has not been placed with anyone, and a cancelled or fully received
    // order has nothing left to arrive.
    if (order.status !== 'sent' && order.status !== 'partially_received') {
      throw ApiError.conflict(
        `A ${order.status.replace('_', ' ')} purchase order cannot receive stock`,
      );
    }

    const allLines = await tx
      .select({
        id: purchaseOrderLines.id,
        partId: purchaseOrderLines.partId,
        sku: parts.sku,
        name: parts.name,
        quantityOrdered: purchaseOrderLines.quantityOrdered,
        quantityReceived: purchaseOrderLines.quantityReceived,
        unitCostUsd: purchaseOrderLines.unitCostUsd,
      })
      .from(purchaseOrderLines)
      .innerJoin(parts, eq(parts.id, purchaseOrderLines.partId))
      .where(eq(purchaseOrderLines.purchaseOrderId, purchaseOrderId));

    const byId = new Map(allLines.map((line) => [line.id, line]));

    // Same lock order as a POS sale — by part id — so a sale and a delivery
    // touching the same parts cannot deadlock against each other.
    const requested = [...input.lines]
      .map((line) => {
        const found = byId.get(line.lineId);
        if (!found) throw ApiError.badRequest(`Line ${line.lineId} is not on this purchase order`);
        return { ...line, line: found };
      })
      .sort((a, b) => a.line.partId.localeCompare(b.line.partId));

    const marginPct = await settingValue(tx, 'default_margin_pct', '35');
    const received: ReceiveStockResult['received'] = [];

    for (const { line, quantityReceived } of requested) {
      const outstanding = Number(line.quantityOrdered) - Number(line.quantityReceived);
      if (quantityReceived > outstanding) {
        throw ApiError.badRequest(
          `${line.name}: receiving ${quantityReceived} would exceed the ${outstanding} still outstanding`,
        );
      }

      await tx
        .update(purchaseOrderLines)
        .set({
          quantityReceived: sql`${purchaseOrderLines.quantityReceived} + ${String(quantityReceived)}`,
          updatedAt: new Date(),
        })
        .where(eq(purchaseOrderLines.id, line.id));

      await tx
        .insert(inventoryBalances)
        .values({ partId: line.partId, locationId, quantity: String(quantityReceived) })
        .onConflictDoUpdate({
          target: [inventoryBalances.partId, inventoryBalances.locationId],
          set: {
            quantity: sql`${inventoryBalances.quantity} + ${String(quantityReceived)}`,
            updatedAt: new Date(),
          },
        });

      await tx.insert(stockMovements).values({
        partId: line.partId,
        locationId,
        type: 'po_receipt',
        quantityDelta: String(quantityReceived),
        referenceId: line.id,
        createdBy: receivedBy,
      });

      const landedCost = landedCostOf(line.unitCostUsd, order.fxRate);
      const suggested = suggestedPriceFor(landedCost, marginPct);

      const [existing] = await tx
        .select()
        .from(prices)
        .where(eq(prices.partId, line.partId))
        .limit(1);

      // An override is a deliberate human decision and survives a new delivery.
      // A part nobody has priced yet takes the suggestion.
      const finalPrice = existing?.finalPrice ?? suggested;

      // "Needs review" is derived, not stored: the landed cost the price was last
      // set against lives in price_history. If it has moved, the standing price
      // is being measured against a cost that no longer applies.
      const [lastManual] = await tx
        .select({ landedCost: priceHistory.landedCost })
        .from(priceHistory)
        .where(and(eq(priceHistory.partId, line.partId), eq(priceHistory.source, 'manual')))
        .orderBy(desc(priceHistory.createdAt))
        .limit(1);

      const needsReview =
        lastManual?.landedCost != null && compare(lastManual.landedCost, landedCost) !== 0;

      await tx
        .insert(prices)
        .values({
          partId: line.partId,
          landedCost,
          suggestedPrice: suggested,
          finalPrice,
          marginPctUsed: marginPct,
        })
        .onConflictDoUpdate({
          target: prices.partId,
          set: {
            landedCost,
            suggestedPrice: suggested,
            finalPrice,
            marginPctUsed: marginPct,
            updatedAt: new Date(),
          },
        });

      // Append-only. changedBy stays null: the system re-suggested this, nobody
      // typed it.
      await tx.insert(priceHistory).values({
        partId: line.partId,
        landedCost,
        suggestedPrice: suggested,
        finalPrice,
        marginPctUsed: marginPct,
        source: 'po_receipt',
        referenceId: line.id,
      });

      received.push({
        lineId: line.id,
        sku: line.sku,
        name: line.name,
        quantityReceived: String(quantityReceived),
        landedCost,
        suggestedPrice: suggested,
        finalPrice,
        needsReview,
        valueGhs: multiply(landedCost, String(quantityReceived)),
      });
    }

    const after = await tx
      .select({
        ordered: purchaseOrderLines.quantityOrdered,
        received: purchaseOrderLines.quantityReceived,
      })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, purchaseOrderId));

    const fullyReceived = after.every(
      (line) => Number(line.received) >= Number(line.ordered),
    );
    const statusAfter = fullyReceived ? 'received' : 'partially_received';

    await tx
      .update(purchaseOrders)
      .set({ status: statusAfter, updatedAt: new Date() })
      .where(eq(purchaseOrders.id, purchaseOrderId));

    return {
      id: order.id,
      reference: order.reference,
      statusBefore: order.status,
      statusAfter,
      received,
      valueReceivedGhs: sum(received.map((line) => line.valueGhs)),
    };
  });
}

/* --------------------------------------------------------- price management */

/** The three states the Prices screen shows, derived rather than stored.
 *
 *  `needs_review` wins over `overridden`: a price that was deliberately set and
 *  whose cost has since moved is the one someone has to look at, and saying only
 *  "overridden" would bury exactly the row that matters. */
export const priceStatus = z.enum(['needs_review', 'overridden', 'confirmed']);
export type PriceStatus = z.infer<typeof priceStatus>;

function statusOf(
  landedCost: string,
  suggested: string,
  finalPrice: string,
  lastManualLandedCost: string | null,
): PriceStatus {
  if (lastManualLandedCost !== null && compare(lastManualLandedCost, landedCost) !== 0) {
    return 'needs_review';
  }
  return compare(finalPrice, suggested) === 0 ? 'confirmed' : 'overridden';
}

export const listPricesQuery = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  status: priceStatus.optional(),
});
export type ListPricesQuery = z.infer<typeof listPricesQuery>;

export const partIdParam = z.object({ partId: z.string().uuid() });
export type PartIdParam = z.infer<typeof partIdParam>;

export const setFinalPriceInput = z.object({
  /** A string, like every other amount: a price is exact, not a float. */
  finalPrice: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Expected an amount such as "448.31"'),
});
export type SetFinalPriceInput = z.infer<typeof setFinalPriceInput>;

export const priceRow = z.object({
  partId: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  brand: z.string().nullable(),
  landedCost: z.string(),
  suggestedPrice: z.string(),
  finalPrice: z.string(),
  marginPctUsed: z.string(),
  status: priceStatus,
  updatedAt: z.string(),
});
export type PriceRow = z.infer<typeof priceRow>;

export const priceDetail = priceRow.extend({
  /** Where the cost came from. Nothing on this screen is typed by hand — to
   *  change the cost you change the purchase order. */
  costBasis: z
    .object({
      purchaseOrderId: z.string().uuid(),
      reference: z.string(),
      unitCostUsd: z.string(),
      fxRate: z.string(),
    })
    .nullable(),
  history: z.array(
    z.object({
      at: z.string(),
      source: z.enum(['po_receipt', 'manual']),
      landedCost: z.string(),
      suggestedPrice: z.string(),
      finalPrice: z.string(),
      marginPctUsed: z.string(),
      changedBy: z.string().nullable(),
      reference: z.string().nullable(),
    }),
  ),
});
export type PriceDetail = z.infer<typeof priceDetail>;

type PriceQueryRow = {
  partId: string;
  sku: string;
  name: string;
  brand: string | null;
  landedCost: string;
  suggestedPrice: string;
  finalPrice: string;
  marginPctUsed: string;
  updatedAt: string;
  lastManualLandedCost: string | null;
};

export async function listPrices(query: ListPricesQuery): Promise<PriceRow[]> {
  const db = getDb();
  const pattern = query.q ? `%${query.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;

  // Only parts that have been priced appear here — a part nobody has ever
  // received has no cost to price against and nothing to show.
  const { rows } = await db.execute<PriceQueryRow>(sql`
    select p.id                   as "partId",
           p.sku,
           p.name,
           p.brand,
           pr.landed_cost         as "landedCost",
           pr.suggested_price     as "suggestedPrice",
           pr.final_price         as "finalPrice",
           pr.margin_pct_used     as "marginPctUsed",
           pr.updated_at          as "updatedAt",
           (select h.landed_cost
              from ${priceHistory} h
             where h.part_id = p.id and h.source = 'manual'
             order by h.created_at desc
             limit 1)             as "lastManualLandedCost"
      from ${prices} pr
      join ${parts} p on p.id = pr.part_id
     where pr.final_price is not null
       and (${pattern}::text is null
            or p.name ilike ${pattern} or p.sku ilike ${pattern} or p.brand ilike ${pattern})
     order by p.name
  `);

  const withStatus = rows.map((row) => ({
    partId: row.partId,
    sku: row.sku,
    name: row.name,
    brand: row.brand,
    landedCost: row.landedCost,
    suggestedPrice: row.suggestedPrice,
    finalPrice: row.finalPrice,
    marginPctUsed: row.marginPctUsed,
    updatedAt: new Date(row.updatedAt).toISOString(),
    status: statusOf(row.landedCost, row.suggestedPrice, row.finalPrice, row.lastManualLandedCost),
  }));

  // Filtered here rather than in SQL because the status is derived from a
  // comparison, not stored. The catalogue is small enough that this is honest
  // rather than lazy; it would need rethinking at thousands of parts.
  return query.status ? withStatus.filter((row) => row.status === query.status) : withStatus;
}

export async function getPrice(partId: string): Promise<PriceDetail> {
  const db = getDb();

  const [row] = await listPricesFor(partId);
  if (!row) throw ApiError.notFound('That part has no price yet');

  const historyRows = await db
    .select({
      at: priceHistory.createdAt,
      source: priceHistory.source,
      landedCost: priceHistory.landedCost,
      suggestedPrice: priceHistory.suggestedPrice,
      finalPrice: priceHistory.finalPrice,
      marginPctUsed: priceHistory.marginPctUsed,
      changedBy: users.fullName,
      reference: purchaseOrders.reference,
      purchaseOrderId: purchaseOrders.id,
      unitCostUsd: purchaseOrderLines.unitCostUsd,
      fxRate: purchaseOrders.fxRate,
    })
    .from(priceHistory)
    .leftJoin(users, eq(users.id, priceHistory.changedBy))
    .leftJoin(purchaseOrderLines, eq(purchaseOrderLines.id, priceHistory.referenceId))
    .leftJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.purchaseOrderId))
    .where(eq(priceHistory.partId, partId))
    .orderBy(desc(priceHistory.createdAt));

  const latestReceipt = historyRows.find((h) => h.source === 'po_receipt' && h.purchaseOrderId);

  return {
    ...row,
    costBasis: latestReceipt
      ? {
          purchaseOrderId: latestReceipt.purchaseOrderId!,
          reference: latestReceipt.reference!,
          unitCostUsd: latestReceipt.unitCostUsd!,
          fxRate: latestReceipt.fxRate!,
        }
      : null,
    history: historyRows.map((h) => ({
      at: h.at.toISOString(),
      source: h.source,
      landedCost: h.landedCost ?? '0.00',
      suggestedPrice: h.suggestedPrice ?? '0.00',
      finalPrice: h.finalPrice ?? '0.00',
      marginPctUsed: h.marginPctUsed ?? '0.00',
      changedBy: h.changedBy,
      reference: h.reference,
    })),
  };
}

/** Shared by the list and the detail so both agree on how a status is reached. */
async function listPricesFor(partId: string): Promise<PriceRow[]> {
  const all = await listPrices({});
  return all.filter((row) => row.partId === partId);
}

export async function setFinalPrice(
  partId: string,
  input: SetFinalPriceInput,
  changedBy: string,
): Promise<PriceDetail> {
  await getDb().transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(prices)
      .where(eq(prices.partId, partId))
      .for('update')
      .limit(1);

    if (!existing) throw ApiError.notFound('That part has no price yet');
    if (existing.landedCost === null || existing.suggestedPrice === null) {
      throw ApiError.conflict('That part has no cost recorded yet — receive it on a purchase order first');
    }

    await tx
      .update(prices)
      .set({ finalPrice: input.finalPrice, updatedAt: new Date() })
      .where(eq(prices.partId, partId));

    // Append-only, and attributed: this is the row that later tells us which cost
    // the price was set against, which is what makes "needs review" derivable.
    await tx.insert(priceHistory).values({
      partId,
      landedCost: existing.landedCost,
      suggestedPrice: existing.suggestedPrice,
      finalPrice: input.finalPrice,
      marginPctUsed: existing.marginPctUsed,
      source: 'manual',
      changedBy,
    });
  });

  return getPrice(partId);
}

/* ---------------------------------------------------------------- settings */

export const settingsResponse = z.object({
  defaultMarginPct: z.string(),
  defaultPaymentTermsDays: z.string(),
});
export type SettingsResponse = z.infer<typeof settingsResponse>;

export const updateSettingsInput = z.object({
  /** Below 100 because a margin is a share of the selling price: at 100% the
   *  price would have to be infinite, and beyond it, negative. */
  defaultMarginPct: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .refine((value) => Number(value) < 100, 'A margin must be under 100%'),
});
export type UpdateSettingsInput = z.infer<typeof updateSettingsInput>;

export async function getSettings(): Promise<SettingsResponse> {
  return getDb().transaction(async (tx) => ({
    defaultMarginPct: await settingValue(tx, 'default_margin_pct', '35'),
    defaultPaymentTermsDays: await settingValue(tx, 'default_payment_terms_days', '30'),
  }));
}

/** Changes what future receipts and price screens suggest. Prices already saved
 *  are left alone: they were decisions taken at the margin of the day, and
 *  rewriting them would silently reprice the whole catalogue. */
export async function updateSettings(input: UpdateSettingsInput): Promise<SettingsResponse> {
  await getDb()
    .insert(settings)
    .values({ key: 'default_margin_pct', value: input.defaultMarginPct })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: input.defaultMarginPct, updatedAt: new Date() },
    });

  return getSettings();
}
