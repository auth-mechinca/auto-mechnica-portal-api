# Auto Mechanica — Build Progress

**As at 17 September 2026.** Covers the wireframing pass, the schema, and the API built on top of it. Companion to [`demo-scope.md`](demo-scope.md), which remains the scope of record: this file says what exists, that one says what was agreed.

---

## Where things stand

| | Status |
|---|---|
| Wireframes | **Done** — 26 screens, low-fidelity, all four roles |
| Database schema | **Done** — 19 tables, 5 migrations, all on `main` or in review |
| Auth, RBAC, sign-out | **Done** — login, JWT with revocable sessions, server-side role checks |
| POS | **Done** — part search, recording a sale, reading the receipt back |
| Backoffice — purchase orders | **Done** — list, detail, receive stock with the full cost-to-price chain |
| Backoffice — price management | **Done** — list with derived status, cost basis and history, set a price |
| Backoffice — suppliers, PO create | **Done** — supplier CRUD with deactivation, drafting a PO, sending, cancelling |
| IMS | **Done** — catalogue, part detail with its stock ledger, adjustments, low stock |
| Financial Core | **Done** — customer accounts with ageing, account detail, recording payments, the cheque queue |
| Settings | **Done** — its own admin-only module: the margin, plus the currency and location the screen reports |
| Next.js frontend | **Not started** — repo is an empty initial commit |
| API documentation | **Done** — OpenAPI 3.1 at `/openapi.json`, Swagger UI at `/docs` |

**222 tests pass.** The spine of the demo now works end to end on the server: receive a purchase order at a new FX rate, watch the landed cost and suggested price move, then sell the part at the till and watch stock and the customer balance follow. What is missing is a face — nothing is wired to a screen yet.

---

## 1. Wireframes

**26 screens on one pan/zoom canvas**, grouped into four bands — Sales (5), Purchasing Officer (13), Accountant (5), Owner/Admin (3). Every screen has a plain-English note directly underneath saying what it is, what you do on it, and the one thing worth knowing. Each band opens with a note covering how its screens connect.

Fidelity is deliberately low: greyscale, real field names, real data, no branding or colour system yet. The intent was to settle structure and flow before anyone argues about colour.

**Section 9's checklist has 22 items. All 22 are drawn.** Four screens were added on top:

| Added | Why |
|---|---|
| **Shell & nav by role** | Not a screen you visit — the four role menus side by side, plus the blocked-route state. Makes the RBAC demo concrete rather than asserted. |
| **Add / edit user** | Section 9 lists "User/Role Management" but no form. The list alone can't create anybody. |
| **Settings** | The scope calls the global margin configurable but names no screen to change it on. Three fields, two of them read-only. Built — see Section 3. |
| **Customer detail — invoices tab** | Not a new screen; the second tab state of "Customer Account Detail". Drawn separately because a wireframe can only show one tab at a time. |

One in-screen addition beyond scope: **Low Stock → "Start purchase order"**, which opens PO Create with the ticked parts already on it. The scope says "simple list"; without this the screen dead-ends. Flagged on the screen itself and easy to remove.

The numbers run continuously across all 26 screens — a purchase order at one FX rate produces a landed cost, which produces a suggested price, which is overridden, which appears at the till, which becomes an invoice on a customer's account, which a cheque bounces against. You can walk the canvas in order and the figures tie out at every step.

---

## 2. Schema

Nineteen tables across five migrations, all in a named `app` schema, never `public`. `0000`–`0002` are merged to `main`; `0003` and `0004` came with the API work and are on `feat/pos-endpoints`.

Two tables were added during the wireframing pass, both because drawing a screen exposed that the data behind it didn't exist. Three more changes came from building against those screens:

### `price_history` — a price's cost basis has to survive the next purchase

`prices` holds **one row per part** and is overwritten in place. A second delivery of the same part at a new FX rate replaces `landed_cost` and `suggested_price`, while `final_price` — the number somebody typed — sits there untouched, now measured against a cost that has moved.

Nothing about the *purchase* was ever lost: purchase orders, their lines and stock movements all keep their own records, and the cost of any specific receipt is reconstructible. But the cost a *price* was set against was gone, and that is the one figure needed to answer "has this price gone stale?".

`price_history` is append-only — one row per price write, carrying all four figures as they stood immediately after it. `source` separates a receipt recomputing the suggestion from a person saving a price. Rows are never updated or deleted.

