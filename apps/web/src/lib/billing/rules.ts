// Billing rules (Phase 5). Pure functions only: no database, no network, so every rule is unit-tested.
// Each project plan a company buys is its OWN Razorpay subscription (Razorpay cannot change the quantity of UPI / eMandate
// subscriptions). The company's Subscription row (quantity, status, grace, period) is DERIVED from those purchases, so a
// replayed or out-of-order webhook can never leave it wrong: it is always recomputed from the purchases.
import type { SubscriptionStatus } from "@/lib/plans/rules";

/** Razorpay subscription statuses. */
export type ProviderStatus = "created" | "authenticated" | "active" | "pending" | "halted" | "cancelled" | "completed" | "expired" | "paused";

const KNOWN: ReadonlySet<string> = new Set(["created", "authenticated", "active", "pending", "halted", "cancelled", "completed", "expired", "paused"]);
export const isProviderStatus = (s: unknown): s is ProviderStatus => typeof s === "string" && KNOWN.has(s);

export type PurchaseInput = {
  status: string;
  currentEnd: Date | null;
  cancelAtCycleEnd: boolean;
  pastDueSince: Date | null;
  /** Charges that went through. Left out means "assume it was paid". */
  paidCount?: number;
};

export type Derived = {
  quantity: number;
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  graceEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
};

export type DeriveContext = {
  /** Free project plans granted by an operator. */
  extraQuantity: number;
  trialEndsAt: Date | null;
  graceDays: number;
  now: Date;
};

const DAY = 86_400_000;

/** Grace period (days) after a failed charge before adding things is paused. */
export function graceDays() {
  const n = Number(process.env.BILLING_GRACE_DAYS);
  return Number.isFinite(n) && n >= 0 && n <= 60 ? Math.floor(n) : 7;
}

type Kind = "paid" | "retrying" | "stopped" | "canceling" | "ended" | "unpaid";

/**
 * paid       charged and running (an authenticated mandate counts: the first charge is due)
 * retrying   a charge failed and Razorpay is still retrying
 * stopped    retries gave up (halted) or the subscription is paused: still the company's project plan, but unpaid
 * canceling  cancelled, paid period not over yet
 * ended      cancelled/completed/expired and over, after it had been paid
 * unpaid     checkout never finished (or cancelled before any charge)
 */
export function purchaseKind(p: PurchaseInput, now: Date): Kind {
  switch (p.status) {
    case "active":
    case "authenticated":
      return "paid";
    case "pending":
      return "retrying";
    case "halted":
    case "paused":
      return "stopped";
    case "cancelled":
    case "completed":
    case "expired":
      if (p.paidCount === 0) return "unpaid";
      return p.status === "cancelled" && p.currentEnd && p.currentEnd > now ? "canceling" : "ended";
    default:
      return "unpaid";
  }
}

export function derive(purchases: PurchaseInput[], ctx: DeriveContext): Derived {
  const { now } = ctx;
  const kinds = purchases.map((p) => ({ p, kind: purchaseKind(p, now) }));
  const of = (...k: Kind[]) => kinds.filter((x) => k.includes(x.kind));
  const periodEnd = (xs: typeof kinds) => xs.reduce<Date | null>((m, x) => (x.p.currentEnd && (!m || x.p.currentEnd > m) ? x.p.currentEnd : m), null);

  // Project plans the company holds: every purchase that is not over, plus operator grants. Overdue ones still count so
  // limits never shrink under a company (data is never removed for non-payment); growth is paused by the status instead.
  const holding = of("paid", "retrying", "stopped", "canceling");
  const quantity = holding.length + Math.max(0, Math.floor(ctx.extraQuantity));

  const overdue = of("retrying", "stopped");
  if (overdue.length) {
    const since = overdue.reduce<Date | null>((m, x) => (x.p.pastDueSince && (!m || x.p.pastDueSince < m) ? x.p.pastDueSince : m), null) ?? now;
    return { quantity, status: "PAST_DUE", currentPeriodEnd: periodEnd(holding), graceEndsAt: new Date(since.getTime() + ctx.graceDays * DAY), cancelAtPeriodEnd: false };
  }

  const paid = of("paid");
  if (paid.length) {
    return { quantity, status: "ACTIVE", currentPeriodEnd: periodEnd(paid), graceEndsAt: null, cancelAtPeriodEnd: paid.every((x) => x.p.cancelAtCycleEnd) && ctx.extraQuantity <= 0 };
  }

  if (ctx.extraQuantity > 0) {
    return { quantity, status: "ACTIVE", currentPeriodEnd: periodEnd(of("canceling")), graceEndsAt: null, cancelAtPeriodEnd: false };
  }

  const canceling = of("canceling");
  if (canceling.length) {
    return { quantity, status: "CANCELED", currentPeriodEnd: periodEnd(canceling), graceEndsAt: null, cancelAtPeriodEnd: true };
  }

  // Nothing running. A company that once paid and has now stopped is cancelled: the trial does not start over.
  // One that never paid carries on with its trial, or stays on the ended one, which planState reads as "trial_expired".
  const ended = of("ended");
  if (ended.length) return { quantity, status: "CANCELED", currentPeriodEnd: periodEnd(ended), graceEndsAt: null, cancelAtPeriodEnd: false };
  return { quantity, status: "TRIALING", currentPeriodEnd: null, graceEndsAt: null, cancelAtPeriodEnd: false };
}

