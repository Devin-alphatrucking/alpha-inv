import { rawDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { logActivity } from "@/lib/activity";
import { hitAll, limitKey, retryMessage } from "@/lib/security/rate-limit";
import {
  applyProviderUpdate,
  derive,
  graceDays,
  purchaseKind,
  totalCountFor,
  type ProviderSubscription,
  type PurchaseState,
} from "./rules";
import { cancelSubscription, createPlan, createSubscription, fetchSubscription, razorpayConfig } from "./razorpay";
import { verifyCheckoutSignature } from "./signature";
import { clearLockCache } from "@/lib/plans/lock";

/**
 * Billing service. Razorpay is the source of truth for money; this code keeps the company's Subscription row
 * (quantity, status, grace, period) in step by RE-DERIVING it from the company's purchases after every change,
 * under a per-company lock. So a repeated or out-of-order event can never leave it wrong.
 *
 * Billing tables are not Row-Level-Security tables (webhooks arrive with no company), so every query here filters by company explicitly.
 */

type Tx = Parameters<Parameters<typeof rawDb.$transaction>[0]>[0];

const DEFAULT_PLAN = "PROJECT";
const UNFINISHED_REUSE_MS = 24 * 3_600_000;

async function lockBilling(tx: Tx, orgId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"billing:" + orgId}))`;
}

/** Runs `fn` inside a transaction holding the company's billing lock (the same one webhooks take). */
export function withBillingLock<T>(orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return rawDb.$transaction(async (tx) => {
    await lockBilling(tx, orgId);
    return fn(tx);
  });
}

/** Recomputes quantity/status/grace/period of the company's Subscription from its purchases. Call inside the billing lock. */
export async function recomputeSubscription(tx: Tx, orgId: string, now: Date = new Date()) {
  const sub = await tx.subscription.findUnique({ where: { organizationId: orgId } });
  if (!sub) return null;
  const purchases = await tx.billingPurchase.findMany({
    where: { organizationId: orgId },
    select: { status: true, currentEnd: true, cancelAtCycleEnd: true, pastDueSince: true, paidCount: true },
  });
  const live = purchases.some((p) => purchaseKind(p, now) !== "unpaid");

  let extraQuantity = sub.extraQuantity;
  if (sub.billing !== "RAZORPAY") {
    // Nothing paid for yet: leave an operator-managed company alone.
    if (!live) return sub;
    // First real purchase: what an operator had set by hand is kept as free project plans, so nobody loses what they had.
    extraQuantity = sub.status === "ACTIVE" ? sub.quantity : 0;
  }

  const d = derive(purchases, { extraQuantity, trialEndsAt: sub.trialEndsAt, graceDays: graceDays(), now });
  clearLockCache(orgId); // the plan may have just become active (or ended): show it at once
  return tx.subscription.update({
    where: { organizationId: orgId },
    data: {
      billing: "RAZORPAY",
      provider: "razorpay",
      extraQuantity,
      quantity: d.quantity,
      status: d.status,
      currentPeriodEnd: d.currentPeriodEnd,
      graceEndsAt: d.graceEndsAt,
      cancelAtPeriodEnd: d.cancelAtPeriodEnd,
    },
  });
}

const stateOf = (p: {
  status: string; paidCount: number; currentStart: Date | null; currentEnd: Date | null; chargeAt: Date | null;
  endedAt: Date | null; cancelAtCycleEnd: boolean; pastDueSince: Date | null; shortUrl: string | null; lastEventAt: Date | null;
}): PurchaseState => ({
  status: p.status, paidCount: p.paidCount, currentStart: p.currentStart, currentEnd: p.currentEnd, chargeAt: p.chargeAt,
  endedAt: p.endedAt, cancelAtCycleEnd: p.cancelAtCycleEnd, pastDueSince: p.pastDueSince, shortUrl: p.shortUrl, lastEventAt: p.lastEventAt,
});

export type ProviderPayment = { id: string; amount?: number; currency?: string; status?: string; method?: string; created_at?: number };

export type ApplyResult = { outcome: "applied" | "stale" | "unknown"; orgId?: string };

/**
 * Applies a provider subscription update (a webhook, a checkout return, a reconcile) to the matching purchase,
 * records the payment if one came with it, and recomputes the company's subscription. Safe to repeat.
 */
export async function applySubscriptionUpdate(
  entity: ProviderSubscription,
  eventAt: Date,
  opts: { payment?: ProviderPayment; onlyOrgId?: string; cancelAtCycleEnd?: boolean; pull?: boolean } = {},
): Promise<ApplyResult> {
  const found = await rawDb.billingPurchase.findUnique({ where: { providerSubscriptionId: entity.id }, select: { id: true, organizationId: true, providerPlanId: true } });
  if (!found || (opts.onlyOrgId && found.organizationId !== opts.onlyOrgId)) return { outcome: "unknown" };
  // An update that names a different plan than the one we sold is not ours to apply.
  if (entity.plan_id && entity.plan_id !== found.providerPlanId) return { outcome: "unknown" };

  return rawDb.$transaction(async (tx) => {
    await lockBilling(tx, found.organizationId);
    const current = await tx.billingPurchase.findUniqueOrThrow({ where: { id: found.id } });
    // A state we just READ from Razorpay is the newest there is, so it is never treated as older than a webhook we already applied.
    const at = opts.pull ? new Date(Math.max(eventAt.getTime(), current.lastEventAt?.getTime() ?? 0)) : eventAt;
    const next = applyProviderUpdate(stateOf(current), entity, at);
    if (next) {
      await tx.billingPurchase.update({
        where: { id: found.id },
        data: { ...next, ...(opts.cancelAtCycleEnd !== undefined ? { cancelAtCycleEnd: opts.cancelAtCycleEnd } : {}) },
      });
    }
    // A payment is a fact, so it is recorded even when the status part of the event is older than what we already know
    // (a checkout return can arrive before the webhook that carries the payment).
    const pay = opts.payment;
    if (pay?.id && pay.status === "captured" && typeof pay.amount === "number") {
      await tx.billingPayment.upsert({
        where: { providerPaymentId: pay.id },
        create: {
          organizationId: found.organizationId,
          purchaseId: found.id,
          providerPaymentId: pay.id,
          amountMinor: pay.amount,
          currency: pay.currency ?? current.currency,
          status: "captured",
          method: pay.method ?? null,
          paidAt: pay.created_at ? new Date(pay.created_at * 1000) : eventAt,
        },
        update: {},
      });
    }
    if (!next) return { outcome: "stale" as const, orgId: found.organizationId };
    await recomputeSubscription(tx, found.organizationId);
    return { outcome: "applied" as const, orgId: found.organizationId };
  });
}

// ---- plan -> Razorpay plan

/** Makes sure the plan exists at Razorpay at its CURRENT price. A price change makes a new provider plan; existing buyers keep theirs. */
export async function ensureProviderPlan(planCode = DEFAULT_PLAN) {
  const plan = await rawDb.plan.findUniqueOrThrow({ where: { code: planCode } });
  if (!plan.active || plan.priceMinor === null || plan.priceMinor < 100) {
    throw new AppError("PAYMENT_001", "Pricing for this plan has not been set yet. Contact support to add a project plan.");
  }
  if (plan.providerPlanId && plan.providerPlanAmount === plan.priceMinor) return plan as typeof plan & { priceMinor: number; providerPlanId: string };
  const created = await createPlan({ name: plan.name, amountMinor: plan.priceMinor, currency: plan.currency, interval: plan.interval === "YEAR" ? "YEAR" : "MONTH" });
  const updated = await rawDb.plan.update({ where: { id: plan.id }, data: { providerPlanId: created.id, providerPlanAmount: plan.priceMinor } });
  return updated as typeof updated & { priceMinor: number; providerPlanId: string };
}

// ---- buying and cancelling

export type BillingUser = { id: string; orgId: string; name?: string | null; email?: string | null };

export type CheckoutStart = {
  purchaseId: string;
  subscriptionId: string;
  keyId: string;
  shortUrl: string | null;
  amountMinor: number;
  currency: string;
  planName: string;
};

/**
 * Starts buying ONE more project plan: creates a Razorpay subscription for it and returns what the checkout window needs.
 * An unfinished checkout from the last day is reused, so a double click or a closed window never creates duplicates.
 */
export async function startPurchase(user: BillingUser): Promise<CheckoutStart> {
  const cfg = razorpayConfig();
  if (!cfg) throw new AppError("PAYMENT_001", "Online payments are not set up yet. Contact support to add a project plan.");
  const limit = await hitAll([
    { key: limitKey("billing:start:user", user.id), limit: 10, windowSeconds: 3600 },
    { key: limitKey("billing:start:org", user.orgId), limit: 30, windowSeconds: 86400 },
  ]);
  if (!limit.allowed) throw new AppError("PAYMENT_001", retryMessage(limit.retryAfterSeconds));

  const sub = await rawDb.subscription.findUnique({ where: { organizationId: user.orgId }, select: { id: true } });
  if (!sub) throw new AppError("PAYMENT_001", "This company has no plan record yet. Contact support.");

  const plan = await ensureProviderPlan();
  const reuse = await rawDb.billingPurchase.findFirst({
    where: { organizationId: user.orgId, status: "created", providerPlanId: plan.providerPlanId, createdAt: { gt: new Date(Date.now() - UNFINISHED_REUSE_MS) } },
    orderBy: { createdAt: "desc" },
  });
  const base = { keyId: cfg.keyId, amountMinor: plan.priceMinor, currency: plan.currency, planName: plan.name };
  if (reuse) return { ...base, purchaseId: reuse.id, subscriptionId: reuse.providerSubscriptionId, shortUrl: reuse.shortUrl, amountMinor: reuse.amountMinor, currency: reuse.currency };

  const totalCount = totalCountFor(plan.interval);
  const remote = await createSubscription({ planId: plan.providerPlanId, totalCount, notes: { organizationId: user.orgId } });
  const row = await rawDb.billingPurchase.create({
    data: {
      organizationId: user.orgId,
      planId: plan.id,
      providerSubscriptionId: remote.id,
      providerPlanId: plan.providerPlanId,
      status: remote.status === "created" || !remote.status ? "created" : remote.status,
      totalCount,
      amountMinor: plan.priceMinor,
      currency: plan.currency,
      shortUrl: remote.short_url ?? null,
      createdById: user.id,
    },
  });
  await logActivity({ userId: user.id, organizationId: user.orgId, action: "BILLING_STARTED", module: "BILLING", entityId: row.id, details: { providerSubscriptionId: remote.id, amountMinor: plan.priceMinor } });
  return { ...base, purchaseId: row.id, subscriptionId: remote.id, shortUrl: row.shortUrl };
}

/**
 * The checkout window reports success to the browser; we do not trust that. The signature proves it came from
 * Razorpay's checkout, and we then READ the subscription from Razorpay and apply that. The webhook does the same later (harmless).
 */
export async function confirmCheckout(user: BillingUser, input: { paymentId: string; subscriptionId: string; signature: string }) {
  const cfg = razorpayConfig();
  if (!cfg) throw new AppError("PAYMENT_001", "Online payments are not set up yet.");
  if (!verifyCheckoutSignature(input.paymentId, input.subscriptionId, input.signature, cfg.keySecret)) {
    throw new AppError("PAYMENT_001", "We could not confirm that payment. If you were charged, it will show up here shortly, or contact support.");
  }
  const remote = await fetchSubscription(input.subscriptionId);
  const result = await applySubscriptionUpdate(remote, new Date(), { onlyOrgId: user.orgId, pull: true });
  if (result.outcome === "unknown") throw new AppError("NOT_FOUND_001", "That purchase was not found for your company.");
  await logActivity({ userId: user.id, organizationId: user.orgId, action: "BILLING_CHANGED", module: "BILLING", details: { providerSubscriptionId: input.subscriptionId, status: remote.status, via: "checkout" } });
  return { status: remote.status ?? "unknown" };
}

/** Cancel one purchased project plan: at the end of the paid period when it is running, at once when it never started. */
export async function cancelPurchase(user: BillingUser, purchaseId: string) {
  const purchase = await rawDb.billingPurchase.findFirst({ where: { id: purchaseId, organizationId: user.orgId } });
  if (!purchase) throw new AppError("NOT_FOUND_001", "That project plan was not found.");
  if (["cancelled", "completed", "expired"].includes(purchase.status)) throw new AppError("PAYMENT_001", "That project plan has already ended.");
  if (purchase.cancelAtCycleEnd) throw new AppError("PAYMENT_001", "That project plan is already set to end at the end of the paid period.");

  const atCycleEnd = purchase.status === "active";
  const remote = await cancelSubscription(purchase.providerSubscriptionId, atCycleEnd);
  await applySubscriptionUpdate(remote, new Date(), { onlyOrgId: user.orgId, cancelAtCycleEnd: atCycleEnd, pull: true });
  await logActivity({ userId: user.id, organizationId: user.orgId, action: "BILLING_CANCELED", module: "BILLING", entityId: purchase.id, details: { atCycleEnd } });
  return { atCycleEnd };
}

/**
 * Stops every running project-plan subscription of a company at once (used when the company is closed, so Razorpay does not keep charging
 * people who can no longer sign in to cancel). Best effort: a plan that cannot be cancelled is returned so the caller can record it for an operator.
 */
export async function cancelCompanyPurchases(orgId: string): Promise<{ cancelled: number; failed: string[] }> {
  if (!razorpayConfig()) return { cancelled: 0, failed: [] };
  const open = await rawDb.billingPurchase.findMany({
    where: { organizationId: orgId, status: { notIn: ["cancelled", "completed", "expired"] } },
    select: { id: true, providerSubscriptionId: true },
  });
  let cancelled = 0;
  const failed: string[] = [];
  for (const p of open) {
    try {
      const remote = await cancelSubscription(p.providerSubscriptionId, false);
      await applySubscriptionUpdate(remote, new Date(), { pull: true });
      cancelled++;
    } catch (error) {
      console.error("[billing] could not cancel", p.providerSubscriptionId, error instanceof Error ? error.message : error);
      failed.push(p.providerSubscriptionId);
    }
  }
  return { cancelled, failed };
}

/** Safety net for a missed webhook: re-reads every unfinished purchase from Razorpay. Returns how many changed. */
export async function reconcile(orgId?: string) {
  const rows = await rawDb.billingPurchase.findMany({
    where: { ...(orgId ? { organizationId: orgId } : {}), status: { notIn: ["completed", "expired"] }, NOT: { status: "cancelled", currentEnd: { lt: new Date() } } },
    select: { providerSubscriptionId: true, status: true },
  });
  let changed = 0;
  for (const r of rows) {
    const remote = await fetchSubscription(r.providerSubscriptionId);
    const res = await applySubscriptionUpdate(remote, new Date(), { pull: true });
    if (res.outcome === "applied" && remote.status !== r.status) changed++;
  }
  return { checked: rows.length, changed };
}

// ---- for the Plan screen

export async function getBillingSummary(orgId: string) {
  const [plan, purchases, payments, sub] = await Promise.all([
    rawDb.plan.findUnique({ where: { code: DEFAULT_PLAN }, select: { name: true, priceMinor: true, currency: true, interval: true } }),
    rawDb.billingPurchase.findMany({
      where: { organizationId: orgId, status: { not: "created" } },
      orderBy: { createdAt: "asc" },
      select: { id: true, status: true, amountMinor: true, currency: true, currentEnd: true, cancelAtCycleEnd: true, pastDueSince: true, createdAt: true },
    }),
    rawDb.billingPayment.findMany({ where: { organizationId: orgId }, orderBy: { paidAt: "desc" }, take: 10, select: { id: true, amountMinor: true, currency: true, method: true, paidAt: true } }),
    rawDb.subscription.findUnique({ where: { organizationId: orgId }, select: { billing: true, extraQuantity: true } }),
  ]);
  return {
    enabled: razorpayConfig() !== null,
    purchasable: razorpayConfig() !== null && !!plan && plan.priceMinor !== null && plan.priceMinor >= 100,
    plan,
    purchases,
    payments,
    extraQuantity: sub?.extraQuantity ?? 0,
    managedByProvider: sub?.billing === "RAZORPAY",
  };
}
