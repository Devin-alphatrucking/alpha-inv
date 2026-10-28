import type { Prisma } from "@alpha/db";
import { rawDb } from "@/lib/db";
import { dbFor } from "@/lib/org/scoped-db";
import { getEntitlements } from "@/lib/plans/entitlements";
import { planState, type PlanState } from "@/lib/plans/rules";
import { platformTx } from "./db";
import { DIRECTORY_CAP, loadDirectory, loadModuleUse } from "./directory";
import { STAGES, healthOf, todayUtc, trialDaysLeft, weeklyCounts, type Level, type Reason, type Stage } from "./health";

/** Read-only data for the master console. Every caller must first pass requirePlatformAdmin() / pagePlatformAdmin(). */

export const PAGE_SIZE = 25;

export type CompanyRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: Date;
  state: PlanState;
  quantity: number;
  billing: string;
  currentPeriodEnd: Date | null;
  graceEndsAt: Date | null;
  members: number;
  projects: number;
  trialEndsAt: Date | null;
  trialDaysLeft: number | null;
  lastActiveAt: Date | null;
  openTickets: number;
  stage: Stage;
  level: Level;
  reasons: Reason[];
};

const ALL_COMPANIES_CAP = DIRECTORY_CAP;

/** Every company (optionally narrowed by name or code) with its stage and health. One database query per request, shared by every part of the page. */
async function loadCompanies(q: string): Promise<CompanyRow[]> {
  const needle = q.trim().toLowerCase();
  const rows = (await loadDirectory()).filter((o) => !needle || o.name.toLowerCase().includes(needle) || o.slug.toLowerCase().includes(needle));
  const now = new Date();
  return rows.map((o) => {
    const state = planState(o.subStatus ? { status: o.subStatus, quantity: o.quantity ?? 0, trialEndsAt: o.trialEndsAt, graceEndsAt: o.graceEndsAt, currentPeriodEnd: o.currentPeriodEnd } : null, now);
    const signals = {
      state,
      createdAt: o.createdAt,
      trialEndsAt: o.trialEndsAt,
      currentPeriodEnd: o.currentPeriodEnd,
      projects: o.projects,
      members: o.members,
      lastActiveAt: o.lastActiveAt,
      openTickets: o.openTickets,
      suspended: o.status === "SUSPENDED",
      now,
    };
    return {
      id: o.id,
      name: o.name,
      slug: o.slug,
      status: o.status,
      createdAt: o.createdAt,
      state,
      quantity: o.quantity ?? 0,
      billing: o.billing ?? "MANUAL",
      currentPeriodEnd: o.currentPeriodEnd,
      graceEndsAt: o.graceEndsAt,
      members: o.members,
      projects: o.projects,
      ...healthOf(signals),
      trialEndsAt: o.trialEndsAt,
      trialDaysLeft: trialDaysLeft(signals),
      lastActiveAt: o.lastActiveAt,
      openTickets: o.openTickets,
    };
  });
}

export const SORTS = { new: "Newest first", active: "Last active", quiet: "Quiet the longest", trial: "Trial ending soonest", name: "Name" } as const;
export type CompanySort = keyof typeof SORTS;

const time = (d: Date | null, empty: number) => (d ? d.getTime() : empty);

