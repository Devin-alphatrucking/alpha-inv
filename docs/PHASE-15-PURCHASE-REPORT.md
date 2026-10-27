# Phase 15: Purchase report (ordered, delivered, billed, paid; supplier performance)

Where: **Purchase report** in the menu (`/reports/purchase`), and **More > Purchase report** on a phone. Three views, each with a **CSV download** (plain numbers for Excel).

## Projects (to date)
For each project, how the money moves from order to payment:

| Column | Meaning |
|---|---|
| **Ordered** | Orders sent to suppliers, with GST. Drafts and cancelled orders count for nothing. An order closed short counts only what arrived. |
| **To deliver** | Ordered, not yet on site. |
| **Delivered, not billed** | Goods that arrived but whose bill has not come: money the supplier will ask for. |
| **Billed** | All confirmed bills of the project (bills still waiting for review are not counted). |
| **Paid / To pay** | Payments recorded, and billed less paid. |
| **Expected cost** | What the project will have cost if everything ordered is billed: bills so far plus ordered-and-not-yet-billed. |
| **Budget** | Shown only to roles that may see budgets. **Over budget** when expected cost passes it, **Near budget** from 80%. |

"Billed against orders" (in the CSV) is the part of the bills that was linked to an order on the invoice page, which is what the "Delivered, not billed" figure depends on. Bills that are not linked to an order still count in Billed.

## Suppliers (for a period)
Orders dated inside the chosen period (default: the last twelve months).
- **On time:** fully delivered orders that have a delivery date, delivered on or before it. The day of delivery is the day the last item arrived.
- **Average delay:** for the late ones, in days.
- **Fill:** quantity received against ordered. An order closed short keeps the full ordered quantity, so a supplier that stopped short shows a lower fill.
- **Refused:** the share of what arrived that was damaged or wrong.
- **Late now:** orders past their delivery date and still not complete.

## Open orders (today)
Orders sent and not yet fully delivered: late ones first (most days late), then by nearest delivery date. Shows percent received and the value still to deliver.

## Who can see it
Administrator, accountant, purchase officer, project manager and viewer (permission `order:view`), each limited to their projects. **Site engineers and staff cannot** (it shows prices). Budgets appear only for roles with budget access.

## Under the hood
Rules (pure, unit-tested): `src/lib/purchase/report-rules.ts`. Data: `src/lib/flows/purchase-report.ts`. Page `src/app/(app)/reports/purchase`, file `src/app/api/reports/purchase`. Tests: `src/lib/purchase/report-rules.test.ts` and `tests/purchase-report.test.ts` (8 database checks: all the figures above, closed short, cancelled, drafts, period, access by role and company).

## Not in this version
Charts; comparing two periods; an email of the weekly summary; the same report on the phone (it opens in the phone's browser for now).