### `sales_invoices.due_date` — ageing had nothing to measure from

Nothing carried a due date. That made "Current" on the Customer Accounts screen mean *raised today* rather than *not yet due*, and every overdue bucket was wrong by the length of the payment terms.

The due date is **stamped when the invoice is raised**, not worked out on read — invoice date plus the `default_payment_terms_days` setting. Same principle as `unit_price` being copied onto the invoice line: changing the terms later must not silently move the due date of invoices already issued and rewrite their ageing with them. A walk-in is settled at the till, so its due date is the invoice date.

**Per-customer payment terms were deliberately left out.** They were built, then dropped: nothing in the 26 wireframes can set terms on a customer — there is no customer edit screen in scope — so the column would have been unreachable and permanently null. One shop-wide default covers the demo.

### Three more, from building against the screens

`0003` made `payments.customer_id` nullable so a walk-in can be recorded the way `sales_invoices` already allowed — the two tables have to agree on what a walk-in is. It also gave `sales_invoices.reference` a unique index, because two customers holding receipts with the same number is a real-world problem, and added a sequence to generate those numbers.

`0004` added `revoked_tokens`, which is what makes signing out mean anything.

---

## 3. The API

Built on `feat/pos-endpoints`, pushed. Node + Express + Drizzle against the `app` schema, running as a persistent process beside Postgres rather than on Vercel serverless.

### Module pattern

Every module is two files, and the split is strict. `routes.ts` holds the router, its role and validation middleware, and one line calling the service. `service.ts` holds business logic, database access and the module's input schemas — and never touches `req`, `res` or a status code. A service signals failure by throwing `ApiError` and the error middleware picks the code, which is what keeps the logic callable from a seed script or a job runner without faking a request.

### What is implemented

| Endpoint | Role | Notes |
|---|---|---|
| `POST /api/auth/login` | any | Case-insensitive email. Unknown account, wrong password and deactivated account all answer the same 401 in the same time |
| `POST /api/auth/logout` | any | Revokes that token specifically |
| `GET /api/auth/me` | any | Re-read from the database, so a deactivated account stops working at once |
| `GET /api/pos/parts` | sales | Name, SKU, part number, OEM number and vehicle fitment |
| `POST /api/pos/sales` | sales | The sale, in one transaction |
| `GET /api/pos/sales/:id` | sales | The receipt |
| `GET /api/backoffice/purchase-orders` | purchasing | Filter by status and supplier |
| `GET /api/backoffice/purchase-orders/:id` | purchasing | Lines, landed costs, delivery history |
| `POST /api/backoffice/purchase-orders/:id/receive` | purchasing | The cost-to-price chain |
| `GET /api/backoffice/prices` | purchasing | Landed, suggested, final, with a derived status and filters |
| `GET /api/backoffice/prices/:partId` | purchasing | Cost basis — which PO, which USD cost, which rate — and full history |
| `PATCH /api/backoffice/prices/:partId` | purchasing | Set the final price; appears in POS immediately |
| `GET /api/financial/customers` | accountant | Accounts, most overdue first, with ageing and summary tiles |
| `GET /api/financial/customers/:id` | accountant | Every invoice and payment on one account |
| `POST /api/financial/payments` | accountant | Money arriving after the counter |
| `GET /api/financial/cheques` | accountant | The queue |
| `POST /api/financial/cheques/:id/clear` | accountant | The only moment a cheque touches a balance |
| `POST /api/financial/cheques/:id/bounce` | accountant | Reverses without deleting |
| `GET`/`POST /api/backoffice/suppliers` | purchasing | List and create |
| `GET`/`PATCH /api/backoffice/suppliers/:id` | purchasing | Detail with PO history; deactivate rather than delete |
| `POST /api/backoffice/purchase-orders` | purchasing | Draft or send; the reference is generated |
| `PATCH /api/backoffice/purchase-orders/:id` | purchasing | Drafts only |
| `POST /api/backoffice/purchase-orders/:id/send` | purchasing | Needs a rate and a line |
| `POST /api/backoffice/purchase-orders/:id/cancel` | purchasing | Only before anything arrives |
| `POST /api/backoffice/purchase-orders/:id/close` | purchasing | Short-close: write off what is not coming |
| `GET`/`POST /api/ims/parts` | purchasing | Catalogue with filter facets; a new part starts at zero stock |
| `GET`/`PATCH /api/ims/parts/:id` | purchasing | Detail with the stock ledger; no stock field on the edit |
| `POST /api/ims/parts/:id/adjust` | purchasing | Damage, loss, count correction — reason required |
| `GET /api/ims/adjustments` | purchasing | Recent adjustments across parts |
| `GET /api/ims/low-stock` | purchasing | With usual supplier and what is already on order |
| `GET`/`POST /api/categories` | purchasing | Its own module — dropdown list, and creating one on the fly |
| `PATCH /api/categories/:id` | purchasing | Rename, or deactivate |
| `GET`/`POST`/`PATCH /api/brands` | purchasing | Its own module, the same shape |
| `GET`/`PATCH /api/settings` | **admin** | Its own module. The global margin, plus the currency and location the screen reports |

