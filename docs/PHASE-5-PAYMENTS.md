# Phase 5: Payments with Razorpay

Status: BUILT and tested against a fake Razorpay server and the real built app. NOT yet tried against Razorpay itself: that needs your test keys (section 6).

## 1. How buying works (and why it is built this way)

One plan = one project. To add a project a company **buys another project plan**. In Razorpay each project plan the company buys is **its own
subscription** (quantity 1), not one subscription whose quantity goes up. Reason: Razorpay cannot change the quantity of a subscription paid by UPI
or eMandate, which most Indian customers use. The result for the customer is the same: they see "Project plans: 2", each with its own renewal date,
and can stop one without touching the others.

The company's allowed projects, users and AI pages come from the same rules as before (`src/lib/plans`). What changed is **where `quantity` and
`status` come from**: they are no longer typed by hand but **derived from the company's purchases** (`src/lib/billing/rules.ts`, `derive`) every time a purchase changes:

| Purchases | Company status |
|---|---|
| at least one charged and running | Active |
| a charge failed (Razorpay is retrying) or retries gave up (halted) or paused | Payment overdue: everything keeps working for the grace period (7 days from the FIRST failure, `BILLING_GRACE_DAYS`), then adding projects, people and invoices pauses. Viewing and editing never stop. |
| cancelled, paid period not over | Ends soon (everything works) |
| everything ended after having paid | Cancelled (the trial does not start again). Data is never deleted. |
| nothing bought | the free trial runs, then "trial ended" |

Because the company row is always **recomputed** from the purchases, a repeated, late or out-of-order message can never leave it wrong.
Free project plans given by your team (`npm run billing -- grant`) are added on top. A company you had set up by hand keeps what it had when it makes its first purchase.

## 2. What the customer sees (Plan & usage page, administrators only)

- "Project plans" card: price, each purchased plan with its state and paid-until date, recent payments, **Add a project plan (price)** and **Stop at period end**.
- **Add a project plan** opens Razorpay's checkout window. A closed window or double click does not create duplicates (the unfinished purchase is reused for 24 hours; a link to Razorpay's own payment page is shown as a fallback).
- When prices are not set or keys are missing, the button becomes "Ask to add a project plan" (the support flow from Phase 4).

## 3. Security

- **Signed webhooks**: `POST /api/billing/razorpay/webhook`. The signature (HMAC-SHA256 of the raw body with the webhook secret) is checked in constant time before anything else; a missing secret refuses everything (503).
- **Checkout return is not trusted**: the browser reports success, we verify Razorpay's signature on `payment_id|subscription_id`, then **read the subscription from Razorpay** and apply that. A purchase can only be confirmed by the company that started it.
- **Idempotent**: every event id is stored once (`BillingEvent`); a repeat, even six at once, is acknowledged and not applied twice. A failed processing returns an error so Razorpay retries.
- **Out-of-order safe**: an update older than one already applied is ignored; payments are still recorded. The first failed charge fixes the start of the grace period.
- Company and person always come from the signed session. Only administrators can buy or cancel. Rate limits: 10 checkouts per person per hour, 30 per company per day.
- The key secret and webhook secret never leave the server. Customers' contact details in Razorpay's payload are not stored. Provider error wording is logged for you, never shown to customers.
- All changes are written to the activity log (`BILLING_STARTED`, `BILLING_CHANGED`, `BILLING_CANCELED`).

## 4. Tables (migration `20261025090000_razorpay_billing`)

`BillingPurchase` (one per project plan bought), `BillingPayment` (one per captured charge), `BillingEvent` (webhook inbox); `Subscription.billing` (`MANUAL` or `RAZORPAY`) and `extraQuantity`; `Plan.providerPlanId/providerPlanAmount`.
These tables are not Row-Level-Security tables because webhooks arrive with no company; all code that reads them filters by company explicitly (tested).
The Razorpay plan is created automatically at the first purchase. **A price change creates a new Razorpay plan; existing customers keep the price they agreed to.**

## 5. Operator commands

- `npm run plan -- edit-plan PROJECT --price 99900 --currency INR` (price in paise: 99900 = INR 999.00)
- `npm run billing -- status <company>`: purchases, payments, and a check that the stored subscription matches what the purchases say
- `npm run billing -- grant <company> <N> --reason "..."`: free project plans (only once the company is on Razorpay billing)
- `npm run billing -- events [--errors]`: the webhook inbox
- `npm run plan -- set ...` still works for hand-managed companies and is refused for companies that pay through Razorpay (it tells you to use `grant`)
- Safety net: a scheduler (daily) can call `POST /api/billing/reconcile` with `Authorization: Bearer <BILLING_CRON_SECRET>`; it re-reads unfinished purchases from Razorpay and repairs any missed webhook.

## 6. What you need to do to go live

1. Razorpay account with **Subscriptions** enabled; copy the **test** Key Id and Key Secret into `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`.
2. Dashboard > Webhooks: URL `https://<your app>/api/billing/razorpay/webhook`, a secret of your choice (also in `RAZORPAY_WEBHOOK_SECRET`), tick the `subscription.*` events.
3. Set the price: `npm run plan -- edit-plan PROJECT --price <paise> --currency INR`.
4. Try a test purchase with Razorpay's test UPI/card details, watch `npm run billing -- status <company>` and `events`; try cancelling.
5. Only then switch to live keys and a live webhook secret. (Razorpay's live mode needs its own KYC and approval for Subscriptions.)
6. Mobile apps: do NOT sell project plans inside the iOS/Android apps (store rules); keep buying on the web. The apps only read the plan state.

## 7. Tested

- 25 database checks against a fake Razorpay server: switched-off and unpriced states, one provider plan per price, reuse of unfinished checkouts, provider errors, wrong/foreign/valid checkout signatures, webhook signatures and tampering, repeated and simultaneous deliveries, late events, unknown and foreign subscriptions, failed charge, grace period and recovery, price change, second plan raising the limits, cancel at period end and the end of the period (data kept), company set up by hand, reconcile, operator commands, isolation of the other company.
- Pure rule tests (state derivation, update ordering, signatures) in `npm run test:unit`.
- Real built app: webhook rejects unsigned and wrongly signed calls, accepts a signed one, acknowledges a repeat; reconcile needs its secret; the Plan page needs a sign-in.
- Not yet tested: Razorpay's real servers and real checkout window (needs your test keys).

## 8. Not built yet

Invoices/receipts emailed for each payment (Razorpay emails its own receipts), undoing a "stop at period end", switching between monthly and yearly, taxes/GST invoices from this app, refunds (done in the Razorpay dashboard), a master-admin screen for all of this, and an alert email when a payment fails (Razorpay notifies the customer).
