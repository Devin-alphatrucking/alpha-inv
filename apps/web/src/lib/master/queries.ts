import type { Prisma } from "@alpha/db";
import { rawDb } from "@/lib/db";
import { dbFor } from "@/lib/org/scoped-db";
import { getEntitlements } from "@/lib/plans/entitlements";
import { planState, type PlanState } from "@/lib/plans/rules";
import { platformTx } from "./db";

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
};

const ALL_COMPANIES_CAP = 5000;

async function loadCompanies(q: string): Promise<CompanyRow[]> {
  const orgs = await rawDb.organization.findMany({
    where: q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { slug: { contains: q, mode: "insensitive" } }] } : {},
    include: { subscription: true },
    orderBy: { createdAt: "desc" },
    take: ALL_COMPANIES_CAP,
  });
  const ids = orgs.map((o) => o.id);
  const [members, projects] = await Promise.all([
    rawDb.membership.groupBy({ by: ["organizationId"], where: { organizationId: { in: ids } }, _count: { _all: true } }),
    platformTx((tx) => tx.project.groupBy({ by: ["organizationId"], where: { organizationId: { in: ids }, status: "ACTIVE" }, _count: { _all: true } })),
  ]);
  const m = new Map(members.map((x) => [x.organizationId, x._count._all]));
  const p = new Map(projects.map((x) => [x.organizationId, x._count._all]));
  const now = new Date();
  return orgs.map((o) => ({
    id: o.id,
    name: o.name,
    slug: o.slug,
    status: o.status,
    createdAt: o.createdAt,
    state: planState(o.subscription, now),
    quantity: o.subscription?.quantity ?? 0,
    billing: o.subscription?.billing ?? "MANUAL",
    currentPeriodEnd: o.subscription?.currentPeriodEnd ?? null,
    graceEndsAt: o.subscription?.graceEndsAt ?? null,
    members: m.get(o.id) ?? 0,
    projects: p.get(o.id) ?? 0,
  }));
}

export async function listCompanies(opts: { q?: string; state?: string; page?: number }) {
  const all = await loadCompanies((opts.q ?? "").trim().slice(0, 80));
  const counts: Record<string, number> = {};
  for (const c of all) counts[c.state] = (counts[c.state] ?? 0) + 1;
  const filtered = opts.state ? all.filter((c) => c.state === opts.state) : all;
  const page = Math.max(1, opts.page ?? 1);
  return { total: filtered.length, rows: filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), counts, capped: all.length >= ALL_COMPANIES_CAP };
}

export async function overview() {
  const since24 = new Date(Date.now() - 86_400_000);
  const since7d = new Date(Date.now() - 7 * 86_400_000);
  const [all, openTickets, errors24h, purchases] = await Promise.all([
    loadCompanies(""),
    platformTx((tx) => tx.supportTicket.count({ where: { status: { not: "RESOLVED" } } })),
    platformTx((tx) => tx.apiErrorLog.count({ where: { createdAt: { gte: since24 } } })),
    rawDb.billingPurchase.findMany({ where: { status: { in: ["active", "authenticated"] } }, select: { amountMinor: true, currency: true, plan: { select: { interval: true } } } }),
  ]);
  const counts: Record<string, number> = {};
  for (const c of all) counts[c.state] = (counts[c.state] ?? 0) + 1;
  // Monthly recurring revenue per currency (yearly plans divided by 12).
  const mrr: Record<string, number> = {};
  for (const p of purchases) mrr[p.currency] = (mrr[p.currency] ?? 0) + Math.round(p.plan.interval === "YEAR" ? p.amountMinor / 12 : p.amountMinor);
  return {
    companies: all.length,
    newThisWeek: all.filter((c) => c.createdAt >= since7d).length,
    counts,
    atRisk: all.filter((c) => c.state === "past_due_grace" || c.state === "past_due" || c.state === "trial_expired").length,
    openTickets,
    errors24h,
    mrr,
    payingPlans: purchases.length,
  };
}

export async function companyDetail(orgId: string) {
  const org = await rawDb.organization.findUnique({ where: { id: orgId }, include: { subscription: { include: { plan: true } } } });
  if (!org) return null;
  const [entitlements, purchases, payments, members, projects, activity, tickets, invoices] = await Promise.all([
    getEntitlements(org.id),
    rawDb.billingPurchase.findMany({ where: { organizationId: org.id }, orderBy: { createdAt: "asc" } }),
    rawDb.billingPayment.findMany({ where: { organizationId: org.id }, orderBy: { paidAt: "desc" }, take: 20 }),
    rawDb.membership.findMany({ where: { organizationId: org.id }, include: { user: { select: { name: true, email: true, deletedAt: true, emailVerifiedAt: true } } }, orderBy: { createdAt: "asc" } }),
    platformTx((tx) => tx.project.findMany({ where: { organizationId: org.id }, select: { id: true, name: true, status: true, monthlyPageLimit: true }, orderBy: { name: "asc" } })),
    platformTx((tx) => tx.activityLog.findMany({ where: { organizationId: org.id }, orderBy: { createdAt: "desc" }, take: 25, include: { user: { select: { email: true } } } })),
    platformTx((tx) => tx.supportTicket.findMany({ where: { organizationId: org.id }, orderBy: { createdAt: "desc" }, take: 10 })),
    dbFor(org.id).invoice.count(),
  ]);
  return { org, entitlements, purchases, payments, members, projects, activity, tickets, invoices };
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
