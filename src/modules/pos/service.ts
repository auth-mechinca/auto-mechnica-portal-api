/** POS business logic. Section 3 of the demo scope.
 *
 *  Not implemented yet. The shape below is the plan, kept here rather than in
 *  routes.ts so the route file stays wiring only.
 *
 *  searchParts(query)
 *    Search by name, part number or fitment. Returns stock on hand and
 *    `prices.final_price` only — never landed cost, suggested price, or
 *    anything a Sales role is not allowed to see (Section 6.3).
 *
 *  recordSale(input, soldBy)
 *    The hardest transaction in the system, and the pattern the rest copy.
 *    Everything below happens inside one `db.transaction`, taking `Tx`:
 *      1. re-read final_price per part — never trust a price sent by the client
 *      2. insert sales_invoice, stamping due_date from
 *         settings.default_payment_terms_days (invoice_date for a walk-in)
 *      3. insert sales_invoice_lines, copying unit_price onto each line so a
 *         later price change cannot rewrite what was sold
 *      4. insert one stock_movement per line, type 'sale', negative delta
 *      5. decrement inventory_balances for the single seeded location
 *      6. insert the payment: cash and momo 'cleared', cheque 'pending'
 *    A sale that would take stock negative is rejected before any of it.
 *
 *  getSale(id)
 *    Receipt-style read for the confirmation screen.
 */
export {};