// ---- applying a provider update to one purchase

/** The part of a Razorpay subscription entity we use (times are unix seconds). */
export type ProviderSubscription = {
  id: string;
  plan_id?: string;
  status?: string;
  current_start?: number | null;
  current_end?: number | null;
  charge_at?: number | null;
  ended_at?: number | null;
  paid_count?: number;
  total_count?: number;
  short_url?: string | null;
};

export type PurchaseState = {
  status: string;
  paidCount: number;
  currentStart: Date | null;
  currentEnd: Date | null;
  chargeAt: Date | null;
  endedAt: Date | null;
  cancelAtCycleEnd: boolean;
  pastDueSince: Date | null;
  shortUrl: string | null;
  lastEventAt: Date | null;
};

const secs = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? new Date(v * 1000) : null);

/**
 * Returns the new state of a purchase after a provider update, or null when the update is stale (older than one already
 * applied) or malformed. `eventAt` is the event's own time (Razorpay `created_at`), not when we received it.
 */
export function applyProviderUpdate(current: PurchaseState, entity: ProviderSubscription, eventAt: Date): PurchaseState | null {
  if (!isProviderStatus(entity.status)) return null;
  if (current.lastEventAt && eventAt < current.lastEventAt) return null;
  const status = entity.status;
  const failing = status === "pending" || status === "halted";
  const settled = status === "active" || status === "authenticated" || status === "completed" || status === "cancelled" || status === "expired";
  return {
    status,
    paidCount: typeof entity.paid_count === "number" ? Math.max(current.paidCount, entity.paid_count) : current.paidCount,
    currentStart: entity.current_start !== undefined ? secs(entity.current_start) : current.currentStart,
    currentEnd: entity.current_end !== undefined ? secs(entity.current_end) : current.currentEnd,
    chargeAt: entity.charge_at !== undefined ? secs(entity.charge_at) : current.chargeAt,
    endedAt: entity.ended_at !== undefined ? secs(entity.ended_at) : current.endedAt,
    // The "cancel at cycle end" flag is ours (set when we ask Razorpay to cancel), so provider updates leave it alone.
    cancelAtCycleEnd: current.cancelAtCycleEnd,
    // The grace clock starts at the FIRST failed charge and clears when the subscription settles again.
    pastDueSince: failing ? (current.pastDueSince ?? eventAt) : settled ? null : current.pastDueSince,
    shortUrl: typeof entity.short_url === "string" ? entity.short_url : current.shortUrl,
    lastEventAt: eventAt,
  };
}

/** A price for the screen. `amountMinor` is in the smallest unit (paise). */
export function formatMoney(amountMinor: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, minimumFractionDigits: amountMinor % 100 === 0 ? 0 : 2 }).format(amountMinor / 100);
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${currency}`;
  }
}

/** Razorpay subscriptions need a number of billing cycles: 10 years either way. The customer can cancel at any time. */
export function totalCountFor(interval: string) {
  return interval === "YEAR" ? 10 : 120;
}
