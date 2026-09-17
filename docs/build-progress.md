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
| Backoffice — price management | **Done** — list with derived status, cost basis and history, set a price, change the shop margin |
| Backoffice — suppliers, PO create | **Not started** — routers mounted, no handlers |
| IMS | **Not started** — router mounted, no handlers |
| Financial Core | **Done** — customer accounts with ageing, account detail, recording payments, the cheque queue |
| Next.js frontend | **Not started** — repo is an empty initial commit |
| API documentation | **Done** — OpenAPI 3.1 at `/openapi.json`, Swagger UI at `/docs` |

**143 tests pass.** The spine of the demo now works end to end on the server: receive a purchase order at a new FX rate, watch the landed cost and suggested price move, then sell the part at the till and watch stock and the customer balance follow. What is missing is a face — nothing is wired to a screen yet.

---

## 1. Wireframes

**26 screens on one pan/zoom canvas**, grouped into four bands — Sales (5), Purchasing Officer (13), Accountant (5), Owner/Admin (3). Every screen has a plain-English note directly underneath saying what it is, what you do on it, and the one thing worth knowing. Each band opens with a note covering how its screens connect.

Fidelity is deliberately low: greyscale, real field names, real data, no branding or colour system yet. The intent was to settle structure and flow before anyone argues about colour.

**Section 9's checklist has 22 items. All 22 are drawn.** Four screens were added on top:

| Added | Why |
|---|---|
| **Shell & nav by role** | Not a screen you visit — the four role menus side by side, plus the blocked-route state. Makes the RBAC demo concrete rather than asserted. |
| **Add / edit user** | Section 9 lists "User/Role Management" but no form. The list alone can't create anybody. |
| **Settings** | The scope calls the global margin configurable but names no screen to change it on. Three fields, two of them read-only. |
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
| `GET`/`PATCH /api/backoffice/settings` | purchasing | The global margin |
| `GET /api/financial/customers` | accountant | Accounts, most overdue first, with ageing and summary tiles |
| `GET /api/financial/customers/:id` | accountant | Every invoice and payment on one account |
| `POST /api/financial/payments` | accountant | Money arriving after the counter |
| `GET /api/financial/cheques` | accountant | The queue |
| `POST /api/financial/cheques/:id/clear` | accountant | The only moment a cheque touches a balance |
| `POST /api/financial/cheques/:id/bounce` | accountant | Reverses without deleting |

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

**4. A draft purchase order has no FX rate.** The PO List wireframe shows a draft with "not set" and no Cedi total, but `purchase_orders.fx_rate` is `NOT NULL`. Receiving is unaffected — nothing can be received without a rate — so this belongs with **PO Create**, not with receiving. Flagged so it is not discovered mid-build.

**5. ~~The scope and progress documents are not in version control.~~ Done 17 September.** Both now live in `docs/` in the API repo, so a decision and the code that implements it move together. The wireframes in `design/` are still outside any repository — worth deciding whether they belong here too, since the API's tests assert figures read off them.

---

## 6. Deliberately not built

Unchanged from Section 8 of the scope: multi-location inventory, per-category margin overrides, live FX rates, freight and duty in landed cost, an audit-log screen, e-commerce, notifications, supplier payables.

Added during the wireframing and API passes: per-customer payment terms, credit notes, price-history UI beyond the panel on the price screen, cash tendered stored against a sale (it is validated and then discarded, so a reprinted receipt shows the amount due rather than what was handed over), and "sign out everywhere" — the revocation table would support it, but nothing asks for it yet.

---

## 7. What's next

**Suppliers and PO Create.** Without them a purchase order can only be seeded, and creating one is where the draft `fx_rate NOT NULL` mismatch has to be resolved.

After that IMS, since it is mostly catalogue maintenance and receiving already covers the stock movements that matter.

The whole spine now runs on the server: receive a purchase order at a new rate, watch the landed cost and suggestion move, see the part flagged for review, confirm a price, find that figure at the till, sell on a cheque, and watch the balance move only when the accountant clears it. Four of the five demo areas are behind an API.

The frontend remains an empty scaffold, and it is now unambiguously the critical path — none of this is demonstrable to the client without screens.

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
