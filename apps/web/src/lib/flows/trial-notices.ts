import { rawDb } from "@/lib/db";
import { absoluteUrl } from "@/lib/app-url";
import { sendMail } from "@/lib/email/transport";
import { trialEndedMail, trialEndingMail } from "@/lib/email/templates";
import { daysLeft, trialNoticeDue, type NoticeKind } from "@/lib/plans/trial-notice";

/**
 * Tells company administrators their trial is about to end (3 days or less left) and, once, that it has ended. A scheduler
 * calls this every hour (POST /api/jobs/trial-notices). Each notice is claimed in the database BEFORE it is sent, so two runs at
 * the same moment cannot both send; if nothing could be delivered the claim is handed back so the next run tries again.
 * Extending a trial clears the marks (see extendTrial), so the extended trial is announced again.
 */

export type TrialNoticeRun = { checked: number; ending: number; ended: number; emails: number; noRecipients: number; failed: number };

const FIELD: Record<NoticeKind, "trialEndingNoticeAt" | "trialEndedNoticeAt"> = { ending: "trialEndingNoticeAt", ended: "trialEndedNoticeAt" };

export async function sendTrialNotices(opts: { now?: Date } = {}): Promise<TrialNoticeRun> {
  const now = opts.now ?? new Date();
  const run: TrialNoticeRun = { checked: 0, ending: 0, ended: 0, emails: 0, noRecipients: 0, failed: 0 };
  const cutoff = new Date(now.getTime() - 8 * 86_400_000);

  const subs = await rawDb.subscription.findMany({
    where: { status: "TRIALING", trialEndsAt: { gt: cutoff }, organization: { status: { in: ["TRIAL", "ACTIVE", "PAST_DUE"] } } },
    select: { id: true, organizationId: true, trialEndsAt: true, trialEndingNoticeAt: true, trialEndedNoticeAt: true, organization: { select: { name: true, displayName: true, primaryColor: true, supportEmail: true } } },
  });

  for (const sub of subs) {
    run.checked++;
    const kind = trialNoticeDue({ trialEndsAt: sub.trialEndsAt, endingNoticeAt: sub.trialEndingNoticeAt, endedNoticeAt: sub.trialEndedNoticeAt, now });
    if (!kind || !sub.trialEndsAt) continue;
    const field = FIELD[kind];

    const claimed = await rawDb.subscription.updateMany({ where: { id: sub.id, [field]: null, trialEndsAt: sub.trialEndsAt }, data: { [field]: now } });
    if (claimed.count !== 1) continue;
    const giveBack = () => rawDb.subscription.updateMany({ where: { id: sub.id, [field]: now }, data: { [field]: null } }).catch(() => undefined);

    try {
      const recipients = await rawDb.membership.findMany({
        where: { organizationId: sub.organizationId, role: "ADMIN", user: { deletedAt: null, emailVerifiedAt: { not: null } } },
        select: { user: { select: { name: true, email: true } } },
      });
      if (recipients.length === 0) {
        await giveBack();
        run.noRecipients++;
        continue;
      }
      const company = sub.organization.displayName || sub.organization.name;
      const brand = { name: company, color: sub.organization.primaryColor, supportEmail: sub.organization.supportEmail };
      const link = absoluteUrl("/plan");
      let delivered = 0;
      for (const r of recipients) {
        const mail =
          kind === "ending"
            ? trialEndingMail(r.user.email, { name: r.user.name, company, days: daysLeft(sub.trialEndsAt, now), link, brand })
            : trialEndedMail(r.user.email, { name: r.user.name, company, link, brand });
        if ((await sendMail(mail)).ok) delivered++;
      }
      if (delivered === 0) {
        await giveBack();
        run.failed++;
        continue;
      }
      run[kind]++;
      run.emails += delivered;
    } catch (error) {
      await giveBack();
      console.error("[trial notices] company failed:", sub.organizationId, error instanceof Error ? error.message : error);
      run.failed++;
    }
  }
  return run;
}
