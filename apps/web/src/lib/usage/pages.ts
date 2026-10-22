import { rawDb } from "@/lib/db";
import { dbFor } from "@/lib/org/scoped-db";
import { AppError } from "@/lib/errors";
import { DEFAULT_FORMAT, validTimeZone } from "@/lib/brand/format";

/**
 * Monthly AI page quota (Azure Document Intelligence pages, not invoices).
 *
 * - Limits: per project (Project.monthlyPageLimit) AND a per-company cap
 *   (AppSetting "companyMonthlyPageLimit:<orgId>"; unset = no company cap).
 * - Counted when the pages are reserved, BEFORE Azure is called.
 * - Deleting an invoice never reduces usage. Only a system failure (refund)
 *   or a smaller-than-expected actual page count lowers it.
 * - Reservation is one atomic UPDATE per scope inside a transaction, so two
 *   simultaneous uploads can never pass the limit together.
 *
 * PageUsage and AppSetting are not company-owned tables, so the company is part
 * of the key: scope "ORG:<orgId>" / "PROJECT:<projectId>", setting key suffix.
 */

export function companyScope(orgId: string) {
  return `ORG:${orgId}`;
}

export function projectScope(projectId: string) {
  return `PROJECT:${projectId}`;
}

function companyLimitKey(orgId: string) {
  return `companyMonthlyPageLimit:${orgId}`;
}

/** Billing month in the given timezone, e.g. "2026-10". */
export function currentPeriod(now = new Date(), timeZone: string = DEFAULT_FORMAT.timeZone): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).format(now);
}

/** The company's current billing month: the month boundary follows the company's own timezone. */
export async function periodForCompany(orgId: string): Promise<string> {
  const org = await rawDb.organization.findUnique({ where: { id: orgId }, select: { timezone: true } });
  return currentPeriod(new Date(), validTimeZone(org?.timezone) ?? DEFAULT_FORMAT.timeZone);
}