export function sortCompanies(rows: CompanyRow[], sort: CompanySort): CompanyRow[] {
  const by: Record<CompanySort, (a: CompanyRow, b: CompanyRow) => number> = {
    new: (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    active: (a, b) => time(b.lastActiveAt, 0) - time(a.lastActiveAt, 0),
    quiet: (a, b) => time(a.lastActiveAt, 0) - time(b.lastActiveAt, 0),
    trial: (a, b) => (a.trialDaysLeft ?? 9999) - (b.trialDaysLeft ?? 9999),
    name: (a, b) => a.name.localeCompare(b.name),
  };
  return [...rows].sort(by[sort]);
}

export async function listCompanies(opts: { q?: string; state?: string; stage?: string; attention?: boolean; sort?: CompanySort; page?: number }) {
  const all = await loadCompanies((opts.q ?? "").trim().slice(0, 80));
  const counts: Record<string, number> = {};
  const stageCounts: Record<string, number> = {};
  for (const c of all) {
    counts[c.state] = (counts[c.state] ?? 0) + 1;
    stageCounts[c.stage] = (stageCounts[c.stage] ?? 0) + 1;
  }
  const filtered = sortCompanies(all.filter((c) => (!opts.state || c.state === opts.state) && (!opts.stage || c.stage === opts.stage) && (!opts.attention || c.level !== "ok")), opts.sort ?? "new");
  const page = Math.max(1, opts.page ?? 1);
  return { total: filtered.length, rows: filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), counts, stageCounts, capped: all.length >= ALL_COMPANIES_CAP };
}

export async function overview() {
  const now = new Date();
  const since24 = new Date(now.getTime() - 86_400_000);
  const since7d = new Date(now.getTime() - 7 * 86_400_000);
  const since30d = new Date(now.getTime() - 30 * 86_400_000);
  const [all, small, purchases, paidRecently, moduleUse] = await Promise.all([
    loadCompanies(""),
    // the small counts share one transaction instead of one each
    platformTx(async (tx) => ({
      openTickets: await tx.supportTicket.count({ where: { status: { not: "RESOLVED" } } }),
      errors24h: await tx.apiErrorLog.count({ where: { createdAt: { gte: since24 } } }),
    })),
    rawDb.billingPurchase.findMany({ where: { status: { in: ["active", "authenticated"] } }, select: { amountMinor: true, currency: true, plan: { select: { interval: true } } } }),
    rawDb.billingPayment.groupBy({ by: ["currency"], where: { status: "captured", paidAt: { gte: since30d } }, _sum: { amountMinor: true } }),
    loadModuleUse(30),
  ]);
  const counts: Record<string, number> = {};
  for (const c of all) counts[c.state] = (counts[c.state] ?? 0) + 1;
  // Monthly recurring revenue per currency (yearly plans divided by 12).
  const mrr: Record<string, number> = {};
  for (const p of purchases) mrr[p.currency] = (mrr[p.currency] ?? 0) + Math.round(p.plan.interval === "YEAR" ? p.amountMinor / 12 : p.amountMinor);
  const risky = all.filter((c) => c.level === "risk");
  return {
    companies: all.length,
    newThisWeek: all.filter((c) => c.createdAt >= since7d).length,
    activeThisWeek: all.filter((c) => c.lastActiveAt && c.lastActiveAt >= since7d).length,
    trialsRunning: all.filter((c) => c.state === "trial").length,
    counts,
    atRisk: all.filter((c) => c.state === "past_due_grace" || c.state === "past_due" || c.state === "trial_expired").length,
    stages: Object.fromEntries(STAGES.map((st) => [st, all.filter((c) => c.stage === st).length])) as Record<Stage, number>,
    needAttention: risky.length,
    attentionList: risky.slice(0, 6),
    trialsEnding: all.filter((c) => c.trialDaysLeft !== null && c.trialDaysLeft <= 7).sort((a, b) => (a.trialDaysLeft ?? 0) - (b.trialDaysLeft ?? 0)).slice(0, 8),
    recentSignups: all.slice(0, 6),
    signupsByWeek: weeklyCounts(all.map((c) => c.createdAt), now, 12),
    moduleUse,
    paidLast30: Object.fromEntries(paidRecently.map((p) => [p.currency, p._sum.amountMinor ?? 0])) as Record<string, number>,
    openTickets: small.openTickets,
    errors24h: small.errors24h,
    mrr,
    payingPlans: purchases.length,
  };
}

