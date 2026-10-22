import { z } from "zod";
import { rawDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { logActivity, type ActivityAction } from "@/lib/activity";
import { recomputeSubscription, reconcile, withBillingLock } from "@/lib/billing/service";
import { parseOverrides } from "@/lib/plans/rules";
import { platformTx } from "./db";
import type { PlatformAdmin } from "./guard";

/**
 * Everything the master console CHANGES. Each operation re-checks its input, needs a written reason, and is written to the
 * activity log against the company it touched (module MASTER), so there is always a record of who changed what and why.
 */

export const reasonSchema = z.string().trim().min(3, "Write a short reason (at least 3 characters).").max(300, "Keep the reason under 300 characters.");

function refuse(message: string): never {
  throw new AppError("VALIDATION_001", message);
}

async function company(orgId: string) {
  const org = await rawDb.organization.findUnique({ where: { id: String(orgId) }, include: { subscription: true } });
  if (!org) throw new AppError("NOT_FOUND_001", "Company not found.");
  return org;
}

function audit(admin: PlatformAdmin, orgId: string | null, action: ActivityAction, details: Record<string, unknown>) {
  return logActivity({ userId: admin.id, organizationId: orgId, action, module: "MASTER", entityId: orgId, details: { by: admin.email, ...details } });
}

export function parseReason(raw: unknown): string {
  const r = reasonSchema.safeParse(raw);
  if (!r.success) return refuse(r.error.issues[0].message);
  return r.data;
}

/** Hand-managed company: sets the number of project plans. Pays through Razorpay: sets the FREE project plans given on top of what it bought. */
export async function setProjectPlans(admin: PlatformAdmin, orgId: string, count: unknown, reason: unknown) {
  const n = z.number().int().min(0).max(1000).safeParse(count);
  if (!n.success) return refuse("Enter a whole number from 0 to 1000.");
  const why = parseReason(reason);
  const org = await company(orgId);
  const sub = org.subscription;
  if (!sub) return refuse("This company has no plan record yet.");
  const before = { quantity: sub.quantity, extraQuantity: sub.extraQuantity, billing: sub.billing };
  await withBillingLock(org.id, async (tx) => {
    if (sub.billing === "RAZORPAY") {
      await tx.subscription.update({ where: { organizationId: org.id }, data: { extraQuantity: n.data } });
      await recomputeSubscription(tx, org.id);
    } else {
      await tx.subscription.update({
        where: { organizationId: org.id },
        data: { quantity: n.data, status: n.data > 0 ? "ACTIVE" : sub.status, provider: sub.provider ?? "manual" },
      });
    }
  });
  await audit(admin, org.id, "MASTER_GRANTED_PLANS", { reason: why, count: n.data, before });
}

export async function extendTrial(admin: PlatformAdmin, orgId: string, days: unknown, reason: unknown) {
  const d = z.number().int().min(1).max(365).safeParse(days);
  if (!d.success) return refuse("Enter a whole number of days from 1 to 365.");
  const why = parseReason(reason);
  const org = await company(orgId);
  const sub = org.subscription;
  if (!sub) return refuse("This company has no plan record yet.");
  const base = sub.trialEndsAt && sub.trialEndsAt > new Date() ? sub.trialEndsAt : new Date();
  const trialEndsAt = new Date(base.getTime() + d.data * 86_400_000);
  await withBillingLock(org.id, async (tx) => {
    await tx.subscription.update({
      where: { organizationId: org.id },
      data: { trialEndsAt, ...(sub.billing !== "RAZORPAY" && sub.status !== "ACTIVE" ? { status: "TRIALING" as const } : {}) },
    });
    if (sub.billing === "RAZORPAY") await recomputeSubscription(tx, org.id);
  });
  await audit(admin, org.id, "MASTER_EXTENDED_TRIAL", { reason: why, days: d.data, trialEndsAt: trialEndsAt.toISOString() });
}

/** Extra projects / users / AI pages for one company, on top of its plans. A null AI page value means "use the plan's". */
export async function setLimits(admin: PlatformAdmin, orgId: string, input: { extraProjects: unknown; extraUsers: unknown; aiPagesPerProject: unknown }, reason: unknown) {
  const schema = z.object({
    extraProjects: z.number().int().min(0).max(1000),
    extraUsers: z.number().int().min(0).max(10000),
    aiPagesPerProject: z.number().int().min(0).max(100000).nullable(),
  });
  const v = schema.safeParse(input);
  if (!v.success) return refuse("Use whole numbers: extra projects 0-1000, extra users 0-10000, AI pages 0-100000 (or leave AI pages empty).");
  const why = parseReason(reason);
  const org = await company(orgId);
  if (!org.subscription) return refuse("This company has no plan record yet.");
  const before = parseOverrides(org.subscription.overrides);
  await rawDb.subscription.update({ where: { organizationId: org.id }, data: { overrides: v.data } });
  await audit(admin, org.id, "MASTER_SET_LIMITS", { reason: why, before, after: v.data });
}

/** Suspend (nobody in the company can sign in; data kept) or reactivate. You cannot suspend a company you belong to. */
export async function setCompanyStatus(admin: PlatformAdmin, orgId: string, status: unknown, reason: unknown) {
  if (status !== "SUSPENDED" && status !== "ACTIVE") return refuse("Status must be ACTIVE or SUSPENDED.");
  const why = parseReason(reason);
  const org = await company(orgId);
  if (org.status === "CLOSED") return refuse("A closed company cannot be changed.");
  if (status === "SUSPENDED") {
    const mine = await rawDb.membership.findFirst({ where: { organizationId: org.id, userId: admin.id }, select: { id: true } });
    if (mine) return refuse("You belong to this company, so suspending it would lock you out. Use another operator account.");
  }
  await rawDb.organization.update({ where: { id: org.id }, data: { status } });
  await audit(admin, org.id, "MASTER_SET_COMPANY_STATUS", { reason: why, from: org.status, to: status });
}

/** Changes a plan for EVERY company on it. A price change makes a new Razorpay plan at the next purchase; current buyers keep their price. */
export async function editPlan(
  admin: PlatformAdmin,
  code: string,
  input: { name: unknown; priceMinor: unknown; currency: unknown; userLimit: unknown; aiPagesPerProject: unknown; includedProjects: unknown },
  reason: unknown,
) {
  const schema = z.object({
    name: z.string().trim().min(2).max(60),
    priceMinor: z.number().int().min(100).max(100_000_000).nullable(),
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
    userLimit: z.number().int().min(1).max(1000),
    aiPagesPerProject: z.number().int().min(0).max(100000),
    includedProjects: z.number().int().min(1).max(100),
  });
  const v = schema.safeParse(input);
  if (!v.success) return refuse("Check the plan values: price is in the smallest unit (paise) and at least 100, currency is a 3-letter code.");
  const why = parseReason(reason);
  const plan = await rawDb.plan.findUnique({ where: { code } });
  if (!plan) throw new AppError("NOT_FOUND_001", "Plan not found.");
  await rawDb.plan.update({ where: { code }, data: v.data });
  await audit(admin, null, "MASTER_EDITED_PLAN", {
    reason: why,
    plan: code,
    before: { name: plan.name, priceMinor: plan.priceMinor, currency: plan.currency, userLimit: plan.userLimit, aiPagesPerProject: plan.aiPagesPerProject, includedProjects: plan.includedProjects },
    after: v.data,
  });
}

export async function setTicketStatus(admin: PlatformAdmin, ticketId: string, status: unknown) {
  if (status !== "OPEN" && status !== "WAITING" && status !== "RESOLVED") return refuse("Status must be OPEN, WAITING or RESOLVED.");
  const t = await platformTx(async (tx) => {
    const found = await tx.supportTicket.findUnique({ where: { id: String(ticketId) }, select: { id: true, organizationId: true, status: true, number: true } });
    if (!found) return null;
    await tx.supportTicket.update({ where: { id: found.id }, data: { status, resolvedAt: status === "RESOLVED" ? new Date() : null } });
    return found;
  });
  if (!t) throw new AppError("NOT_FOUND_001", "Ticket not found.");
  await audit(admin, t.organizationId, "MASTER_TICKET_STATUS", { ticket: t.number, from: t.status, to: status });
}

export async function reconcileNow(admin: PlatformAdmin, orgId?: string) {
  const r = await reconcile(orgId);
  await audit(admin, orgId ?? null, "MASTER_RECONCILED", r);
  return r;
}
