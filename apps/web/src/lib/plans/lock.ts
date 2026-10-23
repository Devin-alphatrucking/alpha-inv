import { rawDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { planState, type PlanState } from "./rules";

/**
 * The paywall. When a company's trial has ended, its plan was cancelled, or a payment stayed unpaid past the grace period,
 * its data is LOCKED: every page, action, file and mobile call that touches company data is refused until a plan is active again.
 * Nothing is deleted. What stays open: the "Choose a plan" screen, buying, support, the person's own account, and signing out.
 */
const LOCKED: ReadonlySet<PlanState> = new Set(["trial_expired", "past_due", "canceled", "none"]);

export const isLockedState = (state: PlanState) => LOCKED.has(state);

export type LockInfo = { locked: boolean; state: PlanState };

const CACHE_MS = 10_000;
const cache = new Map<string, { at: number; info: LockInfo }>();

/** Forget what we know about a company (called when its plan changes), so the change shows at once. */
export function clearLockCache(orgId?: string) {
  if (orgId) cache.delete(orgId);
  else cache.clear();
}

/** Cheap enough to run on every request: one small query, remembered for a few seconds. */
export async function companyLock(orgId: string, now: Date = new Date()): Promise<LockInfo> {
  const hit = cache.get(orgId);
  if (hit && now.getTime() - hit.at < CACHE_MS) return hit.info;
  const sub = await rawDb.subscription.findUnique({
    where: { organizationId: orgId },
    select: { status: true, quantity: true, trialEndsAt: true, currentPeriodEnd: true, graceEndsAt: true, cancelAtPeriodEnd: true },
  });
  const state = planState(sub, now);
  const info = { locked: isLockedState(state), state };
  cache.set(orgId, { at: now.getTime(), info });
  if (cache.size > 5000) cache.clear();
  return info;
}

/** What the person sees on the Choose-a-plan screen. */
export function lockedMessage(state: PlanState): string {
  switch (state) {
    case "trial_expired":
      return "Your free trial has ended. Your data is safe and kept for you, but it stays hidden until a plan is active.";
    case "past_due":
      return "Your last payment did not go through and the grace period has ended. Your data is safe, but it stays hidden until the payment is settled.";
    case "canceled":
      return "Your subscription has ended. Your data is safe and kept for you, but it stays hidden until a plan is active again.";
    default:
      return "This company does not have an active plan yet. Choose a plan to open your data.";
  }
}

/** Throws (402) when the company is locked. Called for every request that touches company data. */
export async function assertNotLocked(orgId: string) {
  const info = await companyLock(orgId);
  if (info.locked) throw new AppError("PLAN_LOCKED", lockedMessage(info.state), { state: info.state });
}