Admin reaches everything.

### Recording a sale

One transaction writes the invoice and its lines, a stock movement per part, the balance decrements, the payment and its allocation — or none of it. A sale whose second line is short of stock leaves no invoice and no movement behind.

Prices are read from the database inside that transaction. There is no price field in the request at all, so a client cannot propose one, and the search endpoint never selects landed cost or suggested price — the promise that Sales cannot see cost holds at the query, not in the UI.

Balances are locked with `SELECT … FOR UPDATE` in part-id order, so two tills cannot both sell the last unit and cannot deadlock against each other or against a delivery.

### Receiving stock

The step the purchase chain exists for, and the one worth demonstrating live. In one transaction it raises the quantity received per line, increases stock and writes a movement for each, computes `landed cost = unit cost (USD) × the rate recorded on the order`, re-suggests a sell price at the shop margin, appends to price history, and moves the order to partially or fully received.

The rate is fixed for the life of the order: a later delivery lands at the rate originally paid, not at the rate today.

Verified against the seeded `PO-2026-0007`. Receiving 20 brake pads and 30 of 50 spark plugs at 13.20, against the 12.50 the existing stock was bought at:

| | Before | After |
|---|---|---|
| Landed cost | 230.00 | 249.48 |
| Suggested price | 310.50 | 336.80 |
| Final price | 310.00 | 310.00 — the override stands |
| Stock | 22 | 42 |
| Flagged for review | — | yes |

Sales still sees 310.00, and no cost field appears in the payload at all.

### Price management

The Prices screen's three states are derived, never stored. `confirmed` means the
final price equals the suggestion; `overridden` means somebody chose differently;
`needs_review` means a price was set by hand and the cost has since moved, so the
standing price is measured against a cost that no longer applies. `needs_review`
outranks `overridden`, because it is the row somebody actually has to look at.

Setting a price appends to `price_history` with who set it and the landed cost it
was set against — which is precisely what makes `needs_review` a comparison
rather than a flag anyone has to remember to raise.

Changing the global margin affects what is suggested from then on. Prices already
saved are left alone: they were decisions taken at the margin of the day, and
recomputing them would silently reprice the catalogue.

### Inventory

The rule the module is arranged around: **stock is never typed.** No endpoint
sets a balance. It moves through a purchase order receipt, a sale, or an
adjustment carrying a reason, and each writes a movement explaining itself. The
edit form has no stock field, and a new part starts at zero rather than with an
opening quantity.

Part detail returns the ledger with a running `onHandAfter` computed from the
movements rather than stored, so the newest row can be checked against the
balance at the top of the screen. They disagree only if something wrote a balance
without a movement — which is the failure this arrangement exists to make
visible.

An adjustment requires a reason, because one without it is indistinguishable
from somebody editing stock to whatever they wanted. A decrease that would go
below zero is refused.

Low stock carries what a purchasing officer needs in order to act: how short,
who supplied it most recently, and **anything already expected on an open
order** — the shortfall may be covered already, and reordering would double up.

### Settings

**Its own module at `/api/settings`, admin only.** Not under `/api/backoffice`,
where it began: settings are read by three modules — pricing takes the margin,
invoicing takes the payment terms, POS prices in the currency — and a thing three
modules read is not owned by one of them. The wireframe's navigation puts
Settings beside Users and Roles under Admin, and the role gate now comes from
that rather than from whichever router it was convenient to attach to.

**The move closed a real hole.** Mounted on the backoffice router it inherited
`purchasing, admin`, so a purchasing officer could change the margin that prices
the whole catalogue. `/api/settings` is `requireRole('admin')`, and a test asserts
that sales, purchasing and accountant are each turned away from both verbs.

