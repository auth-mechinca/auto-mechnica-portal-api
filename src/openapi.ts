import { z } from 'zod';
import * as authService from './modules/auth/service.js';
import * as backofficeService from './modules/backoffice/service.js';
import * as financialService from './modules/financial/service.js';
import * as imsService from './modules/ims/service.js';
import * as categoriesService from './modules/categories/service.js';
import * as brandsService from './modules/brands/service.js';
import * as posService from './modules/pos/service.js';
import * as settingsService from './modules/settings/service.js';

/** The OpenAPI document, generated from the very zod schemas the API validates
 *  and returns. Nothing here is hand-copied from a handler, so the published
 *  contract cannot drift from the code — a changed schema changes the document
 *  on the next boot.
 *
 *  Only implemented endpoints are described. The IMS, Financial and Backoffice
 *  routers exist and enforce their roles, but have no handlers yet; documenting
 *  them now would promise something that returns 404.
 */

/** `io` matters: on input, a field with a default is optional to the caller; on
 *  output it is always present. Using one schema for both would misdescribe one
 *  of them. */
const jsonSchema = (schema: z.ZodType, io: 'input' | 'output') => {
  // `$schema` is meaningful on a standalone document but only noise inside
  // components, where the dialect is already the document's.
  const { $schema: _dialect, ...rest } = z.toJSONSchema(schema, { target: 'draft-2020-12', io });
  return rest as Record<string, unknown>;
};

const errorSchema = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        details: { type: 'array', items: { type: 'object' } },
      },
      required: ['message'],
    },
  },
  required: ['error'],
} as const;

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

const json = (schema: unknown) => ({ 'application/json': { schema } });

const errorResponse = (description: string) => ({
  description,
  content: json(ref('Error')),
});

const AUTH_ERRORS = {
  400: errorResponse('The request failed validation, or a business rule refused it'),
  401: errorResponse('No token, or a token that is invalid, expired or malformed'),
  403: errorResponse('Authenticated, but this role may not reach this area'),
};

