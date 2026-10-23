import { rawDb } from "@/lib/db";
import { dbFor } from "@/lib/org/scoped-db";
import { absoluteUrl } from "@/lib/app-url";
import { sendMail } from "@/lib/email/transport";
import { digestMail, type DigestItem, type DigestSection } from "@/lib/email/templates";
import { formatFromOrg, makeFormatters } from "@/lib/brand/format";
import { loadAttention } from "@/lib/invoices/attention";
import { todayIn } from "@/lib/invoices/status";
import { companyLock } from "@/lib/plans/lock";
import { loadBudgetAlerts } from "@/lib/projects/budget-alerts";
import type { Owed } from "@/lib/invoices/ageing";

/**
 * The daily email to company administrators. A scheduler calls this once an hour (POST /api/jobs/digest); each company gets
 * its email ONCE a day, from DIGEST_HOUR (default 8) in the company's own time zone, and only when something needs attention
 * (overdue, due in the next 7 days, or waiting for review). Locked companies get nothing. People can turn it off on their Account page.
 */

export function digestHour() {
  const n = Number(process.env.DIGEST_HOUR);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : 8;
}

/** The hour (0-23) it is right now in a time zone. */
export function hourIn(timeZone: string, now: Date): number {
  try {
    const h = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).formatToParts(now).find((p) => p.type === "hour")?.value;
    return Number(h ?? 0) % 24;
  } catch {
    return now.getUTCHours();
  }
}

export type DigestRun = { checked: number; sent: number; emails: number; skipped: { early: number; alreadySent: number; locked: number; nothing: number; noRecipients: number }; failed: number };

export async function sendDailyDigests(opts: { now?: Date; hour?: number } = {}): Promise<DigestRun> {
  const now = opts.now ?? new Date();
  const hour = opts.hour ?? digestHour();
  const run: DigestRun = { checked: 0, sent: 0, emails: 0, skipped: { early: 0, alreadySent: 0, locked: 0, nothing: 0, noRecipients: 0 }, failed: 0 };

  const orgs = await rawDb.organization.findMany({
    where: { status: { in: ["TRIAL", "ACTIVE", "PAST_DUE"] } },
    select: { id: true, name: true, displayName: true, country: true, currency: true, timezone: true, primaryColor: true, supportEmail: true, digestSentOn: true },
  });

  for (const org of orgs) {
    run.checked++;
    const fmt = makeFormatters(formatFromOrg(org));
    const zone = fmt.format.timeZone;
    if (hourIn(zone, now) < hour) {
      run.skipped.early++;
      continue;
    }
    const today = todayIn(zone, now);
    if (org.digestSentOn === today) {
      run.skipped.alreadySent++;
      continue;
    }
    if ((await companyLock(org.id)).locked) {
      run.skipped.locked++;
      continue;
    }

    // Claim today before doing anything else: two runs at the same moment cannot both send.
    const claimed = await rawDb.organization.updateMany({
      where: { id: org.id, OR: [{ digestSentOn: null }, { digestSentOn: { not: today } }] },
      data: { digestSentOn: today },
    });
    if (claimed.count !== 1) {
      run.skipped.alreadySent++;
      continue;
    }

    try {
      const { summary, drafts } = await loadAttention(dbFor(org.id), {}, zone);
      const budgets = await loadBudgetAlerts(dbFor(org.id));
      if (summary.overdue.count === 0 && summary.dueSoon.count === 0 && drafts === 0 && budgets.length === 0) {
        run.skipped.nothing++;
        continue;
      }
      const recipients = await rawDb.membership.findMany({
        where: { organizationId: org.id, role: "ADMIN", user: { deletedAt: null, emailVerifiedAt: { not: null }, emailDigest: true } },
        select: { user: { select: { name: true, email: true } } },
      });
      if (recipients.length === 0) {
        run.skipped.noRecipients++;
        continue;
      }

      const money = (minor: number) => fmt.money(minor / 100, 2);
      const item = (o: Owed): DigestItem => ({
        vendor: o.vendorName,
        number: o.invoiceNumber,
        project: o.projectName,
        balance: money(o.balanceMinor),
        when: o.daysLate === null ? "no due date" : o.daysLate > 0 ? `${o.daysLate} day${o.daysLate === 1 ? "" : "s"} late` : o.daysLate === 0 ? "due today" : `due in ${-o.daysLate} day${o.daysLate === -1 ? "" : "s"}`,
      });
      const section = (count: number, minor: number, items: Owed[]): DigestSection => ({ count, amount: money(minor), items: items.map(item) });
      const company = org.displayName || org.name;
      const brand = { name: company, color: org.primaryColor, supportEmail: org.supportEmail };

      let delivered = 0;
      for (const r of recipients) {
        const res = await sendMail(
          digestMail(r.user.email, {
            name: r.user.name,
            company,
            overdue: section(summary.overdue.count, summary.overdue.amountMinor, summary.overdue.oldest),
            dueSoon: section(summary.dueSoon.count, summary.dueSoon.amountMinor, summary.dueSoon.items),
            drafts,
            budgets: budgets.map((b) => ({ name: b.name, percent: b.percent, spent: money(b.spentMinor), budget: money(b.budgetMinor), over: b.level === "over" })),
            link: absoluteUrl("/dashboard"),
            brand,
          }),
        );
        if (res.ok) delivered++;
      }
      if (delivered === 0) {
        // Nothing went out (mail server down): give today back so the next hourly run tries again.
        await rawDb.organization.updateMany({ where: { id: org.id, digestSentOn: today }, data: { digestSentOn: org.digestSentOn } });
        run.failed++;
        continue;
      }
      run.sent++;
      run.emails += delivered;
    } catch (error) {
      await rawDb.organization.updateMany({ where: { id: org.id, digestSentOn: today }, data: { digestSentOn: org.digestSentOn } }).catch(() => undefined);
      console.error("[digest] company failed:", org.id, error instanceof Error ? error.message : error);
      run.failed++;
    }
  }
  return run;
}