**`/api/backoffice/settings` was removed rather than aliased.** Nothing in the
frontend called it, and leaving a second path to the same data — one of them with
the wrong gate — would have reintroduced exactly what this closed. A test asserts
it now 404s.

**`GET` returns what the screen draws:** one editable field and two read-only ones.

| Field | | Source |
|---|---|---|
| `defaultMarginPct` | editable | `settings` table |
| `sellingCurrency` | read-only, always `GHS` | a constant, not a row — nothing in this build can change it |
| `location` | read-only, `{ id, name }` | the single active location |

The two read-only fields report what the system has decided rather than offering
a choice. They are returned rather than hardcoded in the UI so that the day a
second location arrives the screen starts saying something different without a
frontend release. `location` resolves through the same `defaultLocation` helper
the stock code uses, so the shop the screen names is the shop being sold out of.

**`PATCH` accepts `defaultMarginPct` only**, under 100 — a margin is a share of
the selling price, and at 100% the price would have to be infinite. Changing it
affects what is suggested from then on and never rewrites a price somebody has
already confirmed. Anything else in the body is ignored rather than honoured: a
`PATCH` carrying `sellingCurrency: "USD"` succeeds and still answers `GHS`.

**Still open: `defaultPaymentTermsDays`.** It is a real shop-wide setting —
invoicing stamps a due date from it — but it is not on the Settings wireframe, so
it is not in this response. It stays seeded and is read straight from the table
by POS, which is unchanged behaviour. The call still to make is whether it
becomes a fourth field on the screen; adding it later is additive, so nothing
here forecloses it.

One thing to fix when the wireframes are next touched: the Settings artboard
still reads "Suggested price = landed cost × (1 + margin)", which is the markup
formula the API no longer uses. It belongs with the stale-wireframe item in
Section 5.

### Categories and brands

**Each is its own module**, mounted at `/api/categories` and `/api/brands` beside
the other five rather than under IMS. They were briefly inside IMS and documented
together as `/api/ims/{taxonomy}`, which described an endpoint that did not exist:
the routes were always two concrete paths, and the placeholder made the spec
invalid as well as misleading. Separate modules, separate paths, separate
documentation.

They read almost identically and could share an implementation. They do not, on
purpose — a brand is who made the part and a category is what kind of part it is,
and one will grow a field the other does not.

Both were free text on a part, and drifted the first day they were used: one part
went in as "Electrical" and another as "Electrical and Charging", and the filter
list simply reported both. Nothing could tell a new category from a typo of an
existing one, and the exact-match filter then hid a part from the very category
its author thought they had chosen.

They are rows now, referenced by id, with a unique index on the lowercased name —
so "Electrical", "electrical" and " Electrical " are one category rather than
three that look identical on screen. Names are trimmed on write rather than
trusting the caller to have done it.

Neither is ever deleted. A part points at one, and losing the row would leave
that part uncategorised, so they are deactivated like suppliers. Renaming reaches
every part using it, because the part holds a reference rather than the text.

The part list no longer returns the category and brand lists; the dropdowns come
from their own endpoints, which also report how many parts use each. POS search
still returns a brand *name* and no id — the till prints "BP-2042 · Bosch" and
has no business managing brands.

Migrations 0008–0010 do this in three steps: add the tables and the reference
columns, backfill the existing text into rows and point the parts at them, then
drop the text columns. The backfill is a custom migration rather than a generated
one, because drizzle generates structure and moving the values is a separate job.

### Suppliers and drafting a purchase order

A supplier is never deleted. One you stop using is switched to inactive, so its
purchase-order history stays intact and past costs remain explicable; an inactive
supplier cannot be put on a new order.

`purchasedToDateUsd` is reported in dollars, because every order carries its own
FX rate — summing the Cedi totals would add up figures agreed on different days.

**A draft may be saved without an FX rate.** That closes the mismatch flagged
during wireframing: the PO List screen shows a draft with "not set" and no Cedi
total, while the column was `NOT NULL`. `fx_rate` is now nullable and the rate is
required at the moment the order is *sent*, along with at least one line —
enforced in the service, because a check constraint cannot express "required in
some states".

Once sent, the order is frozen. Its lines and its rate are what the supplier is
working to, and changing them afterwards would rewrite the cost basis of stock
already received against it. A sent order with nothing received can still be
cancelled; there is deliberately no way to recall one to draft, because the
supplier is holding a document with that number on it and cancel-and-reissue
leaves both sides able to see what was voided.