export function buildOpenApiDocument(): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Auto Mechanica — Portal API',
      version: '0.1.0',
      description: [
        'Backend for the Auto Mechanica demo: a custom ERP replacing Tally for a',
        'Ghanaian auto-parts retailer.',
        '',
        '**Money.** Every amount is Ghanaian Cedis and is returned as a *string*,',
        'never a number — `"310.00"`, not `310`. Amounts are exact `numeric` values',
        'in Postgres and parsing one into a float loses that. USD appears only on a',
        "purchase order line, as the supplier's own cost.",
        '',
        '**Roles.** Every route below re-checks the role server-side on each request.',
        'The role claim in the token is not trusted as authorisation on its own, and',
        'a Sales session is refused `/api/backoffice/*` by the API rather than by a',
        'hidden menu item.',
        '',
        '**Not yet implemented.** The IMS, Financial Core and Backoffice routers are',
        'mounted and enforce their roles, but carry no handlers. They are omitted',
        'here rather than documented as promises. All five modules are now',
        'implemented.',
      ].join('\n'),
    },
    servers: [{ url: 'http://localhost:4000', description: 'Local development' }],
    tags: [
      { name: 'Auth', description: 'Sign in and identify the current user. Open to all roles.' },
      { name: 'Point of Sale', description: 'Section 3. Requires the **sales** or **admin** role.' },
      {
        name: 'Receivables',
        description:
          'Section 5. Requires the **accountant** or **admin** role. A balance is always derived from invoices minus cleared payments — no endpoint here can set one.',
      },
      {
        name: 'Prices',
        description:
          'Section 6.3. Requires the **purchasing** or **admin** role. The final price set here is the only price figure Sales ever sees.',
      },
      {
        name: 'Inventory',
        description:
          'Section 4. Requires the **purchasing** or **admin** role. Stock is never typed: it moves only through a purchase order receipt, a sale, or an adjustment recorded with a reason.',
      },
      {
        name: 'Categories',
        description:
          'Their own module. Requires the **purchasing** or **admin** role.',
      },
      {
        name: 'Brands',
        description:
          'Their own module. Requires the **purchasing** or **admin** role.',
      },
      {
        name: 'Suppliers',
        description:
          'Section 6.1. Requires the **purchasing** or **admin** role. Suppliers are never deleted — one you stop using becomes inactive, so its purchase-order history stays intact.',
      },
      {
        name: 'Purchase Orders',
        description:
          'Section 6.2. Requires the **purchasing** or **admin** role. This is where a USD purchase cost becomes a Cedi price at the till.',
      },
      {
        name: 'Settings',
        description:
          'Shop-wide settings, **admin** only. The margin here prices the whole catalogue, which is why purchasing cannot reach it.',
      },
      { name: 'Service', description: 'Operational endpoints.' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description:
            'Obtain a token from `POST /api/auth/login`. It carries the role claim and expires in 8 hours. `POST /api/auth/logout` revokes it before then; every request checks that list.',
        },
      },
      schemas: {
        Error: errorSchema,
        LoginRequest: jsonSchema(authService.loginInput, 'input'),
        LoginResponse: jsonSchema(authService.loginResponse, 'output'),
        User: jsonSchema(authService.publicUser, 'output'),
        LogoutResponse: jsonSchema(authService.logoutResponse, 'output'),
        PartSearchResult: jsonSchema(posService.searchResult, 'output'),
        RecordSaleRequest: jsonSchema(posService.recordSaleInput, 'input'),
        Receipt: jsonSchema(posService.receipt, 'output'),
        PurchaseOrderSummary: jsonSchema(backofficeService.purchaseOrderSummary, 'output'),
        PurchaseOrderDetail: jsonSchema(backofficeService.purchaseOrderDetail, 'output'),
        ReceiveStockRequest: jsonSchema(backofficeService.receiveStockInput, 'input'),
        ReceiveStockResult: jsonSchema(backofficeService.receiveStockResult, 'output'),
        PriceRow: jsonSchema(backofficeService.priceRow, 'output'),
        PriceDetail: jsonSchema(backofficeService.priceDetail, 'output'),
        SetFinalPriceRequest: jsonSchema(backofficeService.setFinalPriceInput, 'input'),
        Settings: jsonSchema(settingsService.settingsResponse, 'output'),
        CustomerAccounts: jsonSchema(financialService.customerAccountsResponse, 'output'),
        CustomerAccount: jsonSchema(financialService.customerAccountDetail, 'output'),
        RecordPaymentRequest: jsonSchema(financialService.recordPaymentInput, 'input'),
        ChequeQueue: jsonSchema(financialService.chequeQueueResponse, 'output'),
        Cheque: jsonSchema(financialService.chequeRow, 'output'),
        Supplier: jsonSchema(backofficeService.supplierRow, 'output'),
        SupplierDetail: jsonSchema(backofficeService.supplierDetail, 'output'),
        CreateSupplierRequest: jsonSchema(backofficeService.createSupplierInput, 'input'),
        UpdateSupplierRequest: jsonSchema(backofficeService.updateSupplierInput, 'input'),
        CreatePurchaseOrderRequest: jsonSchema(backofficeService.createPurchaseOrderInput, 'input'),
        ClosePurchaseOrderRequest: jsonSchema(backofficeService.closePurchaseOrderInput, 'input'),
        CancelPurchaseOrderRequest: jsonSchema(backofficeService.cancelPurchaseOrderInput, 'input'),
        Parts: jsonSchema(imsService.partsResponse, 'output'),
        PartDetail: jsonSchema(imsService.partDetail, 'output'),
        CreatePartRequest: jsonSchema(imsService.createPartInput, 'input'),
        UpdatePartRequest: jsonSchema(imsService.updatePartInput, 'input'),
        AdjustStockRequest: jsonSchema(imsService.adjustStockInput, 'input'),
        LowStockRow: jsonSchema(imsService.lowStockRow, 'output'),
        Adjustment: jsonSchema(imsService.adjustmentRow, 'output'),
        Category: jsonSchema(categoriesService.categoryRow, 'output'),
        CreateCategoryRequest: jsonSchema(categoriesService.createCategoryInput, 'input'),
        UpdateCategoryRequest: jsonSchema(categoriesService.updateCategoryInput, 'input'),
        Brand: jsonSchema(brandsService.brandRow, 'output'),
        CreateBrandRequest: jsonSchema(brandsService.createBrandInput, 'input'),
        UpdateBrandRequest: jsonSchema(brandsService.updateBrandInput, 'input'),
        UpdatePurchaseOrderRequest: jsonSchema(backofficeService.updatePurchaseOrderInput, 'input'),
        UpdateSettingsRequest: jsonSchema(settingsService.updateSettingsInput, 'input'),
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      '/health': {
        get: {
          tags: ['Service'],
          summary: 'Liveness check',
          security: [],
          responses: { 200: { description: 'The process is up', content: json({ type: 'object' }) } },
        },
      },

      '/api/auth/login': {
        post: {
          tags: ['Auth'],
          summary: 'Exchange credentials for a token',
          description:
            'The email is matched case-insensitively. An unknown email, a wrong password and a deactivated account all return the same 401 and take the same time, so the response cannot be used to discover which accounts exist.',
          security: [],
          requestBody: { required: true, content: json(ref('LoginRequest')) },
          responses: {
            200: { description: 'Signed in', content: json(ref('LoginResponse')) },
            400: AUTH_ERRORS[400],
            401: errorResponse('Invalid email or password'),
          },
        },
      },

      '/api/auth/logout': {
        post: {
          tags: ['Auth'],
          summary: 'Sign out this token',
          description: [
            'Revokes the token used to make this call. A JWT is valid until it expires',
            'and presenting one asks the server nothing, so without this a sign-out is',
            'only the client agreeing to forget the token — and anyone who copied it',
            'keeps the session. On a shared till that is a real hole.',
            '',
            'Only this token is revoked. Signing out at the counter does not sign the',
            'same person out on another device.',
            '',
            'Calling it twice is not an error, but the second call is refused with 401:',
            'the token it would revoke has already been revoked.',
          ].join('\n'),
          responses: {
            200: { description: 'Signed out', content: json(ref('LogoutResponse')) },
            401: errorResponse('No token, or a token that is already signed out'),
          },
        },
      },

      '/api/auth/me': {
        get: {
          tags: ['Auth'],
          summary: 'The signed-in user',
          description:
            'Re-read from the database rather than decoded from the token, so an account deactivated since sign-in stops working immediately. The frontend uses this to choose which navigation to draw — advisory only, since every route re-checks the role anyway.',
          responses: {
            200: { description: 'The current user', content: json(ref('User')) },
            401: AUTH_ERRORS[401],
          },
        },
      },

      '/api/ims/parts': {
        get: {
          tags: ['Inventory'],
          summary: 'The parts catalogue',
          description:
            'Returns the parts and a count of how many sit at or below their reorder point. The category and brand dropdowns come from their own endpoints — the list here used to be a `distinct` over free text, which reported near-duplicates rather than preventing them.',
          parameters: [
            { name: 'q', in: 'query', required: false, schema: { type: 'string' }, description: 'Match name, SKU, part number or OEM number' },
            { name: 'categoryId', in: 'query', required: false, schema: { type: 'string', format: 'uuid' } },
            { name: 'brandId', in: 'query', required: false, schema: { type: 'string', format: 'uuid' } },
            { name: 'belowReorder', in: 'query', required: false, schema: { type: 'boolean' } },
            {
              name: 'status',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['active', 'inactive', 'all'], default: 'active' },
            },
          ],
          responses: {
            200: { description: 'Parts with filter facets', content: json(ref('Parts')) },
            ...AUTH_ERRORS,
          },
        },
        post: {
          tags: ['Inventory'],
          summary: 'Create a part',
          description:
            'A new part starts at zero stock. There is no quantity field: stock arrives through a purchase order receipt, never at creation. `fitment` is free-text Year/Make/Model/Engine lines — not a cross-reference database, per Section 4.',
          requestBody: { required: true, content: json(ref('CreatePartRequest')) },
          responses: {
            201: { description: 'Created', content: json(ref('PartDetail')) },
            409: errorResponse('That SKU is already in use'),
            ...AUTH_ERRORS,
          },
        },
      },

      '/api/ims/parts/{id}': {
        get: {
          tags: ['Inventory'],
          summary: 'One part, with its stock ledger',
          description:
            '`movements` carries a running `onHandAfter` computed from the ledger rather than stored, so the newest row can be checked against the balance at the top. They disagree only if something wrote a balance without a movement. Landed cost is included here and never in the POS search.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            200: { description: 'The part', content: json(ref('PartDetail')) },
            404: errorResponse('Part not found'),
            ...AUTH_ERRORS,
          },
        },
        patch: {
          tags: ['Inventory'],
          summary: 'Edit a part',
          description:
            'Details only. There is deliberately no stock field — a balance cannot be edited here or anywhere. Setting `isActive: false` keeps the part and its history but takes it out of the working list.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: { required: true, content: json(ref('UpdatePartRequest')) },
          responses: {
            200: { description: 'Updated', content: json(ref('PartDetail')) },
            404: errorResponse('Part not found'),
            409: errorResponse('That SKU is already in use'),
            ...AUTH_ERRORS,
          },
        },
      },

      '/api/ims/parts/{id}/adjust': {
        post: {
          tags: ['Inventory'],
          summary: 'Correct stock, with a reason',
          description: [
            'For damage, loss and count corrections. Deliveries come in through a',
            'purchase order — this is not a way to receive stock.',
            '',
            'The reason is required. An adjustment without one is indistinguishable from',
            'somebody editing stock to whatever they wanted, which is exactly what the',
            'ledger exists to prevent.',
            '',
            'Writes one movement and moves the balance in the same transaction, so the',
            'two can never disagree. A decrease that would take stock below zero is',
            'refused.',
          ].join('\n'),
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: { required: true, content: json(ref('AdjustStockRequest')) },
          responses: {
            200: { description: 'Adjusted', content: json(ref('PartDetail')) },
            404: errorResponse('Part not found'),
            409: errorResponse('The part is inactive, or the decrease would go below zero'),
            ...AUTH_ERRORS,
          },
        },
      },

      '/api/ims/adjustments': {
        get: {
          tags: ['Inventory'],
          summary: 'Recent adjustments across all parts',
          responses: {
            200: { description: 'Newest first', content: json({ type: 'array', items: ref('Adjustment') }) },
            ...AUTH_ERRORS,
          },
        },
      },

      '/api/ims/low-stock': {
        get: {
          tags: ['Inventory'],
          summary: 'Parts at or below their reorder point',
          description:
            'Each row carries how short it is, who supplied it most recently, and anything still expected on an open purchase order — because the shortfall may already be covered, and reordering would double up.',
          responses: {
            200: { description: 'Shortest first', content: json({ type: 'array', items: ref('LowStockRow') }) },
            ...AUTH_ERRORS,
          },
        },
      },

      '/api/categories': {
        get: {
          tags: ['Categories'],
          summary: 'List categories',
          description:
            'Intended for a type-ahead dropdown on the part form. `partCount` says how many parts use each, so a screen can show what deactivating one would affect.',
          parameters: [
            { name: 'q', in: 'query', required: false, schema: { type: 'string' }, description: 'Match the name' },
            {
              name: 'status',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['active', 'inactive', 'all'], default: 'active' },
            },
          ],
          responses: {
            200: { description: 'By name', content: json({ type: 'array', items: ref('Category') }) },
            ...AUTH_ERRORS,
          },
        },
        post: {
          tags: ['Categories'],
          summary: 'Create a categorie',
          description:
            'Called from the part form when an officer types a category that does not exist yet. Names are trimmed and compared case-insensitively, so "Bosch", "bosch" and " Bosch " are one — a duplicate is refused with 409 naming the existing row.',
          requestBody: { required: true, content: json(ref('CreateCategoryRequest')) },
          responses: {
            201: { description: 'Created', content: json(ref('Category')) },
            409: errorResponse('One with that name already exists'),
            ...AUTH_ERRORS,
          },
        },
      },

      '/api/categories/{id}': {
        patch: {
          tags: ['Categories'],
          summary: 'Rename, or deactivate',
          description:
            'Renaming reaches every part using it, because a part holds a reference rather than a copy of the text. Nothing is deleted — a part points at this row, so removing it would leave that part unclassified; `isActive: false` takes it out of the dropdown instead.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: { required: true, content: json(ref('UpdateCategoryRequest')) },
          responses: {
            200: { description: 'Updated', content: json(ref('Category')) },
            404: errorResponse('Not found'),
            409: errorResponse('Another one already has that name'),
            ...AUTH_ERRORS,
          },
        },
      },

      '/api/brands': {
        get: {
          tags: ['Brands'],
          summary: 'List brands',
          description:
            'Intended for a type-ahead dropdown on the part form. `partCount` says how many parts use each, so a screen can show what deactivating one would affect.',
          parameters: [
            { name: 'q', in: 'query', required: false, schema: { type: 'string' }, description: 'Match the name' },
            {
              name: 'status',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['active', 'inactive', 'all'], default: 'active' },
            },
          ],
          responses: {
            200: { description: 'By name', content: json({ type: 'array', items: ref('Brand') }) },
            ...AUTH_ERRORS,
          },
        },
        post: {
          tags: ['Brands'],
          summary: 'Create a brand',
          description:
            'Called from the part form when an officer types a brand that does not exist yet. Names are trimmed and compared case-insensitively, so "Bosch", "bosch" and " Bosch " are one — a duplicate is refused with 409 naming the existing row.',
          requestBody: { required: true, content: json(ref('CreateBrandRequest')) },
          responses: {
            201: { description: 'Created', content: json(ref('Brand')) },
            409: errorResponse('One with that name already exists'),
            ...AUTH_ERRORS,
          },
        },
      },

      '/api/brands/{id}': {
        patch: {
          tags: ['Brands'],
          summary: 'Rename, or deactivate',
          description:
            'Renaming reaches every part using it, because a part holds a reference rather than a copy of the text. Nothing is deleted — a part points at this row, so removing it would leave that part unclassified; `isActive: false` takes it out of the dropdown instead.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: { required: true, content: json(ref('UpdateBrandRequest')) },
          responses: {
            200: { description: 'Updated', content: json(ref('Brand')) },
            404: errorResponse('Not found'),
            409: errorResponse('Another one already has that name'),
            ...AUTH_ERRORS,
          },
        },
      },

      '/api/financial/customers': {
        get: {
          tags: ['Receivables'],
          summary: 'Customer accounts, most overdue first',
          description: [
            'Balances are derived: invoices minus allocations from payments that have',
            'cleared. No table stores one, so no endpoint can set one.',
            '',
            '`daysLate` is measured from the **due date** of the oldest unpaid invoice —',
            'the one you would chase on — not from the invoice date. Ageing buckets are',
            'per invoice rather than per customer, so a single very late invoice is not',
            'hidden behind a current one on the same account.',
            '',
            'A pending cheque is deliberately counted as still owed: it has not cleared,',
            'so it has paid nothing.',
          ].join('\n'),
          parameters: [
            { name: 'q', in: 'query', required: false, schema: { type: 'string' }, description: 'Match customer name or phone' },
          ],
          responses: {
            200: { description: 'Accounts with totals, ageing and summary', content: json(ref('CustomerAccounts')) },
            ...AUTH_ERRORS,
          },
        },
      },

      '/api/financial/customers/{id}': {
        get: {
          tags: ['Receivables'],
          summary: 'One account, with every invoice and payment',
          description:
            'The Outstanding column across the invoices adds up to the balance — the whole calculation on one response. On a payment, `outstandingAfter` is what the invoice still owed once that payment landed, so a bounced payment reads as the full amount again.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            200: { description: 'The account', content: json(ref('CustomerAccount')) },
            404: errorResponse('Customer not found'),
            ...AUTH_ERRORS,
          },
        },
      },

      '/api/financial/payments': {
        post: {
          tags: ['Receivables'],
          summary: 'Record a payment received after the sale',
          description: [
            'For money arriving after the counter — a transfer, a cheque dropped off,',
            'MoMo against an account. Payments taken at the till go through POS.',
            '',
            'Cash and MoMo are recorded `cleared` and move the balance immediately. A',
            'cheque is recorded `pending` and moves nothing until somebody clears it in',
            'the queue.',
            '',
            'Allocations are optional: leave them out and the money sits against the',
            'account until it is applied. Allocating oldest-first is the convention, not',
            'a rule — the accountant decides. An allocation may not exceed what the',
            'invoice still owes, nor the payment itself.',
          ].join('\n'),
          requestBody: { required: true, content: json(ref('RecordPaymentRequest')) },
          responses: {
            201: { description: 'Recorded; returns the updated account', content: json(ref('CustomerAccount')) },
            ...AUTH_ERRORS,
          },
        },
      },

      '/api/financial/cheques': {
        get: {
          tags: ['Receivables'],
          summary: 'The cheque queue',
          parameters: [
            {
              name: 'status',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['pending', 'cleared', 'bounced'] },
            },
          ],
          responses: {
            200: { description: 'Cheques with counts and the pending value', content: json(ref('ChequeQueue')) },
            ...AUTH_ERRORS,
          },
        },
      },

      '/api/financial/cheques/{id}/clear': {
        post: {
          tags: ['Receivables'],
          summary: 'Mark a cheque cleared',
          description:
            'The payment flips from pending to cleared, its allocations take effect, and the balance drops. This is the only moment a cheque touches a balance. `id` is the payment id from the queue.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            200: { description: 'Cleared', content: json(ref('Cheque')) },
            404: errorResponse('No cheque against that payment'),
            409: errorResponse('That cheque is already cleared or bounced'),
            ...AUTH_ERRORS,
          },
        },
      },

      '/api/financial/cheques/{id}/bounce': {
        post: {
          tags: ['Receivables'],
          summary: 'Mark a cheque bounced',
          description:
            'The payment flips to bounced and the invoice goes back to outstanding in full. The row is never deleted — it stays in the customer history, flagged, because a bounce is something that happened.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            200: { description: 'Bounced', content: json(ref('Cheque')) },
            404: errorResponse('No cheque against that payment'),
            409: errorResponse('That cheque is already cleared or bounced'),
            ...AUTH_ERRORS,
          },
        },
      },

      '/api/backoffice/prices': {
        get: {
          tags: ['Prices'],
          summary: 'Cost, suggestion and final price for every priced part',
          description: [
            'A part appears once it has been received against a cost; before that there',
            'is nothing to price. `status` is derived, not stored:',
            '',
            '- `confirmed` — the final price equals the suggestion',
            '- `overridden` — somebody set a different price deliberately',
            '- `needs_review` — a price was set by hand and the cost has since moved,',
            '  so the standing price is measured against a cost that no longer applies',
            '',
            '`needs_review` outranks `overridden`, because it is the row somebody has to',
            'look at.',
          ].join('\n'),
          parameters: [
            { name: 'q', in: 'query', required: false, schema: { type: 'string' }, description: 'Match name, SKU or brand' },
            {
              name: 'status',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['needs_review', 'overridden', 'confirmed'] },
            },
          ],
          responses: {
            200: { description: 'Priced parts, by name', content: json({ type: 'array', items: ref('PriceRow') }) },
            ...AUTH_ERRORS,
          },
        },
      },

      '/api/backoffice/prices/{partId}': {
        get: {
          tags: ['Prices'],
          summary: 'One price, with its cost basis and history',
          description:
            '`costBasis` names the purchase order the current cost came from, with the USD figure and the FX rate behind it. Nothing on this screen is typed by hand — to change the cost, change the purchase order.',
          parameters: [{ name: 'partId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            200: { description: 'The price', content: json(ref('PriceDetail')) },
            404: errorResponse('That part has no price yet'),
            ...AUTH_ERRORS,
          },
        },
        patch: {
          tags: ['Prices'],
          summary: 'Set the final sell price',
          description:
            'Saves the price and appends a history row recording who set it and which landed cost it was set against — which is what later makes `needs_review` derivable. This is the figure that appears in POS the moment it is saved.',
          parameters: [{ name: 'partId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: { required: true, content: json(ref('SetFinalPriceRequest')) },
          responses: {
            200: { description: 'Saved', content: json(ref('PriceDetail')) },
            404: errorResponse('That part has no price yet'),
            409: errorResponse('That part has no cost recorded yet'),
            ...AUTH_ERRORS,
          },
        },
      },

      '/api/settings': {
        get: {
          tags: ['Settings'],
          summary: 'Shop-wide settings',
          description: [
            'Everything the Settings screen draws: two fields that can be changed and two',
            'that report what the system has decided.',
            '',
            '`sellingCurrency` is always `GHS` and `location` is the single shop. Both are',
            'returned rather than hardcoded in the UI, so the day a second location or a',
            'second currency arrives the screen changes without a frontend release.',
          ].join('\n'),
          responses: {
            200: { description: 'Current settings', content: json(ref('Settings')) },
            ...AUTH_ERRORS,
          },
        },
        patch: {
          tags: ['Settings'],
          summary: 'Change the margin or the payment terms',
          description: [
            'Send the fields that changed; at least one is required. The read-only fields',
            'in the response are not accepted and a body carrying one is not an error —',
            'it simply does not set anything.',
            '',
            '**`defaultMarginPct`** is a margin **on the selling price**, not a markup on',
            'cost: 35 means 35% of what the customer pays. The suggestion is therefore',
            '`landed cost / (1 - margin/100)`, so a part costing 291.40 suggests 448.31,',
            'not 393.39.',
            '',
            '**`defaultPaymentTermsDays`** is how many days after the invoice date a named',
            "account's invoice falls due. A walk-in is settled at the counter and is always",
            'due the day it is raised, whatever this says.',
            '',
            'Neither change reaches backwards. A new margin changes what is suggested from',
            'here on; prices already saved were decisions taken at the margin of the day.',
            'New terms apply to invoices raised from here on: `due_date` is stamped on the',
            'invoice rather than derived on read, so an invoice keeps the terms in force',
            'the day it was issued — otherwise moving 30 days to 45 would re-age the whole',
            'ledger overnight and a customer ten days late would quietly become five days',
            'early.',
          ].join('\n'),
          requestBody: { required: true, content: json(ref('UpdateSettingsRequest')) },
          responses: {
            200: { description: 'Updated', content: json(ref('Settings')) },
            // Spread first: the specific 400 below is the useful one, and
            // ordering it after keeps it from being overwritten.
            ...AUTH_ERRORS,
            400: errorResponse(
              'A margin must be under 100%, terms must be 0–365 whole days, and a body must change at least one setting',
            ),
          },
        },
      },

      '/api/pos/parts': {
        get: {
          tags: ['Point of Sale'],
          summary: 'Search parts for a sale',
          description:
            'Matches name, SKU, part number, OEM number and vehicle fitment. Returns the sell price and stock on hand and nothing else — landed cost and the suggested price are never selected, so a Sales session cannot see what a part cost. A null `sellPrice` means Price Management has not set one and the part cannot be sold.',
          parameters: [
            {
              name: 'q',
              in: 'query',
              required: true,
              schema: { type: 'string', minLength: 1, maxLength: 100 },
              description: 'Search term. Wildcards are treated as literal characters.',
              example: 'toyota',
            },
          ],
          responses: {
            200: {
              description: 'Up to 50 matches, by name',
              content: json({ type: 'array', items: ref('PartSearchResult') }),
            },
            ...AUTH_ERRORS,
          },
        },
      },

      '/api/pos/sales': {
        post: {
          tags: ['Point of Sale'],
          summary: 'Record a sale',
          description: [
            'Writes the invoice and its lines, a stock movement per part, the balance',
            'decrements, the payment and its allocation — in a single transaction. If any',
            'line is short of stock, none of it is written.',
            '',
            'Prices are read from the database inside that transaction. There is no price',
            'field in this request: a client cannot propose one.',
            '',
            '`customerId: null` is a walk-in, settled at the till and due the same day. A',
            'named customer gets the shop payment terms and appears in the ageing report.',
            'A cheque requires a named customer — a bounced cheque attached to nobody',
            'leaves a debt with no one to chase — and is recorded `pending`, moving no',
            'balance until the Accountant clears it. Cash and MoMo clear immediately.',
            '',
            '`cashTendered` is validated against the amount due and then discarded; change',
            'is a till courtesy, not a ledger entry.',
          ].join('\n'),
          requestBody: { required: true, content: json(ref('RecordSaleRequest')) },
          responses: {
            201: { description: 'Sale recorded', content: json(ref('Receipt')) },
            409: errorResponse('Not enough stock on hand'),
            ...AUTH_ERRORS,
          },
        },
      },

      '/api/backoffice/suppliers': {
        get: {
          tags: ['Suppliers'],
          summary: 'List suppliers',
          parameters: [
            { name: 'q', in: 'query', required: false, schema: { type: 'string' }, description: 'Match name or contact person' },
            {
              name: 'status',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['active', 'inactive', 'all'], default: 'active' },
            },
          ],
          responses: {
            200: { description: 'Suppliers by name', content: json({ type: 'array', items: ref('Supplier') }) },
            ...AUTH_ERRORS,
          },
        },
        post: {
          tags: ['Suppliers'],
          summary: 'Create a supplier',
          description:
            '`currency` records how the supplier invoices — USD by default, since the client buys from third-party suppliers in dollars. It converts nothing on its own; conversion happens once, on the purchase order, at the rate typed there.',
          requestBody: { required: true, content: json(ref('CreateSupplierRequest')) },
          responses: {
            201: { description: 'Created', content: json(ref('SupplierDetail')) },
            ...AUTH_ERRORS,
          },
        },
      },

      '/api/backoffice/suppliers/{id}': {
        get: {
          tags: ['Suppliers'],
          summary: 'One supplier, with their purchase-order history',
          description:
            '`purchasedToDateUsd` is given in dollars because every order carries its own FX rate — summing the Cedi totals would add up figures agreed on different days.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            200: { description: 'The supplier', content: json(ref('SupplierDetail')) },
            404: errorResponse('Supplier not found'),
            ...AUTH_ERRORS,
          },
        },
        patch: {
          tags: ['Suppliers'],
          summary: 'Edit a supplier, or deactivate one',
          description:
            'Nothing is deleted. Setting `isActive: false` keeps the purchase-order history intact and stops the supplier appearing on a new order.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: { required: true, content: json(ref('UpdateSupplierRequest')) },
          responses: {
            200: { description: 'Updated', content: json(ref('SupplierDetail')) },
            404: errorResponse('Supplier not found'),
            ...AUTH_ERRORS,
          },
        },
      },

      '/api/backoffice/purchase-orders': {
        post: {
          tags: ['Purchase Orders'],
          summary: 'Create a purchase order',
          description: [
            'The reference is generated on save. `status` defaults to `draft`.',
            '',
            'A draft may be saved without an FX rate: nothing has been agreed with anyone',
            'yet, so it has no Cedi value and `fxRate` and `totalGhs` come back null. The',
            'rate becomes required at the moment the order is sent, along with at least',
            'one line.',
            '',
            'Costs are stored in USD exactly as entered. The Cedi figure is derived, never',
            'typed.',
          ].join('\n'),
          requestBody: { required: true, content: json(ref('CreatePurchaseOrderRequest')) },
          responses: {
            201: { description: 'Created', content: json(ref('PurchaseOrderDetail')) },
            ...AUTH_ERRORS,
          },
        },
        get: {
          tags: ['Purchase Orders'],
          summary: 'List purchase orders',
          description:
            'Totals are given in both currencies: `totalUsd` is what the supplier invoices, `totalGhs` is that at the rate recorded on the order.',
          parameters: [
            {
              name: 'status',
              in: 'query',
              required: false,
              schema: {
                type: 'string',
                enum: ['draft', 'sent', 'partially_received', 'received', 'cancelled', 'closed'],
              },
            },
            { name: 'supplierId', in: 'query', required: false, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            200: {
              description: 'Matching orders, newest first',
              content: json({ type: 'array', items: ref('PurchaseOrderSummary') }),
            },
            ...AUTH_ERRORS,
          },
        },
      },

      '/api/backoffice/purchase-orders/{id}': {
        patch: {
          tags: ['Purchase Orders'],
          summary: 'Edit a draft',
          description:
            'Drafts only. Once an order has gone out, its lines and its rate are what the supplier is working to, and changing them would rewrite the cost basis of stock already received against it. Supplying `lines` replaces them wholesale.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: { required: true, content: json(ref('UpdatePurchaseOrderRequest')) },
          responses: {
            200: { description: 'Updated', content: json(ref('PurchaseOrderDetail')) },
            404: errorResponse('Purchase order not found'),
            409: errorResponse('Only a draft can be edited'),
            ...AUTH_ERRORS,
          },
        },
        get: {
          tags: ['Purchase Orders'],
          summary: 'One purchase order, with its lines and delivery history',
          description:
            'Each line carries its landed cost — unit cost in USD times the order FX rate — and `receipts` lists each delivery against the order, with what arrived and what it was worth in Cedis.',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            200: { description: 'The order', content: json(ref('PurchaseOrderDetail')) },
            404: errorResponse('No such purchase order'),
            ...AUTH_ERRORS,
          },
        },
      },

      '/api/backoffice/purchase-orders/{id}/send': {
        post: {
          tags: ['Purchase Orders'],
          summary: 'Mark a draft as sent',
          description:
            'Requires an FX rate and at least one line. From here the order is frozen: the rate applies to every receipt against it, including partial deliveries months later.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            200: { description: 'Sent', content: json(ref('PurchaseOrderDetail')) },
            404: errorResponse('Purchase order not found'),
            409: errorResponse('That order is not a draft'),
            ...AUTH_ERRORS,
          },
        },
      },

      '/api/backoffice/purchase-orders/{id}/cancel': {
        post: {
          tags: ['Purchase Orders'],
          summary: 'Cancel a purchase order',
          description:
            'Only before anything arrives. Stock already received cannot be un-received, and the prices it set are standing against it. A `reason` is optional here — an order nobody acted on often ends for no reason worth recording.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: { required: true, content: json(ref('CancelPurchaseOrderRequest')) },
          responses: {
            200: { description: 'Cancelled', content: json(ref('PurchaseOrderDetail')) },
            404: errorResponse('Purchase order not found'),
            409: errorResponse('Stock has already been received, or it is already cancelled'),
            ...AUTH_ERRORS,
          },
        },
      },

      '/api/backoffice/purchase-orders/{id}/close': {
        post: {
          tags: ['Purchase Orders'],
          summary: 'Short-close: write off what is not coming',
          description: [
            'For when part of an order arrived and the rest never will — a line the',
            'supplier has discontinued, say. Without it the order sits',
            '`partially_received` for good: stock that is not coming keeps showing as',
            'expected, and the supplier never stops having an open order.',
            '',
            'What arrived is untouched — the stock, its movements and the prices it set',
            'all stand. Only the expectation of the remainder is written off:',
            '`outstandingGhs` becomes zero and `writtenOffGhs` records what was',
            'abandoned.',
            '',
            'A distinct status on purpose. `cancelled` would claim nothing arrived and',
            '`received` would claim everything did; both would misstate what happened.',
            '',
            'Only for `partially_received`. If nothing arrived, that is a cancellation',
            'however it is worded — so each status means exactly one thing.',
            '',
            'A `reason` is required, because this writes value off and somebody will ask',
            'why months later. It is recorded on the order with who closed it and when,',
            'and comes back as `resolution`.',
          ].join('\n'),
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: { required: true, content: json(ref('ClosePurchaseOrderRequest')) },
          responses: {
            200: { description: 'Closed', content: json(ref('PurchaseOrderDetail')) },
            404: errorResponse('Purchase order not found'),
            409: errorResponse('Nothing arrived (cancel instead), everything arrived, or already resolved'),
            ...AUTH_ERRORS,
          },
        },
      },

      '/api/backoffice/purchase-orders/{id}/receive': {
        post: {
          tags: ['Purchase Orders'],
          summary: 'Receive stock against a purchase order',
          description: [
            'The step the whole purchase chain exists for. In one transaction it raises',
            'the quantity received per line, increases stock and writes a movement for',
            'each, computes the landed cost, re-suggests a sell price, appends to price',
            'history, and moves the order to `partially_received` or `received`.',
            '',
            '`landed cost = unit cost (USD) x the FX rate recorded on the order`. That',
            'rate is fixed for the life of the order: a later delivery lands at the rate',
            'originally paid, not at the rate today.',
            '',
            'Send only the lines that actually arrived, with what arrived now — not a',
            'running total. Receiving less than was ordered leaves the order partially',
            'received; receiving more than is outstanding is refused.',
            '',
            'A part nobody has priced takes the new suggestion. A price somebody set by',
            'hand is **kept** — it was a deliberate decision — but comes back with',
            '`needsReview: true` when the cost it was set against has since moved.',
          ].join('\n'),
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          requestBody: { required: true, content: json(ref('ReceiveStockRequest')) },
          responses: {
            201: { description: 'Stock received', content: json(ref('ReceiveStockResult')) },
            404: errorResponse('No such purchase order'),
            409: errorResponse('The order is a draft, cancelled, or already fully received'),
            ...AUTH_ERRORS,
          },
        },
      },

      '/api/pos/sales/{id}': {
        get: {
          tags: ['Point of Sale'],
          summary: 'Read a receipt back',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
              description: 'The invoice id returned when the sale was recorded.',
            },
          ],
          responses: {
            200: { description: 'The receipt', content: json(ref('Receipt')) },
            404: errorResponse('No such sale'),
            ...AUTH_ERRORS,
          },
        },
      },
    },
  };
}
