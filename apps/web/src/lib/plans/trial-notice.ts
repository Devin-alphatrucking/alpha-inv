// When a company on a trial is told that its trial is about to end, or has ended. Pure rules, no database.

export type NoticeKind = "ending" | "ended";

export const ENDING_DAYS = 3;
/** A trial that ended longer ago than this is not announced (so switching this on does not write to long-gone trials). */
export const ENDED_WINDOW_DAYS = 7;

const DAY = 86_400_000;

export type TrialNoticeInput = {
  trialEndsAt: Date | null;
  endingNoticeAt: Date | null;
  endedNoticeAt: Date | null;
  now: Date;
};

/** Which notice (if any) is due now. Each is sent once per trial; extending a trial clears the marks so it is told again. */
export function trialNoticeDue(i: TrialNoticeInput): NoticeKind | null {
  if (!i.trialEndsAt) return null;
  const left = i.trialEndsAt.getTime() - i.now.getTime();
  if (left > 0) return left <= ENDING_DAYS * DAY && !i.endingNoticeAt ? "ending" : null;
  return -left <= ENDED_WINDOW_DAYS * DAY && !i.endedNoticeAt ? "ended" : null;
}

/** Whole days left, counting a part day as a day (the same way the console counts it). */
export function daysLeft(trialEndsAt: Date, now: Date): number {
  return Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / DAY));
}
