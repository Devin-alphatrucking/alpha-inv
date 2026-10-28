import { rawDb } from "@/lib/db";
import { absoluteUrl } from "@/lib/app-url";
import { sendMail } from "@/lib/email/transport";
import { quietCheckInMail } from "@/lib/email/templates";
import { QUIET_AFTER_DAYS, QUIET_GIVE_UP_DAYS, quietDays } from "@/lib/plans/quiet-notice";

/**
 * A friendly check-in to the administrators of a company that nobody has used for two weeks (not after 90 days, not more than
 * once a month). A scheduler calls this every hour (POST /api/jobs/quiet-notices). The notice is claimed in the database BEFORE
 * it is sent, so two runs at the same moment cannot both send; if nothing could be delivered the claim is handed back.
 */

export type QuietNoticeRun = { checked: number; sent: number; emails: number; noRecipients: number; failed: number };

export async function sendQuietNotices(opts: { now?: Date } = {}): Promise<QuietNoticeRun> {
  const now = opts.now ?? new Date();
  const run: QuietNoticeRun = { checked: 0, sent: 0, emails: 0, noRecipients: 0, failed: 0 };
  const DAY = 86_400_000;
  const quietBefore = new Date(now.getTime() - QUIET_AFTER_DAYS * DAY);
  const goneBefore = new Date(now.getTime() - (QUIET_GIVE_UP_DAYS + 1) * DAY);

  const orgs = await rawDb.organization.findMany({
    where: {
      status: { in: ["TRIAL", "ACTIVE"] },
      createdAt: { lt: quietBefore },
      OR: [{ lastActiveAt: { lt: quietBefore, gt: goneBefore } }, { lastActiveAt: null, createdAt: { gt: goneBefore } }],
    },
    select: { id: true, name: true, displayName: true, status: true, createdAt: true, lastActiveAt: true, quietNoticeAt: true, primaryColor: true, supportEmail: true },
  });

  for (const org of orgs) {
    run.checked++;
    const days = quietDays({ status: org.status, createdAt: org.createdAt, lastActiveAt: org.lastActiveAt, lastNoticeAt: org.quietNoticeAt, now });
    if (days === null) continue;

    const claimed = await rawDb.organization.updateMany({ where: { id: org.id, quietNoticeAt: org.quietNoticeAt }, data: { quietNoticeAt: now } });
    if (claimed.count !== 1) continue;
    const giveBack = () => rawDb.organization.updateMany({ where: { id: org.id, quietNoticeAt: now }, data: { quietNoticeAt: org.quietNoticeAt } }).catch(() => undefined);

    try {
      const recipients = await rawDb.membership.findMany({
        where: { organizationId: org.id, role: "ADMIN", user: { deletedAt: null, emailVerifiedAt: { not: null } } },
        select: { user: { select: { name: true, email: true } } },
      });
      if (recipients.length === 0) {
        await giveBack();
        run.noRecipients++;
        continue;
      }
      const company = org.displayName || org.name;
      const brand = { name: company, color: org.primaryColor, supportEmail: org.supportEmail };
      const link = absoluteUrl("/dashboard");
      let delivered = 0;
      for (const r of recipients) {
        if ((await sendMail(quietCheckInMail(r.user.email, { name: r.user.name, company, days, link, brand }))).ok) delivered++;
      }
      if (delivered === 0) {
        await giveBack();
        run.failed++;
        continue;
      }
      run.sent++;
      run.emails += delivered;
    } catch (error) {
      await giveBack();
      console.error("[quiet notices] company failed:", org.id, error instanceof Error ? error.message : error);
      run.failed++;
    }
  }
  return run;
}
