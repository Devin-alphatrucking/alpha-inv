// Invoice status rules. Pure functions, unit-tested (status.test.ts). Money is compared in whole paise so floating point
// can never turn 0.1 + 0.2 into "not fully paid".

export type InvoiceStatusValue = "PROCESSING" | "NEEDS_REVIEW" | "UNPAID" | "PARTIALLY_PAID" | "PAID" | "OVERDUE";

/** Rounds to 2 decimals the way people expect (1.005 becomes 1.01). */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Whole paise/cents. */
export const toMinor = (n: number): number => Math.round((n + Number.EPSILON) * 100);

/** Today's calendar date in the company's time zone, as YYYY-MM-DD. */
export function todayIn(timeZone: string | null | undefined, now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/**
 * Due dates are calendar dates (stored as midnight UTC). An invoice is overdue only once the whole due day has
 * passed in the company's time zone: due today is not overdue yet.
 */
export function isPastDue(dueDate: Date | null | undefined, timeZone: string | null | undefined, now: Date = new Date()): boolean {
  if (!dueDate || Number.isNaN(dueDate.getTime())) return false;
  return todayIn(timeZone, now) > dueDate.toISOString().slice(0, 10);
}

/**
 * The status of a confirmed invoice from what has been paid.
 *  paid in full                  -> PAID
 *  something still owed, past due -> OVERDUE (whether or not part was paid)
 *  part paid                     -> PARTIALLY_PAID
 *  nothing paid                  -> UNPAID
 */
export function computeStatus(input: { total: number; paid: number; dueDate: Date | null | undefined; timeZone?: string | null; now?: Date }): "PAID" | "OVERDUE" | "PARTIALLY_PAID" | "UNPAID" {
  const total = toMinor(input.total);
  const paid = toMinor(input.paid);
  // A zero-value invoice has nothing to pay; one paise of slack matches how amounts are entered.
  if (paid >= total - 1 && (paid > 0 || total <= 0)) return "PAID";
  if (isPastDue(input.dueDate, input.timeZone, input.now)) return "OVERDUE";
  return paid > 0 ? "PARTIALLY_PAID" : "UNPAID";
}

/** Largest payment still allowed (never negative). */
export function remainingMinor(total: number, paid: number): number {
  return Math.max(0, toMinor(total) - toMinor(paid));
}
