# Phase 14: Delivery check and bill-to-order match (first version)

Connects Purchase (what was ordered), Technical (what arrived on site) and Accounts (what the supplier billed).

## Delivery check (`/purchase/deliveries`)
- Any order that was **sent** to the supplier appears in the list, those still waiting for goods first, with "Late" when its delivery date has passed.
- A site engineer, project manager, purchase officer or administrator opens an order and **records a delivery**: the day it arrived, the challan number, and for each item how much arrived in good condition and how much was **refused** (damaged, wrong item), with a remark. Items that did not come are left blank. Several part deliveries are fine.
- After saving, **photos** of the challan and the goods are added to that delivery (same photo storage and checks as site photos; a purchase officer may photograph a delivery although they cannot add other site photos).
- The page shows ordered, received, refused and still to come for every item, and "Over by N" when more arrived than was ordered.
- **Prices are never shown on the delivery screens.** Engineers can do deliveries without seeing order rates or totals.
- A delivery can be removed by the person who recorded it (within a day) or by the purchase officer / administrator. Deliveries cannot be recorded against a draft or cancelled order.

## Bill matched to its order (invoice page, "Purchase order check")
- On a bill, people who may see orders and review bills can **link** it to one of that supplier's sent orders on the same project. Linking to another supplier's or project's order, or to an unsent order, is refused. The link can be removed.
- The check compares the bill's items with the order and with what was received:
  - **Problem:** an item that is not on the order; a rate more than 1% above the ordered rate; more billed than ordered; more billed than received; all bills for the order together above its value (before GST) by more than 1% (at least 5 rupees).
  - **Note:** nothing recorded as received yet for an item.
  - Earlier bills for the same order count: a second bill is judged against the first. A bill is not judged against bills that came after it.
- Items are matched by material, by the same words, or when one name is inside the other (very short names never match by accident).
- Payment is **not blocked**; the result tells the person to settle problems with the supplier first. (A hard block can be added if you want one.)
- Engineers do not see the check (it shows prices).

## Under the hood
- Tables `GoodsReceipt`, `GoodsReceiptLine` with company column and row-level security; `Invoice.purchaseOrderId`; `SitePhoto.receiptId` (migration `20261106090000_delivery_check`).
- Permissions `delivery:view` (everyone with purchase view access except staff) and `delivery:write` (administrator, purchase officer, project manager, site engineer).
- Rules: `src/lib/purchase/delivery-rules.ts` (unit-tested). Database work: `src/lib/flows/delivery.ts`. Tests: `tests/delivery.test.ts` (12 checks).

## Not in this version
Blocking payment on a mismatch; approving an exception with a reason; goods-received PDF; supplier delivery performance report (Phase 15); emails when goods are late.

## Dashboard module hub
The dashboard now opens with the three modules as cards (Site work, Purchase, Accounts), each with live numbers and one click to open it, then a "From site to payment" strip (request, approval, order, delivery, bill, payment) where each step links to its screen, then the existing Finance dashboard. A person sees only the modules their role can open; someone with a single module (a staff member) sees the finance dashboard as before. Code: `src/lib/flows/hub.ts`, `src/components/module-hub.tsx`.
