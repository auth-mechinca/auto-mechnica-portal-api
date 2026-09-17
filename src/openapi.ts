import { z } from 'zod';
import * as authService from './modules/auth/service.js';
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
        'here rather than documented as promises.',
      ].join('\n'),
    },
    servers: [{ url: 'http://localhost:4000', description: 'Local development' }],
    tags: [
      { name: 'Auth', description: 'Sign in and identify the current user. Open to all roles.' },
      { name: 'Point of Sale', description: 'Section 3. Requires the **sales** or **admin** role.' },
      { name: 'Service', description: 'Operational endpoints.' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description:
            'Obtain a token from `POST /api/auth/login`. It carries the role claim and expires in 8 hours.',
        },
      },
      schemas: {
        Error: errorSchema,
        LoginRequest: jsonSchema(authService.loginInput, 'input'),
        LoginResponse: jsonSchema(authService.loginResponse, 'output'),
        User: jsonSchema(authService.publicUser, 'output'),
        PartSearchResult: jsonSchema(posService.searchResult, 'output'),
        RecordSaleRequest: jsonSchema(posService.recordSaleInput, 'input'),
        Receipt: jsonSchema(posService.receipt, 'output'),
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