export async function companyDetail(orgId: string) {
  const org = await rawDb.organization.findUnique({ where: { id: orgId }, include: { subscription: { include: { plan: true } } } });
  if (!org) return null;
  const [entitlements, purchases, payments, members, projects, activity, tickets, invoices, notes, followUps, health, usageRows] = await Promise.all([
    getEntitlements(org.id),
    rawDb.billingPurchase.findMany({ where: { organizationId: org.id }, orderBy: { createdAt: "asc" } }),
    rawDb.billingPayment.findMany({ where: { organizationId: org.id }, orderBy: { paidAt: "desc" }, take: 20 }),
    rawDb.membership.findMany({ where: { organizationId: org.id }, include: { user: { select: { name: true, email: true, phone: true, deletedAt: true, emailVerifiedAt: true, totpEnabledAt: true, isPlatformAdmin: true } } }, orderBy: { createdAt: "asc" } }),
    platformTx((tx) => tx.project.findMany({ where: { organizationId: org.id }, select: { id: true, name: true, status: true, monthlyPageLimit: true }, orderBy: { name: "asc" } })),
    platformTx((tx) => tx.activityLog.findMany({ where: { organizationId: org.id }, orderBy: { createdAt: "desc" }, take: 25, include: { user: { select: { email: true } } } })),
    platformTx((tx) => tx.supportTicket.findMany({ where: { organizationId: org.id }, orderBy: { createdAt: "desc" }, take: 10 })),
    dbFor(org.id).invoice.count(),
    platformTx((tx) => tx.clientNote.findMany({ where: { organizationId: org.id }, orderBy: { createdAt: "desc" }, take: 50 })),
    platformTx((tx) => tx.clientFollowUp.findMany({ where: { organizationId: org.id }, orderBy: [{ doneAt: { sort: "asc", nulls: "first" } }, { dueOn: "asc" }], take: 30 })),
    loadCompanies("").then((rows) => rows.find((r) => r.id === org.id) ?? null),
    platformTx((tx) => tx.activityLog.groupBy({ by: ["module"], where: { organizationId: org.id, module: { not: "MASTER" }, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }, _count: { _all: true } })),
  ]);
  const usage30 = Object.fromEntries(usageRows.map((u) => [u.module, u._count._all])) as Record<string, number>;
  return { org, entitlements, purchases, payments, members, projects, activity, tickets, invoices, notes, followUps, health, usage30 };
}

export async function listTickets(opts: { status?: string; q?: string; page?: number }) {
  const where: Prisma.SupportTicketWhereInput = {
    ...(opts.status === "OPEN" || opts.status === "WAITING" || opts.status === "RESOLVED" ? { status: opts.status } : opts.status === "ACTIVE" ? { status: { not: "RESOLVED" } } : {}),
    ...(opts.q
      ? {
          OR: [
            { subject: { contains: opts.q, mode: "insensitive" } },
            { email: { contains: opts.q, mode: "insensitive" } },
            { organization: { name: { contains: opts.q, mode: "insensitive" } } },
            ...(Number.isInteger(Number(opts.q)) ? [{ number: Number(opts.q) }] : []),
          ],
        }
      : {}),
  };
  const page = Math.max(1, opts.page ?? 1);
  return platformTx(async (tx) => {
    const [total, rows, byStatus] = await Promise.all([
      tx.supportTicket.count({ where }),
      tx.supportTicket.findMany({
        where,
        orderBy: [{ status: "asc" }, { priority: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: { organization: { select: { id: true, name: true, slug: true } } },
      }),
      tx.supportTicket.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);
    return { total, rows, byStatus: Object.fromEntries(byStatus.map((b) => [b.status, b._count._all])) as Record<string, number> };
  });
}

export async function ticketDetail(id: string) {
  return platformTx((tx) =>
    tx.supportTicket.findUnique({ where: { id }, include: { organization: { select: { id: true, name: true, slug: true, subscription: { select: { status: true, quantity: true } } } } } }),
  );
}

export async function listActivity(opts: { module?: string; q?: string; orgId?: string; page?: number }) {
  const where: Prisma.ActivityLogWhereInput = {
    ...(opts.module ? { module: opts.module } : {}),
    ...(opts.orgId ? { organizationId: opts.orgId } : {}),
    ...(opts.q ? { OR: [{ action: { contains: opts.q, mode: "insensitive" } }, { entityId: { contains: opts.q, mode: "insensitive" } }, { user: { email: { contains: opts.q, mode: "insensitive" } } }] } : {}),
  };
  const page = Math.max(1, opts.page ?? 1);
  return platformTx(async (tx) => {
    const [total, rows, modules] = await Promise.all([
      tx.activityLog.count({ where }),
      tx.activityLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 50, take: 50, include: { user: { select: { email: true } } } }),
      tx.activityLog.groupBy({ by: ["module"], _count: { _all: true } }),
    ]);
    const orgIds = [...new Set(rows.map((r) => r.organizationId).filter((x): x is string => !!x))];
    const orgs = await tx.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } });
    return { total, rows, modules: modules.map((m) => ({ value: m.module, count: m._count._all })), orgNames: new Map(orgs.map((o) => [o.id, o.name])) };
  });
}

