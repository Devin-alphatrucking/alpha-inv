// Run with: npm run test:unit (from the repo root)
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { applyProviderUpdate, derive, formatMoney, purchaseKind, type PurchaseInput, type PurchaseState } from "./rules";
import { signWebhook, verifyCheckoutSignature, verifyWebhookSignature } from "./signature";

const now = new Date("2026-11-01T12:00:00Z");
const day = 86_400_000;
const P = (o: Partial<PurchaseInput> = {}): PurchaseInput => ({ status: "active", currentEnd: new Date(+now + 20 * day), cancelAtCycleEnd: false, pastDueSince: null, ...o });
const ctx = (o: Partial<Parameters<typeof derive>[1]> = {}) => ({ extraQuantity: 0, trialEndsAt: null, graceDays: 7, now, ...o });

// ---- derive: quantity and status come from the purchases
let d = derive([P(), P()], ctx());
assert.deepEqual([d.quantity, d.status, d.graceEndsAt, d.cancelAtPeriodEnd], [2, "ACTIVE", null, false]);
assert.equal(+d.currentPeriodEnd!, +now + 20 * day);

d = derive([P(), P({ status: "created" })], ctx());
assert.equal(d.quantity, 1, "an unfinished checkout adds nothing");

d = derive([P(), P()], ctx({ extraQuantity: 1 }));
assert.equal(d.quantity, 3, "operator grants add to purchases");

// a trial turns into a paid plan the moment a purchase is active
d = derive([P()], ctx({ trialEndsAt: new Date(+now + 5 * day) }));
assert.deepEqual([d.quantity, d.status], [1, "ACTIVE"]);
d = derive([], ctx({ trialEndsAt: new Date(+now + 5 * day) }));
assert.deepEqual([d.quantity, d.status], [0, "TRIALING"]);
d = derive([P({ status: "created" })], ctx({ trialEndsAt: new Date(+now + 5 * day) }));
assert.equal(d.status, "TRIALING");
// trial over and nothing bought stays TRIALING (planState reads the old end date as trial_expired)
d = derive([], ctx({ trialEndsAt: new Date(+now - day) }));
assert.equal(d.status, "TRIALING");

// payment fails: past due, grace counts from the FIRST failure
const since = new Date(+now - 2 * day);
d = derive([P(), P({ status: "pending", pastDueSince: since })], ctx());
assert.equal(d.status, "PAST_DUE");
assert.equal(d.quantity, 2, "limits never shrink because a payment is late");
assert.equal(+d.graceEndsAt!, +since + 7 * day);
d = derive([P({ status: "pending", pastDueSince: new Date(+now - 1 * day) }), P({ status: "halted", pastDueSince: since })], ctx());
assert.equal(+d.graceEndsAt!, +since + 7 * day, "earliest failure wins");
d = derive([P({ status: "halted", pastDueSince: new Date(+now - 30 * day) })], ctx());
assert.equal(d.status, "PAST_DUE");
assert.ok(d.graceEndsAt! < now, "grace is over");
d = derive([P({ status: "paused" })], ctx());
assert.equal(d.status, "PAST_DUE");
d = derive([P({ status: "pending", pastDueSince: null })], ctx({ graceDays: 3 }));
assert.equal(+d.graceEndsAt!, +now + 3 * day, "a missing failure time starts the grace now, never an instant block");

// recovery: no overdue purchase left
d = derive([P({ status: "active", pastDueSince: null })], ctx());
assert.equal(d.status, "ACTIVE");

// cancel at the end of the cycle
d = derive([P({ cancelAtCycleEnd: true })], ctx());
assert.deepEqual([d.status, d.cancelAtPeriodEnd, d.quantity], ["ACTIVE", true, 1]);
d = derive([P({ cancelAtCycleEnd: true }), P()], ctx());
assert.equal(d.cancelAtPeriodEnd, false, "one running plan still renews");
d = derive([P({ cancelAtCycleEnd: true })], ctx({ extraQuantity: 1 }));
assert.equal(d.cancelAtPeriodEnd, false);
// cancelled with time left, then over
d = derive([P({ status: "cancelled", currentEnd: new Date(+now + 3 * day) })], ctx());
assert.deepEqual([d.status, d.quantity, d.cancelAtPeriodEnd], ["CANCELED", 1, true]);
assert.equal(+d.currentPeriodEnd!, +now + 3 * day);
d = derive([P({ status: "cancelled", currentEnd: new Date(+now - day) })], ctx());
assert.deepEqual([d.status, d.quantity], ["CANCELED", 0]);
assert.equal(+d.currentPeriodEnd!, +now - day);
d = derive([P({ status: "expired", currentEnd: new Date(+now + 3 * day) })], ctx());
assert.equal(d.quantity, 0, "an expired subscription holds nothing, even with a future date");
d = derive([P({ status: "completed" })], ctx());
assert.equal(d.quantity, 0);
// one cancelled, one live
d = derive([P({ status: "cancelled", currentEnd: new Date(+now + 3 * day) }), P()], ctx());
assert.deepEqual([d.status, d.quantity], ["ACTIVE", 2]);
// the trial does not start over after a company has paid and stopped
d = derive([P({ status: "cancelled", currentEnd: new Date(+now - day) })], ctx({ trialEndsAt: new Date(+now + 5 * day) }));
assert.equal(d.status, "CANCELED");
// ...but cancelling a checkout that was never paid leaves the trial alone
d = derive([P({ status: "cancelled", paidCount: 0, currentEnd: null })], ctx({ trialEndsAt: new Date(+now + 5 * day) }));
assert.deepEqual([d.status, d.quantity], ["TRIALING", 0]);
// nothing at all
d = derive([], ctx());
assert.deepEqual([d.quantity, d.status], [0, "TRIALING"]);
assert.equal(purchaseKind(P({ status: "weird" }), now), "unpaid");