export async function getCompanyPageLimit(orgId: string): Promise<number | null> {
  const row = await rawDb.appSetting.findUnique({ where: { key: companyLimitKey(orgId) } });
  if (!row) return null;
  const n = Number(row.value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

export async function setCompanyPageLimit(orgId: string, limit: number | null) {
  const key = companyLimitKey(orgId);
  if (limit == null) {
    await rawDb.appSetting.deleteMany({ where: { key } });
    return;
  }
  await rawDb.appSetting.upsert({
    where: { key },
    create: { key, value: String(limit) },
    update: { value: String(limit) },
  });
}

type Tx = Parameters<Parameters<typeof rawDb.$transaction>[0]>[0];

async function addToScope(
  tx: Tx,
  scopeKey: string,
  period: string,
  pages: number,
  limit: number | null
): Promise<boolean> {
  await tx.$executeRaw`
    INSERT INTO "PageUsage" ("id", "scopeKey", "period", "pagesUsed", "updatedAt")
    VALUES (gen_random_uuid()::text, ${scopeKey}, ${period}, 0, now())
    ON CONFLICT ("scopeKey", "period") DO NOTHING`;

  // limit === null means "no cap": always allowed.
  const rows =
    limit === null
      ? await tx.$queryRaw<{ pagesUsed: number }[]>`
          UPDATE "PageUsage"
          SET "pagesUsed" = "pagesUsed" + ${pages}, "updatedAt" = now()
          WHERE "scopeKey" = ${scopeKey} AND "period" = ${period}
          RETURNING "pagesUsed"`
      : await tx.$queryRaw<{ pagesUsed: number }[]>`
          UPDATE "PageUsage"
          SET "pagesUsed" = "pagesUsed" + ${pages}, "updatedAt" = now()
          WHERE "scopeKey" = ${scopeKey} AND "period" = ${period}
            AND "pagesUsed" + ${pages} <= ${limit}
          RETURNING "pagesUsed"`;
  return rows.length > 0;
}

async function shiftScope(
  tx: Tx,
  scopeKey: string,
  period: string,
  delta: number
) {
  if (delta === 0) return;
  await tx.$executeRaw`
    UPDATE "PageUsage"
    SET "pagesUsed" = GREATEST(0, "pagesUsed" + ${delta}), "updatedAt" = now()
    WHERE "scopeKey" = ${scopeKey} AND "period" = ${period}`;
}

/**
 * Reserve pages for one upload. Throws QUOTA_001 (429) when either the
 * project limit or the company cap would be exceeded. Nothing is counted
 * in that case. The project must belong to `orgId`.
 */
export async function reservePages(input: {
  orgId: string;
  projectId: string;
  userId: string | null;
  pages: number;
  fileHash: string | null;
}): Promise<{ eventId: string; period: string }> {
  const { orgId, projectId, userId, pages, fileHash } = input;
  const period = await periodForCompany(orgId);

  // Scoped lookup: a project from another company is simply "not found".
  const project = await dbFor(orgId).project.findUnique({
    where: { id: projectId },
    select: { monthlyPageLimit: true, name: true },
  });
  if (!project) throw new AppError("NOT_FOUND_001", "Project not found");
  const companyLimit = await getCompanyPageLimit(orgId);

  return rawDb.$transaction(async (tx) => {
    // PageUsageEvent is company-protected by Row-Level Security: say which company this is.
    await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, true)`;
    const okProject = await addToScope(
      tx,
      projectScope(projectId),
      period,
      pages,
      project.monthlyPageLimit
    );
    if (!okProject) {
      const used = await currentUsage(tx, projectScope(projectId), period);
      const left = Math.max(0, project.monthlyPageLimit - used);
      throw new AppError(
        "QUOTA_001",
        `Monthly AI page limit reached for "${project.name}" (${used}/${project.monthlyPageLimit} pages used, ${left} left, this file needs ${pages}). It resets next month; ask an admin to raise the limit.`
      );
    }

    const okCompany = await addToScope(tx, companyScope(orgId), period, pages, companyLimit);
    if (!okCompany) {
      throw new AppError(
        "QUOTA_001",
        "The company-wide monthly AI page limit has been reached. Ask an admin to raise it."
      );
    }

    const event = await tx.pageUsageEvent.create({
      data: {
        organizationId: orgId,
        projectId,
        userId,
        fileHash,
        period,
        pagesReserved: pages,
        status: "RESERVED",
      },
      select: { id: true },
    });
    return { eventId: event.id, period };
  });
}

async function currentUsage(tx: Tx, scopeKey: string, period: string) {
  const row = await tx.pageUsage.findUnique({
    where: { scopeKey_period: { scopeKey, period } },
    select: { pagesUsed: true },
  });
  return row?.pagesUsed ?? 0;
}

/** After Azure answers: correct the counters to the real page count. */
export async function settlePages(orgId: string, eventId: string, actualPages: number) {
  await rawDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, true)`;
    const event = await tx.pageUsageEvent.findUnique({ where: { id: eventId } });
    if (!event || event.status !== "RESERVED") return;
    const delta = actualPages - event.pagesReserved;
    await shiftScope(tx, projectScope(event.projectId), event.period, delta);
    if (event.organizationId) {
      await shiftScope(tx, companyScope(event.organizationId), event.period, delta);
    }
    await tx.pageUsageEvent.update({
      where: { id: eventId },
      data: { status: "CONSUMED", pagesActual: actualPages },
    });
  });
}

/** Give the pages back after OUR failure (storage/Azure error). Idempotent. */
export async function refundPages(orgId: string, eventId: string, reason: string) {
  await rawDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, true)`;
    const claimed = await tx.pageUsageEvent.updateMany({
      where: { id: eventId, status: "RESERVED" },
      data: { status: "REFUNDED", reason: reason.slice(0, 500), pagesActual: 0 },
    });
    if (claimed.count === 0) return;
    const event = await tx.pageUsageEvent.findUnique({ where: { id: eventId } });
    if (!event) return;
    await shiftScope(tx, projectScope(event.projectId), event.period, -event.pagesReserved);
    if (event.organizationId) {
      await shiftScope(tx, companyScope(event.organizationId), event.period, -event.pagesReserved);
    }
  });
}

export async function attachInvoiceToEvent(orgId: string, eventId: string, invoiceId: string) {
  await rawDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, true)`;
    await tx.pageUsageEvent.updateMany({
      where: { id: eventId, organizationId: orgId },
      data: { invoiceId },
    });
  });
}

export type UsageSummary = {
  period: string;
  companyUsed: number;
  companyLimit: number | null;
  byProject: Record<string, number>;
};

/**
 * Usage numbers for the admin screens (current month). Project counters are
 * only returned for the given project ids, so one company never sees another's.
 */
export async function getUsageSummary(
  orgId: string,
  projectIds: string[]
): Promise<UsageSummary> {
  const period = await periodForCompany(orgId);
  const scopeKeys = [companyScope(orgId), ...projectIds.map(projectScope)];
  const [rows, companyLimit] = await Promise.all([
    rawDb.pageUsage.findMany({ where: { period, scopeKey: { in: scopeKeys } } }),
    getCompanyPageLimit(orgId),
  ]);
  const byProject: Record<string, number> = {};
  let companyUsed = 0;
  for (const row of rows) {
    if (row.scopeKey === companyScope(orgId)) companyUsed = row.pagesUsed;
    else if (row.scopeKey.startsWith("PROJECT:")) {
      byProject[row.scopeKey.slice("PROJECT:".length)] = row.pagesUsed;
    }
  }
  return { period, companyUsed, companyLimit, byProject };
}
