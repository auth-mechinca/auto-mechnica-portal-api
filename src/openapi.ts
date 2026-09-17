import { z } from 'zod';
import * as authService from './modules/auth/service.js';
import * as backofficeService from './modules/backoffice/service.js';
import * as posService from './modules/pos/service.js';

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
        'here rather than documented as promises. Backoffice is partly implemented:',
        'purchase orders and receiving are here, suppliers and price management are not.',
      ].join('\n'),
    },
    servers: [{ url: 'http://localhost:4000', description: 'Local development' }],
    tags: [
      { name: 'Auth', description: 'Sign in and identify the current user. Open to all roles.' },
      { name: 'Point of Sale', description: 'Section 3. Requires the **sales** or **admin** role.' },
      {
        name: 'Prices',
        description:
          'Section 6.3. Requires the **purchasing** or **admin** role. The final price set here is the only price figure Sales ever sees.',
      },
      {
        name: 'Purchase Orders',
        description:
          'Section 6.2. Requires the **purchasing** or **admin** role. This is where a USD purchase cost becomes a Cedi price at the till.',
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
        Settings: jsonSchema(backofficeService.settingsResponse, 'output'),
        UpdateSettingsRequest: jsonSchema(backofficeService.updateSettingsInput, 'input'),
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

      '/api/backoffice/settings': {
        get: {
          tags: ['Prices'],
          summary: 'Shop-wide settings',
          responses: {
            200: { description: 'Current settings', content: json(ref('Settings')) },
            ...AUTH_ERRORS,
          },
        },
        patch: {
          tags: ['Prices'],
          summary: 'Change the global margin',
          description: [
            '`defaultMarginPct` is a margin **on the selling price**, not a markup on',
            'cost: 35 means 35% of what the customer pays. The suggestion is therefore',
            '`landed cost / (1 - margin/100)`, so a part costing 291.40 suggests 448.31,',
            'not 393.39.',
            '',
            'Changing it affects what is suggested from here on. Prices already saved are',
            'left alone — they were decisions taken at the margin of the day, and',
            'rewriting them would silently reprice the catalogue.',
          ].join('\n'),
          requestBody: { required: true, content: json(ref('UpdateSettingsRequest')) },
          responses: {
            200: { description: 'Updated', content: json(ref('Settings')) },
            // Spread first: the specific 400 below is the useful one, and
            // ordering it after keeps it from being overwritten.
            ...AUTH_ERRORS,
            400: errorResponse('A margin must be under 100%'),
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

      '/api/backoffice/purchase-orders': {
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
                enum: ['draft', 'sent', 'partially_received', 'received', 'cancelled'],
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
