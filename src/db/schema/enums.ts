import { appSchema } from './schema.js';
export const userRole = appSchema.enum('user_role', ['sales', 'purchasing', 'accountant', 'admin']);

export const poStatus = appSchema.enum('po_status', [
  'draft',
  'sent',
  'partially_received',
  'received',
  'cancelled',
]);

/** Every change to an inventory balance is one of these — balances are never edited directly. */
export const movementType = appSchema.enum('movement_type', ['po_receipt', 'sale', 'adjustment']);

export const adjustmentReason = appSchema.enum('adjustment_reason', [
  'damage',
  'loss',
  'count_correction',
]);

/** What wrote a `price_history` row. A receipt recomputes the suggestion on its
 *  own; `manual` is a person saving a final price on Price Edit. */
export const priceChangeSource = appSchema.enum('price_change_source', ['po_receipt', 'manual']);

export const paymentMethod = appSchema.enum('payment_method', ['cash', 'cheque', 'momo']);

/** Cash and MoMo land as 'cleared'. Cheques start 'pending' and are resolved by hand. */
export const paymentStatus = appSchema.enum('payment_status', ['pending', 'cleared', 'bounced']);

export const momoNetwork = appSchema.enum('momo_network', ['mtn', 'telecel', 'airteltigo']);
