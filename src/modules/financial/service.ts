/** Receivables business logic. Section 5 of the demo scope.
 *
 *  Not implemented yet.
 *
 *  Two rules here are not negotiable, and both are structural rather than
 *  conventions: no table has a balance column, so a balance is always derived
 *  (invoices minus cleared allocations) and there is nothing for an endpoint to
 *  set. And a bounce reverses the balance while staying visible in history — the
 *  payment row is never deleted.
 *
 *  listCustomerAccounts()
 *    Derived balance plus ageing buckets. Ageing is measured in days past
 *    sales_invoices.due_date, not days since the invoice — "over 60 days" means
 *    60 days late. A customer row shows the oldest unpaid invoice's due date.
 *
 *  getCustomerAccount(id)
 *    Invoice history, payment history, derived balance. On the payments tab,
 *    "balance due" is what remained owing on that invoice after that payment,
 *    not a running account balance.
 *
 *  recordPayment(input, recordedBy)
 *    One transaction: the payment, its method detail (cheque or momo), and its
 *    allocations. Cash and momo are inserted 'cleared'; a cheque is 'pending'
 *    and contributes nothing to the balance until someone clears it.
 *
 *  clearCheque / bounceCheque
 *    Sets payments.status and stamps cheques.resolved_at / resolved_by.
 */
export {};