// ---- applyProviderUpdate
const base: PurchaseState = { status: "created", paidCount: 0, currentStart: null, currentEnd: null, chargeAt: null, endedAt: null, cancelAtCycleEnd: false, pastDueSince: null, shortUrl: "https://rzp.io/i/x", lastEventAt: null };
const t = (n: number) => new Date(Date.UTC(2026, 10, 1, 0, 0, n));
const ts = (n: number) => Math.floor(+t(n) / 1000);

const s = applyProviderUpdate(base, { id: "sub_1", status: "active", current_start: ts(0), current_end: ts(1000), paid_count: 1 }, t(5))!;
assert.equal(s.status, "active");
assert.equal(s.paidCount, 1);
assert.equal(+s.currentEnd!, +t(1000));
assert.equal(s.shortUrl, "https://rzp.io/i/x", "missing fields keep their value");
assert.equal(+s.lastEventAt!, +t(5));

assert.equal(applyProviderUpdate(s, { id: "sub_1", status: "created" }, t(4)), null, "a stale event is ignored");
assert.ok(applyProviderUpdate(s, { id: "sub_1", status: "active" }, t(5)), "the same time is applied again (idempotent)");
assert.equal(applyProviderUpdate(s, { id: "sub_1", status: "banana" }, t(9)), null);
assert.equal(applyProviderUpdate(s, { id: "sub_1" }, t(9)), null);
assert.equal(applyProviderUpdate(s, { id: "sub_1", status: "active", paid_count: 0 }, t(9))!.paidCount, 1, "paid count never goes backwards");

let f = applyProviderUpdate(s, { id: "sub_1", status: "pending" }, t(10))!;
assert.equal(+f.pastDueSince!, +t(10));
f = applyProviderUpdate(f, { id: "sub_1", status: "halted" }, t(20))!;
assert.equal(+f.pastDueSince!, +t(10), "grace counts from the FIRST failure");
f = applyProviderUpdate(f, { id: "sub_1", status: "active", paid_count: 2 }, t(30))!;
assert.equal(f.pastDueSince, null);
f = applyProviderUpdate(f, { id: "sub_1", status: "paused" }, t(40))!;
assert.equal(f.pastDueSince, null, "paused is not a failed charge");

// ---- signatures
const body = JSON.stringify({ event: "subscription.charged", payload: { x: 1 } });
const sig = signWebhook(body, "whsec");
assert.equal(sig, createHmac("sha256", "whsec").update(body).digest("hex"));
assert.equal(verifyWebhookSignature(body, sig, "whsec"), true);
assert.equal(verifyWebhookSignature(body, sig.toUpperCase(), "whsec"), true, "hex case does not matter");
assert.equal(verifyWebhookSignature(body + " ", sig, "whsec"), false, "any change to the body breaks it");
assert.equal(verifyWebhookSignature(body, sig, "other"), false);
assert.equal(verifyWebhookSignature(body, null, "whsec"), false);
assert.equal(verifyWebhookSignature(body, "", "whsec"), false);
assert.equal(verifyWebhookSignature(body, sig.slice(2), "whsec"), false, "wrong length");
assert.equal(verifyWebhookSignature(body, sig, ""), false, "no secret configured means nothing is trusted");

const cs = createHmac("sha256", "keysecret").update("pay_1|sub_1").digest("hex");
assert.equal(verifyCheckoutSignature("pay_1", "sub_1", cs, "keysecret"), true);
assert.equal(verifyCheckoutSignature("pay_2", "sub_1", cs, "keysecret"), false);
assert.equal(verifyCheckoutSignature("pay_1", "sub_2", cs, "keysecret"), false);
assert.equal(verifyCheckoutSignature("pay_1", "sub_1", cs, ""), false);

// ---- helpers
assert.match(formatMoney(99900, "INR"), /999/);

console.log("billing rules: all checks passed");