**Short-close** handles the case that neither cancel nor receive covers: part of
an order arrived and the rest never will, because the supplier discontinued the
line. Without it the order sits `partially_received` for good — stock that is not
coming keeps showing as expected, and the supplier never stops having an open
order. What arrived is untouched; only the expectation of the remainder is
written off, and `closed` is its own status because `cancelled` would claim
nothing arrived and `received` would claim everything did. It applies only to a
part-delivered order: if nothing came, that is a cancellation however it is
worded, and each status then means exactly one thing.

Both outcomes record **why**. `purchase_orders` gained a resolution triple —
`resolved_at`, `resolved_by`, `resolution_reason` — mirroring the shape `cheques`
already uses for cleared and bounced, rather than a column set per outcome or a
separate events table, which would be the audit log Section 8 excludes. The
reason is required when short-closing, because that writes value off and somebody
will ask about it later, and optional when cancelling, because an order nobody
acted on often ends for no reason worth recording. Free text rather than an enum:
nobody has yet seen the reasons a real purchasing officer writes, and a
constrained list should come from reading them.

### Receivables

Two rules run through the module, and both are structural rather than conventions
anyone has to remember.

**A balance is derived** — invoices minus allocations from payments that have
cleared. No table has a balance column, so there is nothing for an endpoint to
set. A pending cheque is therefore counted as still owed, which is correct: it
has not cleared, so it has paid nothing.

**A bounce reverses without deleting.** The payment keeps its row and its
allocations; flipping it out of `cleared` is what puts the invoice back to
outstanding. The history still shows the cheque, flagged, because a bounce is
something that happened.

Ageing is measured from the **due date**, not the invoice date, and the buckets
are per invoice rather than per customer — a single very late invoice would
otherwise hide behind a current one on the same account. A customer row shows the
due date of their oldest unpaid invoice, which is the one you would chase on.

Verified end to end: POS takes a cheque sale, the account shows the full amount
still owed, clearing drops it to zero, and bouncing a second cheque puts that
invoice back to its full amount with the payment still on the record.

### Money

Every amount is `numeric` in Postgres and a string in transit — `"310.00"`, never `310`. Arithmetic runs on scaled integers in `src/lib/money.ts`, shared with the seeds so the two cannot disagree. `18.40 × 12.5` in floating point is `229.99999999999997`; there is a test that says so.

### Signing out

A JWT is valid until it expires, and presenting one asks the server nothing — so a client-side sign-out is only the client agreeing to forget the token, and anyone who copied it keeps the session. Tokens therefore carry an id, `POST /api/auth/logout` records it as revoked, and every authenticated request checks that list. Only that token is revoked: signing out at the till does not sign the same person out on their phone.

The cost is one indexed lookup per request, affordable precisely because the API is a persistent process next to the database.

---

## 4. Decisions taken during the build

| Question | Decision |
|---|---|
| Wireframe fidelity | Low-fi greyscale first; styling after structure is agreed |
| Which cost drives a suggested price | The **latest** purchase cost — you price to replace, not to what you paid |
| "Balance due" on the payments tab | What was still owed **on that invoice** after the payment. A running account balance was rejected: payments alone can't carry one, because invoices are raised between them |
| Due date shown on a customer row | The **oldest unpaid** invoice's due date — the one you'd chase on |
| Ageing basis | Days past the **due date**, not days since the invoice |
| Cheque date field | **Removed from the wireframes.** `cheques` carries number, bank and resolution — no date column |
| Customer Accounts layout | Table, not cards |
| Where demo seeds live | The **API repo**, not `migration-scripts`. The demo accounts must be hashed with the app's own cost, seed rows are typed against the Drizzle schema, and `db:setup` is an API-repo script. `migration-scripts` keeps the Tally migration, which is its real reason to exist |
| A walk-in's payment | `payments.customer_id` became nullable, matching `sales_invoices`. A cheque still requires a named customer — a bounced cheque attached to nobody is a debt with no one to chase |
| Invoice numbering | A Postgres sequence. `max(reference) + 1` lets two tills read the same number, and the unique index would then reject one sale outright |
| Overridden price meeting a new cost | **The override stands and the part is flagged for review.** Answered below |
| What "margin" means | A margin **on the selling price**, not a markup on cost. `price = cost ÷ (1 − margin ÷ 100)`. This follows the accounting sense of the word — gross margin is a share of revenue — which is a fact about terminology rather than something confirmed with the shop owner. If he prices on cost instead, the fix is to relabel the setting "Markup %" and flip one function |
| Changing the global margin | Affects future suggestions only; saved prices are decisions, not derivations |
| Logout | Server-side revocation, not client-side forgetting |

