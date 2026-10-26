import { toMinor } from "./status";

// Payables ageing and "what needs attention": pure functions over plain numbers and dates, unit-tested (ageing.test.ts).
// Amounts are whole paise/cents. A due date is a calendar date (midnight UTC); "today" is the company's calendar date as YYYY-MM-DD.

export type OwedInvoice = {
  id: string;
  invoiceNumber: string;
  vendorName: string;
  projectName: string;
  total: number;
  paid: number;
  dueDate: Date | null;
};

export type BucketKey = "current" | "d1_30" | "d31_60" | "d61_90" | "d90" | "noDue";

export const BUCKETS: { key: BucketKey; label: string }[] = [
  { key: "current", label: "Not yet due" },
  { key: "d1_30", label: "1-30 days late" },
  { key: "d31_60", label: "31-60 days late" },
  { key: "d61_90", label: "61-90 days late" },
  { key: "d90", label: "Over 90 days late" },
  { key: "noDue", label: "No due date" },
];

const DAY = 86_400_000;
const dayNumber = (ymd: string) => Math.floor(Date.parse(`${ymd}T00:00:00Z`) / DAY);

/** How many whole days past the due date (negative: still to come, 0: due today). null when there is no due date. */
export function daysLate(dueDate: Date | null, today: string): number | null {
  if (!dueDate || Number.isNaN(dueDate.getTime())) return null;
  return dayNumber(today) - dayNumber(dueDate.toISOString().slice(0, 10));
}

export function bucketFor(late: number | null): BucketKey {
  if (late === null) return "noDue";
  if (late <= 0) return "current";
  if (late <= 30) return "d1_30";
  if (late <= 60) return "d31_60";
  if (late <= 90) return "d61_90";
  return "d90";
}

export type Owed = OwedInvoice & { balanceMinor: number; daysLate: number | null; bucket: BucketKey };

export type AttentionSummary = {
  buckets: { key: BucketKey; label: string; count: number; amountMinor: number }[];
  owedMinor: number;
  overdue: { count: number; amountMinor: number; oldest: Owed[] };
  dueSoon: { count: number; amountMinor: number; items: Owed[] };
};

/** Every invoice with something still to pay, with its balance, how late it is and its age bucket (input order kept). */
export function owedInvoices(invoices: OwedInvoice[], today: string): Owed[] {
  const owed: Owed[] = [];
  for (const inv of invoices) {
    const balanceMinor = toMinor(inv.total) - toMinor(inv.paid);
    if (balanceMinor <= 0) continue; // nothing left to pay
    const late = daysLate(inv.dueDate, today);
    owed.push({ ...inv, balanceMinor, daysLate: late, bucket: bucketFor(late) });
  }
  return owed;
}

/** `soonDays`: how many days ahead (including today) counts as "due soon". */
export function summarise(invoices: OwedInvoice[], today: string, soonDays = 7, listSize = 5): AttentionSummary {
  const owed = owedInvoices(invoices, today);

  const buckets = BUCKETS.map((b) => {
    const inB = owed.filter((o) => o.bucket === b.key);
    return { ...b, count: inB.length, amountMinor: inB.reduce((s, o) => s + o.balanceMinor, 0) };
  });

  const late = owed.filter((o) => o.daysLate !== null && o.daysLate > 0).sort((a, b) => (b.daysLate ?? 0) - (a.daysLate ?? 0) || b.balanceMinor - a.balanceMinor);
  const soon = owed
    .filter((o) => o.daysLate !== null && o.daysLate <= 0 && o.daysLate >= -(soonDays - 1))
    .sort((a, b) => (b.daysLate ?? 0) - (a.daysLate ?? 0) || b.balanceMinor - a.balanceMinor);

  return {
    buckets,
    owedMinor: owed.reduce((s, o) => s + o.balanceMinor, 0),
    overdue: { count: late.length, amountMinor: late.reduce((s, o) => s + o.balanceMinor, 0), oldest: late.slice(0, listSize) },
    dueSoon: { count: soon.length, amountMinor: soon.reduce((s, o) => s + o.balanceMinor, 0), items: soon.slice(0, listSize) },
  };
}
