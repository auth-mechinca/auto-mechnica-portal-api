/** Suppliers, purchase orders and pricing. Section 6 of the demo scope.
 *
 *  Not implemented yet.
 *
 *  createPurchaseOrder(input)
 *    Lines carry unit_cost_usd; the order carries one fx_rate (GHS per USD),
 *    entered by hand. That single rate applies to every receipt against the
 *    order, including partial deliveries.
 *
 *  receiveStock(poId, input, userId)
 *    The centrepiece of the demo — receive a PO, watch a price appear at the
 *    till. All of it in one transaction:
 *      1. increment quantity_received per line; partial deliveries allowed
 *      2. increment inventory_balances, insert a stock_movement 'po_receipt'
 *      3. landed_cost = unit_cost_usd * fx_rate            -> GHS (Section 6.4)
 *      4. suggested_price = landed_cost * (1 + default_margin_pct/100)
 *      5. upsert prices; leave a hand-set final_price alone
 *      6. append a price_history row, source 'po_receipt', changed_by null
 *      7. move the PO to partially_received or received
 *
 *    Pricing is against the LATEST purchase cost — you price to replace, not to
 *    what you paid. What happens to an existing override at a new cost is still
 *    open (see the build-progress note); the recommendation is that the override
 *    stands but the part is flagged for review, which needs a schema change
 *    because `prices` has no review state today.
 *
 *  setFinalPrice(partId, price, userId)
 *    Updates prices.final_price and appends a price_history row, source
 *    'manual', changed_by set. The final price is the only figure the Sales role
 *    ever sees — never cost, never the suggestion.
 */
export {};
