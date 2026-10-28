// When a company that has gone quiet gets a friendly check-in email. Pure rules, no database.

/** Nobody in the company has done anything for this many days. */
export const QUIET_AFTER_DAYS = 14;
/** A company quiet for longer than this is treated as gone and left alone. */
export const QUIET_GIVE_UP_DAYS = 90;
/** After a check-in, wait this long before another. */
export const QUIET_COOLDOWN_DAYS = 30;

const DAY = 86_400_000;

export type QuietInput = {
  status: string;
  createdAt: Date;
  lastActiveAt: Date | null;
  lastNoticeAt: Date | null;
  now: Date;
};

/** Whole days the company has been quiet, or null when it should not be written to now. */
export function quietDays(i: QuietInput): number | null {
  if (i.status !== "TRIAL" && i.status !== "ACTIVE") return null;
  const last = i.lastActiveAt ?? i.createdAt;
  const idle = Math.floor((i.now.getTime() - last.getTime()) / DAY);
  if (idle < QUIET_AFTER_DAYS || idle > QUIET_GIVE_UP_DAYS) return null;
  if (i.lastNoticeAt && i.now.getTime() - i.lastNoticeAt.getTime() < QUIET_COOLDOWN_DAYS * DAY) return null;
  return idle;
}
