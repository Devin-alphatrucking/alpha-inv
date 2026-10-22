// Database-backed tests of the Razorpay billing step (Phase 5), against a FAKE Razorpay server. Run through `npm run test:isolation`.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const ownerUrl = process.env.TEST_OWNER_DATABASE_URL;
const emailFile = process.env.EMAIL_FILE;
if (!ownerUrl || !emailFile || !process.env.DATABASE_URL) {
  console.error("Run this through `npm run test:isolation`.");
  process.exit(2);
}
const require = createRequire(import.meta.url);
const { Client } = require("pg") as typeof import("pg");
const repoRoot = path.resolve(process.cwd(), "../..");

let passed = 0;
let failed = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed++;
    console.log(`FAIL  ${name}\n      ${(error as Error).message.split("\n").slice(0, 4).join("\n      ")}`);
  }
}
async function rejects(promise: Promise<unknown>, match?: RegExp) {
  let error: unknown = null;
  try {
    await promise;
  } catch (e) {
    error = e;
  }
  assert.ok(error, "expected the call to fail, but it succeeded");
  if (match) assert.match(String((error as Error).message), match);
  return error as Error & { code?: string };
}

const mails = () => (fs.existsSync(emailFile!) ? fs.readFileSync(emailFile!, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { to: string; subject: string; text: string }) : []);
let ipCounter = 150;
const ip = () => `198.51.100.${++ipCounter}`;
const nowSec = () => Math.floor(Date.now() / 1000);

// ---------------------------------------------------------------- fake Razorpay
type FakeSub = { id: string; plan_id: string; status: string; current_start: number | null; current_end: number | null; paid_count: number; total_count: number; short_url: string; ended_at: number | null; charge_at: number | null };
const fake = {
  plans: [] as { id: string; amount: number }[],
  subs: new Map<string, FakeSub>(),
  calls: [] as string[],
  auths: new Set<string>(),
  failNext: false,
};
const fakeServer = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    fake.calls.push(`${req.method} ${req.url}`);
    fake.auths.add(String(req.headers.authorization));
    const send = (code: number, obj: unknown) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    if (fake.failNext) {
      fake.failNext = false;
      return send(400, { error: { code: "BAD_REQUEST_ERROR", description: "internal provider wording that must not reach customers" } });
    }
    const json = body ? JSON.parse(body) : {};
    const url = req.url ?? "";
    if (req.method === "POST" && url === "/plans") {
      const plan = { id: `plan_${fake.plans.length + 1}`, amount: json.item.amount };
      fake.plans.push(plan);
      return send(200, { id: plan.id, interval: 1, period: json.period, item: json.item });
    }
    if (req.method === "POST" && url === "/subscriptions") {
      const s: FakeSub = { id: `sub_${fake.subs.size + 1}`, plan_id: json.plan_id, status: "created", current_start: null, current_end: null, paid_count: 0, total_count: json.total_count, short_url: `https://rzp.test/i/${fake.subs.size + 1}`, ended_at: null, charge_at: null };
      fake.subs.set(s.id, s);
      return send(200, s);
    }
    const m = /^\/subscriptions\/([^/]+)(\/cancel)?$/.exec(url);
    if (m && fake.subs.has(m[1])) {
      const s = fake.subs.get(m[1])!;
      if (req.method === "GET") return send(200, s);
      if (req.method === "POST" && m[2]) {
        // cancel at cycle end keeps it active until then; otherwise it ends now
        if (!json.cancel_at_cycle_end) {
          s.status = "cancelled";
          s.ended_at = nowSec();
        }
        return send(200, s);
      }
    }
    send(404, { error: { description: "not found" } });
  });
});

