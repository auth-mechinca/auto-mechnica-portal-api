/** Inventory business logic. Section 4 of the demo scope.
 *
 *  Not implemented yet.
 *
 *  listParts / createPart / updatePart
 *    Catalogue maintenance, including fitment entries and reorder point.
 *
 *  adjustStock(partId, delta, reason, userId)
 *    Manual correction. Reason is required (damage / loss / count correction).
 *    The stock_movement and the inventory_balance update share one transaction,
 *    so a balance can never move without a movement row explaining it.
 *
 *  listLowStock()
 *    Balances at or below parts.reorder_point. The wireframe's
 *    "Start purchase order" hands the ticked parts to PO Create.
 */
export {};
