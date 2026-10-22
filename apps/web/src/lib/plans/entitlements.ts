import { rawDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import {
  checkAddInvoices,
  checkAddProject,
  checkAddUsers,
  checkCompanyPageCap,
  checkPageLimit,
  computeLimits,
  planState,
  trialDaysLeft,
  type Limits,
  type PlanInput,
  type PlanState,
  type Usage,
} from "./rules";

/**
 * What a company's plan allows, and how much of it is used. ONE place decides this, so the web app,
 * the server actions and (later) the API and the mobile apps always agree.
 *
 * Counted: ACTIVE projects only (a completed or archived project frees its place); members of the company who
 * have not deleted their account; open (unused, uncancelled, unexpired) invitations.
 */

/** Anything that can run raw SQL: a Prisma transaction client, scoped or not. */
export type Tx = Pick<typeof rawDb, "$executeRaw" | "$queryRaw">;

export type Entitlements = {
  orgId: string;
  hasSubscription: boolean;
  planCode: string | null;
  planName: string | null;
  state: PlanState;
  quantity: number;
  limits: Limits;
  usage: Usage;
  trialEndsAt: Date | null;
  trialDaysLeft: number | null;
  currentPeriodEnd: Date | null;
  graceEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
};

const NO_PLAN_LIMITS: Limits = { projects: 0, users: 0, aiPagesPerProject: 0, companyPageCap: 0 };

/** Says which company the following statements are about (Row-Level Security) and serialises changes to one company. */
export async function lockCompany(tx: Tx, orgId: string) {
  await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, true)`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"company:" + orgId}))`;
}

// Timestamps are stored as UTC without a zone, so compare against UTC "now", not the database session's own zone.
async function countUsage(tx: Tx, orgId: string): Promise<Usage> {
  const [p, u, i] = await Promise.all([
    tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "Project" WHERE "organizationId" = ${orgId} AND "status" = 'ACTIVE'`,
    tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "Membership" m JOIN "User" u ON u."id" = m."userId" WHERE m."organizationId" = ${orgId} AND u."deletedAt" IS NULL`,
    tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "AuthToken" WHERE "type" = 'INVITE' AND "organizationId" = ${orgId} AND "usedAt" IS NULL AND "revokedAt" IS NULL AND "expiresAt" > (now() AT TIME ZONE 'UTC')`,
  ]);
  return { projects: p[0]?.n ?? 0, users: u[0]?.n ?? 0, pendingInvites: i[0]?.n ?? 0 };
}

async function load(tx: Tx, orgId: string, now: Date): Promise<Entitlements> {
  await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, true)`;
  const [sub, usage] = await Promise.all([
    rawDb.subscription.findUnique({ where: { organizationId: orgId }, include: { plan: true } }),
    countUsage(tx, orgId),
  ]);
  if (!sub) {
    return {
      orgId, hasSubscription: false, planCode: null, planName: null, state: "none", quantity: 0, limits: NO_PLAN_LIMITS, usage,
      trialEndsAt: null, trialDaysLeft: null, currentPeriodEnd: null, graceEndsAt: null, cancelAtPeriodEnd: false,
    };
  }
  const plan: PlanInput = sub.plan;
  return {
    orgId,
    hasSubscription: true,
    planCode: sub.plan.code,
    planName: sub.plan.name,
    state: planState(sub, now),
    quantity: sub.quantity,
    limits: computeLimits(plan, sub),
    usage,
    trialEndsAt: sub.trialEndsAt,
    trialDaysLeft: trialDaysLeft(sub, now),
    currentPeriodEnd: sub.currentPeriodEnd,
    graceEndsAt: sub.graceEndsAt,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
  };
}

/** Pass `tx` when you are already inside a transaction (so the counts see your own changes). */
export async function getEntitlements(orgId: string, tx?: Tx, now: Date = new Date()): Promise<Entitlements> {
  return tx ? load(tx, orgId, now) : rawDb.$transaction((t) => load(t, orgId, now));
}

const refuse = (message: string): never => {
  throw new AppError("PLAN_001", message);
};

/** Call INSIDE the transaction that creates (or re-activates) the project. Serialised per company, so two requests cannot both take the last place. */
export async function assertCanAddProject(tx: Tx, orgId: string): Promise<Entitlements> {
  await lockCompany(tx, orgId);
  const e = await getEntitlements(orgId, tx);
  const check = checkAddProject(e.state, e.limits, e.usage);
  if (!check.ok) refuse(check.message);
  return e;
}

/** Call INSIDE the transaction that adds the member(s). `adding` is how many people are about to be added. */
export async function assertCanAddUsers(tx: Tx, orgId: string, adding = 1): Promise<Entitlements> {
  await lockCompany(tx, orgId);
  const e = await getEntitlements(orgId, tx);
  const check = checkAddUsers(e.state, e.limits, e.usage, adding);
  if (!check.ok) refuse(check.message);
  return e;
}

/** Sending an invitation: the same rule, without holding a lock (the lock is taken when the invitation is accepted). */
export async function assertCanInvite(orgId: string): Promise<Entitlements> {
  const e = await getEntitlements(orgId);
  const check = checkAddUsers(e.state, e.limits, e.usage, 1);
  if (!check.ok) refuse(check.message);
  return e;
}

/** Uploading invoices costs AI money, so it stops when the plan is not in good standing. */
export async function assertCanUpload(orgId: string): Promise<Entitlements> {
  const e = await getEntitlements(orgId);
  const check = checkAddInvoices(e.state);
  if (!check.ok) refuse(check.message);
  return e;
}

/** A company admin may lower a project's monthly AI page limit, never raise it above the plan. */
export function assertProjectPageLimit(e: Entitlements, requested: number) {
  const check = checkPageLimit(requested, e.limits);
  if (!check.ok) refuse(check.message);
}

export function assertCompanyPageCap(e: Entitlements, requested: number) {
  const check = checkCompanyPageCap(requested, e.limits);
  if (!check.ok) refuse(check.message);
}

/** The new-trial length for companies created through sign-up (days). */
export function trialDays() {
  const n = Number(process.env.TRIAL_DAYS);
  return Number.isFinite(n) && n > 0 && n <= 365 ? Math.floor(n) : 14;
}
