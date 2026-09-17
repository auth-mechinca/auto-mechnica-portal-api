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
  suppliers,
  users,
} from '../../db/schema/index.js';
import { ApiError } from '../../lib/http.js';
import { add, compare, multiply, sum } from '../../lib/money.js';

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

const suggestedFrom = (landed: string, marginPct: string) => {
  // landed x (1 + margin/100), built as an exact decimal multiplier.
  const multiplier = add('1', multiply(marginPct, '0.01', 4));
  return multiply(landed, multiplier);
};

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
      const suggestedPrice = suggestedFrom(landedCost, marginPct);

      const [existing] = await tx
        .select()
        .from(prices)
        .where(eq(prices.partId, line.partId))
        .limit(1);

      // An override is a deliberate human decision and survives a new delivery.
      // A part nobody has priced yet takes the suggestion.
      const finalPrice = existing?.finalPrice ?? suggestedPrice;

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
          suggestedPrice,
          finalPrice,
          marginPctUsed: marginPct,
        })
        .onConflictDoUpdate({
          target: prices.partId,
          set: { landedCost, suggestedPrice, finalPrice, marginPctUsed: marginPct, updatedAt: new Date() },
        });

      // Append-only. changedBy stays null: the system re-suggested this, nobody
      // typed it.
      await tx.insert(priceHistory).values({
        partId: line.partId,
        landedCost,
        suggestedPrice,
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
        suggestedPrice,
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
