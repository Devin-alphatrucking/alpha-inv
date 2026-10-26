# Phase 12: Purchase module (first version)

The path from "site needs cement" to "order sent to the supplier", in the web app (works on a phone browser).

## The flow
1. **Material request** (`/purchase`, New request). A site engineer, project manager or purchase officer lists items, quantities and a needed-by date for a project. It is numbered `MR-2026-0001` (numbers are per company and year and never reused).
2. **Approval.** The request starts as a draft. **Send for approval** puts it in front of a project manager or administrator, who **approves** or **rejects** it (a rejection needs a reason the engineer can read). The writer can take a submitted request back to edit it, or cancel it. A manager cannot approve their own request; an administrator can.
3. **Purchase order** (`/purchase/orders`). The purchase officer (or administrator) makes an order from an approved request or from nothing: supplier (from the Vendors list), dates, payment terms, delivery address, items with rate and GST. Totals add up as they type, each line rounded to the paisa. Numbered `PO-2026-0001`.
   - A draft order can be changed. **Mark as sent** locks it. A draft or sent order can be **cancelled** with a reason; the request then goes back to *Approved* so it can be ordered again (to another supplier, say).
   - One request can have several orders (split between suppliers).
   - **Print or save as PDF** prints just the order (menus are hidden when printing).

## Who can do what
| Role | See requests | Raise | Approve | See orders and prices | Make orders |
|---|---|---|---|---|---|
| Administrator | all projects | yes | yes (own too) | yes | yes |
| Project manager | assigned | yes | yes (not own) | yes | no |
| Purchase officer | assigned | yes | no | yes | yes |
| Site engineer | assigned | yes | no | **no** | no |
| Accountant | all | no | no | yes | no |
| Viewer | assigned | no | no | yes | no |
| Staff | no | no | no | no | no |

Engineers do not see order prices or order numbers: commercial terms stay in the office.
Someone who is not on a project cannot tell its requests or orders exist.

## Under the hood
- Tables `MaterialRequest(+Line)`, `PurchaseOrder(+Line)`, `DocumentCounter` (migration `20261105090000_purchase`), all with company column and row-level security.
- Numbers come from one atomic counter statement inside the same transaction that saves the document, so two people at once never get the same number and a failed save does not burn one.
- Status changes are conditional updates (`WHERE status = ...`), so two people acting at once cannot both succeed.
- Money is held in paise and quantities in thousandths while calculating (`src/lib/purchase/rules.ts`), so there is no floating point drift. Rules are unit-tested; database behaviour is in `tests/purchase.test.ts` (15 checks).
- Permissions: `request:view`, `request:write`, `request:approve`, `order:view`, `order:write` in `src/lib/roles.ts`.

## Not in this version (next, per PRODUCT-PLAN)
- Delivery check (goods received note) against the order, and part deliveries (Phase 14)
- Matching an invoice to its order and flagging extra quantity or higher rate (Phase 14)
- Quotes from several suppliers; "usual rate" and "cheapest supplier" shown while ordering
- Emails to the approver when a request is waiting, and to the supplier with the order attached
- Order PDF as a real file (printing from the browser works today)
- Order-level approval limits (you removed approvals for large invoices; none are built for orders)