export async function listErrors(opts: { q?: string; code?: string; orgId?: string; page?: number }) {
  const where: Prisma.ApiErrorLogWhereInput = {
    ...(opts.code ? { errorCode: opts.code } : {}),
    ...(opts.orgId ? { organizationId: opts.orgId } : {}),
    ...(opts.q ? { OR: [{ message: { contains: opts.q, mode: "insensitive" } }, { endpoint: { contains: opts.q, mode: "insensitive" } }, { requestId: { contains: opts.q, mode: "insensitive" } }] } : {}),
  };
  const page = Math.max(1, opts.page ?? 1);
  return platformTx(async (tx) => {
    const [total, rows, codes] = await Promise.all([
      tx.apiErrorLog.count({ where }),
      tx.apiErrorLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 50, take: 50 }),
      tx.apiErrorLog.groupBy({ by: ["errorCode"], _count: { _all: true }, orderBy: { _count: { errorCode: "desc" } }, take: 12 }),
    ]);
    const orgIds = [...new Set(rows.map((r) => r.organizationId).filter((x): x is string => !!x))];
    const orgs = await tx.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } });
    return { total, rows, codes: codes.map((c) => ({ value: c.errorCode, count: c._count._all })), orgNames: new Map(orgs.map((o) => [o.id, o.name])) };
  });
}

export async function billingOverview() {
  const [companies, events, payments, errorEvents] = await Promise.all([
    loadCompanies(""),
    rawDb.billingEvent.findMany({ orderBy: { receivedAt: "desc" }, take: 30, select: { id: true, type: true, outcome: true, error: true, receivedAt: true, organizationId: true } }),
    rawDb.billingPayment.findMany({ orderBy: { paidAt: "desc" }, take: 20, include: { purchase: { select: { organization: { select: { id: true, name: true } } } } } }),
    rawDb.billingEvent.count({ where: { outcome: "error" } }),
  ]);
  const watch = companies.filter((c) => ["past_due_grace", "past_due", "canceling", "canceled", "trial_expired"].includes(c.state));
  return { watch, events, payments, errorEvents };
}

export async function listPlans() {
  return rawDb.plan.findMany({ orderBy: { code: "asc" }, include: { _count: { select: { subscriptions: true } } } });
}


/** Every follow-up not yet done, soonest first, with the company it is about. */
export async function openFollowUps(limit = 200) {
  return platformTx((tx) =>
    tx.clientFollowUp.findMany({ where: { doneAt: null }, orderBy: [{ dueOn: "asc" }, { createdAt: "asc" }], take: limit, include: { organization: { select: { id: true, name: true, slug: true } } } }),
  );
}

export async function recentlyDoneFollowUps(limit = 15) {
  return platformTx((tx) =>
    tx.clientFollowUp.findMany({ where: { doneAt: { not: null } }, orderBy: { doneAt: "desc" }, take: limit, include: { organization: { select: { id: true, name: true } } } }),
  );
}

export const today = () => todayUtc();