### The overridden-price question, answered

An earlier note said `prices` already had a review state and that option (b) was therefore cheap. That was wrong — there is no such column. It turns out not to need one.

`price_history` records the landed cost each price was set against. "Needs review" is therefore a **comparison** between that and the cost now, derived exactly the way a customer balance is derived from its transactions. A hand-set price is kept, because it was a deliberate decision, and comes back flagged rather than silently eroding the margin. No migration, and nothing for anyone to remember to set.

---

## 5. Still open — needs a call

**1. The wireframes still show markup-era prices.** Settled in the code, not yet on the canvas.

Margin now means margin on the selling price — `suggested = landed ÷ (1 − margin ÷ 100)` — and the API, seeds and tests moved together. The 26 artboards did not: they still show GH₵ 393.39 where the API says GH₵ 448.31, and PriceEdit's "36.9% on cost" no longer describes the system. The figures need regenerating before the client sees the canvas and the API side by side.

The margin itself is a setting, so what it should be is the owner's call at a keyboard, not an open question here.

**2. Post-dated cheques.** Common here, and the schema cannot represent one. Adding a cheque date is small; deciding whether the demo needs it is the question.

**3. Credit notes.** The invoices tab says a mistake is corrected with a credit, not by editing history. That is the right principle, but there is no credit-note table and it is not in scope — so today it is a statement of intent.

**4. ~~The scope and progress documents are not in version control.~~ Done 17 September.** Both now live in `docs/` in the API repo, so a decision and the code that implements it move together. The wireframes in `design/` are still outside any repository — worth deciding whether they belong here too, since the API's tests assert figures read off them.

---

## 6. Deliberately not built

Unchanged from Section 8 of the scope: multi-location inventory, per-category margin overrides, live FX rates, freight and duty in landed cost, an audit-log screen, e-commerce, notifications, supplier payables.

Added during the wireframing and API passes: per-customer payment terms, credit notes, price-history UI beyond the panel on the price screen, cash tendered stored against a sale (it is validated and then discarded, so a reprinted receipt shows the amount due rather than what was handed over), and "sign out everywhere" — the revocation table would support it, but nothing asks for it yet.

---

## 7. What's next

**The frontend.** It is the only thing left.

All five demo areas now have an API behind them, and every screen in the 26
wireframes has endpoints to draw from. Nothing else on the backend is blocking a
demo — what is blocking one is that none of it can be seen.

The whole spine now runs on the server: receive a purchase order at a new rate, watch the landed cost and suggestion move, see the part flagged for review, confirm a price, find that figure at the till, sell on a cheque, and watch the balance move only when the accountant clears it. Suppliers and purchase orders can be created from nothing, so the whole chain runs without seeded data standing in for a step, and the catalogue behind it can be maintained.

**The backend for the demo is complete.** All five areas the client asked to see — POS, IMS, Financial Core, RBAC and Backoffice — are implemented, documented and tested. The frontend is an empty scaffold, and is now the only thing between this and something the client can be shown.

The frontend remains untouched. At some point that becomes the critical path, since none of the above is demonstrable without it.

---

## Where things live

| | |
|---|---|
| Scope of record | [`docs/demo-scope.md`](demo-scope.md) |
| Wireframes (working files) | `design/` in the project root, beside this repo — 26 `.dc.html` artboards plus `canvas.json`. Not versioned here |
| Wireframes (shareable) | https://claude.ai/artifact/1XutDNA72QppRBLaExBEZw |
| API, schema and seeds | `github.com/auth-mechinca/auto-mechnica-portal-api` |
| API reference | `/docs` (Swagger UI) and `/openapi.json`, generated from the schemas the API validates against |
| Developer setup | That repo's `README.md` — `npm run db:setup` then `npm run dev` |
| Frontend | `github.com/auth-mechinca/auto-mechnica-erp-ui` — empty |
| Tally migration | `github.com/auth-mechinca/migration-scripts` — empty |

Schema migrations are generated by Drizzle and live only in the API repo. `0000`–`0002` are public and immutable; `0003` and `0004` are on `feat/pos-endpoints`. Any further change is a new migration.