async function main() {
  await new Promise<void>((r) => fakeServer.listen(0, "127.0.0.1", r));
  const port = (fakeServer.address() as { port: number }).port;

  const { signUp } = await import("@/lib/flows/signup");
  const { confirmEmail } = await import("@/lib/flows/verify-reset");
  const svc = await import("@/lib/billing/service");
  const { handleRazorpayWebhook } = await import("@/lib/billing/webhook");
  const { signWebhook } = await import("@/lib/billing/signature");
  const ent = await import("@/lib/plans/entitlements");
  const { dbFor } = await import("@/lib/org/scoped-db");

  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows as T[];

  const PW = "correct horse battery staple";
  const makeCompany = async (name: string, email: string) => {
    assert.ok((await signUp({ companyName: name, name: `${name} Admin`, email, password: PW, country: "IN", acceptTerms: true }, { ip: ip() })).ok);
    const found = mails().filter((m) => m.to === email && m.subject.includes("Confirm your email"));
    assert.ok((await confirmEmail(/token=([A-Za-z0-9_-]+)/.exec(found[found.length - 1].text)![1])).ok);
    const [org] = await q<{ id: string; slug: string }>(`SELECT o.id, o.slug FROM "Organization" o JOIN "Membership" m ON m."organizationId"=o.id JOIN "User" u ON u.id=m."userId" WHERE u.email=$1`, [email]);
    const [user] = await q<{ id: string }>(`SELECT id FROM "User" WHERE email=$1`, [email]);
    return { orgId: org.id, slug: org.slug, user: { id: user.id, orgId: org.id, name: `${name} Admin`, email } };
  };
  const addProject = (orgId: string, name: string) =>
    dbFor(orgId).$transaction(async (tx) => {
      await ent.assertCanAddProject(tx, orgId);
      return tx.project.create({ data: { organizationId: orgId, name } });
    });
  const sub = async (orgId: string) => (await q<{ quantity: number; status: string; billing: string; extraQuantity: number; cancelAtPeriodEnd: boolean; graceEndsAt: Date | null; currentPeriodEnd: Date | null }>(`SELECT quantity, status, billing, "extraQuantity", "cancelAtPeriodEnd", ("graceEndsAt" AT TIME ZONE 'UTC') AS "graceEndsAt", ("currentPeriodEnd" AT TIME ZONE 'UTC') AS "currentPeriodEnd" FROM "Subscription" WHERE "organizationId"=$1`, [orgId]))[0];
  const purchaseOf = async (providerId: string) => (await q<{ id: string; status: string; paidCount: number; cancelAtCycleEnd: boolean; pastDueSince: Date | null; organizationId: string }>(`SELECT * FROM "BillingPurchase" WHERE "providerSubscriptionId"=$1`, [providerId]))[0];
  const count = async (sql: string, params: unknown[] = []) => Number((await q<{ n: string }>(sql, params))[0].n);

  // webhook helper: signs like Razorpay does
  const WH = "whsec_test_secret";
  const KEY = "rzp_test_key";
  const SECRET = "rzp_test_secret_value";
  let evCounter = 0;
  const event = async (type: string, s: Partial<FakeSub> & { id: string }, o: { at?: number; id?: string; pay?: Record<string, unknown>; tamper?: boolean; secret?: string } = {}) => {
    const body = JSON.stringify({ event: type, created_at: o.at ?? nowSec() + 1, payload: { subscription: { entity: s }, ...(o.pay ? { payment: { entity: o.pay } } : {}) } });
    const sig = signWebhook(body, o.secret ?? WH);
    return handleRazorpayWebhook(o.tamper ? body.replace('"event"', '"event "') : body, sig, o.id ?? `evt_${++evCounter}`);
  };
  const payment = (id: string, amount: number) => ({ id, amount, currency: "INR", status: "captured", method: "upi", created_at: nowSec(), email: "buyer@example.com", contact: "+910000000000" });

  const acme = await makeCompany("Acme Billing", "admin@acme-billing.test");
  const other = await makeCompany("Other Billing", "admin@other-billing.test");
  const legacy = await makeCompany("Legacy Billing", "admin@legacy-billing.test");
  await q(`UPDATE "Subscription" SET status='ACTIVE', quantity=3, "trialEndsAt"=NULL WHERE "organizationId"=$1`, [legacy.orgId]);

  // ---------------------------------------------------------- setup and checkout
  await check("payments switched off: starting a purchase gives a clear message and creates nothing", async () => {
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    await rejects(svc.startPurchase(acme.user), /not set up yet/);
    assert.equal(await count(`SELECT count(*) n FROM "BillingPurchase"`), 0);
    const s = await svc.getBillingSummary(acme.orgId);
    assert.deepEqual([s.enabled, s.purchasable], [false, false]);
  });

  process.env.RAZORPAY_KEY_ID = KEY;
  process.env.RAZORPAY_KEY_SECRET = SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = WH;
  process.env.RAZORPAY_BASE_URL = `http://127.0.0.1:${port}`;

  await check("no price set: refuses, and never calls the provider", async () => {
    const before = fake.calls.length;
    await rejects(svc.startPurchase(acme.user), /Pricing .* not been set/);
    assert.equal(fake.calls.length, before);
  });

  await check("price set: first purchase creates ONE provider plan and ONE subscription, authenticated with the key", async () => {
    await q(`UPDATE "Plan" SET "priceMinor"=99900, currency='INR' WHERE code='PROJECT'`);
    const c = await svc.startPurchase(acme.user);
    assert.equal(c.keyId, KEY);
    assert.equal(c.amountMinor, 99900);
    assert.equal(c.subscriptionId, "sub_1");
    assert.equal(fake.plans.length, 1);
    assert.equal(fake.plans[0].amount, 99900);
    assert.ok([...fake.auths].every((a) => a === `Basic ${Buffer.from(`${KEY}:${SECRET}`).toString("base64")}`));
    const p = await purchaseOf("sub_1");
    assert.equal(p.status, "created");
    assert.equal(p.organizationId, acme.orgId);
    assert.equal((await sub(acme.orgId)).billing, "MANUAL", "an unfinished checkout changes nothing");
    assert.equal(await count(`SELECT count(*) n FROM "ActivityLog" WHERE action='BILLING_STARTED' AND "organizationId"=$1`, [acme.orgId]), 1);
  });

  await check("a double click or a closed window reuses the unfinished checkout", async () => {
    const again = await svc.startPurchase(acme.user);
    assert.equal(again.subscriptionId, "sub_1");
    assert.equal(fake.subs.size, 1);
    assert.equal(fake.plans.length, 1, "the provider plan is reused while the price is unchanged");
  });

  await check("a provider error is logged for operators and shown to the customer in neutral words", async () => {
    fake.failNext = true;
    await q(`UPDATE "BillingPurchase" SET status='cancelled' WHERE "providerSubscriptionId"='sub_1'`); // so a new one is attempted
    const e = await rejects(svc.startPurchase(acme.user), /payment service refused/);
    assert.ok(!/internal provider wording/.test(e.message));
    await q(`UPDATE "BillingPurchase" SET status='created' WHERE "providerSubscriptionId"='sub_1'`);
  });

  await check("checkout return: a wrong signature is refused and changes nothing", async () => {
    const s = fake.subs.get("sub_1")!;
    s.status = "active";
    s.current_start = nowSec();
    s.current_end = nowSec() + 30 * 86400;
    s.paid_count = 1;
    await rejects(svc.confirmCheckout(acme.user, { paymentId: "pay_1", subscriptionId: "sub_1", signature: "00".repeat(32) }), /could not confirm/);
    assert.equal((await purchaseOf("sub_1")).status, "created");
    assert.equal((await sub(acme.orgId)).billing, "MANUAL");
  });

  await check("checkout return: another company cannot confirm this purchase", async () => {
    const sig = createHmac("sha256", SECRET).update("pay_1|sub_1").digest("hex");
    await rejects(svc.confirmCheckout(other.user, { paymentId: "pay_1", subscriptionId: "sub_1", signature: sig }), /not found for your company/);
    assert.equal((await purchaseOf("sub_1")).status, "created");
  });

  await check("checkout return: a valid signature reads the provider, activates the plan and turns billing on", async () => {
    const sig = createHmac("sha256", SECRET).update("pay_1|sub_1").digest("hex");
    const r = await svc.confirmCheckout(acme.user, { paymentId: "pay_1", subscriptionId: "sub_1", signature: sig });
    assert.equal(r.status, "active");
    const p = await purchaseOf("sub_1");
    assert.deepEqual([p.status, p.paidCount], ["active", 1]);
    const s = await sub(acme.orgId);
    assert.deepEqual([s.billing, s.quantity, s.status, s.extraQuantity, s.cancelAtPeriodEnd], ["RAZORPAY", 1, "ACTIVE", 0, false]);
    assert.ok(s.currentPeriodEnd && s.currentPeriodEnd > new Date());
    const e = await ent.getEntitlements(acme.orgId);
    assert.deepEqual([e.state, e.limits.projects, e.limits.users], ["active", 1, 5]);
  });

  // ---------------------------------------------------------- webhook
  await check("webhook: wrong signature, tampered body, or no secret are all refused and recorded nowhere", async () => {
    const before = await count(`SELECT count(*) n FROM "BillingEvent"`);
    assert.equal((await event("subscription.charged", { id: "sub_1" }, { secret: "wrong" })).status, 400);
    assert.equal((await event("subscription.charged", { id: "sub_1" }, { tamper: true })).status, 400);
    assert.equal((await handleRazorpayWebhook("{}", null, "x")).status, 400);
    assert.equal(await count(`SELECT count(*) n FROM "BillingEvent"`), before);
    const keep = process.env.RAZORPAY_WEBHOOK_SECRET;
    process.env.RAZORPAY_WEBHOOK_SECRET = "";
    assert.equal((await event("subscription.charged", { id: "sub_1" })).status, 503);
    process.env.RAZORPAY_WEBHOOK_SECRET = keep;
  });

  await check("webhook: subscription.charged is applied, the payment is recorded without the customer's contact details", async () => {
    const r = await event("subscription.charged", { id: "sub_1", plan_id: "plan_1", status: "active", paid_count: 2, current_end: nowSec() + 60 * 86400 }, { id: "evt_charge_1", pay: payment("pay_2", 99900) });
    assert.equal(r.status, 200);
    assert.equal(r.body.message, "Processed.");
    assert.equal((await purchaseOf("sub_1")).paidCount, 2);
    assert.equal(await count(`SELECT count(*) n FROM "BillingPayment" WHERE "providerPaymentId"='pay_2' AND "organizationId"=$1`, [acme.orgId]), 1);
    const [ev] = await q<{ payload: unknown; outcome: string; organizationId: string }>(`SELECT payload, outcome, "organizationId" FROM "BillingEvent" WHERE "eventId"='evt_charge_1'`);
    assert.equal(ev.outcome, "processed");
    assert.equal(ev.organizationId, acme.orgId);
    assert.ok(!/buyer@example.com|\+910000000000/.test(JSON.stringify(ev.payload)), "no personal contact details are stored");
  });

  await check("webhook: the same event delivered again, even 6 times at once, changes nothing and records one payment", async () => {
    const burst = await Promise.all(Array.from({ length: 6 }, () => event("subscription.charged", { id: "sub_1", plan_id: "plan_1", status: "active", paid_count: 3 }, { id: "evt_charge_2", at: nowSec() + 10, pay: payment("pay_3", 99900) })));
    assert.ok(burst.every((r) => r.status === 200), JSON.stringify(burst.map((r) => r.status)));
    assert.equal(await count(`SELECT count(*) n FROM "BillingPayment" WHERE "providerPaymentId"='pay_3'`), 1);
    assert.equal(await count(`SELECT count(*) n FROM "BillingEvent" WHERE "eventId"='evt_charge_2'`), 1);
    const again = await event("subscription.charged", { id: "sub_1", status: "active" }, { id: "evt_charge_2" });
    assert.equal(again.body.message, "Already received.");
    assert.equal((await purchaseOf("sub_1")).paidCount, 3);
  });

  await check("webhook: an older event arriving late is ignored and cannot undo newer state", async () => {
    const r = await event("subscription.authenticated", { id: "sub_1", plan_id: "plan_1", status: "authenticated" }, { at: nowSec() - 3600 });
    assert.equal(r.body.message, "Ignored.");
    assert.equal((await purchaseOf("sub_1")).status, "active");
  });

  await check("webhook: unknown subscription, other plan, and non-subscription events are acknowledged and ignored", async () => {
    assert.equal((await event("subscription.activated", { id: "sub_999", status: "active" })).body.message, "Ignored.");
    assert.equal((await event("subscription.halted", { id: "sub_1", plan_id: "plan_other", status: "halted" })).body.message, "Ignored.");
    assert.equal((await event("payment.failed", { id: "sub_1" })).body.message, "Ignored.");
    assert.equal((await purchaseOf("sub_1")).status, "active");
  });

  await check("webhook: a failed charge starts the grace period and growth keeps working inside it", async () => {
    const at = nowSec() + 100;
    assert.equal((await event("subscription.pending", { id: "sub_1", plan_id: "plan_1", status: "pending" }, { at })).status, 200);
    const s = await sub(acme.orgId);
    assert.equal(s.status, "PAST_DUE");
    assert.equal(s.quantity, 1, "limits do not shrink for a late payment");
    assert.equal(+s.graceEndsAt!, (at + 7 * 86400) * 1000);
    const e = await ent.getEntitlements(acme.orgId);
    assert.equal(e.state, "past_due_grace");
    await check_growth_allowed(acme.orgId);
  });
  async function check_growth_allowed(orgId: string) {
    await ent.assertCanUpload(orgId); // does not throw inside the grace period
  }

  await check("webhook: the first failure time is kept when it fails again (halted); after the grace period adding things is paused, viewing is not", async () => {
    await event("subscription.halted", { id: "sub_1", plan_id: "plan_1", status: "halted" }, { at: nowSec() + 200 });
    // move the first failure into the past so the 7 days are over
    await q(`UPDATE "BillingPurchase" SET "pastDueSince" = (now() AT TIME ZONE 'UTC') - interval '9 days' WHERE "providerSubscriptionId"='sub_1'`);
    await event("subscription.halted", { id: "sub_1", plan_id: "plan_1", status: "halted" }, { at: nowSec() + 300 });
    const e = await ent.getEntitlements(acme.orgId);
    assert.equal(e.state, "past_due");
    assert.equal(e.limits.projects, 1, "the plan is still the company's");
    await rejects(ent.assertCanUpload(acme.orgId), /grace period has ended/);
    const rows = await dbFor(acme.orgId).project.findMany();
    assert.ok(Array.isArray(rows), "existing data stays readable");
  });

  await check("webhook: paying again recovers everything on its own", async () => {
    await event("subscription.charged", { id: "sub_1", plan_id: "plan_1", status: "active", paid_count: 4, current_end: nowSec() + 90 * 86400 }, { at: nowSec() + 400, pay: payment("pay_4", 99900) });
    const s = await sub(acme.orgId);
    assert.deepEqual([s.status, s.graceEndsAt], ["ACTIVE", null]);
    assert.equal((await ent.getEntitlements(acme.orgId)).state, "active");
    assert.equal((await purchaseOf("sub_1")).pastDueSince, null);
    await ent.assertCanUpload(acme.orgId);
  });

  // ---------------------------------------------------------- more plans, price change
  await check("a price change makes a NEW provider plan; the second purchase adds a project and users", async () => {
    await q(`UPDATE "Plan" SET "priceMinor"=129900 WHERE code='PROJECT'`);
    const c = await svc.startPurchase(acme.user);
    assert.equal(c.amountMinor, 129900);
    assert.equal(fake.plans.length, 2);
    assert.equal(c.subscriptionId, "sub_2");
    const s2 = fake.subs.get("sub_2")!;
    assert.equal(s2.plan_id, "plan_2");
    Object.assign(s2, { status: "active", current_start: nowSec(), current_end: nowSec() + 30 * 86400, paid_count: 1 });
    await event("subscription.activated", { id: "sub_2", plan_id: "plan_2", status: "active", paid_count: 1, current_end: s2.current_end }, { pay: payment("pay_5", 129900) });
    const s = await sub(acme.orgId);
    assert.deepEqual([s.quantity, s.status], [2, "ACTIVE"]);
    const e = await ent.getEntitlements(acme.orgId);
    assert.deepEqual([e.limits.projects, e.limits.users, e.limits.companyPageCap], [2, 10, 1000]);
    assert.equal((await purchaseOf("sub_1")).paidCount, 4, "the first buyer keeps the price they agreed to");
    const have = await count(`SELECT count(*) n FROM "Project" WHERE "organizationId"=$1 AND status='ACTIVE'`, [acme.orgId]);
    assert.ok(have <= 1, "sign-up creates at most one starter project");
    for (let i = have; i < 2; i++) await addProject(acme.orgId, `Project ${i}`);
    await rejects(addProject(acme.orgId, "One too many"), /includes 2 projects/);
  });

  await check("the Plan screen data shows both plans and the payments, newest first", async () => {
    const b = await svc.getBillingSummary(acme.orgId);
    assert.equal(b.purchases.length, 2);
    assert.ok(b.payments.length >= 4);
    assert.equal(b.managedByProvider, true);
    assert.equal(b.purchasable, true);
  });

  // ---------------------------------------------------------- cancel
  await check("cancelling a running plan keeps it until the paid period ends", async () => {
    const p1 = await purchaseOf("sub_1");
    const r = await svc.cancelPurchase(acme.user, p1.id);
    assert.equal(r.atCycleEnd, true);
    assert.equal((await purchaseOf("sub_1")).cancelAtCycleEnd, true);
    const s = await sub(acme.orgId);
    assert.deepEqual([s.quantity, s.status, s.cancelAtPeriodEnd], [2, "ACTIVE", false], "one plan still renews");
    await rejects(svc.cancelPurchase(acme.user, p1.id), /already set to end/);
    await rejects(svc.cancelPurchase(other.user, p1.id), /not found/);
  });

  await check("both cancelled at period end: company shows 'ends soon'; after the period it ends, nothing is deleted", async () => {
    const p2 = await purchaseOf("sub_2");
    await svc.cancelPurchase(acme.user, p2.id);
    let s = await sub(acme.orgId);
    assert.deepEqual([s.cancelAtPeriodEnd, s.status], [true, "ACTIVE"]);
    // provider ends sub_1 now (its paid period is over) and sub_2 a week from now
    await event("subscription.cancelled", { id: "sub_1", plan_id: "plan_1", status: "cancelled", current_end: nowSec() - 60, ended_at: nowSec() - 60 }, { at: nowSec() + 500 });
    await event("subscription.cancelled", { id: "sub_2", plan_id: "plan_2", status: "cancelled", current_end: nowSec() + 7 * 86400 }, { at: nowSec() + 500 });
    s = await sub(acme.orgId);
    assert.deepEqual([s.status, s.quantity, s.cancelAtPeriodEnd], ["CANCELED", 1, true]);
    assert.equal((await ent.getEntitlements(acme.orgId)).state, "canceling");
    await ent.assertCanUpload(acme.orgId);
    await event("subscription.cancelled", { id: "sub_2", plan_id: "plan_2", status: "cancelled", current_end: nowSec() - 5 }, { at: nowSec() + 600 });
    const e = await ent.getEntitlements(acme.orgId);
    assert.equal(e.state, "canceled");
    assert.equal(e.limits.projects, 0);
    await rejects(ent.assertCanUpload(acme.orgId), /has ended/);
    assert.equal((await dbFor(acme.orgId).project.findMany()).length, 2, "data is never deleted for non-payment");
  });

  await check("an unfinished purchase cancels at once, and a completed checkout can be restarted later", async () => {
    const c = await svc.startPurchase(acme.user);
    const p = await purchaseOf(c.subscriptionId);
    assert.equal(p.status, "created");
    const r = await svc.cancelPurchase(acme.user, p.id);
    assert.equal(r.atCycleEnd, false);
    assert.equal((await purchaseOf(c.subscriptionId)).status, "cancelled");
  });

  // ---------------------------------------------------------- legacy company, grants, other company isolation
  await check("a company set up by hand keeps what it had when it makes its first purchase", async () => {
    await svc.startPurchase(legacy.user);
    const subId = `sub_${fake.subs.size}`;
    const fs1 = fake.subs.get(subId)!;
    Object.assign(fs1, { status: "active", current_start: nowSec(), current_end: nowSec() + 30 * 86400, paid_count: 1 });
    await event("subscription.activated", { id: subId, plan_id: fs1.plan_id, status: "active", paid_count: 1, current_end: fs1.current_end }, { pay: payment("pay_leg", 129900) });
    const s = await sub(legacy.orgId);
    assert.deepEqual([s.billing, s.extraQuantity, s.quantity, s.status], ["RAZORPAY", 3, 4, "ACTIVE"]);
  });

  await check("the other company was never touched by any of this", async () => {
    const s = await sub(other.orgId);
    assert.equal(s.billing, "MANUAL");
    assert.equal(await count(`SELECT count(*) n FROM "BillingPurchase" WHERE "organizationId"=$1`, [other.orgId]), 0);
    assert.equal(await count(`SELECT count(*) n FROM "BillingPayment" WHERE "organizationId"=$1`, [other.orgId]), 0);
    assert.equal((await ent.getEntitlements(other.orgId)).state, "trial");
  });

  await check("reconcile repairs a missed webhook by reading the provider", async () => {
    const subId = `sub_${fake.subs.size}`;
    fake.subs.get(subId)!.status = "halted"; // the provider says halted, we never heard
    const r = await svc.reconcile(legacy.orgId);
    assert.ok(r.checked >= 1 && r.changed >= 1, JSON.stringify(r));
    assert.equal((await purchaseOf(subId)).status, "halted");
    assert.equal((await sub(legacy.orgId)).status, "PAST_DUE");
    fake.subs.get(subId)!.status = "active";
    await svc.reconcile(legacy.orgId);
    assert.equal((await sub(legacy.orgId)).status, "ACTIVE");
  });

  // ---------------------------------------------------------- operator commands
  const cli = (script: string, args: string[]) =>
    spawnSync("npx", ["tsx", `scripts/${script}`, ...args], { cwd: path.join(repoRoot, "packages", "db"), env: { ...process.env, DATABASE_URL: ownerUrl, MIGRATE_DATABASE_URL: ownerUrl }, shell: true, encoding: "utf8" });

  await check("operator: billing status and events; grants add free project plans; hand edits of a paying company are refused", async () => {
    const st = cli("billing-cli.ts", ["status", legacy.slug]);
    assert.equal(st.status, 0, st.stdout + st.stderr);
    assert.match(st.stdout, /Billing mode RAZORPAY/);
    assert.match(st.stdout, /\(matches\)/);
    const ev = cli("billing-cli.ts", ["events", "--limit", "5"]);
    assert.equal(ev.status, 0, ev.stderr);
    assert.match(ev.stdout, /subscription\./);
    const grant = cli("billing-cli.ts", ["grant", legacy.slug, "5", "--reason", "partner deal"]);
    assert.equal(grant.status, 0, grant.stdout + grant.stderr);
    assert.deepEqual((({ extraQuantity, quantity }) => [extraQuantity, quantity])(await sub(legacy.orgId)), [5, 6]);
    assert.notEqual(cli("billing-cli.ts", ["grant", legacy.slug, "-1"]).status, 0);
    assert.notEqual(cli("billing-cli.ts", ["grant", other.slug, "2"]).status, 0, "grants need billing to be on for that company");
    const hand = cli("plans-cli.ts", ["set", legacy.slug, "--quantity", "9"]);
    assert.notEqual(hand.status, 0);
    assert.match(hand.stderr + hand.stdout, /billing -- grant/);
    assert.equal(cli("plans-cli.ts", ["set", other.slug, "--quantity", "2", "--status", "ACTIVE"]).status, 0, "a hand-managed company can still be edited");
    assert.equal(await count(`SELECT count(*) n FROM "ActivityLog" WHERE action='BILLING_CHANGED' AND "organizationId"=$1`, [legacy.orgId]), 1);
  });

  await owner.end();
  fakeServer.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
