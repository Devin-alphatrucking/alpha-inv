import { rawDb } from "@/lib/db";
import { companyTimeZone } from "./company-tz";
import { todayIn } from "./status";

/**
 * Marks invoices OVERDUE once their whole due day has passed in the company's time zone. There is no scheduled job; this runs when
 * a page or the mobile API reads invoices, at most once every few minutes per company per server process, so lists, the
 * dashboard and the "Overdue" filter are never stale. Paying (or editing the due date) works the status out again with the same rule.
 */
const EVERY_MS = 5 * 60_000;
const lastRun = new Map<string, number>();

export async function syncOverdue(orgId: string, opts: { force?: boolean; now?: Date } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const last = lastRun.get(orgId) ?? 0;
  if (!opts.force && now.getTime() - last < EVERY_MS) return 0;
  lastRun.set(orgId, now.getTime());
  try {
    const today = todayIn(await companyTimeZone(orgId), now);
    return await rawDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, true)`;
      return tx.$executeRaw`
        UPDATE "Invoice" SET "status" = 'OVERDUE', "updatedAt" = now()
        WHERE "organizationId" = ${orgId}
          AND "status" IN ('UNPAID', 'PARTIALLY_PAID')
          AND "dueDate" IS NOT NULL
          AND "dueDate"::date < ${today}::date`;
    });
  } catch (error) {
    lastRun.delete(orgId); // try again on the next read; never break the page for this
    console.error("[overdue] sync failed:", error instanceof Error ? error.message : error);
    return 0;
  }
}
